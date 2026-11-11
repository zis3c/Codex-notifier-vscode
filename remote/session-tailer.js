"use strict";

const {
  classifySessionMetadata,
  getUserMessageTurnId,
  isCurrentUserMessageLine,
  isHistoricalSessionCompletion,
  isHistoricalSessionRequest,
  parseSessionMetadata,
  parseRequestUserInputLine,
  parseTaskCompleteLine,
  parseUserMessageLine
} = require("./session-events");

const METADATA_BYTES = 64 * 1024;
const DISCOVERY_CACHE_MS = 5000;
const INITIAL_TAIL_BYTES = 4 * 1024 * 1024;
const PROMPT_LIMIT = 400;

function directoriesAt(fs, dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function findSessionFiles(fs, path, root) {
  const files = [];
  for (const year of directoriesAt(fs, root)) {
    const yearDir = path.join(root, year);
    for (const month of directoriesAt(fs, yearDir)) {
      const monthDir = path.join(yearDir, month);
      for (const day of directoriesAt(fs, monthDir)) {
        const dayDir = path.join(monthDir, day);
        let entries = [];
        try {
          entries = fs.readdirSync(dayDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
          const file = path.join(dayDir, entry.name);
          try {
            files.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
          } catch {
            // File may be rotated between listing and stat.
          }
        }
      }
    }
  }
  return files;
}

function readLocalChunk(fs, file, offset, size) {
  const fd = fs.openSync(file, "r");
  try {
    const length = Math.max(0, size - offset);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Tails Codex session JSONL files on the machine where this code runs.
 * The remote companion uses this so no session bytes cross the SSH connection;
 * only small event records are written for the local UI extension.
 */
function createSessionTailer({
  fs,
  path,
  sessionsRoot,
  onEvent,
  pollMs = 700,
  historyNotBeforeMs = Date.now(),
  discoveryCacheMs = DISCOVERY_CACHE_MS
}) {
  let timer = null;
  let started = false;
  let pollBusy = false;
  let filesCache = [];
  let filesCacheAt = 0;
  const offsets = new Map();
  const remainders = new Map();
  const sessionInfo = new Map();
  const completedTurnIds = new Set();
  const inputTurnIds = new Set();

  function getSessionInfo(file, size) {
    const cached = sessionInfo.get(file);
    if (cached) return cached;
    const metadata = parseSessionMetadata(readLocalChunk(fs, file, 0, Math.min(size, METADATA_BYTES)));
    if (!metadata) return undefined;

    const info = {
      ...classifySessionMetadata(metadata),
      sessionId: metadata.session_id || metadata.id || "",
      cwd: metadata.cwd || "",
      createdAtMs: Date.parse(metadata.timestamp || ""),
      prompt: ""
    };
    sessionInfo.set(file, info);
    return info;
  }

  function emit(event) {
    try {
      onEvent(event);
    } catch {
      // A failed event write must not stop the tailer.
    }
  }

  function processChunk(file, chunk, info) {
    const lines = ((remainders.get(file) || "") + chunk).split(/\r?\n/);
    remainders.set(file, lines.pop() || "");

    for (const line of lines) {
      const prompt = parseUserMessageLine(line);
      if (prompt) info.prompt = prompt;
      if (prompt && isCurrentUserMessageLine(line, historyNotBeforeMs)) {
        emit({
          kind: "user_message",
          at: Date.now(),
          sessionId: info.sessionId,
          sessionCwd: info.cwd,
          turnId: getUserMessageTurnId(line)
        });
      }

      const request = parseRequestUserInputLine(line);
      if (request) {
        const requestKey = `${info.sessionId || file}:${request.turnId || request.callId}`;
        if (!inputTurnIds.has(requestKey) && !isHistoricalSessionRequest(request, info, historyNotBeforeMs)) {
          inputTurnIds.add(requestKey);
          emit({
            kind: "input",
            at: Date.now(),
            sessionId: info.sessionId,
            sessionCwd: info.cwd,
            turnId: request.turnId || "",
            callId: request.callId || "",
            prompt: String(info.prompt || "").slice(0, PROMPT_LIMIT)
          });
        }
        continue;
      }

      const completion = parseTaskCompleteLine(line);
      const turnId = completion?.turnId;
      if (!turnId || completedTurnIds.has(turnId)) continue;
      if (isHistoricalSessionCompletion(completion, info, historyNotBeforeMs)) continue;
      completedTurnIds.add(turnId);
      emit({
        kind: "complete",
        at: Date.now(),
        sessionId: info.sessionId,
        sessionCwd: info.cwd,
        turnId,
        prompt: String(info.prompt || "").slice(0, PROMPT_LIMIT)
      });
    }
  }

  async function poll() {
    if (pollBusy) return;
    pollBusy = true;
    try {
      const now = Date.now();
      if (now - filesCacheAt >= discoveryCacheMs) {
        filesCache = findSessionFiles(fs, path, sessionsRoot).sort((a, b) => b.mtimeMs - a.mtimeMs);
        filesCacheAt = now;
      }

      const live = new Set(filesCache.map((entry) => entry.file));
      for (const known of Array.from(offsets.keys())) {
        if (!live.has(known)) {
          offsets.delete(known);
          remainders.delete(known);
          sessionInfo.delete(known);
        }
      }
      for (const known of Array.from(sessionInfo.keys())) {
        if (!live.has(known)) sessionInfo.delete(known);
      }

      for (const { file } of filesCache) {
        let size;
        try {
          size = fs.statSync(file).size;
        } catch {
          continue;
        }
        const info = getSessionInfo(file, size);
        if (!info?.eligible) continue;

        let offset = offsets.get(file);
        if (offset == null) {
          // Only bytes appended after the watcher started are relevant, so a
          // bounded tail read avoids loading large historical transcripts.
          offset = Math.max(0, size - INITIAL_TAIL_BYTES);
          offsets.set(file, offset);
          remainders.set(file, "");
        }
        if (size < offset) {
          offset = 0;
          remainders.set(file, "");
        }
        if (size === offset) continue;

        try {
          const chunk = readLocalChunk(fs, file, offset, size);
          offsets.set(file, size);
          processChunk(file, chunk, info);
        } catch {
          // File may be rotated between stat and read; retry next poll.
        }
      }
    } finally {
      pollBusy = false;
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      void poll();
      timer = setInterval(() => void poll(), Math.max(300, pollMs));
      if (typeof timer.unref === "function") timer.unref();
    },
    stop() {
      started = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
    pollOnce: poll
  };
}

module.exports = { createSessionTailer };
