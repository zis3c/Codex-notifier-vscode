# Auto Deploy / Release Flow

This project currently uses **manual release packaging**.

## Current Flow

1. Update code and version in `package.json`.
2. Run the local checks:

```bash
npm run ci
```

3. Build VSIX:

```bash
npm exec --yes @vscode/vsce package -- --out codex-notifier-private.vsix
```

4. Commit and push source to GitHub.
5. Share `.vsix` via:
   - GitHub Release asset (recommended)
   - or repository file (optional)

## Recommended GitHub Release Flow

1. Create tag (example `v0.0.2`).
2. Open GitHub `Releases` -> `Draft a new release`.
3. Upload `codex-notifier-private.vsix`.
4. Publish release notes.

## Optional Future Automation

You can automate with GitHub Actions:

1. Trigger on version tag push.
2. Install Node + `@vscode/vsce`.
3. Build VSIX.
4. Upload VSIX to release automatically.

## Notes

- Keep `.vsix` reproducible from source.
- Ensure bundled sounds are present before packaging:
  - `notification1.wav`
  - `notification2.wav`
- Rebuild the VSIX after any code, manifest, or packaging change that you want
  reflected in the installable file.
- If you only change docs, a VSIX rebuild is not required.
