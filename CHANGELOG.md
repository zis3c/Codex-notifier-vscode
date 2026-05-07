# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-05-07

- Promoted release version from `0.0.1` to `0.1.0` for VSIX distribution maturity.
- Replaced placeholder extension publisher value with a non-placeholder local distribution identifier.
- Added `SECURITY.md` and documented private vulnerability reporting expectations.
- Added a lightweight release validator script (`scripts/validate-release.js`).
- Added `npm` checks:
  - `npm run check`
  - `npm run release:check`
  - `npm run lint` (mapped to `check`)
