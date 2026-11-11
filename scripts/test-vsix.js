const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const AdmZip = require("adm-zip");

function runNpm(args, cwd) {
  const command = `npm ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}`;
  execSync(command, {
    cwd,
    stdio: "inherit",
    shell: true
  });
}

function main() {
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-notifier-vsix-"));
  const outFile = path.join(outDir, `codex-notifier-${pkg.version}.vsix`);

  runNpm(["exec", "--yes", "@vscode/vsce", "--", "package", "--out", outFile], root);

  const zip = new AdmZip(outFile);
  const entries = new Set(zip.getEntries().map((entry) => entry.entryName));
  const required = [
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/extension.js",
    "extension/session-events.js",
    "extension/remote-events.js",
    "extension/remote-paths.js",
    "extension/notification-policy.js",
    "extension/toast-focus.js",
    "extension/windows-toast-focus.ps1",
    "extension/windows-toast-focus.vbs"
  ];

  for (const entry of required) {
    if (!entries.has(entry)) {
      throw new Error(`Missing VSIX entry: ${entry}`);
    }
  }

  const manifestEntry = zip.getEntry("extension/package.json");
  if (!manifestEntry) {
    throw new Error("Missing VSIX entry: extension/package.json");
  }

  const manifestJson = JSON.parse(manifestEntry.getData().toString("utf8"));
  if (manifestJson.version !== pkg.version) {
    throw new Error(`VSIX package version mismatch. Expected ${pkg.version}, found ${manifestJson.version}`);
  }

  if ([...entries].some((entry) => entry.startsWith("extension/remote/"))) {
    throw new Error("The UI VSIX must not bundle the remote companion.");
  }

  console.log("VSIX smoke test passed.");

  checkRemoteVsix(root, outDir);
}

function checkRemoteVsix(root, outDir) {
  const remoteRoot = path.join(root, "remote");
  const remotePkg = JSON.parse(fs.readFileSync(path.join(remoteRoot, "package.json"), "utf8"));
  const remoteOut = path.join(outDir, `codex-notifier-remote-${remotePkg.version}.vsix`);

  runNpm(["exec", "--yes", "@vscode/vsce", "--", "package", "--out", remoteOut], remoteRoot);

  const zip = new AdmZip(remoteOut);
  const entries = new Set(zip.getEntries().map((entry) => entry.entryName));
  const required = [
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/extension.js",
    "extension/session-tailer.js",
    "extension/session-events.js",
    "extension/remote-paths.js"
  ];

  for (const entry of required) {
    if (!entries.has(entry)) {
      throw new Error(`Missing remote VSIX entry: ${entry}`);
    }
  }

  const manifest = JSON.parse(zip.getEntry("extension/package.json").getData().toString("utf8"));
  if (manifest.name !== "codex-notifier-remote") {
    throw new Error(`Unexpected remote extension name: ${manifest.name}`);
  }

  console.log("Remote VSIX smoke test passed.");
}

main();
