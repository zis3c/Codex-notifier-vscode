"use strict";

const assert = require("assert");
const { createHarness, Uri } = require("./runtime-harness");

async function main() {
  const unknown = createHarness({ remotePath: "/data/alice/project" });
  assert.strictEqual(unknown.api.getRemoteSessionRoots().length, 0);
  assert.strictEqual((await unknown.api.findAllCodexSessionFiles()).length, 0);
  assert.strictEqual(unknown.localReads.length, 0, "invalid remote discovery must not fall back to local sessions");
  const summary = await unknown.api.getDetailedDiagnosticsSummary();
  assert.strictEqual(summary.recentDiagnostics[0].code, "remote-home-unknown");
  assert(!JSON.stringify(summary).includes("/.codex/sessions"));
  assert.strictEqual(unknown.lines.length, 1, "repeated discovery errors must be throttled");

  const standard = createHarness({ remotePath: "/home/alice/project" });
  assert.strictEqual(standard.api.getRemoteSessionRoots()[0].path, "/home/alice/.codex/sessions");
  const root = createHarness({ remotePath: "/root/project" });
  assert.strictEqual(root.api.getRemoteSessionRoots()[0].path, "/root/.codex/sessions");

  const explicit = createHarness({ remotePath: "/data/alice/project", settings: { remoteSessionsPath: "/storage/codex/sessions" } });
  assert.strictEqual(explicit.api.getRemoteSessionRoots()[0].path, "/storage/codex/sessions");
  explicit.directories.set("/storage/codex/sessions", [["2026", 2]]);
  explicit.directories.set("/storage/codex/sessions/2026", [["10", 2]]);
  explicit.directories.set("/storage/codex/sessions/2026/10", [["06", 2]]);
  explicit.directories.set("/storage/codex/sessions/2026/10/06", [["session.jsonl", 1]]);
  const sources = await explicit.api.findAllCodexSessionFiles();
  assert.strictEqual(sources.length, 1);
  assert.strictEqual(sources[0].kind, "remote");

  for (const invalidPath of ["~/.codex/sessions", "relative/sessions", "C:\\codex\\sessions"]) {
    const invalid = createHarness({ remotePath: "/home/alice/project", settings: { remoteSessionsPath: invalidPath } });
    assert.strictEqual(invalid.api.getRemoteSessionRoots().length, 0);
    assert.strictEqual((await invalid.api.getDetailedDiagnosticsSummary()).recentDiagnostics[0].code, "remote-path-invalid");
  }
  const missing = createHarness();
  missing.directories.set("/missing", Object.assign(new Error("private body must not be logged"), { code: "FileNotFound" }));
  await missing.api.remoteDirectoriesAt(new Uri("/missing"));
  assert(missing.lines[0].includes("FileNotFound"));
  assert(!missing.lines[0].includes("private body"));
  for (let i = 0; i < 40; i++) missing.api.recordDiagnostic("test", String(i), "metadata");
  assert.strictEqual((await missing.api.getDetailedDiagnosticsSummary()).recentDiagnostics.length, 30);

  const notification = createHarness();
  await notification.api.showSystemNotification("test", "private notification text");
  assert.strictEqual(notification.api.getDiagnosticsSummary().lastNotificationResult, "submitted");
  notification.setNotificationError(Object.assign(new Error("private notification text"), { code: 1 }));
  await notification.api.showSystemNotification("test", "private notification text");
  assert.strictEqual(notification.api.getDiagnosticsSummary().lastNotificationResult, "failed");
  assert(!notification.lines.join("\n").includes("private notification text"));

  assert.strictEqual(notification.api.classifySessionMetadata({ originator: "codex_vscode", source: "vscode" }).eligible, true);
  assert.strictEqual(notification.api.classifySessionMetadata({ originator: "codex_vscode", source: "vscode", thread_source: "subagent" }).eligible, false);
  assert.strictEqual(notification.api.classifySessionMetadata({ originator: "codex_cli", source: "cli" }).eligible, false);
  const locks = new Set();
  const firstWindow = createHarness({ locks });
  const secondWindow = createHarness({ locks });
  const source = { key: "remote-test", kind: "remote", uri: new Uri("/test/session.jsonl") };
  const session = { sessionId: "session-one", cwd: "/test", prompt: "private prompt" };
  for (let i = 0; i < 3; i++) {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg",
      payload: { type: "task_complete", turn_id: `turn-${i}`, completed_at: Date.now() } }) + "\n";
    await Promise.all([
      firstWindow.api.processCodexSessionChunk(line, source, session, 0, undefined, true),
      secondWindow.api.processCodexSessionChunk(line, source, session, 0, undefined, true)
    ]);
  }
  assert.strictEqual(firstWindow.notifications.length + secondWindow.notifications.length, 3,
    "three consecutive turns across two windows must produce exactly three notifications");
  assert.strictEqual(secondWindow.api.getDiagnosticsSummary().completedTurnIds, 3);
  assert(!secondWindow.lines.join("\n").includes("private prompt"));
  console.log("Remote path, discovery, diagnostics and submission failure tests passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
