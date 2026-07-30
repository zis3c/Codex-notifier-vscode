const assert = require("assert");

const commands = [];
const vscode = {
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} })
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback })
  },
  env: { remoteName: "ssh-remote" },
  commands: {
    executeCommand: command => {
      commands.push(command);
      return Promise.resolve();
    }
  }
};

const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
};
const companion = require("./extension");

const started = JSON.stringify({
  timestamp: "2026-07-30T20:00:00Z",
  type: "event_msg",
  payload: { type: "task_started", turn_id: "turn-1" }
});
const completed = JSON.stringify({
  timestamp: "2026-07-30T20:00:01Z",
  type: "event_msg",
  payload: { type: "task_complete", turn_id: "turn-1" }
});

assert.strictEqual(companion._test.parseSessionLine(started), undefined);
assert.strictEqual(companion._test.parseSessionLine(completed), "turn-1");

companion._test.consumeSessionText("session.jsonl", `${started}\n${completed}\n`, true);
assert.deepStrictEqual(commands, ["codexNotifier.notifyComplete"]);

// Duplicate completion events must not produce duplicate sounds.
companion._test.consumeSessionText("session.jsonl", `${completed}\n`, true);
assert.strictEqual(commands.length, 1);

console.log("remote companion tests passed");
