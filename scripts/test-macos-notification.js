"use strict";

const assert = require("assert");
const {
  findTerminalNotifier,
  buildMacOSFocusUri,
  showMacOSNotification
} = require("../macos-notification");

async function run() {
  assert.strictEqual(
    findTerminalNotifier("/usr/bin:/bin", (file) => file === "/opt/homebrew/bin/terminal-notifier"),
    "/opt/homebrew/bin/terminal-notifier"
  );
  assert.strictEqual(
    findTerminalNotifier("/usr/local/bin:/bin", (file) => file === "/usr/local/bin/terminal-notifier"),
    "/usr/local/bin/terminal-notifier"
  );
  assert.strictEqual(findTerminalNotifier("/bin", () => false), "");

  const vscode = {
    Uri: { parse: (text) => ({ toString: () => text }) },
    env: {
      uriScheme: "vscode",
      asExternalUri: async (uri) => ({ toString: () => `${uri.toString()}?windowId=14` })
    }
  };
  assert.strictEqual(
    await buildMacOSFocusUri(vscode),
    "vscode://zis3c.codex-notifier/focus?windowId=14"
  );
  const threadId = "123e4567-e89b-12d3-a456-426614174000";
  assert.strictEqual(
    await buildMacOSFocusUri(vscode, threadId),
    `vscode://openai.chatgpt/local/${threadId}?windowId=14`
  );
  assert.strictEqual(
    await buildMacOSFocusUri(vscode, "not-a-real-thread-id"),
    "vscode://zis3c.codex-notifier/focus?windowId=14"
  );
  assert.strictEqual(
    await buildMacOSFocusUri({ ...vscode, env: { ...vscode.env, remoteName: "ssh-remote" } }, threadId),
    "vscode://zis3c.codex-notifier/focus?windowId=14"
  );

  const calls = [];
  const fakeExecFile = (file, args, done) => {
    calls.push({ file, args });
    done(null);
  };
  await showMacOSNotification("Codex", "Needs your input", "vscode://test/focus?windowId=14", {
    notifier: "/opt/homebrew/bin/terminal-notifier",
    execFile: fakeExecFile
  });
  assert.deepStrictEqual(calls, [{
    file: "/opt/homebrew/bin/terminal-notifier",
    args: ["-title", "Codex", "-message", "Needs your input", "-open", "vscode://test/focus?windowId=14"]
  }]);

  calls.length = 0;
  await showMacOSNotification("Codex", "No click action", "", {
    notifier: "/opt/homebrew/bin/terminal-notifier",
    execFile: fakeExecFile
  });
  assert.deepStrictEqual(calls[0].args, ["-title", "Codex", "-message", "No click action"]);

  calls.length = 0;
  const title = 'Codex: "task"';
  const message = 'Quoted "text"; $(rm -rf ~)';
  await showMacOSNotification(title, message, "", { notifier: "", execFile: fakeExecFile });
  assert.strictEqual(calls[0].file, "osascript");
  assert.strictEqual(
    calls[0].args[1],
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`
  );

  calls.length = 0;
  await showMacOSNotification("Codex", "fallback", "vscode://test/focus", {
    notifier: "/opt/homebrew/bin/terminal-notifier",
    execFile: (file, args, done) => {
      calls.push({ file, args });
      done(file.includes("terminal-notifier") ? new Error("not available") : null);
    }
  });
  assert.strictEqual(calls[0].file, "/opt/homebrew/bin/terminal-notifier");
  assert.strictEqual(calls[1].file, "osascript");
  console.log("macOS notification tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
