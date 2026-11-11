"use strict";

const assert = require("assert");
const { createRemoteEventBridge } = require("../remote-events");

const files = new Map();
const vscode = {
  FileType: { File: 1, Directory: 2 },
  Uri: {
    joinPath: (base, name) => ({ path: `${base.path}/${name}` })
  },
  workspace: {
    fs: {
      readDirectory: async (dir) => {
        if (dir.path === "/missing") throw new Error("FileNotFound");
        return [...files.keys()]
          .filter((file) => file.startsWith(`${dir.path}/`))
          .map((file) => [file.slice(dir.path.length + 1), 1]);
      },
      readFile: async (uri) => Buffer.from(files.get(uri.path) || ""),
      delete: async (uri) => {
        files.delete(uri.path);
      }
    }
  }
};

async function main() {
  const received = [];
  const bridge = createRemoteEventBridge({
    vscode,
    dirUri: { path: "/events" },
    onEvent: async (event) => received.push(event)
  });

  files.set("/events/agent.json", JSON.stringify({ at: 1 }));
  files.set("/events/2.json", JSON.stringify({ kind: "complete", turnId: "two" }));
  files.set("/events/1.json", JSON.stringify({ kind: "input", turnId: "one" }));
  files.set("/events/3.json", "{not json");
  files.set("/events/notes.txt", "ignore me");

  await bridge.pollOnce();

  assert.deepStrictEqual(received.map((event) => event.turnId), ["one", "two"]);
  assert.strictEqual(files.has("/events/1.json"), false);
  assert.strictEqual(files.has("/events/2.json"), false);
  assert.strictEqual(files.has("/events/3.json"), false, "malformed events are discarded");
  assert.strictEqual(files.has("/events/agent.json"), true, "the heartbeat file is not an event");
  assert.strictEqual(files.has("/events/notes.txt"), true);

  const missing = createRemoteEventBridge({
    vscode,
    dirUri: { path: "/missing" },
    onEvent: async () => {
      throw new Error("must not be called");
    }
  });
  await missing.pollOnce();

  console.log("Remote event bridge tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
