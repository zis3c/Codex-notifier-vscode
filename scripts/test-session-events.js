"use strict";

const assert = require("assert");
const {
  isHistoricalSessionCompletion,
  isHistoricalSessionRequest,
  parseRequestUserInputLine,
  parseTaskCompleteLine,
  parseTimestampMs
} = require("../session-events");

function completionLine(turnId, completedAt) {
  return JSON.stringify({
    timestamp: "2026-07-30T23:05:23.159Z",
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: turnId,
      completed_at: completedAt
    }
  });
}

function requestUserInputLine(turnId, callId, requestedAt) {
  return JSON.stringify({
    timestamp: requestedAt,
    type: "response_item",
    payload: {
      type: "function_call",
      id: "fc_test",
      name: "request_user_input",
      arguments: "{\"questions\":[]}",
      call_id: callId,
      internal_chat_message_metadata_passthrough: {
        turn_id: turnId
      }
    }
  });
}

const forkedSession = {
  forkedFromId: "parent-session",
  createdAtMs: Date.parse("2026-07-30T23:05:22.986Z")
};
const watcherStartedAtMs = Date.parse("2026-07-30T23:00:00.000Z");

const inherited = parseTaskCompleteLine(
  completionLine("old-turn", 1785452598)
);
assert.strictEqual(inherited.turnId, "old-turn");
assert.strictEqual(
  isHistoricalSessionCompletion(inherited, forkedSession, watcherStartedAtMs),
  true,
  "a completion copied from before the fork must be ignored"
);

const newCompletion = parseTaskCompleteLine(
  completionLine("new-turn", 1785452820)
);
assert.strictEqual(
  isHistoricalSessionCompletion(newCompletion, forkedSession, watcherStartedAtMs),
  false,
  "a completion produced after the fork must notify"
);

const resumedSession = {
  forkedFromId: "",
  createdAtMs: Date.parse("2026-07-30T16:30:19.903Z")
};
const oldResumedCompletion = parseTaskCompleteLine(
  completionLine("old-resumed-turn", 1785429316)
);
assert.strictEqual(
  isHistoricalSessionCompletion(oldResumedCompletion, resumedSession, watcherStartedAtMs),
  true,
  "old completions from a resumed top-level chat must be ignored"
);
assert.strictEqual(
  isHistoricalSessionCompletion(newCompletion, resumedSession, watcherStartedAtMs),
  false,
  "a new completion from a resumed top-level chat must notify"
);

const request = parseRequestUserInputLine(
  requestUserInputLine("prompt-turn", "call_prompt", "2026-07-30T23:05:24.159Z")
);
assert.strictEqual(request.turnId, "prompt-turn");
assert.strictEqual(request.callId, "call_prompt");
assert.strictEqual(
  isHistoricalSessionRequest(request, forkedSession, watcherStartedAtMs),
  false,
  "a new request_user_input prompt must notify"
);

const historicalRequest = parseRequestUserInputLine(
  requestUserInputLine("old-prompt-turn", "call_old_prompt", "2026-07-30T22:59:59.159Z")
);
assert.strictEqual(
  isHistoricalSessionRequest(historicalRequest, forkedSession, watcherStartedAtMs),
  true,
  "a pre-watch request_user_input prompt must be ignored"
);

assert.strictEqual(
  isHistoricalSessionCompletion({ turnId: "missing-time" }, forkedSession, watcherStartedAtMs),
  true,
  "an undated completion in the initial session snapshot must be ignored"
);
assert.strictEqual(
  isHistoricalSessionCompletion({ turnId: "later-missing-time" }, forkedSession, undefined),
  false,
  "an undated completion appended later must remain eligible"
);

assert.strictEqual(parseTimestampMs("2026-07-30T23:05:22.986Z"), forkedSession.createdAtMs);
assert.strictEqual(parseTimestampMs(1785452722), 1785452722000);
assert.strictEqual(parseTaskCompleteLine('{"type":"event_msg","payload":{"type":"token_count"}}'), undefined);
assert.strictEqual(
  parseRequestUserInputLine('{"type":"response_item","payload":{"type":"function_call","name":"shell_command"}}'),
  undefined
);

console.log("Session event tests passed.");
