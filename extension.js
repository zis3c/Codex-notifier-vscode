const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const {
  isHistoricalSessionCompletion,
  parseTaskCompleteLine
} = require("./session-events");
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
let debugDocWatcher = null;
let output = null;
let codexLogPoller = null;
let codexLogOffsets = new Map();
let codexLogRemainders = new Map();
let codexLogFilesCache = [];
let codexLogFilesCacheAt = 0;
let codexLogPollBusy = false;
let codexLogWatcherStartedAt = 0;
let codexCompletedTurnIds = new Set();
let codexSessionInfo = new Map();
let statusItem = null;
let statusTimer = null;

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
    lastNotifyAt: fmtTs(lastCodexNotifyAt)
  };
}

// Main extension settings namespace.
function getConfig() {
  return vscode.workspace.getConfiguration("codexNotifier");
}

// Lazily create output channel used for debug/diagnostic logs.
function getOutput() {
  if (!output) {
    output = vscode.window.createOutputChannel("Codex Notifier");
  }
  return output;
}

// Debug logger guarded by `codexNotifier.debug` setting.
function logDebug(message) {
  const cfg = getConfig();
  if (!cfg.get("debug", false)) return;
  const ts = new Date().toISOString();
  getOutput().appendLine(`[${ts}] ${message}`);
}

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
function showWindowsToast(title, message) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve();
      return;
    }

    const esc = (s) => String(s).replace(/'/g, "''");
    const t = esc(title);
    const m = esc(message);
    const script = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;",
      `$xml = @'<toast><visual><binding template="ToastGeneric"><text>${t}</text><text>${m}</text></binding></visual></toast>'@;`,
      "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument;",
      "$doc.LoadXml($xml);",
      "$toast = [Windows.UI.Notifications.ToastNotification]::new($doc);",
      "$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Codex Notifier');",
      "$notifier.Show($toast);"
    ].join(" ");

    execFile("powershell.exe", ["-NoProfile", "-Command", script], () => resolve());
  });
}

// Cross-platform system notification helper for when VS Code is not focused.
function showSystemNotification(title, message) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      void showWindowsToast(title, message).finally(resolve);
      return;
    }

    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`],
        () => resolve()
      );
      return;
    }

    if (process.platform === "linux") {
      execFile("notify-send", [title, message], () => resolve());
      return;
    }

    resolve();
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
  const isFocused = vscode.window.state.focused;
  const shouldSystemNotify = enablePopup && toastWhenUnfocused && !isFocused;
  const volumeRaw = config.get("volume", 1);
  const volume = Number.isFinite(volumeRaw) ? Math.max(0, Math.min(1, volumeRaw)) : 1;
  const completeSoundPath = config.get("completeSoundPath", "");
  const errorSoundPath = config.get("errorSoundPath", "");

  if (enablePopup) {
    if (kind === "error") {
      if (shouldSystemNotify) {
        await showSystemNotification("Codex Notifier", message);
      } else {
        vscode.window.showErrorMessage(message);
      }
    } else {
      if (shouldSystemNotify) {
        await showSystemNotification("Codex Notifier", message);
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
  if (debugDocWatcher) {
    debugDocWatcher.dispose();
    debugDocWatcher = null;
  }
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
    const sessionsPath = configuredPath
      ? configuredPath
      : `${inferRemoteHomePath(uri.path) || ""}/.codex/sessions`;
    if (!sessionsPath.startsWith("/")) continue;
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
    for (const year of localDirectoriesAt(root).slice(-2)) {
      const yearDir = path.join(root, year);
      for (const month of localDirectoriesAt(yearDir).slice(-2)) {
        const monthDir = path.join(yearDir, month);
        for (const day of localDirectoriesAt(monthDir).slice(-3)) {
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
  } catch {
    return [];
  }
}

async function findRemoteCodexSessionFiles() {
  const candidates = [];
  for (const root of getRemoteSessionRoots()) {
    for (const year of (await remoteDirectoriesAt(root)).slice(-2)) {
      const yearDir = vscode.Uri.joinPath(root, year);
      for (const month of (await remoteDirectoriesAt(yearDir)).slice(-2)) {
        const monthDir = vscode.Uri.joinPath(yearDir, month);
        for (const day of (await remoteDirectoriesAt(monthDir)).slice(-3)) {
          const dayDir = vscode.Uri.joinPath(monthDir, day);
          let entries = [];
          try {
            entries = await vscode.workspace.fs.readDirectory(dayDir);
          } catch {
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

async function findAllCodexSessionFiles() {
  const now = Date.now();
  if (now - codexLogFilesCacheAt < 1000) return codexLogFilesCache;

  const remoteRoots = getRemoteSessionRoots();
  const candidates = remoteRoots.length > 0
    ? await findRemoteCodexSessionFiles()
    : findLocalCodexSessionFiles();

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  codexLogFilesCache = candidates
    .filter((candidate) => now - candidate.mtimeMs <= 1000 * 60 * 60 * 24 * 2)
    .slice(0, 12);
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
        }))
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

async function getSessionInfo(source, size) {
  const cached = codexSessionInfo.get(source.key);
  if (cached) return cached;

  const text = await readCodexSessionChunk(source, 0, size);
  const metadata = parseSessionMetadata(text);
  if (!metadata) return undefined;

  const classification = classifySessionMetadata(metadata);
  const info = {
    ...classification,
    cwd: metadata.cwd || "",
    source: typeof metadata.source === "string" ? metadata.source : "subagent",
    threadSource: metadata.thread_source || "",
    forkedFromId: metadata.forked_from_id || "",
    createdAtMs: Date.parse(metadata.timestamp || "")
  };
  codexSessionInfo.set(source.key, info);
  logDebug(
    `session classified source=${source.key} eligible=${info.eligible} reason=${info.reason} cwd=${info.cwd}`
  );
  return info;
}

async function processCodexSessionChunk(chunk, sourceKey, sessionInfo, historyNotBeforeMs) {
  const combined = (codexLogRemainders.get(sourceKey) || "") + chunk;
  const lines = combined.split(/\r?\n/);
  codexLogRemainders.set(sourceKey, lines.pop() || "");

  for (const line of lines) {
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
    await notify("complete", "Codex: response complete", { mode: "auto", turnId });
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
 * tails recent JSONL session files, and reacts only to task_complete events.
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

      for (const source of files) {
        try {
          const stat = await getCodexSessionStat(source);
          const sessionInfo = await getSessionInfo(source, stat.size);
          if (!sessionInfo?.eligible) continue;

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
          await processCodexSessionChunk(chunk, source.key, sessionInfo, historyNotBeforeMs);
        } catch (error) {
          logDebug(`session read failed source=${source.key} error=${String(error)}`);
        }
      }
    } catch (error) {
      logDebug(`session discovery failed error=${String(error)}`);
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

  debugDocWatcher = vscode.workspace.onDidOpenTextDocument((doc) => {
    logDebug(`document opened: scheme=${doc.uri.scheme} uri=${doc.uri.toString()}`);
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
  context.subscriptions.push(debugDocWatcher);
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
            await notify("error", "Codex: task error", { mode: "manual" });
          } else {
            await notify("complete", "Codex: response complete", { mode: "manual" });
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
              await notify("error", "Codex: task error", { mode: "manual" });
            } else {
              await notify("complete", "Codex: response complete", { mode: "manual" });
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
  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.notifyComplete", async () => {
      await notify("complete", "Codex: response complete", { mode: "manual" });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.notifyError", async () => {
      await notify("error", "Codex: task error", { mode: "manual" });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.testSound", async () => {
      await notify("complete", "Codex Notifier: test sound", { mode: "manual" });
    })
  );


  context.subscriptions.push(
    vscode.commands.registerCommand("codexNotifier.debugSnapshot", async () => {
      const docs = vscode.workspace.textDocuments.map((d) => `${d.uri.scheme} :: ${d.uri.toString()}`);
      const editors = vscode.window.visibleTextEditors.map((e) => `${e.document.uri.scheme} :: ${e.document.uri.toString()}`);
      const out = getOutput();
      out.appendLine("===== Snapshot =====");
      out.appendLine(`docs(${docs.length})`);
      docs.forEach((d) => out.appendLine(`  ${d}`));
      out.appendLine(`visibleEditors(${editors.length})`);
      editors.forEach((e) => out.appendLine(`  ${e}`));
      out.show(true);
      vscode.window.showInformationMessage("Codex Notifier: debug snapshot written to output.");
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
      Object.entries(summary).forEach(([k, v]) => out.appendLine(`${k}: ${v}`));
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
