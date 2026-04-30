# Changelog

All notable changes to Spyglass are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning is
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Architecture document (`ARCHITECTURE.md`) describing target shape: validator core, dialect overlays, public-vs-auth'd surfaces, i18n strategy.
- Roadmap (`ROADMAP.md`) with phased plan from current monolith to OSS-able core + hosted product.
- README with run instructions and layout overview.
- `.env.example` documenting expected runtime variables (placeholder until Phase 7 introduces auth).
- `scripts/backup-db.sh` — daily SQLite online-backup with 30-day rotation. Installed via `/etc/cron.d/spyglass-backup` (03:30 daily).
- Test infrastructure using Node's built-in `node:test` (zero deps).
  - `tests/validator.test.js` — 36 tests covering `detectType`, `validateORTB`, `crosscheck`, `nativeAssetCrosscheck`. Path-based assertions stable across future i18n key refactor.
  - `tests/db.test.js` — 13 tests covering Partners/Samples CRUD, slug uniqueness, ON DELETE SET NULL behavior. Uses tempfs DB.
  - `tests/fixtures.js` — reusable oRTB payload factories.
- ESLint flat config (`eslint.config.js`) tuned for correctness over style; Prettier handles formatting.
- Prettier config (`.prettierrc.json`, `.prettierignore`).
- TypeScript via JSDoc + `checkJs` (`tsconfig.json`) — no source migration, just `tsc --noEmit` catches type bugs in vanilla JS.
- `.editorconfig` for cross-editor consistency.
- npm scripts: `test`, `test:watch`, `test:coverage`, `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `ci`.
- `engines.node: ">=20"` in `package.json`.

### Changed

- Extracted validator core into `validator.js` (formerly inline in `server.js`). Pure JS, no Node-only APIs — runs in browser too. `server.js` is now a thin HTTP wrapper.
- `detectType()` now uses structural array markers (`Array.isArray(obj.imp)`) rather than `id`-presence checks, so payloads missing their `id` still dispatch to the right validator and produce actionable findings instead of "unrecognized payload". Adds heuristics for malformed payloads (site/app present → request; id+cur present → response).
- `server.js`: `PORT` is now `process.env.PORT || 3000` to support test fixtures.

### Fixed

- `detectType` for plain Kadam Feed push arrays — array shape was previously short-circuited as "unknown" before reaching the array check.
- `detectType` no longer requires `obj.id` to recognize a BidRequest/BidResponse, so the validator's "missing id" finding can actually fire.

## [Pre-0.x] — 2026-04-30 baseline

Initial git import of the v8 monolith. Single-container application:

- Express HTTP server, REST API
- SQLite-backed partner + sample library (`better-sqlite3`)
- Vanilla-JS UI on the kyivtech-portal design system
- Kadam-aware validator (Ukrainian copy, baked-in dialect rules)
- Bind-mounted design-system.css from kyivtech-portal for shared tokens
- Reachable behind kyivtech-portal admin auth at `/spyglass-proxy/`
