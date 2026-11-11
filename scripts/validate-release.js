"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function assertExists(relPath) {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required file: ${relPath}`);
  }
}

function assertPackageJson() {
  const packagePath = path.join(root, "package.json");
  const raw = fs.readFileSync(packagePath, "utf8");
  const pkg = JSON.parse(raw);

  if (!pkg.publisher || pkg.publisher === "local") {
    throw new Error("package.json: set a non-placeholder publisher value.");
  }

  if (!pkg.version || /^0\.0\./.test(pkg.version)) {
    throw new Error("package.json: version should be beyond 0.0.x for release builds.");
  }

  if (!pkg.main) {
    throw new Error("package.json: missing main entry.");
  }

  if (!Array.isArray(pkg.extensionKind) || pkg.extensionKind[0] !== "ui") {
    throw new Error("package.json: extensionKind must prefer the local UI host so notifications work in remote workspaces.");
  }
}

function assertRemotePackageJson() {
  const packagePath = path.join(root, "remote", "package.json");
  const raw = fs.readFileSync(packagePath, "utf8");
  const pkg = JSON.parse(raw);

  if (!pkg.main) {
    throw new Error("remote/package.json: missing main entry.");
  }

  if (!Array.isArray(pkg.extensionKind) || pkg.extensionKind[0] !== "workspace") {
    throw new Error("remote/package.json: extensionKind must prefer the remote workspace host.");
  }
}

function main() {
  assertExists("README.md");
  assertExists("LICENSE");
  assertExists("INSTALLATION.md");
  assertExists("CHANGELOG.md");
  assertExists("SECURITY.md");
  assertExists("extension.js");
  assertExists("remote-events.js");
  assertExists("remote-paths.js");
  assertExists("remote/package.json");
  assertExists("remote/extension.js");
  assertExists("remote/session-tailer.js");
  assertPackageJson();
  assertRemotePackageJson();
  console.log("Release validation passed.");
}

main();
