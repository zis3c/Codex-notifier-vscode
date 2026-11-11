"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targetDir = path.join(root, "remote");

fs.mkdirSync(targetDir, { recursive: true });
for (const name of ["session-events.js", "remote-paths.js"]) {
  fs.copyFileSync(path.join(root, name), path.join(targetDir, name));
}
fs.copyFileSync(path.join(root, "LICENSE"), path.join(targetDir, "LICENSE"));
console.log("Synced shared files and LICENSE to remote/");
