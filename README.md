# Codex Notifier

Sound and desktop notifications for Codex workflows in Visual Studio Code.

Codex Notifier alerts you when a Codex response finishes or when Codex needs you to answer a question. It supports automatic detection from Codex session logs, manually triggered notifications, and configurable sound and UI feedback.

> [!NOTE]
> Automatic detection works with eligible top-level Codex sessions. You can also trigger notifications manually with the `.codex-notify` file.

## Features

- Completion and error notifications, with manual commands for testing.
- Bundled sounds, with separate defaults for completion (`notification2.wav`) and errors (`notification1.wav`).
- Automatic completion detection using Codex session events.
- Input-request detection for `request_user_input` and `request_user_input_async`.
- Suppression of misleading completion notifications while asynchronous questions are awaiting answers in a local session.
- Clickable macOS system notifications that can reopen the originating VS Code window and Codex conversation.
- Windows toast-click support for returning to the matching VS Code window.
- Configurable quiet status-bar messages, banners, system notifications, and sounds.
- Optional document-based idle detection when session-log monitoring is disabled.
- Manual triggers using `.codex-notify` or `codex-done.ps1`.
- Remote SSH support using a companion extension to relay small event records to the local VS Code UI host.

## Commands

| Command | Purpose |
| --- | --- |
| `Codex Notifier: Notify Complete` | Send a manual completion notification. |
| `Codex Notifier: Notify Error` | Send a manual error notification. |
| `Codex Notifier: Test Sound` | Check sound and notification behavior. |
| `Codex Notifier: Toggle Auto Notify` | Enable or disable automatic session monitoring. |
| `Codex Notifier: Show Diagnostics` | Inspect current notifier settings and monitoring state. |
| `Codex Notifier: Enable Toast Window Focus (Windows)` | Repair Windows toast protocol registration, if needed. |

## Installation

### VS Code Marketplace

1. Open the Extensions view in VS Code (`Ctrl+Shift+X` on Windows/Linux, `Cmd+Shift+X` on macOS).
2. Search for **Codex Notifier**.
3. Install `zis3c.codex-notifier`.

[Codex Notifier on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=zis3c.codex-notifier)

Alternatively, install it from the command line:

```bash
code --install-extension zis3c.codex-notifier
```

For an offline or manual VSIX installation, see [INSTALLATION.md](INSTALLATION.md).

> [!IMPORTANT]
> The macOS click-to-chat behavior described below is part of the proposed changes in this branch. It is not necessarily available in the published Marketplace release.

## Quick Start

1. Open VS Code settings and search for `Codex Notifier`.
2. Keep sound and automatic Codex session monitoring enabled.
3. Run `Codex Notifier: Test Sound` from the Command Palette.
4. Ask Codex to complete a task or request a structured choice using Plan mode.
5. Switch to another application before Codex finishes or requests your attention.
6. Click the notification to return to VS Code.

If a workspace has its own `.vscode/settings.json`, check whether its `codexNotifier.*` values override your user settings.

### macOS: Clickable Notifications and Conversation Routing

On macOS, the extension can use [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) to show system notifications with a click action. The click action returns to the relevant VS Code window and, when a valid Codex thread ID is available, opens the conversation associated with the notification.

#### Setup

Install the notification helper with Homebrew:

```bash
brew install terminal-notifier
```

Then allow **terminal-notifier** to send notifications under **System Settings → Notifications**. If the application does not appear or macOS denies permission, run a notification manually and check its exit status:

```bash
terminal-notifier -title "Codex Notifier" -message "Notification test"
echo $?
```

A nonzero exit status indicates that the helper could not deliver the notification; verify its macOS notification permission before testing the extension.

Recommended VS Code settings for macOS:

```json
{
  "codexNotifier.enableSound": true,
  "codexNotifier.enablePopup": true,
  "codexNotifier.toastWhenUnfocused": true,
  "codexNotifier.focusExistingWindowOnToast": true,
  "codexNotifier.monitorCodexLog": true
}
```

#### What happens on click

- **Task completed:** The notification opens the associated Codex conversation when its thread ID is available.
- **Input needed:** A `request_user_input` or `request_user_input_async` notification opens the conversation where Codex is waiting for a response.
- **Unanswered asynchronous questions:** A subsequent `task_complete` event does not produce another notification while the tracked questions remain unanswered. Normal completion notifications resume after the answer or a new ordinary request.
- **Multiple VS Code windows:** VS Code's `asExternalUri()` mechanism is used to route the notification back to the window that issued it.
- **Manual notifications:** Without a valid thread ID, the notification can focus VS Code but cannot choose a particular Codex conversation.

#### Limitations

- `terminal-notifier` is optional for basic notifications but **required for clickable macOS notifications**. If it is missing or fails to send a notification, the extension falls back to AppleScript (`osascript`). Clicking that fallback notification may open Script Editor instead of VS Code.
- Opening a specific chat depends on the Codex extension's currently supported `vscode://openai.chatgpt/local/<threadId>` URI. This is **not a documented public API** and could change in a future Codex version.
- Pending-question suppression is implemented for locally monitored JSONL sessions. Remote SSH behavior has not been verified end-to-end with this feature.
- Pending-question state is in memory. Restarting the session watcher clears that state; a conversation already awaiting an answer may temporarily produce an ordinary completion notification.
- System notification behavior and permissions depend on macOS settings.

### Windows: Toast Window Focus

On Windows, the extension registers a per-user toast protocol and keeps track of window ownership so a notification can return to the matching VS Code window. This is especially useful when several windows share an existing Codex chat.

If Windows toast-click focusing stops working, run `Codex Notifier: Enable Toast Window Focus (Windows)` from the Command Palette to repair its registration.

## How It Works

1. When VS Code activates the extension, it starts the configured session-log monitor and manual file watcher.
2. Automatic mode scans eligible Codex JSONL sessions and processes authoritative events such as `task_complete`, `request_user_input`, and `request_user_input_async`.
3. Session metadata is used to ignore ineligible auxiliary sessions and avoid replaying historical notifications when a conversation is resumed.
4. Async input requests are tracked by session and question call ID. Completion events are suppressed while unanswered asynchronous questions remain pending.
5. The notification system chooses a system notification when the VS Code window is not focused and the relevant settings permit it; otherwise it uses a banner or a quiet status indicator.
6. With the macOS click-to-chat feature enabled, the extension builds a VS Code URI for the corresponding thread and supplies it to `terminal-notifier`.
7. Manual mode watches `codexNotifier.watchFilePath`, which defaults to `.codex-notify` in the current workspace. A changed nonempty value containing `error` triggers an error notification; other nonempty values trigger completion notifications.

### Remote SSH Workspaces

Remote workspaces use a companion event bridge: a small companion running on the remote side reads session information and emits event records; the local VS Code UI extension handles notifications and sound. The notification audio therefore plays on your local computer.

For remote setups, see [INSTALLATION.md](INSTALLATION.md) and configure `codexNotifier.remoteSessionsPath` if the remote sessions directory cannot be inferred from the workspace. Use a relative `codexNotifier.watchFilePath` for workspace-based remote manual triggers; an absolute path refers to the machine running the local UI extension.

Local macOS click-to-chat and pending-async-input behavior should not be assumed to work identically over Remote SSH until tested.

## Recommended Settings

```json
{
  "codexNotifier.enableSound": true,
  "codexNotifier.enablePopup": true,
  "codexNotifier.completionUseBanner": false,
  "codexNotifier.toastWhenUnfocused": true,
  "codexNotifier.focusExistingWindowOnToast": true,
  "codexNotifier.monitorCodexLog": true,
  "codexNotifier.codexLogPollMs": 700
}
```

Use the `Codex Notifier` settings group in VS Code to discover additional sound, duration, manual trigger, and fallback options.

## Testing

Install dependencies and run the repository's automated checks:

```bash
npm ci
npm run ci
```

For more targeted checks:

```bash
node --check extension.js
node --check macos-notification.js
node --check pending-async-input.js
node scripts/test-macos-notification.js
node scripts/test-pending-async-input.js
npm run package:test
```

For a local macOS integration test, launch an Extension Development Host with `F5`, ensure that both Codex and this development build are active, and verify the following:

1. A completion notification reopens the conversation that produced it.
2. An input request opens the conversation containing the unanswered form.
3. A background `task_complete` event does not replace a pending-input notification before the form is answered.
4. After answering, a genuine completion notification is shown again.
5. The notification targets the expected window when more than one VS Code window is open.

Automated tests cover notification URI construction, executable discovery and fallback, session-event parsing, pending-question state, and VSIX packaging. They do not replace a real macOS notification-click test. Remote SSH also requires a separate live test.

## Project Structure

```text
codex-notifier-vscode/
├── extension.js                     # Main extension lifecycle and monitors
├── session-events.js                # Codex JSONL event parsing
├── macos-notification.js            # macOS notifications and click-through URIs
├── pending-async-input.js           # Outstanding async-question tracking
├── toast-focus.js                   # Windows toast focus URL payloads
├── windows-toast-focus.ps1          # Windows native window focusing
├── windows-toast-focus.vbs          # Windows hidden helper launcher
├── notification1.wav                # Default error sound
├── notification2.wav                # Default completion sound
├── codex-done.ps1                   # Manual notification helper
├── package.json                     # Extension manifest and npm scripts
├── scripts/
│   ├── test-macos-notification.js
│   ├── test-pending-async-input.js
│   ├── test-session-events.js
│   ├── test-vsix.js
│   └── validate-release.js
├── remote/                          # Remote SSH companion extension
├── INSTALLATION.md
├── CONTRIBUTING.md
├── SECURITY.md
├── AUTO_DEPLOY.md
└── README.md
```

Some files in this outline are omitted for brevity. Local settings such as `.vscode/settings.json`, session trigger files, build output, and VSIX packages should not be committed unless explicitly required.

## Documentation

- [INSTALLATION.md](INSTALLATION.md) — installation and configuration details.
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributing and development workflow.
- [SECURITY.md](SECURITY.md) — security reporting.
- [AUTO_DEPLOY.md](AUTO_DEPLOY.md) — release automation.
- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=zis3c.codex-notifier) — published extension.

## License

MIT. See [LICENSE](LICENSE).
