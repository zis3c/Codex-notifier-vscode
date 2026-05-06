# Codex Finish Notifier (VS Code Extension)

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visual-studio-code&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-Node.js-F7DF1E?logo=javascript&logoColor=black)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)
![License](https://img.shields.io/badge/License-MIT-green)

A lightweight VS Code extension that notifies you when Codex responses finish using sound and configurable UI alerts (quiet status or banner popup).

> [!NOTE]
> Built for fast feedback loops: you can use auto-detection from Codex logs/chat, or manual file-trigger flow via `.codex-notify`.

## Features

- Completion and error notification commands.
- Bundled sound defaults (no custom setup required):
  - Complete -> `notification2.wav`
  - Error -> `notification1.wav`
- Auto completion detection from Codex stream logs.
- Optional document-based idle detection fallback.
- Quiet mode or banner mode for completion notifications.
- Manual trigger support through `.codex-notify` and `codex-done.ps1`.

## Commands

| Command | Description |
|:--|:--|
| `Codex Notifier: Notify Complete` | Trigger completion notification manually |
| `Codex Notifier: Notify Error` | Trigger error notification manually |
| `Codex Notifier: Test Sound` | Test completion sound + UI behavior |
| `Codex Notifier: Toggle Auto Notify` | Enable/disable log-based auto detection |
| `Codex Notifier: Show Diagnostics` | Show runtime diagnostics snapshot |
| `Codex Notifier: Debug Snapshot` | Print active docs/editors to output channel |

## Quick Start

1. Install from VSIX (see [INSTALLATION.md](./INSTALLATION.md)).
2. Open VS Code settings and search `Codex Notifier`.
3. Run `Codex Notifier: Test Sound`.

## Recommended Settings

```json
{
  "codexNotifier.enableSound": true,
  "codexNotifier.enablePopup": true,
  "codexNotifier.completionUseBanner": false,
  "codexNotifier.monitorCodexLog": true,
  "codexNotifier.codexLogPollMs": 500,
  "codexNotifier.codexLogIdleMs": 900,
  "codexNotifier.codexChatCooldownMs": 4500
}
```

## Documentation

- [INSTALLATION.md](./INSTALLATION.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [AUTO_DEPLOY.md](./AUTO_DEPLOY.md)

## Project Structure

```text
codex-finish-notifier-vscode/
|- extension.js
|- package.json
|- notification1.wav
|- notification2.wav
|- codex-done.ps1
|- .vscodeignore
|- LICENSE
`- README.md
```

## License

MIT. See [LICENSE](./LICENSE).
