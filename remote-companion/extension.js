const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const POLL_INTERVAL_MS = 500;
const DISCOVERY_INTERVAL_MS = 1000;
const LOCK_PATH = "/tmp/codex-notifier-remote-companion.lock";

let timer;
let output;
let lastDiscoveryAt = 0;
let notificationCount = 0;
let lastNotificationAt = "never";
let isLeader = false;
let hasCompletedInitialDiscovery = false;
const offsets = new Map();
const remainders = new Map();
const completedTurnIds = new Set();

function getOutput() {
  output ||= vscode.window.createOutputChannel("Codex Notifier Remote");
  return output;
}

function log(message) {
  getOutput().appendLine(`${new Date().toISOString()} ${message}`);
}

function getSessionsRoot() {
  const codexHome = process.env.CODEX_HOME
    || path.join(process.env.HOME || "", ".codex");
  return path.join(codexHome, "sessions");
}

function directoriesAt(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function discoverSessionFiles() {
  const root = getSessionsRoot();
  const result = [];
  for (const year of directoriesAt(root).slice(-2)) {
    const yearDir = path.join(root, year);
    for (const month of directoriesAt(yearDir).slice(-2)) {
      const monthDir = path.join(yearDir, month);
      for (const day of directoriesAt(monthDir).slice(-3)) {
        const dayDir = path.join(monthDir, day);
        try {
          for (const entry of fs.readdirSync(dayDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith(".jsonl")) {
              result.push(path.join(dayDir, entry.name));
            }
          }
        } catch {
          // The directory can disappear while Codex rotates session files.
        }
      }
    }
  }
  return result;
}

function parseSessionLine(line) {
  if (!line.includes('"task_complete"')) {
    return undefined;
  }
  try {
    const event = JSON.parse(line);
    if (event?.type === "event_msg" && event.payload?.type === "task_complete") {
      return event.payload.turn_id || `${event.timestamp || ""}:${line.length}`;
    }
  } catch {
    // A partial JSON line is retained and retried on the next poll.
  }
  return undefined;
}

function forwardCompletion(turnId) {
  if (completedTurnIds.has(turnId)) {
    return;
  }
  completedTurnIds.add(turnId);
  notificationCount += 1;
  lastNotificationAt = new Date().toISOString();
  log(`task_complete detected turnId=${turnId}`);
  void vscode.commands.executeCommand("codexNotifier.notifyComplete").then(
    () => log(`forwarded completion turnId=${turnId}`),
    error => log(`failed to forward completion turnId=${turnId}: ${error?.message || error}`)
  );
}

function consumeSessionText(file, text, shouldNotify) {
  const combined = (remainders.get(file) || "") + text;
  const lines = combined.split(/\r?\n/);
  remainders.set(file, lines.pop() || "");
  for (const line of lines) {
    const turnId = parseSessionLine(line);
    if (turnId && shouldNotify) {
      forwardCompletion(turnId);
    }
  }
}

function initializeFile(file, shouldReadFromStart) {
  const stat = fs.statSync(file);
  offsets.set(file, shouldReadFromStart ? 0 : stat.size);
  remainders.set(file, "");
  log(`tracking ${file} offset=${shouldReadFromStart ? 0 : stat.size}`);
}

function pollFile(file) {
  try {
    const stat = fs.statSync(file);
    let offset = offsets.get(file) || 0;
    if (stat.size < offset) {
      offset = 0;
      remainders.set(file, "");
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
    consumeSessionText(file, buffer.toString("utf8"), true);
  } catch (error) {
    log(`poll failed for ${file}: ${error.message}`);
    offsets.delete(file);
    remainders.delete(file);
  }
}

function acquireLeadership() {
  try {
    const fd = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") {
      log(`leader lock failed: ${error.message}`);
      return false;
    }
  }

  try {
    const ownerPid = Number(fs.readFileSync(LOCK_PATH, "utf8"));
    if (Number.isFinite(ownerPid) && ownerPid > 0) {
      process.kill(ownerPid, 0);
      log(`follower mode; leader pid=${ownerPid}`);
      return false;
    }
  } catch (error) {
    if (error.code !== "ESRCH" && error.code !== "ENOENT") {
      log(`leader check failed: ${error.message}`);
      return false;
    }
  }

  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // Another instance may already be replacing a stale lock.
  }
  return acquireLeadership();
}

function poll() {
  if (!isLeader
    || !vscode.workspace.getConfiguration("codexNotifierRemote").get("enabled", true)) {
    return;
  }

  const now = Date.now();
  if (now - lastDiscoveryAt >= DISCOVERY_INTERVAL_MS) {
    lastDiscoveryAt = now;
    for (const file of discoverSessionFiles()) {
      if (!offsets.has(file)) {
        try {
          // Files first seen after activation are new Codex sessions, so read
          // them from the beginning in case a very short task already ended.
          initializeFile(file, hasCompletedInitialDiscovery);
        } catch (error) {
          log(`initialization failed for ${file}: ${error.message}`);
        }
      }
    }
    hasCompletedInitialDiscovery = true;
  }
  for (const file of offsets.keys()) {
    pollFile(file);
  }
}

function diagnostics() {
  return {
    remoteName: vscode.env.remoteName || "none",
    sessionsRoot: getSessionsRoot(),
    isLeader,
    trackedSessionFiles: [...offsets.keys()],
    notificationCount,
    lastNotificationAt
  };
}

function activate(context) {
  log(`activated remoteName=${vscode.env.remoteName || "none"} pid=${process.pid}`);
  isLeader = acquireLeadership();
  if (isLeader) {
    log("leader mode");
    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);
  }
  context.subscriptions.push(
    {
      dispose: () => {
        clearInterval(timer);
        if (isLeader) {
          try {
            if (Number(fs.readFileSync(LOCK_PATH, "utf8")) === process.pid) {
              fs.unlinkSync(LOCK_PATH);
            }
          } catch {
            // The lock may already be gone during shutdown.
          }
        }
      }
    },
    vscode.commands.registerCommand("codexNotifierSessionWatcher.showDiagnostics", () => {
      const value = diagnostics();
      log(`diagnostics ${JSON.stringify(value)}`);
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
  _test: { consumeSessionText, parseSessionLine, diagnostics }
};
