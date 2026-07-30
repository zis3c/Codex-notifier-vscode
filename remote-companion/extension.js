const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const POLL_INTERVAL_MS = 1000;
const DISCOVERY_INTERVAL_MS = 5000;
const INITIAL_READ_LIMIT = 1024 * 1024;
const TURN_START = /Reasoning summary turn-start\b.*\bconversationId=([^\s]+)/;
const STREAM_INACTIVE = /thread_stream_view_activity_changed active=false\b.*\bconversationId=([^\s]+)/;

let timer;
let output;
let lastDiscoveryAt = 0;
let notificationCount = 0;
let lastNotificationAt = "never";
const offsets = new Map();
const pendingConversations = new Set();

function getOutput() {
  output ||= vscode.window.createOutputChannel("Codex Notifier Remote");
  return output;
}

function log(message) {
  getOutput().appendLine(`${new Date().toISOString()} ${message}`);
}

function getLogRoot() {
  const agentFolder = process.env.VSCODE_AGENT_FOLDER;
  if (agentFolder) {
    return path.join(agentFolder, "data", "logs");
  }
  return path.join(process.env.HOME || "", ".vscode-server", "data", "logs");
}

function discoverLogFiles() {
  const root = getLogRoot();
  let sessions;
  try {
    sessions = fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .slice(-4);
  } catch (error) {
    log(`log discovery failed at ${root}: ${error.message}`);
    return [];
  }

  const result = [];
  for (const session of sessions) {
    const sessionDir = path.join(root, session);
    let hosts = [];
    try {
      hosts = fs.readdirSync(sessionDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith("exthost"))
        .map(entry => entry.name);
    } catch {
      continue;
    }
    for (const host of hosts) {
      const candidate = path.join(sessionDir, host, "openai.chatgpt", "Codex.log");
      if (fs.existsSync(candidate)) {
        result.push(candidate);
      }
    }
  }
  return result;
}

function consumeLines(text, shouldNotify) {
  for (const line of text.split(/\r?\n/)) {
    const start = line.match(TURN_START);
    if (start) {
      pendingConversations.add(start[1]);
      continue;
    }

    const inactive = line.match(STREAM_INACTIVE);
    if (!inactive || !pendingConversations.delete(inactive[1])) {
      continue;
    }

    if (shouldNotify) {
      notificationCount += 1;
      lastNotificationAt = new Date().toISOString();
      log(`completion detected for conversation ${inactive[1]}`);
      void vscode.commands.executeCommand("codexNotifier.notifyComplete").then(
        () => log("forwarded completion to local Codex Notifier"),
        error => log(`failed to forward completion: ${error?.message || error}`)
      );
    }
  }
}

function initializeFile(file) {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - INITIAL_READ_LIMIT);
  const length = stat.size - start;
  if (length > 0) {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      consumeLines(buffer.toString("utf8"), false);
    } finally {
      fs.closeSync(fd);
    }
  }
  offsets.set(file, stat.size);
  log(`tracking ${file}`);
}

function initializeFiles(files) {
  const missing = files.filter(file => !offsets.has(file));
  if (!missing.length) {
    return;
  }

  if (offsets.size > 0) {
    for (const file of missing) {
      initializeFile(file);
    }
    return;
  }

  const initialLines = [];
  for (const file of missing) {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - INITIAL_READ_LIMIT);
    const length = stat.size - start;
    if (length > 0) {
      const fd = fs.openSync(file, "r");
      try {
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, start);
        initialLines.push(...buffer.toString("utf8").split(/\r?\n/));
      } finally {
        fs.closeSync(fd);
      }
    }
    offsets.set(file, stat.size);
    log(`tracking ${file}`);
  }

  // The same conversation can move between extension hosts. Rebuild its state
  // from all log tails in timestamp order rather than directory order.
  initialLines.sort();
  consumeLines(initialLines.join("\n"), false);
}

function pollFile(file) {
  try {
    if (!offsets.has(file)) {
      initializeFile(file);
      return;
    }

    const stat = fs.statSync(file);
    let offset = offsets.get(file);
    if (stat.size < offset) {
      offset = 0;
    }
    if (stat.size === offset) {
      return;
    }

    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buffer, 0, length, offset);
    } finally {
      fs.closeSync(fd);
    }
    offsets.set(file, stat.size);
    consumeLines(buffer.toString("utf8"), true);
  } catch (error) {
    log(`poll failed for ${file}: ${error.message}`);
    offsets.delete(file);
  }
}

function poll() {
  if (!vscode.workspace.getConfiguration("codexNotifierRemote").get("enabled", true)) {
    return;
  }

  const now = Date.now();
  if (now - lastDiscoveryAt >= DISCOVERY_INTERVAL_MS) {
    lastDiscoveryAt = now;
    try {
      initializeFiles(discoverLogFiles());
    } catch (error) {
      log(`initialization failed: ${error.message}`);
    }
  }
  for (const file of offsets.keys()) {
    pollFile(file);
  }
}

function diagnostics() {
  return {
    remoteName: vscode.env.remoteName || "none",
    logRoot: getLogRoot(),
    trackedLogFiles: [...offsets.keys()],
    pendingConversations: [...pendingConversations],
    notificationCount,
    lastNotificationAt
  };
}

function activate(context) {
  log(`activated remoteName=${vscode.env.remoteName || "none"}`);
  poll();
  timer = setInterval(poll, POLL_INTERVAL_MS);
  context.subscriptions.push(
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand("codexNotifierRemote.showDiagnostics", () => {
      const value = diagnostics();
      log(`diagnostics ${JSON.stringify(value)}`);
      getOutput().show(true);
      return value;
    })
  );
}

function deactivate() {
  clearInterval(timer);
  timer = undefined;
  output?.dispose();
  output = undefined;
}

module.exports = {
  activate,
  deactivate,
  _test: { consumeLines, diagnostics }
};
