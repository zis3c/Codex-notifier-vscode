# Changelog

All notable changes to this project will be documented in this file.

## [0.2.2] - 2026-07-31

- Kept filtering guardian and subagent completions while allowing a resumed
  top-level conversation to notify after the VS Code workspace changes.

## [0.2.1] - 2026-07-30

- Filtered out guardian, subagent, and other internal Codex sessions that emit
  their own intermediate `task_complete` events.
- Added diagnostics for eligible and ignored session sources.

## [0.2.0] - 2026-07-30

- Consolidated Remote SSH detection and local sound playback into one UI extension.
- Replaced `Codex.log` WebView activity inference with authoritative
  `task_complete` events from Codex session JSONL files.
- Added remote session discovery through `vscode.workspace.fs` and configurable
  local/remote session paths.

## [0.1.9] - 2026-07-30

- Added detailed log-source diagnostics for troubleshooting Remote SSH auto-detection.

## [0.1.8] - 2026-07-30

- Added Remote SSH workspace support by running notifications in the local UI extension host.
- Switched relative manual-trigger reads to the VS Code file-system API so `.codex-notify` can be watched on remote workspace roots.
- Added discovery and polling of Codex logs in remote VS Code Server hosts and the current `exthost*` log layout.
- Matched explicit per-conversation turn-start and completion markers so silence alone no longer triggers or suppresses notifications.
- Added remote workspace details to diagnostics and documented local versus remote path behavior.

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
