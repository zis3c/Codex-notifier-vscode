"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSessionTailer } = require("../remote/session-tailer");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-notifier-agent-"));
const sessionsRoot = path.join(tmp, "sessions");
const dayDir = path.join(sessionsRoot, "2026", "11", "11");
fs.mkdirSync(dayDir, { recursive: true });

const now = Date.now();
const metadataLine = (overrides = {}) => JSON.stringify({
  timestamp: new Date(now - 5000).toISOString(),
  type: "session_meta",
  payload: {
    id: "sess-1",
    originator: "codex_vscode",
    source: "vscode",
    cwd: "/home/alice/project",
    ...overrides
  }
});
const userMessageLine = (message, timestamp = now - 1000, turnId = "turn-1") => JSON.stringify({
  timestamp: new Date(timestamp).toISOString(),
  type: "event_msg",
  payload: { type: "user_message", message, turn_id: turnId }
});
const completionLine = (turnId, completedAt = now - 500) => JSON.stringify({
  timestamp: new Date(completedAt).toISOString(),
  type: "event_msg",
  payload: { type: "task_complete", turn_id: turnId, completed_at: completedAt }
});
const requestLine = (turnId, callId, requestedAt = now - 500) => JSON.stringify({
  timestamp: new Date(requestedAt).toISOString(),
  type: "response_item",
  payload: {
    type: "function_call",
    name: "request_user_input",
    arguments: JSON.stringify({ questions: [{ question: "Pick one" }] }),
    call_id: callId,
    internal_chat_message_metadata_passthrough: { turn_id: turnId }
  }
});

const events = [];
const tailer = createSessionTailer({
  fs,
  path,
  sessionsRoot,
  historyNotBeforeMs: now - 60000,
  discoveryCacheMs: 0,
  onEvent: (event) => events.push(event)
});

const sessionA = path.join(dayDir, "rollout-a.jsonl");
fs.writeFileSync(sessionA, [
  metadataLine(),
  userMessageLine("Fix the bug"),
  completionLine("old-turn", now - 120000)
].join("\n") + "\n");

async function main() {
  await tailer.pollOnce();

  assert.deepStrictEqual(events.map((event) => event.kind), ["user_message"]);
  assert.strictEqual(events[0].sessionId, "sess-1");
  assert.strictEqual(events[0].turnId, "turn-1");

  events.length = 0;
  fs.appendFileSync(sessionA, completionLine("turn-1") + "\n");
  await tailer.pollOnce();
  assert.deepStrictEqual(events.map((event) => event.kind), ["complete"]);
  assert.strictEqual(events[0].turnId, "turn-1");
  assert.strictEqual(events[0].prompt, "Fix the bug");
  assert.strictEqual(events[0].sessionCwd, "/home/alice/project");

  events.length = 0;
  fs.appendFileSync(sessionA, completionLine("turn-1") + "\n");
  await tailer.pollOnce();
  assert.strictEqual(events.length, 0, "duplicate completion must not notify twice");

  events.length = 0;
  fs.appendFileSync(sessionA, requestLine("turn-2", "call-2") + "\n");
  await tailer.pollOnce();
  assert.deepStrictEqual(events.map((event) => event.kind), ["input"]);
  assert.strictEqual(events[0].turnId, "turn-2");
  assert.strictEqual(events[0].callId, "call-2");

  events.length = 0;
  const subagent = path.join(dayDir, "rollout-subagent.jsonl");
  fs.writeFileSync(subagent, [
    metadataLine({ id: "sess-sub", thread_source: "subagent" }),
    userMessageLine("nested work", now - 1000, "turn-sub"),
    completionLine("turn-sub")
  ].join("\n") + "\n");
  await tailer.pollOnce();
  assert.strictEqual(events.length, 0, "subagent sessions must stay silent");

  events.length = 0;
  const split = completionLine("turn-split");
  fs.appendFileSync(sessionA, split.slice(0, 25));
  await tailer.pollOnce();
  assert.strictEqual(events.length, 0, "a partial line must wait for the rest of the append");
  fs.appendFileSync(sessionA, split.slice(25) + "\n");
  await tailer.pollOnce();
  assert.deepStrictEqual(events.map((event) => event.kind), ["complete"]);
  assert.strictEqual(events[0].turnId, "turn-split");

  tailer.stop();
  console.log("Remote agent tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
