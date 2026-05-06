# Installation & Setup Guide

This guide explains how to install and run **Codex Finish Notifier**.

---

## Prerequisites

Before installing, ensure you have:

1. VS Code installed.
2. A built `.vsix` file (example: `codex-notifier-private.vsix`).

---

## Option 1: Install From VSIX (Recommended for Users)

1. Open VS Code.
2. Go to Extensions panel.
3. Click `...` -> `Install from VSIX...`.
4. Choose `codex-notifier-private.vsix`.
5. Click **Reload** when prompted.

---

## Option 2: Run In Extension Development Host (For Contributors)

1. Open this project folder in VS Code.
2. Press `F5`.
3. In Extension Development Host:
   - Open Command Palette (`Ctrl+Shift+P`).
   - Run `Codex Notifier: Test Sound`.

---

## First-Time Verification

1. Confirm sound is enabled:
   - `codexNotifier.enableSound = true`
2. Run `Codex Notifier: Test Sound`.
3. Confirm you hear sound and see status/banner based on your settings.

---

## Configuration Tips

- Leave these empty to use bundled sounds:
  - `codexNotifier.completeSoundPath`
  - `codexNotifier.errorSoundPath`
- Toggle completion UI mode:
  - `codexNotifier.completionUseBanner = true` (banner)
  - `codexNotifier.completionUseBanner = false` (quiet status bar)

---

## Troubleshooting

- **Banner appears but no sound**
  - Reload VS Code after installing/updating VSIX.
  - Check `enableSound` and `volume`.

- **No auto completion notify**
  - Ensure `codexNotifier.monitorCodexLog = true`.
  - Run `Codex Notifier: Show Diagnostics`.

- **Too many notifications**
  - Increase `codexNotifier.codexChatCooldownMs`.
