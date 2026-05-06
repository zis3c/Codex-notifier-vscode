# Contributing

Thanks for contributing to Codex Finish Notifier.

## Local Workflow

1. Create a branch from `main`.
2. Make focused changes.
3. Test in Extension Development Host (`F5`).
4. Run:
   - `node --check extension.js`
5. Commit with clear message.
6. Open PR.

## Code Style

- Keep logic simple and explicit.
- Prefer minimal, readable fixes.
- Avoid machine-specific hardcoded paths.
- Keep bundled fallback behavior working for all users.

## Testing Checklist

- `Codex Notifier: Test Sound` works.
- Completion notify fires once per response burst.
- No repeated spam notifications.
- Banner/quiet mode toggle works (`codexNotifier.completionUseBanner`).

## Packaging

- Build VSIX with:
  - `npm exec --yes @vscode/vsce package -- --out codex-notifier-private.vsix`
