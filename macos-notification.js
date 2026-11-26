"use strict";

const fs = require("fs");
// This helper only runs on macOS, so path rules must stay POSIX on any host OS.
const path = require("path").posix;
const { execFile } = require("child_process");

// VS Code started from Finder often does not inherit Homebrew's PATH.
function findTerminalNotifier(searchPath = process.env.PATH || "", isExecutable = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}) {
  const directories = [
    ...searchPath.split(path.delimiter),
    "/opt/homebrew/bin", // Apple silicon
    "/usr/local/bin" // Intel Homebrew
  ];
  for (const directory of new Set(directories)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, "terminal-notifier");
    if (isExecutable(candidate)) return candidate;
  }
  return "";
}

// asExternalUri adds a windowId so the URI is handled in the notifying
// VS Code window. When a top-level local Codex thread ID is available, ask the
// Codex extension to open that conversation. Its /local/<id> URI is currently
// supported in practice but is not a documented public API. Manual events,
// remote sessions, and invalid IDs retain the notifier's own focus-only URI.
async function buildMacOSFocusUri(vscode, threadId = "") {
  const id = String(threadId || "").trim();
  const isUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
  // A Remote SSH session ID has no local chat to open.
  const canOpenThread = isUuid && !vscode.env.remoteName;
  const internalUri = canOpenThread
    ? vscode.Uri.parse(`${vscode.env.uriScheme}://openai.chatgpt/local/${id}`)
    : vscode.Uri.parse(`${vscode.env.uriScheme}://zis3c.codex-notifier/focus`);
  const externalUri = await vscode.env.asExternalUri(internalUri);
  return externalUri.toString();
}

function showMacOSNotification(title, message, clickUri = "", options = {}) {
  const run = options.execFile || execFile;
  const notifier = Object.prototype.hasOwnProperty.call(options, "notifier")
    ? options.notifier
    : findTerminalNotifier();
  const fallbackArgs = ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`];

  return new Promise((resolve) => {
    const fallback = () => run("osascript", fallbackArgs, () => resolve());
    if (!notifier) {
      fallback();
      return;
    }
    // Argument arrays avoid shell interpretation of prompts or deep-link URIs.
    const args = ["-title", String(title), "-message", String(message)];
    if (clickUri) args.push("-open", clickUri);
    run(notifier, args, (error) => {
      if (error) fallback();
      else resolve();
    });
  });
}

module.exports = { findTerminalNotifier, buildMacOSFocusUri, showMacOSNotification };
