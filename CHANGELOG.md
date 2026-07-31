# Changelog

All notable changes to this project will be documented in this file.

## [0.1.8] - 2026-07-31

- Added Remote SSH workspace support for Codex session notifications.
- Kept notifications and sounds running in the local UI extension host.
- Switched auto-detection to authoritative Codex session JSONL `task_complete`
  events.
- Ignored inherited, replayed, guardian, and subagent session history so only
  fresh top-level work notifies.
- Added detailed remote session diagnostics and configurable local or remote
  session paths.
- Credit: Remote SSH implementation and follow-up fixes were contributed by
  Ae-Mc in [PR #1](https://github.com/zis3c/Codex-notifier-vscode/pull/1).

## [0.1.7] - 2026-07-24

- Added unfocused system notifications so Codex responses can alert you even when VS Code is not the active window.
- Extended the unfocused notification path beyond Windows to support macOS and Linux where available.

## [0.1.6] - 2026-07-21

- Fixed workspace switching so Codex Notifier keeps watching the active folder instead of staying stuck on the first workspace.
- Improved manual `.codex-notify` handling so a new trigger file can be created after the extension is already running.
- Lowered the default auto-detect burst thresholds so fresh workspaces do not depend on folder-local settings to fire notifications.

## [0.1.5] - 2026-07-21

- Release cut for the Codex 26.715.31925 compatibility fix and the follow-up auto-detect polish.

## [0.1.4] - 2026-07-21

- Tightened Codex auto-detect so open and close chatter does not fire notifications on its own.
- Reduced debug log noise by logging burst start and completion edges instead of every poll hit.
- Raised the default auto-detect burst threshold a bit for safer completion detection.

## [0.1.0] - 2026-05-07

- Promoted release version from `0.0.1` to `0.1.0` for VSIX distribution maturity.
- Replaced placeholder extension publisher value with a non-placeholder local distribution identifier.
- Added `SECURITY.md` and documented private vulnerability reporting expectations.
- Added a lightweight release validator script (`scripts/validate-release.js`).
- Added `npm` checks:
  - `npm run check`
  - `npm run release:check`
  - `npm run lint` (mapped to `check`)
