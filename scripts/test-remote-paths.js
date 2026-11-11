"use strict";

const assert = require("assert");
const {
  inferRemoteHomePath,
  resolveRemoteSessionsPath,
  resolveRemoteEventsPath
} = require("../remote-paths");

assert.strictEqual(inferRemoteHomePath("/home/alice/project"), "/home/alice");
assert.strictEqual(inferRemoteHomePath("/root/project"), "/root");
assert.strictEqual(inferRemoteHomePath("/Users/alice/project"), "/Users/alice");
assert.strictEqual(inferRemoteHomePath("/data/alice/project"), null);

assert.strictEqual(
  resolveRemoteSessionsPath({ homePath: "/home/alice" }),
  "/home/alice/.codex/sessions"
);
assert.strictEqual(
  resolveRemoteSessionsPath({ configuredPath: "/storage/codex/sessions", homePath: "/home/alice" }),
  "/storage/codex/sessions"
);
assert.strictEqual(
  resolveRemoteSessionsPath({ configuredPath: "~/.codex/sessions", homePath: "/home/alice" }),
  ""
);
assert.strictEqual(resolveRemoteSessionsPath({}), "");

assert.strictEqual(
  resolveRemoteEventsPath("/home/alice/.codex/sessions"),
  "/home/alice/.codex/codex-notifier-events"
);
assert.strictEqual(
  resolveRemoteEventsPath("/storage/codex/sessions"),
  "/storage/codex/codex-notifier-events"
);
assert.strictEqual(resolveRemoteEventsPath(""), "");

console.log("Remote path tests passed.");
