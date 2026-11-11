"use strict";

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const extensionVersion = require("./package.json").version;
const { createSessionTailer } = require("./session-tailer");
const {
  inferRemoteHomePath,
  resolveRemoteSessionsPath,
  resolveRemoteEventsPath
} = require("./remote-paths");

const EVENT_TTL_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

let tailer = null;
let heartbeatTimer = null;
let eventsDir = null;

function getConfig() {
  return vscode.workspace.getConfiguration("codexNotifier");
}

function resolveSessionsRoot() {
  const configured = String(getConfig().get("remoteSessionsPath", "") || "").trim();
  if (configured) {
    if (path.isAbsolute(configured)) return configured;
    return "";
  }
  return path.join(os.homedir(), ".codex", "sessions");
}

function toNativePath(value) {
  if (process.platform === "win32" && /^\/[a-zA-Z]:\//.test(value)) {
    return value.slice(1).replace(/\//g, "\\");
  }
  return value;
}

// Use the same workspace-based cache location the local UI extension derives,
// so both sides agree even when the Codex home differs from the workspace home.
function resolveEventsDir() {
  const configured = String(getConfig().get("remoteSessionsPath", "") || "").trim();
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.path || "";
  const sessionsPath = resolveRemoteSessionsPath({
    configuredPath: configured,
    homePath: inferRemoteHomePath(workspacePath)
  });
  const eventsPath = resolveRemoteEventsPath(sessionsPath);
  return eventsPath
    ? toNativePath(eventsPath)
    : path.join(os.homedir(), ".codex", "codex-notifier-events");
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

function pruneEvents(dir, now = Date.now()) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name !== "agent.json" && !entry.name.endsWith(".json") && !entry.name.endsWith(".tmp")) continue;
    const file = path.join(dir, entry.name);
    try {
      if (now - fs.statSync(file).mtimeMs > EVENT_TTL_MS) fs.unlinkSync(file);
    } catch {
      // Another process may have removed it already.
    }
  }
}

function writeHeartbeat() {
  if (!eventsDir) return;
  try {
    writeJsonAtomic(path.join(eventsDir, "agent.json"), {
      version: extensionVersion,
      pid: process.pid,
      at: Date.now()
    });
  } catch {
    // The local UI extension simply sees no heartbeat.
  }
}

function stop() {
  if (tailer) tailer.stop();
  tailer = null;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function start() {
  stop();
  if (!vscode.env.remoteName) return;
  const sessionsRoot = resolveSessionsRoot();
  if (!sessionsRoot) return;

  eventsDir = resolveEventsDir();
  try {
    fs.mkdirSync(eventsDir, { recursive: true, mode: 0o700 });
  } catch {
    eventsDir = null;
    return;
  }

  let sequence = 0;
  const outputDir = eventsDir;
  const pollMsRaw = Number(getConfig().get("codexLogPollMs", 700));
  tailer = createSessionTailer({
    fs,
    path,
    sessionsRoot,
    pollMs: Number.isFinite(pollMsRaw) ? pollMsRaw : 700,
    onEvent: (event) => {
      writeJsonAtomic(
        path.join(outputDir, `${Date.now()}-${process.pid}-${sequence++}.json`),
        event
      );
    }
  });
  tailer.start();

  writeHeartbeat();
  pruneEvents(eventsDir);
  heartbeatTimer = setInterval(() => {
    writeHeartbeat();
    pruneEvents(eventsDir);
  }, HEARTBEAT_MS);
}

function activate(context) {
  start();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexNotifier.remoteSessionsPath")
        || event.affectsConfiguration("codexNotifier.codexLogPollMs")) {
        start();
      }
    })
  );
}

function deactivate() {
  stop();
}

module.exports = { activate, deactivate };
