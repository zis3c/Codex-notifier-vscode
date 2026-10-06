"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const root = path.resolve(__dirname, "..");

class Uri {
  constructor(uriPath, authority = "ssh-remote+test", scheme = "vscode-remote") {
    this.path = uriPath;
    this.fsPath = uriPath;
    this.authority = authority;
    this.scheme = scheme;
  }
  with(values) { return Object.assign(new Uri(this.path, this.authority, this.scheme), values); }
  toString() { return `${this.scheme}://${this.authority}${this.path}`; }
}

function createHarness({ platform = "win32", focused = false, settings = {}, locks = new Set(), remotePath } = {}) {
  const config = { focusExistingWindowOnToast: false, enableSound: false, completionUseBanner: true, ...settings };
  const lines = [];
  const notifications = [];
  const localReads = [];
  const directories = new Map();
  const files = new Map();
  let notificationError;
  const vscode = {
    env: { remoteName: remotePath ? "ssh-remote" : undefined, sessionId: "test-window" },
    FileType: { File: 1, Directory: 2 },
    Uri: { joinPath: (uri, ...parts) => uri.with({ path: path.posix.join(uri.path, ...parts) }) },
    workspace: {
      workspaceFolders: remotePath ? [{ uri: new Uri(remotePath) }] : [],
      textDocuments: [],
      getConfiguration: () => ({ get: (key, fallback) => key in config ? config[key] : fallback }),
      fs: {
        readDirectory: async (uri) => {
          const entries = directories.get(uri.path);
          if (entries instanceof Error) throw entries;
          return entries || [];
        },
        readFile: async (uri) => Buffer.from(files.get(uri.path) || ""),
        stat: async (uri) => ({ size: Buffer.byteLength(files.get(uri.path) || ""), mtime: Date.now() })
      }
    },
    window: {
      state: { focused }, visibleTextEditors: [],
      createOutputChannel: () => ({ appendLine: (line) => lines.push(line), show: () => {} }),
      showInformationMessage: (message) => lines.push(`banner:${message}`)
    }
  };
  const module = { exports: {} };
  const localRequire = createRequire(path.join(root, "extension.js"));
  const runtimeFs = {
    openSync: (file, mode) => {
      if (mode === "wx" && locks.has(file)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      locks.add(file);
      return 1;
    },
    writeFileSync: () => {}, closeSync: () => {},
    statSync: () => ({ mtimeMs: Date.now() }), existsSync: () => false,
    readdirSync: (dir) => { localReads.push(dir); return []; }
  };
  const source = fs.readFileSync(path.join(root, "extension.js"), "utf8");
  const expose = `\nmodule.exports.testing = {
    getRemoteSessionRoots, findAllCodexSessionFiles, getDetailedDiagnosticsSummary,
    remoteDirectoriesAt, notify, showSystemNotification, recordDiagnostic,
    classifySessionMetadata, processCodexSessionChunk, getDiagnosticsSummary
  };`;
  const context = {
    require: (name) => {
      if (name === "vscode") return vscode;
      if (name === "fs") return runtimeFs;
      if (name === "os") return { tmpdir: () => "/test-temp", homedir: () => "/test-home" };
      if (name === "child_process") return {
        execFile: (_command, args, options, callback) => {
          const cb = typeof options === "function" ? options : callback;
          if (args.join(" ").includes("ForegroundWindow")) cb(null, focused ? "321" : "999");
          else { notifications.push(args); cb(notificationError); }
        }
      };
      return localRequire(name);
    },
    module, exports: module.exports, Buffer, Date, console,
    process: { platform, ppid: 321 }, __dirname: root,
    setTimeout: (callback) => { callback(); return 1; }, clearTimeout: () => {},
    setInterval: () => 1, clearInterval: () => {}
  };
  vm.runInNewContext(source + expose, context, { filename: "extension.js" });
  return {
    api: module.exports.testing, config, lines, notifications, localReads, directories, files,
    setNotificationError: (error) => { notificationError = error; }
  };
}

module.exports = { createHarness, Uri };
