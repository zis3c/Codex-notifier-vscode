const vscode = require("vscode");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const {
  isHistoricalSessionCompletion,
  isHistoricalSessionRequest,
  parseUserMessageLine,
  parseRequestUserInputLine,
  parseTaskCompleteLine
} = require("./session-events");
const { buildToastFocusLaunchUri } = require("./toast-focus");
const extensionVersion = require("./package.json").version;

/**
 * Codex Notifier extension runtime state.
 * These variables keep watcher/timer handles and burst tracking so we can
 * reliably detect "response complete" without duplicate notifications.
 */
let watchers = [];
let codexDocWatcher = null;
let codexPoller = null;
let codexState = new Map();
let lastCodexNotifyAt = 0;
let output = null;
let codexLogPoller = null;
let codexLogOffsets = new Map();
let codexLogRemainders = new Map();
let codexLogFilesCache = [];
let codexLogFilesCacheAt = 0;
let codexLogPollBusy = false;
let codexLogWatcherStartedAt = 0;
let codexCompletedTurnIds = new Set();
let codexInputRequestTurnIds = new Set();
let codexSessionInfo = new Map();
let statusItem = null;
let statusTimer = null;
const diagnosticEvents = new Map();
let lastNotificationAttemptAt = 0;
let lastNotificationResult = "none";

// Keep bounded metadata only. Never include notification text or transcript bodies.
function recordDiagnostic(code, source, detail) {
  const key = `${code}:${source}`;
  const previous = diagnosticEvents.get(key);
  const now = Date.now();
  const event = { code, source, detail, at: fmtTs(now), count: (previous?.count || 0) + 1 };
  event.loggedAt = previous?.loggedAt || 0;
  if (!previous || now - event.loggedAt >= 60000) {
    getOutput().appendLine(`[${event.at}] ${code}: ${source} ${detail}`);
    event.loggedAt = now;
  }
  diagnosticEvents.delete(key);
  diagnosticEvents.set(key, event);
  if (diagnosticEvents.size > 30) diagnosticEvents.delete(diagnosticEvents.keys().next().value);
}

function claimNotification(key) {
  const digest = crypto.createHash("sha256").update(String(key)).digest("hex");
  const lockPath = path.join(os.tmpdir(), `codex-notifier-${digest}.lock`);
  const staleMs = 24 * 60 * 60 * 1000;

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, String(Date.now()), "utf8");
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") return true;
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
        fs.unlinkSync(lockPath);
        return claimNotification(key);
      }
    } catch {
      return true;
    }
    return false;
  }
}

// Small helper for readable timestamps in diagnostics output.
function fmtTs(ms) {
  if (!ms) return "n/a";
  return new Date(ms).toISOString();
}

// Snapshot current runtime and config values for quick troubleshooting.
function getDiagnosticsSummary() {
  const cfg = getConfig();
  return {
    remoteName: vscode.env.remoteName || "local",
    workspaceSchemes: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.scheme).join(", ") || "none",
    monitorCodexLog: cfg.get("monitorCodexLog", true),
    monitorCodexChat: cfg.get("monitorCodexChat", true),
    codexLogPollMs: cfg.get("codexLogPollMs", 700),
    codexChatCooldownMs: cfg.get("codexChatCooldownMs", 5000),
    volume: cfg.get("volume", 1),
    trackedSessionFiles: codexLogOffsets.size,
    ignoredSessionFiles: [...codexSessionInfo.values()].filter((info) => !info.eligible).length,
    completedTurnIds: codexCompletedTurnIds.size,
    inputRequestTurnIds: codexInputRequestTurnIds.size,
    lastNotifyAt: fmtTs(lastCodexNotifyAt),
    lastNotificationAttemptAt: fmtTs(lastNotificationAttemptAt),
    lastNotificationResult
  };
}

// Main extension settings namespace.
function getConfig() {
  return vscode.workspace.getConfiguration("codexNotifier");
}

// Lazily create output channel used for the explicit diagnostics command.
function getOutput() {
  if (!output) {
    output = vscode.window.createOutputChannel("Codex Notifier");
  }
  return output;
}

// Retained as a no-op for internal call sites; routine runtime logging stays quiet.
function logDebug() {}

// Quiet UI feedback (status bar), used instead of intrusive info banners.
function showQuickStatus(message, kind) {
  const config = getConfig();
  const popupMsRaw = config.get("popupDurationMs", 1800);
  const popupMs = Number.isFinite(popupMsRaw) ? Math.max(300, popupMsRaw) : 1800;

  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  }

  statusItem.text = kind === "error" ? `$(error) ${message}` : `$(check) ${message}`;
  statusItem.tooltip = "Codex Notifier";
  statusItem.show();

  if (statusTimer) {
    clearTimeout(statusTimer);
  }
  statusTimer = setTimeout(() => {
    statusItem?.hide();
    statusTimer = null;
  }, popupMs);
}

// Optional Windows toast helper (kept for compatibility, currently quiet mode uses status bar).
function showWindowsToast(title, message, launchUri = "") {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve();
      return;
    }

    const escXml = (s) => String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    const actionXml = launchUri
      ? `<actions><action content="Open Codex" activationType="protocol" arguments="${escXml(launchUri)}"/></actions>`
      : "";
    const xml = `<toast${launchUri ? ` activationType="protocol" launch="${escXml(launchUri)}"` : ""}><visual><binding template="ToastGeneric"><text>${escXml(title)}</text><text>${escXml(message)}</text></binding></visual>${actionXml}</toast>`;
    const escapedXml = xml.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop';",
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;",
      `$xml = '${escapedXml}';`,
      "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument;",
      "$doc.LoadXml($xml);",
      "$toast = [Windows.UI.Notifications.ToastNotification]::new($doc);",
      "$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.VisualStudioCode');",
      "$notifier.Show($toast);"
    ].join(" ");

    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 10000 }, (error) => {
        resolve(error ? { status: "failed", code: String(error.code || error.name) } : { status: "submitted" });
      });
  });
}

// Cross-platform system notification helper for when VS Code is not focused.
function showSystemNotification(title, message, launchUri = "") {
  lastNotificationAttemptAt = Date.now();
  lastNotificationResult = "pending";
  const complete = (result) => {
    lastNotificationResult = result.status;
    if (result.status === "failed") {
      recordDiagnostic("system-notification-failed", process.platform, `code=${result.code}`);
    }
  };
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      void showWindowsToast(title, message, launchUri).then((result) => {
        complete(result);
        resolve();
      });
      return;
    }

    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`],
        (error) => {
          complete(error ? { status: "failed", code: String(error.code || error.name) } : { status: "submitted" });
          resolve();
        }
      );
      return;
    }

    if (process.platform === "linux") {
      execFile("notify-send", [title, message], (error) => {
        complete(error ? { status: "failed", code: String(error.code || error.name) } : { status: "submitted" });
        resolve();
      });
      return;
    }

    lastNotificationResult = "unsupported-platform";
    resolve();
  });
}

function getToastFocusTarget(sessionCwd = "") {
  const workspacePath = sessionCwd || vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || "";
  const workspaceName = sessionCwd
    ? path.basename(sessionCwd)
    : vscode.workspace.name || vscode.workspace.workspaceFolders?.[0]?.name || "";
  // For an automatic session notification, sessionCwd is the target signal.
  // Do not let the extension host that won dedupe override it with its PID.
  const windowPid = sessionCwd ? 0 : process.ppid;
  const activeFileName = vscode.window.activeTextEditor
    ? path.basename(vscode.window.activeTextEditor.document.fileName || "")
    : "";
  return { workspaceName, workspacePath, activeFileName, windowSessionId: getWindowSessionId(), windowPid };
}

function isWindowsWindowFocused() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(vscode.window.state.focused);
      return;
    }

    const script = "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ForegroundWindow { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid); public static uint GetPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; } }'; [ForegroundWindow]::GetPid()";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], (error, stdout) => {
      if (error) {
        resolve(vscode.window.state.focused);
        return;
      }
      const foregroundPid = Number(String(stdout || "").trim());
      resolve(Number.isInteger(foregroundPid) && foregroundPid === process.ppid);
    });
  });
}

function registerFocusedWindowsToastTarget() {
  if (process.platform !== "win32" || !getWindowSessionId()) return;
  recordWindowFocusHistory();
  const windowSessionId = getWindowSessionId();
  const sessionId = windowSessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  const handlePath = path.join(os.tmpdir(), `codex-notifier-window-${sessionId}.handle`);
  const script = "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ForegroundWindowHandle { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); }'; [ForegroundWindowHandle]::GetForegroundWindow().ToInt64()";
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], (error, stdout, stderr) => {
    if (error) {
      logDebug(`window registration failed session=${windowSessionId} error=${String(stderr || error.message || error).trim()}`);
      return;
    }
    const handle = Number(String(stdout || "").trim());
    if (Number.isSafeInteger(handle) && handle > 0) {
      try {
        fs.writeFileSync(handlePath, String(handle), "utf8");
        logDebug(`window registered session=${windowSessionId} handle=${handle}`);
      } catch {
        logDebug(`window registration write failed session=${windowSessionId}`);
      }
    } else {
      logDebug(`window registration returned invalid handle session=${windowSessionId} output=${String(stdout || "").trim()}`);
    }
  });
}

function getWindowFocusHistoryPath() {
  return path.join(os.tmpdir(), "codex-notifier-window-focus-history.jsonl");
}

function recordWindowFocusHistory() {
  if (process.platform !== "win32" || !getWindowSessionId() || !vscode.window.state.focused) return;
  try {
    const historyPath = getWindowFocusHistoryPath();
    const entries = fs.existsSync(historyPath)
      ? fs.readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean).slice(-99)
      : [];
    entries.push(JSON.stringify({ at: Date.now(), windowSessionId: getWindowSessionId() }));
    fs.writeFileSync(historyPath, `${entries.join("\n")}\n`, "utf8");
  } catch {
    // Focus history is best effort; direct owner registration remains available.
  }
}

function getFocusedWindowAt(timestampMs) {
  if (!Number.isFinite(timestampMs)) return "";
  try {
    const lines = fs.readFileSync(getWindowFocusHistoryPath(), "utf8").split(/\r?\n/).filter(Boolean);
    let owner = "";
    let latestAt = -Infinity;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (Number.isFinite(entry.at) && entry.at <= timestampMs && entry.at > latestAt) {
        latestAt = entry.at;
        owner = String(entry.windowSessionId || "");
      }
    }
    return owner;
  } catch {
    return "";
  }
}

function getSessionWindowOwnerPath(sessionId) {
  const safeSessionId = String(sessionId || "").replace(/[^A-Za-z0-9_-]/g, "_");
  return safeSessionId ? path.join(os.tmpdir(), `codex-notifier-session-${safeSessionId}.owner`) : "";
}

function getSessionTurnOwnerPath(sessionId, turnId) {
  const safeSessionId = String(sessionId || "").replace(/[^A-Za-z0-9_-]/g, "_");
  const safeTurnId = String(turnId || "").replace(/[^A-Za-z0-9_-]/g, "_");
  return safeSessionId && safeTurnId
    ? path.join(os.tmpdir(), `codex-notifier-session-${safeSessionId}-turn-${safeTurnId}.owner`)
    : "";
}

function getWindowSessionId() {
  return normalizeWindowSessionId(vscode.env.sessionId);
}

function normalizeWindowSessionId(value) {
  const raw = String(value || "");
  const match = raw.match(/^([0-9a-f-]{36})\d{13}$/i);
  return match ? match[1] : raw;
}

function recordFocusedSessionOwner(sessionId, ownerWindowSessionId = "", eventTimestampMs = 0, turnId = "") {
  if (process.platform !== "win32") return;
  const ownerPath = getSessionTurnOwnerPath(sessionId, turnId) || getSessionWindowOwnerPath(sessionId);
  const owner = ownerWindowSessionId || getWindowSessionId();
  if (!ownerPath || !owner) return;
  try {
    let previousTimestamp = -Infinity;
    if (fs.existsSync(ownerPath)) {
      try {
        const previous = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
        previousTimestamp = Number(previous.eventTimestampMs);
      } catch {
        // Legacy plain-text owner files have no timestamp and can be replaced.
      }
    }
    if (Number.isFinite(eventTimestampMs) && Number.isFinite(previousTimestamp) && previousTimestamp >= eventTimestampMs) {
      return;
    }
    const ownerRecord = JSON.stringify({ windowSessionId: String(owner), eventTimestampMs: Number(eventTimestampMs) || Date.now() });
    fs.writeFileSync(ownerPath, ownerRecord, "utf8");
    logDebug(`session owner recorded session=${sessionId} owner=${owner} event=${eventTimestampMs || "now"}`);
  } catch {
    // Ownership is best effort; workspace matching remains as a fallback.
  }
}

function getSessionWindowOwner(sessionId, turnId = "") {
  const ownerPath = getSessionTurnOwnerPath(sessionId, turnId) || getSessionWindowOwnerPath(sessionId);
  if (!ownerPath) return "";
  try {
    const raw = fs.readFileSync(ownerPath, "utf8").trim();
    try {
      return normalizeWindowSessionId(JSON.parse(raw).windowSessionId);
    } catch {
      return normalizeWindowSessionId(raw);
    }
  } catch {
    return "";
  }
}

function getUserMessageTurnId(line) {
  try {
    const event = JSON.parse(line);
    if (event?.type === "event_msg" && event.payload?.type === "user_message") {
      return String(event.payload.turn_id || "");
    }
    if (event?.type === "response_item" && event.payload?.type === "message" && event.payload.role === "user") {
      return String(event.payload.internal_chat_message_metadata_passthrough?.turn_id || event.payload.turn_id || "");
    }
  } catch {
    return "";
  }
  return "";
}

function isCurrentSessionUserMessage(line, historyNotBeforeMs) {
  if (!Number.isFinite(historyNotBeforeMs)) return true;
  try {
    const event = JSON.parse(line);
    const timestamp = Date.parse(event?.timestamp || "");
    return Number.isFinite(timestamp) && timestamp >= historyNotBeforeMs;
  } catch {
    return false;
  }
}

function installWindowsToastFocusHelper(context) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Toast window focus is only available on Windows."));
      return;
    }

    const wrapperPath = path.join(context.extensionPath, "windows-toast-focus.vbs").replace(/'/g, "''");
    const wscriptPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
    const commandValue = `"${wscriptPath}" "${wrapperPath}" "%1"`;
    const escapedCommand = commandValue.replace(/'/g, "''");
    const script = [
      "$key = 'HKCU:\\Software\\Classes\\codex-notifier';",
      "New-Item -Path $key -Force | Out-Null;",
      "Set-Item -Path $key -Value 'URL:Codex Notifier Toast Focus Protocol';",
      "New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null;",
      "New-Item -Path ($key + '\\shell\\open\\command') -Force | Out-Null;",
      `Set-Item -Path ($key + '\\shell\\open\\command') -Value '${escapedCommand}';`
    ].join(" ");

    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// Fallback alert tone when no custom sound file is configured.
function playSystemBeep() {
  process.stdout.write("\u0007");
}

// Resolve configured sound file path, else use bundled notification.wav if present.
function resolveSoundPath(configuredPath, kind = "complete") {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  // Kind-specific bundled defaults for users installing via VSIX.
  if (kind === "error") {
    const bundledError = path.join(__dirname, "notification1.wav");
    if (fs.existsSync(bundledError)) {
      return bundledError;
    }
  } else {
    const bundledComplete = path.join(__dirname, "notification2.wav");
    if (fs.existsSync(bundledComplete)) {
      return bundledComplete;
    }
  }

  // Backward compatibility fallback.
  const bundledLegacy = path.join(__dirname, "notification.wav");
  if (fs.existsSync(bundledLegacy)) {
    return bundledLegacy;
  }

  return "";
}

// Cross-platform sound player wrapper with Windows-first implementation.
function playSound(filePath, volume) {
  return new Promise((resolve) => {
    if (!filePath) {
      playSystemBeep();
      resolve();
      return;
    }

    const safeVolume = Number.isFinite(volume) ? String(Math.max(0, Math.min(1, volume))) : "1";

    if (process.platform === "win32") {
      const escapedPath = filePath.replace(/'/g, "''");
      const ext = path.extname(filePath).toLowerCase();

      // WAV playback via SoundPlayer is most reliable on Windows.
      if (ext === ".wav") {
        const script = [
          `if (-not (Test-Path -LiteralPath '${escapedPath}')) { exit 1 }`,
          `$p = New-Object System.Media.SoundPlayer '${escapedPath}';`,
          "$p.PlaySync();"
        ].join(" ");

        execFile("powershell.exe", ["-NoProfile", "-Command", script], (err) => {
          if (err) playSystemBeep();
          resolve();
        });
        return;
      }

      const script = [
        "Add-Type -AssemblyName presentationCore;",
        `if (-not (Test-Path -LiteralPath '${escapedPath}')) { exit 1 }`,
        `$resolved = (Resolve-Path -LiteralPath '${escapedPath}').Path;`,
        "$u = New-Object System.Uri($resolved);",
        "$p = New-Object system.windows.media.mediaplayer;",
        "$p.Open($u);",
        `$p.Volume = ${safeVolume};`,
        "$p.Play();",
        "Start-Sleep -Milliseconds 1400;",
        "$p.Close();"
      ].join(" ");

      execFile("powershell.exe", ["-NoProfile", "-Command", script], (err) => {
        if (err) playSystemBeep();
        resolve();
      });
      return;
    }

    if (process.platform === "darwin") {
      execFile("afplay", [filePath], () => resolve());
      return;
    }

    execFile("paplay", [filePath], () => resolve());
  });
}

/**
 * Main notification primitive.
 * - `kind`: "complete" or "error"
 * - `message`: user-facing text
 * - `options`: reserved for future mode flags
 */
async function notify(kind, message, _options = {}) {
  const config = getConfig();
  const enablePopup = config.get("enablePopup", true);
  const completionUseBanner = config.get("completionUseBanner", false);
  const toastWhenUnfocused = config.get("toastWhenUnfocused", true);
  const enableSound = config.get("enableSound", true);
  const isFocused = await isWindowsWindowFocused();
  const shouldSystemNotify = enablePopup && toastWhenUnfocused && !isFocused;
  logDebug(`notify state focused=${isFocused} systemToast=${shouldSystemNotify} key=${_options.dedupeKey || "manual"}`);

  // Let an unfocused window win the shared dedupe lock so it can show the
  // Windows toast. A focused window should not consume that event with a
  // banner while another window is in the background.
  if (_options.dedupeKey) {
    const workspacePriorityDelay = _options.workspaceMatch === false ? 500 : 0;
    if (!shouldSystemNotify || workspacePriorityDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(150, workspacePriorityDelay)));
    }
    if (!claimNotification(_options.dedupeKey)) {
      recordDiagnostic("notification-deduplicated", _options.dedupeKey, "Already claimed by another window or turn.");
      logDebug(`duplicate notification suppressed key=${_options.dedupeKey}`);
      return;
    }
  }

  const volumeRaw = config.get("volume", 1);
  const volume = Number.isFinite(volumeRaw) ? Math.max(0, Math.min(1, volumeRaw)) : 1;
  const completeSoundPath = config.get("completeSoundPath", "");
  const errorSoundPath = config.get("errorSoundPath", "");
  const focusExistingWindowOnToast = config.get("focusExistingWindowOnToast", true);
  if (focusExistingWindowOnToast) registerFocusedWindowsToastTarget();
  const notificationTitle = kind === "error"
    ? "Codex task error"
    : _options.waitingForInput || message.startsWith("Codex is waiting") || message.startsWith("Needs your input")
      ? "Codex needs your input"
      : "Codex task complete";
  const launchUri = focusExistingWindowOnToast
    ? buildToastFocusLaunchUri({
      ...getToastFocusTarget(_options.sessionCwd || ""),
      windowSessionId: _options.toastWindowSessionId || getWindowSessionId()
    })
    : "";

  if (enablePopup) {
    if (kind === "error") {
      if (shouldSystemNotify) {
        await showSystemNotification(notificationTitle, _options.toastMessage || message, launchUri);
      } else {
        vscode.window.showErrorMessage(message);
      }
    } else {
      if (shouldSystemNotify) {
        await showSystemNotification(notificationTitle, _options.toastMessage || message, launchUri);
      } else if (completionUseBanner) {
        vscode.window.showInformationMessage(message);
      } else {
        // Quiet mode: hide banner and show only status bar.
        showQuickStatus(message, kind);
      }
    }
  }

  if (enableSound) {
    const preferredPath = kind === "error" ? errorSoundPath : completeSoundPath;
    const soundPath = resolveSoundPath(preferredPath, kind);
    await playSound(soundPath, volume);
  }
}

// Stop file watcher trigger (".codex-notify").
function stopWatcher() {
  if (watchers.length > 0) {
    for (const watcher of watchers) {
      try {
        if (typeof watcher.dispose === "function") {
          watcher.dispose();
        } else if (typeof watcher.close === "function") {
          watcher.close();
        }
      } catch {
        // noop
      }
    }
  }
  watchers = [];
}

// Stop Codex document-based monitoring.
function stopCodexDocumentWatcher() {
  if (codexDocWatcher) {
    codexDocWatcher.dispose();
    codexDocWatcher = null;
  }

  if (codexPoller) {
    clearInterval(codexPoller);
    codexPoller = null;
  }
  codexState.clear();
}

// Stop Codex session monitoring and reset tail state.
function stopCodexLogWatcher() {
  if (codexLogPoller) {
    clearInterval(codexLogPoller);
    codexLogPoller = null;
  }
  codexLogOffsets.clear();
  codexLogRemainders.clear();
  codexLogFilesCache = [];
  codexLogFilesCacheAt = 0;
  codexLogPollBusy = false;
  codexLogWatcherStartedAt = 0;
  codexCompletedTurnIds.clear();
  codexInputRequestTurnIds.clear();
  codexSessionInfo.clear();
}

function inferRemoteHomePath(uriPath) {
  const parts = String(uriPath || "").replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0].toLowerCase() === "root") return "/root";
  if ((parts[0].toLowerCase() === "home" || parts[0].toLowerCase() === "users") && parts[1]) {
    return `/${parts[0]}/${parts[1]}`;
  }
  if (/^[a-zA-Z]:$/.test(parts[0]) && parts[1]) {
    if (parts[1].toLowerCase() === "users" && parts[2]) {
      return `/${parts[0]}/${parts[1]}/${parts[2]}`;
    }
    if (parts[1].toLowerCase() === "home" && parts[2]) {
      return `/${parts[0]}/${parts[1]}/${parts[2]}`;
    }
  }
  return null;
}

function getRemoteSourceUris() {
  const sourceUris = [];
  for (const folder of vscode.workspace.workspaceFolders || []) sourceUris.push(folder.uri);
  if (vscode.workspace.workspaceFile) sourceUris.push(vscode.workspace.workspaceFile);
  for (const doc of vscode.workspace.textDocuments || []) sourceUris.push(doc.uri);
  for (const editor of vscode.window.visibleTextEditors || []) sourceUris.push(editor.document.uri);
  return sourceUris.filter((uri) => uri?.scheme === "vscode-remote");
}

function getRemoteSessionRoots() {
  const configuredPath = String(getConfig().get("remoteSessionsPath", "") || "").trim();
  const roots = [];
  const seen = new Set();
  for (const uri of getRemoteSourceUris()) {
    const homePath = inferRemoteHomePath(uri.path);
    if (!configuredPath && !homePath) {
      recordDiagnostic("remote-home-unknown", uri.toString(), "Set remoteSessionsPath to the absolute remote sessions directory.");
      continue;
    }
    const sessionsPath = configuredPath
      ? configuredPath
      : `${homePath}/.codex/sessions`;
    if (!sessionsPath.startsWith("/")) {
      recordDiagnostic("remote-path-invalid", uri.authority || "remote", "remoteSessionsPath must be an absolute POSIX path, not ~ or a Windows path.");
      continue;
    }
    const root = uri.with({ path: sessionsPath, query: "", fragment: "" });
    const key = root.toString();
    if (!seen.has(key)) {
      seen.add(key);
      roots.push(root);
    }
  }
  return roots;
}

function getLocalSessionRoots() {
  const configuredPath = String(getConfig().get("localSessionsPath", "") || "").trim();
  if (configuredPath) return [configuredPath];
  const homeDir = os.homedir();
  return homeDir ? [path.join(homeDir, ".codex", "sessions")] : [];
}

function localDirectoriesAt(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function findLocalCodexSessionFiles() {
  const candidates = [];
  for (const root of getLocalSessionRoots()) {
    for (const year of localDirectoriesAt(root)) {
      const yearDir = path.join(root, year);
      for (const month of localDirectoriesAt(yearDir)) {
        const monthDir = path.join(yearDir, month);
        for (const day of localDirectoriesAt(monthDir)) {
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
              const stat = fs.statSync(file);
              candidates.push({
                key: `local-session:${file}`,
                kind: "local",
                file,
                mtimeMs: stat.mtimeMs
              });
            } catch {
              // File may be rotated between listing and stat.
            }
          }
        }
      }
    }
  }
  return candidates;
}

async function remoteDirectoriesAt(root) {
  try {
    return (await vscode.workspace.fs.readDirectory(root))
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name)
      .sort();
  } catch (error) {
    recordDiagnostic("remote-directory-read-failed", root.toString(), String(error.code || error.name || "unknown"));
    return [];
  }
}

async function findRemoteCodexSessionFiles() {
  const candidates = [];
  for (const root of getRemoteSessionRoots()) {
    for (const year of (await remoteDirectoriesAt(root))) {
      const yearDir = vscode.Uri.joinPath(root, year);
      for (const month of (await remoteDirectoriesAt(yearDir))) {
        const monthDir = vscode.Uri.joinPath(yearDir, month);
        for (const day of (await remoteDirectoriesAt(monthDir))) {
          const dayDir = vscode.Uri.joinPath(monthDir, day);
          let entries = [];
          try {
            entries = await vscode.workspace.fs.readDirectory(dayDir);
          } catch (error) {
            recordDiagnostic("remote-directory-read-failed", dayDir.toString(), String(error.code || error.name || "unknown"));
            continue;
          }
          for (const [name, type] of entries) {
            if (type !== vscode.FileType.File || !name.endsWith(".jsonl")) continue;
            const uri = vscode.Uri.joinPath(dayDir, name);
            try {
              const stat = await vscode.workspace.fs.stat(uri);
              candidates.push({
                key: `remote-session:${uri.toString()}`,
                kind: "remote",
                uri,
                mtimeMs: stat.mtime
              });
            } catch (error) {
              recordDiagnostic("remote-file-stat-failed", uri.toString(), String(error.code || error.name || "unknown"));
              // File may be rotated between listing and stat.
            }
          }
        }
      }
    }
  }
  return candidates;
}

async function findAllCodexSessionFiles() {
  const now = Date.now();
  if (now - codexLogFilesCacheAt < 5000) return codexLogFilesCache;

  const remoteRoots = getRemoteSessionRoots();
  // A remote workspace with an invalid/missing path must not silently monitor
  // unrelated sessions on the local UI machine.
  const isRemoteWorkspace = getRemoteSourceUris().length > 0 || Boolean(vscode.env.remoteName);
  const candidates = remoteRoots.length > 0 || isRemoteWorkspace
    ? await findRemoteCodexSessionFiles()
    : findLocalCodexSessionFiles();

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // Existing chats can be resumed after many newer sessions were created.
  // Do not drop old sessions by count or file age. Metadata loading remains
  // cheap because getSessionInfo reads only each file's first line.
  codexLogFilesCache = candidates;
  codexLogFilesCacheAt = now;
  return codexLogFilesCache;
}

async function getDetailedDiagnosticsSummary() {
  const summary = getDiagnosticsSummary();
  try {
    codexLogFilesCacheAt = 0;
    const sources = await findAllCodexSessionFiles();
    return {
      ...summary,
      extensionVersion,
      architecture: "single-ui-extension",
      remoteSessionRoots: getRemoteSessionRoots().map((uri) => uri.toString()),
      localSessionRoots: getLocalSessionRoots(),
      detectedSessionSources: sources.map((source) => source.key),
      eligibleSessionSources: sources
        .filter((source) => codexSessionInfo.get(source.key)?.eligible)
        .map((source) => source.key),
      ignoredSessionSources: sources
        .filter((source) => codexSessionInfo.get(source.key)?.eligible === false)
        .map((source) => ({
          source: source.key,
          reason: codexSessionInfo.get(source.key).reason
        })),
      recentDiagnostics: [...diagnosticEvents.values()].map(({ loggedAt: _loggedAt, ...event }) => event)
    };
  } catch (error) {
    return {
      ...summary,
      extensionVersion,
      architecture: "single-ui-extension",
      remoteSessionRoots: getRemoteSessionRoots().map((uri) => uri.toString()),
      localSessionRoots: getLocalSessionRoots(),
      detectedSessionSources: [],
      sessionDiscoveryError: String(error?.stack || error)
    };
  }
}

async function getCodexSessionStat(source) {
  if (source.kind === "remote") {
    const stat = await vscode.workspace.fs.stat(source.uri);
    return { size: stat.size };
  }
  const stat = fs.statSync(source.file);
  return { size: stat.size };
}

async function readCodexSessionChunk(source, offset, size) {
  if (source.kind === "remote") {
    const bytes = await vscode.workspace.fs.readFile(source.uri);
    return Buffer.from(bytes).subarray(offset, size).toString("utf8");
  }

  const fd = fs.openSync(source.file, "r");
  try {
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseSessionMetadata(text) {
  const newline = text.indexOf("\n");
  const firstLine = newline >= 0 ? text.slice(0, newline) : text;
  try {
    const event = JSON.parse(firstLine);
    return event?.type === "session_meta" ? event.payload : undefined;
  } catch {
    return undefined;
  }
}

function classifySessionMetadata(metadata) {
  if (metadata?.originator !== "codex_vscode") {
    return { eligible: false, reason: "non-vscode-originator" };
  }
  if (metadata?.source !== "vscode" || metadata?.thread_source === "subagent") {
    return { eligible: false, reason: "subagent-or-internal-session" };
  }
  return { eligible: true, reason: "top-level-vscode-session" };
}

function parseSessionPrompt(text) {
  let latestPrompt = "";
  for (const line of text.split(/\r?\n/)) {
    const prompt = parseUserMessageLine(line);
    if (prompt) latestPrompt = prompt;
  }
  return latestPrompt;
}

async function getLatestSessionPrompt(source, size, fallback = "") {
  const tailSize = 256 * 1024;
  const text = await readCodexSessionChunk(source, Math.max(0, size - tailSize), size);
  return parseSessionPrompt(text) || fallback;
}

function formatSessionNotification(kind, prompt, waitingForInput = false) {
  const cleanPrompt = String(prompt || "").replace(/\s+/g, " ").trim();
  const shortPrompt = cleanPrompt.length > 120 ? `${cleanPrompt.slice(0, 117).trimEnd()}...` : cleanPrompt;
  if (!shortPrompt) {
    return waitingForInput
      ? "Codex is waiting for your input. Click to return to this conversation."
      : kind === "error"
        ? "Codex could not complete the task. Click to return to this conversation."
        : "Codex has finished responding. Click to return to this conversation.";
  }
  const prefix = waitingForInput ? "Needs your input" : kind === "error" ? "Task error" : "Finished";
  return `${prefix}: ${shortPrompt}`;
}

async function getSessionInfo(source, size) {
  const cached = codexSessionInfo.get(source.key);
  if (cached) return cached;

  // Session metadata is stored on the first line. Avoid loading large old
  // transcripts just to decide whether a session is eligible.
  const text = await readCodexSessionChunk(source, 0, Math.min(size, 64 * 1024));
  const metadata = parseSessionMetadata(text);
  if (!metadata) return undefined;

  const classification = classifySessionMetadata(metadata);
  const info = {
    ...classification,
    sessionId: metadata.session_id || metadata.id || "",
    cwd: metadata.cwd || "",
    source: typeof metadata.source === "string" ? metadata.source : "subagent",
    threadSource: metadata.thread_source || "",
    forkedFromId: metadata.forked_from_id || "",
    prompt: parseSessionPrompt(text),
    createdAtMs: Date.parse(metadata.timestamp || "")
  };
  codexSessionInfo.set(source.key, info);
  logDebug(
    `session classified source=${source.key} eligible=${info.eligible} reason=${info.reason} cwd=${info.cwd}`
  );
  return info;
}

function normalizeWorkspacePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/([a-zA-Z]:)/, "$1")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isSessionInCurrentWorkspace(sessionInfo) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0 || !sessionInfo?.cwd) return true;

  const sessionPath = normalizeWorkspacePath(sessionInfo.cwd);
  return folders.some((folder) => {
    const folderPath = normalizeWorkspacePath(folder.uri.fsPath || folder.uri.path);
    return sessionPath === folderPath || sessionPath.startsWith(`${folderPath}/`);
  });
}

async function processCodexSessionChunk(chunk, source, sessionInfo, sourceSize, historyNotBeforeMs, workspaceMatch) {
  const sourceKey = source.key;
  const combined = (codexLogRemainders.get(sourceKey) || "") + chunk;
  const lines = combined.split(/\r?\n/);
  codexLogRemainders.set(sourceKey, lines.pop() || "");

  for (const line of lines) {
    const userMessage = parseUserMessageLine(line);
    if (userMessage && isCurrentSessionUserMessage(line, historyNotBeforeMs)) {
      let ownerWindowSessionId = "";
      let eventTimestampMs = 0;
      const userTurnId = getUserMessageTurnId(line);
      try {
        eventTimestampMs = Date.parse(JSON.parse(line)?.timestamp || "");
        ownerWindowSessionId = getFocusedWindowAt(eventTimestampMs);
      } catch {
        ownerWindowSessionId = "";
      }
      recordFocusedSessionOwner(sessionInfo.sessionId, ownerWindowSessionId, eventTimestampMs, userTurnId);
    }
    const request = parseRequestUserInputLine(line);
    if (request) {
      const sessionKey = sessionInfo.sessionId || sourceKey;
      const requestKey = `${sessionKey}:${request.turnId || request.callId}`;
      if (codexInputRequestTurnIds.has(requestKey)) continue;
      if (isHistoricalSessionRequest(request, sessionInfo, historyNotBeforeMs)) {
        logDebug(
          `historical request_user_input ignored source=${sourceKey} turnId=${request.turnId} cutoff=${fmtTs(historyNotBeforeMs)}`
        );
        continue;
      }
      codexInputRequestTurnIds.add(requestKey);
      lastCodexNotifyAt = Date.now();
      logDebug(`request_user_input source=${sourceKey} turnId=${request.turnId} callId=${request.callId || "n/a"}`);
      sessionInfo.prompt = await getLatestSessionPrompt(source, sourceSize, sessionInfo.prompt);
      await notify("complete", "Codex is waiting for your input.", {
        mode: "auto",
        turnId: request.turnId,
        sessionCwd: sessionInfo.cwd,
        toastMessage: formatSessionNotification("complete", sessionInfo.prompt, true),
        waitingForInput: true,
        toastWindowSessionId: getSessionWindowOwner(sessionInfo.sessionId, request.turnId),
        workspaceMatch,
        dedupeKey: `input:${requestKey}`
      });
      continue;
    }

    const completion = parseTaskCompleteLine(line);
    const turnId = completion?.turnId;
    if (!turnId || codexCompletedTurnIds.has(turnId)) continue;
    if (isHistoricalSessionCompletion(completion, sessionInfo, historyNotBeforeMs)) {
      logDebug(
        `historical task_complete ignored source=${sourceKey} turnId=${turnId} cutoff=${fmtTs(historyNotBeforeMs)}`
      );
      continue;
    }
    codexCompletedTurnIds.add(turnId);
    lastCodexNotifyAt = Date.now();
    logDebug(`task_complete source=${sourceKey} turnId=${turnId}`);
    sessionInfo.prompt = await getLatestSessionPrompt(source, sourceSize, sessionInfo.prompt);
    await notify("complete", "Codex has finished responding.", {
        mode: "auto",
        turnId,
        sessionCwd: sessionInfo.cwd,
        toastMessage: formatSessionNotification("complete", sessionInfo.prompt),
        toastWindowSessionId: getSessionWindowOwner(sessionInfo.sessionId, turnId),
        workspaceMatch,
        dedupeKey: `complete:${sessionInfo.sessionId || sourceKey}:${turnId}`
    });
  }
}

function isLikelyCodexDocument(doc) {
  if (!doc || !doc.uri) return false;
  const scheme = String(doc.uri.scheme || "").toLowerCase();
  const uri = String(doc.uri.toString() || "").toLowerCase();
  if (scheme === "openai-codex") return true;
  if (scheme.includes("codex")) return true;
  if (uri.includes("openai-codex")) return true;
  return false;
}

/**
 * Authoritative Codex completion detector.
 *
 * The extension stays in the local UI host so it can play audio locally. In a
 * Remote SSH window it accesses ~/.codex/sessions through vscode.workspace.fs,
 * tails recent JSONL session files, and reacts to task_complete plus
 * request_user_input events.
 */
function startCodexLogWatcher() {
  stopCodexLogWatcher();

  const cfg = getConfig();
  if (!cfg.get("monitorCodexLog", true)) return;

  const pollMsRaw = cfg.get("codexLogPollMs", 700);
  const pollMs = Number.isFinite(pollMsRaw) ? Math.max(300, pollMsRaw) : 700;
  codexLogWatcherStartedAt = Date.now();

  const poll = async () => {
    if (codexLogPollBusy) return;
    codexLogPollBusy = true;
    try {
      const files = await findAllCodexSessionFiles();
      const live = new Set(files.map((source) => source.key));
      for (const known of Array.from(codexLogOffsets.keys())) {
        if (!live.has(known)) {
          codexLogOffsets.delete(known);
          codexLogRemainders.delete(known);
          codexSessionInfo.delete(known);
        }
      }

      const sessionSources = [];
      for (const source of files) {
        try {
          const stat = await getCodexSessionStat(source);
          const sessionInfo = await getSessionInfo(source, stat.size);
          if (!sessionInfo?.eligible) continue;
          const workspaceMatch = isSessionInCurrentWorkspace(sessionInfo);
          sessionSources.push({ source, stat, sessionInfo, workspaceMatch });
        } catch (error) {
          recordDiagnostic("session-read-failed", source.key, String(error.code || error.name || "unknown"));
        }
      }

      // Codex does not expose the selected chat session to third-party
      // extensions. Monitor all eligible sessions and use the
      // cross-process session_id + turn_id lock to emit one notification.
      for (const { source, stat, sessionInfo, workspaceMatch } of sessionSources) {
        try {

          let offset = codexLogOffsets.get(source.key);
          let historyNotBeforeMs;
          if (offset == null) {
            // Read a newly discovered source from byte zero so very short turns
            // are not missed, but accept only completions produced after this
            // watcher started and after this rollout was created. This prevents
            // late remote discovery and resumed chats from replaying history.
            offset = 0;
            historyNotBeforeMs = codexLogWatcherStartedAt;
            codexLogOffsets.set(source.key, offset);
            codexLogRemainders.set(source.key, "");
            logDebug(
              `session tail start source=${source.key} offset=${offset} historyCutoff=${fmtTs(historyNotBeforeMs)}`
            );
          }
          if (stat.size < offset) {
            offset = 0;
            codexLogRemainders.set(source.key, "");
          }
          if (stat.size === offset) continue;

          const chunk = await readCodexSessionChunk(source, offset, stat.size);
          codexLogOffsets.set(source.key, stat.size);
          await processCodexSessionChunk(chunk, source, sessionInfo, stat.size, historyNotBeforeMs, workspaceMatch);
        } catch (error) {
          recordDiagnostic("session-read-failed", source.key, String(error.code || error.name || "unknown"));
        }
      }
    } catch (error) {
      recordDiagnostic("session-discovery-failed", "sessions", String(error.code || error.name || "unknown"));
    } finally {
      codexLogPollBusy = false;
    }
  };

  void poll();
  codexLogPoller = setInterval(() => void poll(), pollMs);
}

/**
 * Document-based fallback detector for openai-codex docs.
 * Useful when log signals are missing/unreliable in some environments.
 */
function startCodexDocumentWatcher(context) {
  stopCodexDocumentWatcher();

  const config = getConfig();
  const enabled = config.get("monitorCodexChat", true);
  if (config.get("monitorCodexLog", true)) return;
  if (!enabled) return;

  const idleMsRaw = config.get("codexChatIdleMs", 1800);
  const cooldownMsRaw = config.get("codexChatCooldownMs", 5000);
  const pollMsRaw = config.get("codexChatPollMs", 600);
  const idleMs = Number.isFinite(idleMsRaw) ? Math.max(500, idleMsRaw) : 1800;
  const cooldownMs = Number.isFinite(cooldownMsRaw) ? Math.max(0, cooldownMsRaw) : 5000;
  const pollMs = Number.isFinite(pollMsRaw) ? Math.max(250, pollMsRaw) : 600;

  const touchDocument = (doc) => {
    if (!isLikelyCodexDocument(doc)) return;
    const key = doc.uri.toString();
    const textLen = doc.getText().length;
    const now = Date.now();
    const prev = codexState.get(key);

    if (!prev) {
      codexState.set(key, {
        textLen,
        lastChangeAt: now,
        notifiedForThisBurst: false
      });
      return;
    }

    if (textLen !== prev.textLen) {
      prev.textLen = textLen;
      prev.lastChangeAt = now;
      prev.notifiedForThisBurst = false;
    }
  };

  const maybeNotify = async () => {
    const now = Date.now();

    for (const state of codexState.values()) {
      if (state.notifiedForThisBurst) continue;
      if (now - state.lastChangeAt < idleMs) continue;
      if (now - lastCodexNotifyAt < cooldownMs) continue;

      state.notifiedForThisBurst = true;
      lastCodexNotifyAt = now;
      logDebug("notify complete from Codex activity detector");
      await notify("complete", "Codex: response complete");
      break;
    }
  };

  codexDocWatcher = vscode.workspace.onDidChangeTextDocument((event) => {
    logDebug(`text change: scheme=${event.document.uri.scheme}`);
    touchDocument(event.document);
  });

  // Polling catches Codex custom-editor updates that may not emit normal text change events.
  codexPoller = setInterval(async () => {
    const docs = vscode.workspace.textDocuments.filter((d) => isLikelyCodexDocument(d));
    logDebug(`poll tick: totalDocs=${vscode.workspace.textDocuments.length} codexDocs=${docs.length}`);
    for (const doc of docs) {
      touchDocument(doc);
    }
    await maybeNotify();
  }, pollMs);

  context.subscriptions.push(codexDocWatcher);
  context.subscriptions.push({ dispose: () => { if (codexPoller) clearInterval(codexPoller); codexPoller = null; } });
  context.subscriptions.push({ dispose: stopCodexDocumentWatcher });
}

// File-trigger watcher: write to `.codex-notify` to manually signal complete/error.
function startWatcher(_context) {
  stopWatcher();

  const config = getConfig();
  const enabled = config.get("watchEnabled", true);
  if (!enabled) return;

  const rawPath = config.get("watchFilePath", ".codex-notify");

  try {
    if (path.isAbsolute(rawPath)) {
      const targetPath = rawPath;
      let lastContent = null;
      const parentDir = path.dirname(targetPath);
      const fileName = path.basename(targetPath);

      const readAndNotify = async () => {
        try {
          if (!fs.existsSync(targetPath)) return;
          const next = fs.readFileSync(targetPath, "utf8");
          if (next === lastContent) return;
          lastContent = next;

          const trimmed = next.trim().toLowerCase();
          if (!trimmed) return;

          if (trimmed.includes("error")) {
            await notify("error", "Codex could not complete the task. Click to return to this conversation.", { mode: "manual" });
          } else {
            await notify("complete", "Codex has finished responding. Click to return to this conversation.", { mode: "manual" });
          }
        } catch {
          // noop
        }
      };

      if (!fs.existsSync(parentDir)) {
        logDebug(`watch parent missing, manual trigger disabled until parent exists: ${parentDir}`);
        return;
      }

      if (fs.existsSync(targetPath)) {
        lastContent = fs.readFileSync(targetPath, "utf8");
        logDebug(`watching manual trigger file: ${targetPath}`);
      } else {
        logDebug(`watching for manual trigger file creation: ${targetPath}`);
      }

      const dirWatcher = fs.watch(parentDir, { persistent: false }, async (_eventType, filename) => {
        if (!filename || path.basename(String(filename)) !== fileName) return;
        await readAndNotify();
      });
      watchers.push(dirWatcher);
    } else {
      // Relative workspace files can live behind a remote/virtual file-system
      // provider. Keep their URI scheme/authority intact and use the VS Code
      // file-system API instead of treating uri.fsPath as a local Node.js path.
      const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
      const pathSegments = normalizedPath.split("/").filter(Boolean);
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      const roots = workspaceFolders.length > 0
        ? workspaceFolders.map((folder) => ({
          patternBase: folder,
          rootUri: folder.uri
        }))
        : [{
          patternBase: process.cwd(),
          rootUri: vscode.Uri.file(process.cwd())
        }];

      for (const root of roots) {
        const targetUri = vscode.Uri.joinPath(root.rootUri, ...pathSegments);
        const pattern = new vscode.RelativePattern(root.patternBase, normalizedPath);
        const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
        let lastContent = null;
        let initialized = false;

        const readAndNotify = async () => {
          try {
            const bytes = await vscode.workspace.fs.readFile(targetUri);
            const next = Buffer.from(bytes).toString("utf8");
            if (!initialized) {
              lastContent = next;
              initialized = true;
              return;
            }
            if (next === lastContent) return;
            lastContent = next;

            const trimmed = next.trim().toLowerCase();
            if (!trimmed) return;

            if (trimmed.includes("error")) {
            await notify("error", "Codex could not complete the task. Click to return to this conversation.", { mode: "manual" });
            } else {
            await notify("complete", "Codex has finished responding. Click to return to this conversation.", { mode: "manual" });
            }
          } catch {
            // The trigger file is optional and may not exist yet.
          }
        };

        const initialize = (async () => {
          try {
            const bytes = await vscode.workspace.fs.readFile(targetUri);
            lastContent = Buffer.from(bytes).toString("utf8");
            logDebug(`watching manual trigger file: ${targetUri.toString()}`);
          } catch {
            logDebug(`watching for manual trigger file creation: ${targetUri.toString()}`);
          } finally {
            initialized = true;
          }
        })();

        fileWatcher.onDidCreate(async () => {
          await initialize;
          await readAndNotify();
        });
        fileWatcher.onDidChange(async () => {
          await initialize;
          await readAndNotify();
        });
        fileWatcher.onDidDelete(() => {
          lastContent = null;
          initialized = true;
          logDebug(`manual trigger file deleted: ${targetUri.toString()}`);
        });

        watchers.push(fileWatcher);
      }
    }
  } catch {
    // noop
  }
}

async function maybeShowPostUpdateReloadHint(context) {
  try {
    const currentVersion = context.extension?.packageJSON?.version;
    if (!currentVersion) return;

    const key = "codexNotifier.lastSeenVersion";
    const lastSeenVersion = context.globalState.get(key);

    // First run: store and skip prompt.
    if (!lastSeenVersion) {
      await context.globalState.update(key, currentVersion);
      return;
    }

    // Version changed: recommend reload for bundled asset consistency.
    if (lastSeenVersion !== currentVersion) {
      await context.globalState.update(key, currentVersion);
      const action = "Reload Window";
      const pick = await vscode.window.showInformationMessage(
        `Codex Notifier updated to v${currentVersion}. Reload VS Code to ensure bundled sounds are loaded correctly.`,
        action
      );
      if (pick === action) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    }
  } catch {
    // noop
  }
}

// Extension activation: register commands, config change handlers, and watchers.
function activate(context) {
  if (process.platform === "win32" && getConfig().get("focusExistingWindowOnToast", true)) {
    void installWindowsToastFocusHelper(context).catch((error) => {
      logDebug(`toast focus helper registration failed error=${String(error?.message || error)}`);
    });
    const refreshToastWindowTarget = () => {
      registerFocusedWindowsToastTarget();
      setTimeout(() => registerFocusedWindowsToastTarget(), 250);
    };
    refreshToastWindowTarget();
    context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) refreshToastWindowTarget();
    }));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.enableToastWindowFocus", async () => {
      try {
        await installWindowsToastFocusHelper(context);
        await getConfig().update("focusExistingWindowOnToast", true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("Codex Notifier: toast window focus enabled.");
      } catch (error) {
        vscode.window.showErrorMessage(`Codex Notifier: could not enable toast window focus: ${error.message || error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.notifyComplete", async () => {
      await notify("complete", "Codex has finished responding. Click to return to this conversation.", { mode: "manual" });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.notifyError", async () => {
      await notify("error", "Codex could not complete the task. Click to return to this conversation.", { mode: "manual" });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.testSound", async () => {
      await notify("complete", "Codex Notifier: test sound", { mode: "manual" });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.toggleAutoNotify", async () => {
      const cfg = getConfig();
      const current = cfg.get("monitorCodexLog", true);
      await cfg.update("monitorCodexLog", !current, vscode.ConfigurationTarget.Workspace);
      const next = !current;
      if (next) {
        startCodexLogWatcher();
      } else {
        stopCodexLogWatcher();
      }
      vscode.window.showInformationMessage(`Codex Notifier: auto notify ${next ? "enabled" : "disabled"}.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.showDiagnostics", async () => {
      const summary = await getDetailedDiagnosticsSummary();
      const out = getOutput();
      out.appendLine("===== Diagnostics =====");
      Object.entries(summary).forEach(([k, v]) => out.appendLine(`${k}: ${JSON.stringify(v, null, 2)}`));
      out.show(true);
      vscode.window.showInformationMessage(
        `Codex Notifier: sessions=${summary.trackedSessionFiles} completed=${summary.completedTurnIds} lastNotify=${summary.lastNotifyAt}`
      );
      return summary;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.getDiagnostics", async () => {
      return getDetailedDiagnosticsSummary();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexNotifier")) {
        startWatcher(context);
        startCodexDocumentWatcher(context);
        startCodexLogWatcher();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      startWatcher(context);
      startCodexLogWatcher();
    })
  );

  context.subscriptions.push({ dispose: stopWatcher });

  startWatcher(context);
  startCodexDocumentWatcher(context);
  startCodexLogWatcher();
  void maybeShowPostUpdateReloadHint(context);
  logDebug("activated");
}

// Extension shutdown cleanup.
function deactivate() {
  stopWatcher();
  stopCodexDocumentWatcher();
  stopCodexLogWatcher();
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  statusItem?.dispose();
  statusItem = null;
}

module.exports = {
  activate,
  deactivate
};
