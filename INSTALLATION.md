# Installation & Setup Guide

This guide explains how to install and run **Codex Notifier**.

---

## Prerequisites

Before installing, ensure you have:

1. VS Code installed.
2. Internet access to VS Code Marketplace (for easiest install).

---

## Option 1: Install From VS Code Extensions (Recommended for Users)

1. Open VS Code.
2. Open Extensions panel (`Ctrl+Shift+X`).
3. Search: `Codex Notifier`.
4. Find publisher: `zis3c`.
5. Click **Install**.

Direct Marketplace link:
- https://marketplace.visualstudio.com/items?itemName=zis3c.codex-notifier

---

## Option 2: Install From VSIX (Offline/Manual)

1. Open VS Code.
2. Go to Extensions panel.
3. Click `...` -> `Install from VSIX...`.
4. Choose your `.vsix` file.
5. Click **Reload** when prompted.

---

## Option 3: Run In Extension Development Host (For Contributors)

1. Open this project folder in VS Code.
2. Press `F5`.
3. In Extension Development Host:
   - Open Command Palette (`Ctrl+Shift+P`).
   - Run `Codex Notifier: Test Sound`.
   - Run `Codex Notifier: Show Diagnostics` if you want to confirm the active
     runtime state.

---

## First-Time Verification

1. Confirm sound is enabled:
   - `codexNotifier.enableSound = true`
2. Run `Codex Notifier: Test Sound`.
3. Confirm you hear sound and see status/banner based on your settings for both completion and `request_user_input`.
4. If VS Code is unfocused and `codexNotifier.toastWhenUnfocused = true`, confirm you also get a system notification.
5. Run `Codex Notifier: Show Diagnostics` to confirm the package loaded and the
   extension sees the expected session sources.
6. Leave the auto-detect defaults alone unless you need to tune false positives:

### Windows Toast Click Focus

On Windows, v0.1.12 automatically registers the per-user `codex-notifier://` protocol that starts the bundled focus helper when a toast is clicked. Run `Codex Notifier: Enable Toast Window Focus (Windows)` only to repair a missing protocol registration.

The helper records the native target of each VS Code window and matches toast ownership by Codex session and turn. This also supports the same existing chat being open in multiple windows. If an exact target cannot be verified, it does nothing instead of focusing the wrong window.

For safer auto-detection defaults:

- `codexNotifier.codexLogMinEvents = 2`
- `codexNotifier.codexLogMinBurstMs = 250`

---

## Configuration Tips

- Leave these empty to use bundled sounds:
  - `codexNotifier.completeSoundPath`
  - `codexNotifier.errorSoundPath`
- Toggle completion and prompt UI mode:
  - `codexNotifier.completionUseBanner = true` (banner)
  - `codexNotifier.completionUseBanner = false` (quiet status bar)
- Toggle unfocused system notifications:
  - `codexNotifier.toastWhenUnfocused = true` (show system toast when VS Code is not focused)
  - `codexNotifier.toastWhenUnfocused = false` (no system toast when VS Code is not focused)
- If a setting seems ignored, check whether the current workspace `.vscode/settings.json` is overriding your user setting.

## Remote SSH

- Install **Codex Notifier** in the local VS Code UI. It is declared as a UI extension so notifications and sound play on the computer running VS Code.
- Install **Codex Notifier Remote** on the SSH host. In the Extensions view, choose **Install in SSH: <host>** for `zis3c.codex-notifier-remote`, then reload the remote window.
- Open the remote folder with **Remote - SSH** as usual.
- Keep `codexNotifier.watchFilePath` relative (the default is `.codex-notify`) to watch the trigger file on the SSH host.
- Absolute trigger and custom sound paths refer to the local computer.
- The remote companion reads `~/.codex/sessions/**/*.jsonl` on the SSH host and
  writes small event files to `~/.codex/codex-notifier-events`. The local
  extension consumes those events, so session transcripts never cross SSH.
- For nonstandard home layouts, configure the absolute remote path in
  `codexNotifier.remoteSessionsPath`.
- Remote SSH to Linux and macOS hosts is supported. Windows SSH hosts are not
  covered yet.
- Run `Codex Notifier: Show Diagnostics` to confirm the remote event roots and
  that events are being processed.
- Remote live behavior still needs manual smoke testing. There is no automated
  Remote SSH end-to-end test in CI yet.

---

## Troubleshooting

- **Banner appears but no sound**
  - Reload VS Code after installing/updating VSIX.
  - Check `enableSound` and `volume`.

- **No auto completion notify**
  - Ensure `codexNotifier.monitorCodexLog = true`.
  - Leave `codexNotifier.codexLogMinEvents` and `codexNotifier.codexLogMinBurstMs` at their safer defaults unless you have a special case.
  - Run `Codex Notifier: Show Diagnostics`.

- **Expected banner or toast does not appear**
  - Check `codexNotifier.enablePopup = true`.
  - Check `codexNotifier.completionUseBanner` for focused behavior.
  - Check `codexNotifier.toastWhenUnfocused` for unfocused behavior.
  - Check whether workspace settings override your user settings.

- **Too many notifications**
  - Increase `codexNotifier.codexChatCooldownMs`.

- **Toast opens the wrong window or does nothing**
  - Run `Codex Notifier: Enable Toast Window Focus (Windows)` to repair protocol registration.
  - Reload or restart all VS Code windows after installing the VSIX.
  - Test with a new prompt in the existing chat so the current turn gets a fresh window target.
  - Use `Codex Notifier: Show Diagnostics` if the issue remains.

- **Want a quick package check**
  - Run `npm run package:test`.
  - This checks the VSIX contents, not the full VS Code UI flow.
