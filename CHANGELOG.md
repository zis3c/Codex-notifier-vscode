# Changelog

All notable changes to this project will be documented in this file.

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
