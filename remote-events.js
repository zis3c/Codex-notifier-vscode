"use strict";

/**
 * Polls a remote directory for tiny JSON event files written by the Codex
 * Notifier Remote companion. Reading only these files keeps session logs on
 * the remote host, so Remote SSH never transfers the JSONL transcripts.
 */
function createRemoteEventBridge({ vscode, dirUri, onEvent, pollMs = 1000 }) {
  let timer = null;
  let busy = false;
  let stopped = true;

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      let entries;
      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        return;
      }
      entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File) continue;
        if (!name.endsWith(".json") || name === "agent.json") continue;
        const fileUri = vscode.Uri.joinPath(dirUri, name);
        try {
          const bytes = await vscode.workspace.fs.readFile(fileUri);
          const event = JSON.parse(Buffer.from(bytes).toString("utf8"));
          await onEvent(event);
        } catch {
          // Malformed or concurrently removed event files are discarded.
        }
        try {
          await vscode.workspace.fs.delete(fileUri);
        } catch {
          // Another window may have consumed it first.
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void poll();
      timer = setInterval(() => void poll(), pollMs);
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    pollOnce: poll
  };
}

module.exports = { createRemoteEventBridge };
