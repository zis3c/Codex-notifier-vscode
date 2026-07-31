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
    "extension/session-events.js"
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

  console.log("VSIX smoke test passed.");
}

main();
