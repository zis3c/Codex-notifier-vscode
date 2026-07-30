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

companion._test.consumeLines(
  "Reasoning summary turn-start x conversationId=abc\n" +
  "thread_stream_view_activity_changed active=false x conversationId=abc\n",
  true
);
assert.deepStrictEqual(commands, ["codexNotifier.notifyComplete"]);

companion._test.consumeLines(
  "thread_stream_view_activity_changed active=false x conversationId=unknown\n",
  true
);
assert.strictEqual(commands.length, 1);

console.log("remote companion tests passed");
