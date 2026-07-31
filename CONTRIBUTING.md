# Contributing to Codex Finish Notifier

Thanks for contributing. Bug fixes, docs improvements, and UX refinements are welcome.

## How to Contribute

### 1. Report Bugs

- Check existing issues first.
- If new, include:
  - clear title
  - reproduction steps
  - expected vs actual behavior

### 2. Suggest Features

- Describe use case and expected behavior.
- Keep changes backward compatible where possible.

### 3. Submit Pull Requests

1. Fork/clone the repository.
2. Create a branch:
   - `git checkout -b feature/my-change`
3. Implement changes.
4. Test extension in Development Host (`F5`).
5. Commit with clear message.
6. Open PR.

## Coding Guidelines

- Keep logic simple and explicit.
- Avoid machine-specific paths in committed config.
- Preserve bundled sound fallback behavior.
- Prefer readable fixes over clever complexity.

## Validation Checklist

- `node --check extension.js` passes.
- `npm run ci` passes.
- `npm run package:test` passes.
- `package.json` stays valid JSON.
- `Codex Notifier: Test Sound` works in a local VS Code window.
- Completion notify fires once per real response burst, not on open or close chatter.
- Quiet/banner toggle behaves correctly.
- Auto-detect stays quiet on chat open and chat quit.
- Remote SSH live behavior is still manual test only.
- Full UI E2E for the VS Code window is not automated yet.

## Packaging Notes

Build install artifact with:

```bash
npm exec --yes @vscode/vsce package -- --out codex-notifier-private.vsix
```

For release checks, use:

```bash
npm run ci
```

## License

By contributing, you agree your contributions are licensed under MIT.
