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

function cleanUserPrompt(text) {
  const value = String(text || "").trim();
  const requestMarker = value.match(/(?:^|\n)##\s*My request:\s*([\s\S]*)$/i);
  return (requestMarker ? requestMarker[1] : value).trim();
}

function parseUserMessageLine(line) {
  if (!line.includes('"user_message"') && !line.includes('"role":"user"')) return undefined;
  try {
    const event = JSON.parse(line);
    if (event?.type === "event_msg" && event.payload?.type === "user_message") {
      return typeof event.payload.message === "string" ? cleanUserPrompt(event.payload.message) : undefined;
    }
    if (event?.type === "response_item" && event.payload?.type === "message" && event.payload.role === "user") {
      const text = event.payload.content
        ?.filter((item) => item?.type === "input_text" && typeof item.text === "string")
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join(" ");
      return text ? cleanUserPrompt(text) : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
    let argumentsPayload;
    try {
      const rawArguments = event.payload.arguments;
      argumentsPayload = typeof rawArguments === "string"
        ? JSON.parse(rawArguments || "{}")
        : rawArguments || {};
    } catch {
      return undefined;
    }
    const questions = argumentsPayload?.questions;
    if (!Array.isArray(questions) || !questions.some((question) => (
      question && typeof question.question === "string" && question.question.trim()
    ))) {
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

function parseSessionMetadata(text) {
  const newline = text.indexOf("\n");
  const firstLine = newline >= 0 ? text.slice(0, newline) : text;
  try {
    const event = JSON.parse(firstLine);
    return event?.type === "session_meta" ? event.payload : undefined;
  } catch {
    return undefined;
  }
}

function classifySessionMetadata(metadata) {
  if (metadata?.originator !== "codex_vscode") {
    return { eligible: false, reason: "non-vscode-originator" };
  }
  if (metadata?.source !== "vscode" || metadata?.thread_source === "subagent") {
    return { eligible: false, reason: "subagent-or-internal-session" };
  }
  return { eligible: true, reason: "top-level-vscode-session" };
}

function getUserMessageTurnId(line) {
  try {
    const event = JSON.parse(line);
    if (event?.type === "event_msg" && event.payload?.type === "user_message") {
      return String(event.payload.turn_id || "");
    }
    if (event?.type === "response_item" && event.payload?.type === "message" && event.payload.role === "user") {
      return String(event.payload.internal_chat_message_metadata_passthrough?.turn_id || event.payload.turn_id || "");
    }
  } catch {
    return "";
  }
  return "";
}

function isCurrentUserMessageLine(line, historyNotBeforeMs) {
  if (!Number.isFinite(historyNotBeforeMs)) return true;
  try {
    const event = JSON.parse(line);
    const timestamp = Date.parse(event?.timestamp || "");
    return Number.isFinite(timestamp) && timestamp >= historyNotBeforeMs;
  } catch {
    return false;
  }
}

module.exports = {
  classifySessionMetadata,
  getUserMessageTurnId,
  isCurrentUserMessageLine,
  isHistoricalSessionCompletion,
  isHistoricalSessionRequest,
  parseSessionMetadata,
  parseRequestUserInputLine,
  parseUserMessageLine,
  cleanUserPrompt,
  parseTaskCompleteLine,
  parseTimestampMs
};
