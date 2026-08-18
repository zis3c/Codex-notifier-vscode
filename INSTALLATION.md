# Installation & Setup Guide

This guide explains how to install and run **Codex Finish Notifier**.

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

- Install the extension in the local VS Code UI. It is declared as a UI extension so notifications and sound play on the computer running VS Code.
- Open the remote folder with **Remote - SSH** as usual.
- Keep `codexNotifier.watchFilePath` relative (the default is `.codex-notify`) to watch the trigger file on the SSH host.
- Absolute trigger and custom sound paths refer to the local computer.
- The same local extension reads remote `~/.codex/sessions/**/*.jsonl` files
  through the Remote SSH file-system provider and watches `task_complete`
  plus `request_user_input`.
- For nonstandard home layouts, configure the absolute remote path in
  `codexNotifier.remoteSessionsPath`.
- Run `Codex Notifier: Show Diagnostics` to confirm that remote session sources
  were discovered.
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

- **Want a quick package check**
  - Run `npm run package:test`.
  - This checks the VSIX contents, not the full VS Code UI flow.
