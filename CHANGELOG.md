# Changelog

All notable changes to Spyglass are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning is
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### CI / repo hygiene

- GitHub Actions workflow (`.github/workflows/ci.yml`) running `npm run ci` (format:check → lint → typecheck → tests) on every push to `main` and every PR. Concurrency-cancelled per ref so old runs don't keep eating minutes.
- Dependabot config (`.github/dependabot.yml`) with weekly grouped PRs: dev-tools cluster (eslint/prettier/typescript/@types) and runtime cluster (better-sqlite3) updated separately to keep diffs reviewable. GitHub Actions versions bumped on the same cadence.
- CI status badge in README.

### Phase 1 — Foundation refactor

#### Validator core split into modules

- New `validator/` directory replaces the single-file monolith. Pure JS, browser-runnable.
  - `validator/index.js` — public API: `validate()`, `crosscheck()`, `detectType()`, `listDialects()`, `listLocales()`.
  - `validator/helpers.js` — predicates, ISO regexes.
  - `validator/findings.js` — `makeFinding()` factory + level constants (`error`/`warning`/`info`).
  - `validator/detect.js` — payload type detection (Phase 2 will add version detection).
  - `validator/rules-request.js` — IAB BidRequest rules.
  - `validator/rules-response.js` — IAB BidResponse rules.
  - `validator/rules-feed.js` — Kadam feed format (push + clickunder).
  - `validator/crosscheck.js` — semantic req↔res crosscheck + native asset compare.
  - `validator/dialects/iab.js` — base dialect (currently empty hooks).
  - `validator/dialects/kadam.js` — Kadam-specific extras (`ext.bsection`, `subage`, macros, push detection).
  - `validator/spec-refs.json` — finding-id → IAB markdown anchor map.
  - `validator/messages/{uk,en}.json` + `index.js` — locale resolver with `{var}` interpolation.

#### Findings model

- Findings now carry **stable `id`** (e.g. `'imp.banner.size_required'`), structured `params` for interpolation, `level` (`error`/`warning`/`info`), `path`, `specRef` (deep link to IAB spec), and `msg` (localized at presentation time).
- Top-level `status` values are now `'clean' | 'warnings' | 'errors' | 'invalid'` (was `'Healthy' | 'Critical' | 'Invalid'`).
- API response payload uses `validation.findings[]` (was `validation.errors[]`).

#### Dialect split — IAB default, Kadam opt-in

- Default dialect is now `iab` — payloads validate strictly against the OpenRTB spec without Kadam-specific rules.
- `?dialect=kadam` query param activates the Kadam overlay (push detection, `subage`, `ext.bsection`/`btags`, macro support check).
- Future dialects (PropellerAds, Adsterra, MGID …) add via the same overlay pattern.

#### API surface

- `/api/analyze?locale=uk&dialect=iab` accepts both as optional query params.
- Response gained `meta: { locale, dialect }`.

### Resilience sub-tasks (paired with Phase 1)

- **`GET /api/health`** — pings the SQLite DB (`SELECT 1`) and returns `{ status, checks, uptime, pid, node }`. Returns 503 if DB is unreachable.
- **Uniform API error shape** — every 4xx/5xx /api/\* response now follows `{ success: false, error: 'human msg', code: 'machine_id', detail?: any }`.
- **Process safety net** — `uncaughtException` and `unhandledRejection` handlers log and continue rather than letting Node kill the worker.
- **Graceful shutdown** — `SIGINT`/`SIGTERM` close the HTTP server cleanly with a 5s hard-exit fallback.
- **UI error boundary** — global `error` and `unhandledrejection` listeners surface a toast instead of letting one bug freeze the whole page.
- **Spec deep-links in UI** — every validation finding now shows a `spec ↗` link to the relevant IAB markdown section.

### Earlier groundwork (still in Unreleased)

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

- Extracted validator core into `validator.js` (formerly inline in `server.js`). Pure JS, no Node-only APIs — runs in browser too. `server.js` is now a thin HTTP wrapper. (Phase-1 superseded this with `validator/` directory split.)
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
