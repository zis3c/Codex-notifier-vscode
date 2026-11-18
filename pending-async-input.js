"use strict";

// Track unanswered asynchronous questions separately for each Codex session.
// A task_complete event does NOT imply that an async question was answered.
const ASYNC_REPLY_OPEN = /<send_user_message_question_reply\b/i;
const ASYNC_REPLY_BODY = /<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/i;

function parseQuestionReference(value) {
  let id = value;
  if (typeof id === "string") {
    try {
      id = JSON.parse(id);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(id) || id[0] !== "request_user_input_async" || typeof id[1] !== "string") {
    return null;
  }
  const index = Number(id[2]);
  if (!Number.isInteger(index) || index < 0) return null;
  return { callId: id[1], index };
}

function parseAsyncRequest(line) {
  try {
    const event = JSON.parse(line);
    const payload = event?.payload;
    if (event.type !== "response_item" || payload?.type !== "function_call" || payload.name !== "request_user_input_async") {
      return null;
    }
    const callId = payload.call_id;
    if (typeof callId !== "string" || !callId) return null;
    const raw = payload.arguments || {};
    const args = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(args?.questions) || args.questions.length === 0) return null;
    return { callId, questionCount: args.questions.length };
  } catch {
    return null;
  }
}

class PendingAsyncInputTracker {
  constructor() {
    // sessionId -> callId -> set of unanswered question indexes
    this.pending = new Map();
  }

  registerRequest(sessionId, jsonlLine) {
    const request = parseAsyncRequest(jsonlLine);
    if (!request || !sessionId) return false;
    let calls = this.pending.get(sessionId);
    if (!calls) {
      calls = new Map();
      this.pending.set(sessionId, calls);
    }
    // Replayed or duplicated requests should not re-open answered questions.
    if (!calls.has(request.callId)) {
      calls.set(request.callId, new Set(Array.from({ length: request.questionCount }, (_, i) => i)));
    }
    return true;
  }

  handleUserMessage(sessionId, message) {
    const calls = this.pending.get(sessionId);
    if (!calls || typeof message !== "string" || !message.trim()) return;

    // Starting a new ordinary prompt explicitly moves on from pending questions.
    if (!ASYNC_REPLY_OPEN.test(message)) {
      this.pending.delete(sessionId);
      return;
    }

    // Do not accidentally dismiss unanswered questions on malformed replies.
    const match = message.match(ASYNC_REPLY_BODY);
    if (!match) return;
    let answers;
    try {
      answers = JSON.parse(match[1]);
    } catch {
      return;
    }
    if (!Array.isArray(answers)) answers = [answers];
    for (const answer of answers) {
      const reference = parseQuestionReference(answer?.questionItemId);
      if (!reference) continue;
      const unanswered = calls.get(reference.callId);
      if (!unanswered) continue;
      unanswered.delete(reference.index);
      if (unanswered.size === 0) calls.delete(reference.callId);
    }
    if (calls.size === 0) this.pending.delete(sessionId);
  }

  hasPending(sessionId) {
    return (this.pending.get(sessionId)?.size || 0) > 0;
  }

  clear() {
    this.pending.clear();
  }
}

module.exports = { PendingAsyncInputTracker, parseAsyncRequest, parseQuestionReference };
