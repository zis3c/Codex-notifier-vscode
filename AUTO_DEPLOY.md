# Auto Deploy

This project currently uses manual packaging and release flow.

## Current Release Flow

1. Update code/version.
2. Build VSIX:
   - `npm exec --yes @vscode/vsce package -- --out codex-notifier-private.vsix`
3. Commit and push source.
4. Upload VSIX to GitHub Release (recommended) or repository (if preferred).

## Optional Future Automation (GitHub Actions)

You can automate by:

1. Trigger on tag push (e.g. `v0.0.2`).
2. Install Node + `@vscode/vsce`.
3. Build `.vsix`.
4. Publish artifact to GitHub Release.

## Notes

- Keep `.vsix` reproducible from source.
- Ensure bundled sounds are included before packaging.
