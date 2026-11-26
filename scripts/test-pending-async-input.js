"use strict";
const assert = require("assert");
const { PendingAsyncInputTracker } = require("../pending-async-input");
const { parseRequestUserInputLine } = require("../session-events");

const request = (id, count = 1, tool = "request_user_input_async") => JSON.stringify({
  timestamp: "2026-11-18T19:41:36.206Z",
  type: "response_item",
  payload: {
    type: "function_call", name: tool, call_id: id,
    arguments: JSON.stringify({ questions: Array.from({ length: count }, (_, i) => ({ title: `Question ${i}` })) })
  }
});
const answer = (callId, index) => ({
  questionItemId: JSON.stringify(["request_user_input_async", callId, index]), answer: "Yes"
});
const reply = (...answers) => `<send_user_message_question_reply>${JSON.stringify(answers)}</send_user_message_question_reply>`;

// Ensure the existing session parser recognizes the real async/title format.
const eventFromCodex = parseRequestUserInputLine(request("call-async-parser"));
assert.ok(eventFromCodex && eventFromCodex.callId === "call-async-parser",
  "session-events.js must recognize request_user_input_async and title");
assert.strictEqual(eventFromCodex.questionCount, 1, "session-events.js must report the question count");

const register = (target, sessionId, line) => target.registerRequest(sessionId, parseRequestUserInputLine(line));
const state = new PendingAsyncInputTracker();
assert.strictEqual(register(state, "session-a", request("call-a", 2)), true);
assert.strictEqual(state.hasPending("session-a"), true, "pending questions suppress subsequent task_complete");
assert.strictEqual(state.hasPending("session-b"), false, "sessions stay independent");
register(state, "session-a", request("call-b"));
register(state, "session-b", request("call-other"));
state.handleUserMessage("session-a", reply(answer("call-a", 0)));
assert.strictEqual(state.hasPending("session-a"), true, "partial reply must not clear other questions");
state.handleUserMessage("session-a", reply(answer("call-a", 1)));
assert.strictEqual(state.hasPending("session-a"), true, "other outstanding calls remain pending");
state.handleUserMessage("session-a", reply(answer("call-b", 0)));
assert.strictEqual(state.hasPending("session-a"), false, "all answers restore completion notification");
assert.strictEqual(state.hasPending("session-b"), true, "another session is unaffected");
state.handleUserMessage("session-b", "Let's do something else");
assert.strictEqual(state.hasPending("session-b"), false, "new ordinary prompt cancels pending questions");

register(state, "session-a", request("call-a"));
state.handleUserMessage("session-a", reply({ questionItemId: "not parseable" }));
assert.strictEqual(state.hasPending("session-a"), true, "unknown reply must not silently clear pending state");
state.handleUserMessage("session-a", "<send_user_message_question_reply>{broken</send_user_message_question_reply>");
assert.strictEqual(state.hasPending("session-a"), true, "malformed reply must not clear pending state");
state.handleUserMessage("session-a", `# Context from my IDE setup:\n## My request:\n${reply(answer("call-a", 0))}`);
assert.strictEqual(state.hasPending("session-a"), false, "IDE context prefix does not mask the answer");
assert.strictEqual(register(state, "session-a", request("sync", 1, "request_user_input")), false, "synchronous requests are not marked as async");
assert.strictEqual(register(state, "session-a", "bad-json"), false, "malformed input must not be tracked");

register(state, "session-a", request("call-next"));
state.clear();
assert.strictEqual(state.hasPending("session-a"), false, "watcher shutdown clears state");
console.log("Pending async-input tests passed.");
