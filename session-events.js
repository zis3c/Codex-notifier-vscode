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

function isInheritedForkCompletion(completion, sessionInfo, initialForkRead) {
  if (!sessionInfo?.forkedFromId) return false;

  const forkedAtMs = sessionInfo.createdAtMs;
  if (Number.isFinite(forkedAtMs) && Number.isFinite(completion?.completedAtMs)) {
    return completion.completedAtMs < forkedAtMs;
  }

  // If a forked session does not contain usable timestamps, ignore only the
  // initial copied snapshot. Later appends remain eligible for notification.
  return Boolean(initialForkRead);
}

module.exports = {
  isInheritedForkCompletion,
  parseTaskCompleteLine,
  parseTimestampMs
};
