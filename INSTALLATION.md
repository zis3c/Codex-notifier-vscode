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

---

## First-Time Verification

1. Confirm sound is enabled:
   - `codexNotifier.enableSound = true`
2. Run `Codex Notifier: Test Sound`.
3. Confirm you hear sound and see status/banner based on your settings.
4. Leave the auto-detect defaults alone unless you need to tune false positives:
   - `codexNotifier.codexLogMinEvents = 2`
   - `codexNotifier.codexLogMinBurstMs = 250`

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
  - Leave `codexNotifier.codexLogMinEvents` and `codexNotifier.codexLogMinBurstMs` at their safer defaults unless you have a special case.
  - Run `Codex Notifier: Show Diagnostics`.

- **Too many notifications**
  - Increase `codexNotifier.codexChatCooldownMs`.
