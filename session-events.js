"use strict";

function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1000000000000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 1000000000000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseTaskCompleteLine(line) {
  if (!line.includes('"task_complete"')) return undefined;
  try {
    const event = JSON.parse(line);
    if (event?.type !== "event_msg" || event.payload?.type !== "task_complete") {
      return undefined;
    }
    return {
      turnId: event.payload.turn_id || `${event.timestamp || "unknown"}:${line.length}`,
      completedAtMs: parseTimestampMs(event.payload.completed_at)
    };
  } catch {
    // Incomplete lines are retained and retried after the next append.
    return undefined;
  }
}

function parseRequestUserInputLine(line) {
  if (!line.includes('"request_user_input"')) return undefined;
  try {
    const event = JSON.parse(line);
    if (event?.type !== "response_item" || event.payload?.type !== "function_call") {
      return undefined;
    }
    if (event.payload.name !== "request_user_input") {
      return undefined;
    }
    const turnId = event.payload.internal_chat_message_metadata_passthrough?.turn_id
      || event.payload.turn_id
      || event.payload.call_id
      || `${event.timestamp || "unknown"}:${line.length}`;
    return {
      turnId,
      callId: event.payload.call_id,
      requestedAtMs: parseTimestampMs(event.timestamp)
    };
  } catch {
    // Incomplete lines are retained and retried after the next append.
    return undefined;
  }
}

function isHistoricalSessionEvent(event, sessionInfo, historyNotBeforeMs, eventAtMsKey) {
  if (!Number.isFinite(historyNotBeforeMs)) return false;

  const createdAtMs = sessionInfo?.createdAtMs;
  const cutoffMs = Number.isFinite(createdAtMs)
    ? Math.max(historyNotBeforeMs, createdAtMs)
    : historyNotBeforeMs;

  const eventAtMs = Number.isFinite(event?.[eventAtMsKey]) ? event[eventAtMsKey] : undefined;
  if (Number.isFinite(eventAtMs)) {
    return eventAtMs < cutoffMs;
  }

  // An undated event in the first snapshot cannot be proven current.
  // Later appends are processed without a cutoff and remain eligible.
  return true;
}

function isHistoricalSessionCompletion(completion, sessionInfo, historyNotBeforeMs) {
  return isHistoricalSessionEvent(completion, sessionInfo, historyNotBeforeMs, "completedAtMs");
}

function isHistoricalSessionRequest(request, sessionInfo, historyNotBeforeMs) {
  return isHistoricalSessionEvent(request, sessionInfo, historyNotBeforeMs, "requestedAtMs");
}

module.exports = {
  isHistoricalSessionCompletion,
  isHistoricalSessionRequest,
  parseRequestUserInputLine,
  parseTaskCompleteLine,
  parseTimestampMs
};
