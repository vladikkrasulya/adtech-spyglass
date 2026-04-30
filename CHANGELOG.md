# Changelog

All notable changes to Spyglass are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning is
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Phase 4 — Validator extracted as `@kyivtech/spyglass-core`

The validator engine moves from a sub-directory to a separately-publishable npm package, while the parent app still consumes it through a workspace symlink. This is the structural prerequisite for the public Spyglass demo (browser-side validation) and CI/CLI use cases. Publishing to npm is a separate one-step decision when ready.

- Repo becomes an npm workspace: `validator/` → `packages/core/` with its own `package.json`, `LICENSE` (MIT), and `README.md`.
- Package metadata: `@kyivtech/spyglass-core` v0.1.0, MIT, `engines.node >=18`, `sideEffects: false`, full `files` allow-list (no source leakage).
- Server.js and tests now consume the engine via `require('@kyivtech/spyglass-core')` — same module, resolved through `node_modules/@kyivtech/spyglass-core` symlink to `packages/core/`.
- README in the package documents the public API, dialect contract, version coverage, i18n approach, and design principles — ready for npm landing page.
- Dockerfile updated to copy workspace manifests before `npm install` so the symlink resolves correctly inside the container.
- UI is unaffected: same `/api/analyze` contract, same JSON shape, same bind-mounted hot-reload workflow.
- All 83 tests pass; full CI green; container rebuilt and live-verified at `https://spyglass.kyivtech.com.ua`.

### Phase 7 (partial) — Multi-user accounts

The validator/crosscheck/preview path stays **fully public** (no login needed). Only the saved-samples library and partner taxonomy are gated behind a per-user account. Aligns with the deploy decision: spyglass.kyivtech.com.ua is a public tool with optional accounts for persistent state.

#### Storage

- `db.js` schema bumped to `user_version = 2`. Adds `users(id, email, password_hash, created_at)`. Both `partners` and `samples` get a non-null `user_id` FK with `ON DELETE CASCADE`. Slug uniqueness moves from global to `UNIQUE(user_id, slug)` so two users can each have a partner named "Adsterra".
- Existing v0 data dropped (was test-only — confirmed empty in production).
- Sample creation verifies `partner_id` belongs to the same user — prevents cross-user assignment via crafted POST.

#### Auth (`auth.js`)

- bcrypt password hashing (12 rounds), email/password registration.
- Sessions stored in-process: random 32-byte hex token in `spy_session` cookie (HttpOnly, SameSite=Lax, Secure when behind HTTPS, 30-day Max-Age).
- Constant-time login: bcrypt compare always runs even on missing email, so timing doesn't leak whether an email exists.
- Per-IP rate limits: register 5/hour, login 10/15min.
- Hourly sweeper purges expired sessions.
- Graceful shutdown clears the session map.

#### API

Public (no auth):

- `POST /api/auth/register` `{ email, password }` → creates user + sets session cookie.
- `POST /api/auth/login` `{ email, password }` → sets session cookie.
- `POST /api/auth/logout` → clears session.
- `GET  /api/auth/me` → `{ user: { id, email, created_at } | null }`.

Required to be logged in (returns 401 with uniform error envelope when anonymous):

- `/api/partners[/:id]` — all CRUD ops, scoped per user.
- `/api/samples[/:id]` — all CRUD ops, scoped per user.

`/api/health` now also surfaces `sessions` (active count) and `users` (total registered).

#### UI

- Auth widget in header: "sign in" button when anonymous; user email + "sign out" when logged in.
- Login/register modal with mode-toggle link, password length hint, and Enter-to-submit.
- `Save` button auth-gates: anonymous click prompts the sign-in modal instead of erroring on the API.
- Library panel renders an "Sign in to save" CTA for anonymous users; the partner filter / partner manager only appears when logged in.
- Localized auth errors (`invalid_email`, `weak_password`, `email_taken`, `invalid_credentials`, `rate_limited` → human Ukrainian copy).
- 401 responses on `/api/partners` or `/api/samples` (e.g. session expired during use) trigger silent fallback to anonymous state — no error toast spam.

#### Tests

- `tests/db.test.js` rewritten — 17 tests covering Users CRUD, slug-per-user uniqueness, ON DELETE CASCADE for users → partners + samples, scope enforcement (userB cannot read/update/delete userA's data), partner-of-other-user rejection on sample creation.
- `tests/auth.test.js` new — 11 tests covering register validation, login (correct + wrong + non-existent email with constant-time response), session round-trip, logout invalidation, register/login rate limits.
- All 83 tests pass.

### Phase 2 — IAB-spec authoritative validator (initial)

- `validator/detect.js` extended with `detectVersion(payload)` returning `{ version, confidence, signals }`.
  - Buckets: `'2.5' | '2.6' | '3.0' | 'unknown'` — minor revisions (`2.6-202309`, `2.6-202505`, etc.) deferred.
  - Detection by **field-presence signals** since pasted JSON has no `X-Openrtb-Version` header. 2.6 markers checked first (e.g. `imp[].rwdd`, `device.sua`, `regs.gpp`, `*.cattax`, pod fields), then 2.5 markers (`source`, `bseat`, `imp[].metric`, etc.). 3.0 uses the distinct `item[]` / `openrtb.ver` envelope.
  - Confidence: `1` for definitive markers, `0.7` for 2.5-only signals, `0.3` for default-when-no-markers, `0` for non-objects.
- `validate()` result now carries `result.version` so callers can show the detected version without a second function call.
- Public API: `detectVersion`, `VERSIONS` re-exported from `validator/index.js`.
- UI: validation tab header shows the detected version pill (e.g. "oRTB BidRequest · errors · oRTB 2.6"). Hover reveals the matched signal list. `~`/`?` suffixes mark medium/low confidence.

#### VAST 4.x acceptance

- New `imp.video.protocols_unknown` warning for `video.protocols` codes outside the IAB List 5.8 range (1-14 + `>=500` exchange-specific).
- Codes 10/11/12/13/14 (VAST 4.0 Wrapper, VAST 4.1, VAST 4.1 Wrapper, VAST 4.2, VAST 4.2 Wrapper) accepted without warning — previously the rule had no idea what valid codes were.

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
