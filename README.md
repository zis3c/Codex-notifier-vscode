# Codex Notifier (VS Code Extension)

Plays a sound and/or shows a popup when task is complete.

## Documentation

- [INSTALLATION.md](./INSTALLATION.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [AUTO_DEPLOY.md](./AUTO_DEPLOY.md)

## Project File Guide

- `extension.js`
  - Main extension runtime and command registration.
  - Contains all watcher logic (file trigger, Codex doc monitor, Codex.log monitor).
- `package.json`
  - Extension manifest: commands, activation events, settings schema, keybindings.
  - Note: standard JSON does not support inline comments.
- `.vscode/launch.json`
  - Debug launcher config for Extension Development Host (`F5`).
- `.vscode/settings.json`
  - Workspace-local tuning for notifier behavior while developing/testing.
- `codex-done.ps1`
  - Helper script that writes `.codex-notify` to manually trigger notifications.
- `.codex-notify`
  - File watched by extension for external/manual completion/error triggers.
- `notification.wav`
  - Bundled fallback sound for completion/error notifications.

## Features

- Command: `Codex Notifier: Notify Complete`
- Command: `Codex Notifier: Notify Error`
- Command: `Codex Notifier: Test Sound`
- Optional file watcher trigger:
  - Watches `.codex-notify` in workspace (default)
  - On file update:
    - contains `error` -> error notification
    - anything else -> complete notification
- Codex chat auto-detect trigger:
  - Monitors `openai-codex` session document updates
  - When updates go idle for configured delay, plays complete notification
- Codex log auto-detect trigger (recommended):
  - Monitors VS Code `Codex.log` for `thread-stream-state-changed`
  - When stream events go idle, plays complete notification

## Install (Local Dev)

1. Open this folder in VS Code: `vscode-codex-notifier`
2. Press `F5` to launch Extension Development Host
3. In new window, run command palette:
   - `Codex Notifier: Test Sound`

## Settings

In VS Code settings (`settings.json`):

```json
{
  "codexNotifier.enableSound": true,
  "codexNotifier.enablePopup": true,
  "codexNotifier.volume": 1,
  "codexNotifier.completeSoundPath": "C:\\\\sounds\\\\done.wav",
  "codexNotifier.errorSoundPath": "C:\\\\sounds\\\\error.wav",
  "codexNotifier.watchEnabled": true,
  "codexNotifier.watchFilePath": ".codex-notify",
  "codexNotifier.monitorCodexChat": true,
  "codexNotifier.codexChatIdleMs": 1800,
  "codexNotifier.codexChatCooldownMs": 5000,
  "codexNotifier.codexChatPollMs": 600,
  "codexNotifier.monitorCodexLog": true,
  "codexNotifier.codexLogPollMs": 700,
  "codexNotifier.codexLogIdleMs": 900,
  "codexNotifier.codexLogCompleteWindowMs": 8000
}
```

If sound path is empty, extension uses system beep.

## Trigger From Terminal

From workspace root:

```powershell
Set-Content .codex-notify "complete $(Get-Date -Format o)"
```

For error:

```powershell
Set-Content .codex-notify "error $(Get-Date -Format o)"
```

Or use helper script:

```powershell
.\codex-done.ps1
.\codex-done.ps1 -Kind error
.\codex-done.ps1 -Kind complete -Message "complete manual trigger"
```

## Hotkeys

- `Ctrl+Alt+.` -> `Codex Notifier: Notify Complete`
- `Ctrl+Alt+,` -> `Codex Notifier: Notify Error`

## Notes

- For Windows custom sound, extension uses `SoundPlayer` for `.wav` and `MediaPlayer` fallback for other formats.
- Keep sound files local and accessible.
