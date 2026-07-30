"use strict";

const assert = require("assert");
const {
  isInheritedForkCompletion,
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

const forkedSession = {
  forkedFromId: "parent-session",
  createdAtMs: Date.parse("2026-07-30T23:05:22.986Z")
};

const inherited = parseTaskCompleteLine(
  completionLine("old-turn", 1785452598)
);
assert.strictEqual(inherited.turnId, "old-turn");
assert.strictEqual(
  isInheritedForkCompletion(inherited, forkedSession, true),
  true,
  "a completion copied from before the fork must be ignored"
);

const newCompletion = parseTaskCompleteLine(
  completionLine("new-turn", 1785452820)
);
assert.strictEqual(
  isInheritedForkCompletion(newCompletion, forkedSession, true),
  false,
  "a completion produced after the fork must notify"
);

assert.strictEqual(
  isInheritedForkCompletion(inherited, { forkedFromId: "", createdAtMs: forkedSession.createdAtMs }, true),
  false,
  "normal top-level sessions must keep their existing behavior"
);

assert.strictEqual(
  isInheritedForkCompletion({ turnId: "missing-time" }, forkedSession, true),
  true,
  "an undated completion in the initial fork snapshot must be ignored"
);
assert.strictEqual(
  isInheritedForkCompletion({ turnId: "later-missing-time" }, forkedSession, false),
  false,
  "an undated completion appended later must remain eligible"
);

assert.strictEqual(parseTimestampMs("2026-07-30T23:05:22.986Z"), forkedSession.createdAtMs);
assert.strictEqual(parseTimestampMs(1785452722), 1785452722000);
assert.strictEqual(parseTaskCompleteLine('{"type":"event_msg","payload":{"type":"token_count"}}'), undefined);

console.log("Session event tests passed.");
