"use strict";

const path = require("path");

function inferRemoteHomePath(uriPath) {
  const parts = String(uriPath || "").replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0].toLowerCase() === "root") return "/root";
  if ((parts[0].toLowerCase() === "home" || parts[0].toLowerCase() === "users") && parts[1]) {
    return `/${parts[0]}/${parts[1]}`;
  }
  if (/^[a-zA-Z]:$/.test(parts[0]) && parts[1]) {
    if (parts[1].toLowerCase() === "users" && parts[2]) {
      return `/${parts[0]}/${parts[1]}/${parts[2]}`;
    }
    if (parts[1].toLowerCase() === "home" && parts[2]) {
      return `/${parts[0]}/${parts[1]}/${parts[2]}`;
    }
  }
  return null;
}

function resolveRemoteSessionsPath({ configuredPath = "", homePath = "" } = {}) {
  const configured = String(configuredPath || "").trim();
  if (configured) return configured.startsWith("/") ? configured : "";
  return homePath ? `${homePath}/.codex/sessions` : "";
}

function resolveRemoteEventsPath(sessionsPath) {
  if (!sessionsPath) return "";
  return `${path.posix.dirname(sessionsPath)}/codex-notifier-events`;
}

module.exports = { inferRemoteHomePath, resolveRemoteSessionsPath, resolveRemoteEventsPath };
