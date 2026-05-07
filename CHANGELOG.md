# Changelog

All notable changes to Spyglass are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning is
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### v9.8.2 — Pre-freeze hardening (Phase 9b/audit follow-up)

**Final sprint before development freeze.** Closes the two P0 risks
flagged by the 360° pre-freeze audit. Production stays live; only new
feature work pauses.

- **P0.1 — `/api/auth/reset-password` rate-limit**. The mode='rotate'
  branch calls `bcrypt.compare(oldPassword, ...)`; without a per-IP
  cap, a held reset token (15-min TTL) was a brute-force gateway for
  the user's old password. New `resetPasswordLimiter` (5 / 15 min /
  IP) matches the `/forgot-password` tier. Login (10/15min/IP +
  8/15min/email), register (5/hour/IP), and forgot-password
  (5/15min/IP) limiters were already in place — audit had missed
  them; this sprint closes the actual gap.
- **P0.2 — Behavior events ring buffer**. `__spyglassBehavior.events`
  was an unbounded array; a misbehaving creative pumping events at
  100s/sec could grow parent-tab memory linearly until OOM. New
  `pushBehaviorEvent(evt)` helper enforces a 500-event rolling
  window via `splice(0, length - MAX)`. Engine still truncates on
  wire-send; this is purely about parent-tab memory hygiene during
  long monitoring runs.

### Phase 10b — UI Format Badge + LLM Few-Shot Wiring (v9.8.0)

- `/api/analyze` now returns `meta.format = { formats, contexts,
protocols, tags, confidence }` computed as the union of
  `detectFormat(bidReq)` ∪ `detectFormat(bidRes)`.
- Three colour-coded chip families render in the left summary
  sidebar: blue (format), green (context), amber (protocol). Hidden
  while `confidence === 0`.
- Frontend builder pulls the detected format off
  `window.__spyglassLast.meta` and threads it through
  `SpyglassIntel.suggestName(bucket, fields, format)`. The cache
  key now includes format so the same field set under different
  hints resolves to different suggestions.
- Server `/api/intel/suggest-name` calls
  `kb.fewShotForFormat(format, { limit: 2 })` and threads the
  anonymised field-name lists into `intelLlm.suggestName(...,
{ fewShot })`. Prompt builder gained a "Reference examples from
  canonical RTB streams" block when fewShot is non-empty.
- Graceful fallback: unknown / missing format → empty fewShot →
  prompt collapses to original Phase 7c zero-shot form.

### Phase 10 — Knowledge Base + Format Detector (v9.7.0)

- New axis `detectFormat()` alongside `detectType()` /
  `detectVersion()`. Pure-data heuristics, runs in browser AND Node.
  Tags banner / video / audio / native / push / pops / inpage,
  context (web / inapp / ctv / dooh), and protocol family (vast-2/3/4
  / daast). Uses `imp.video.protocols`, `seatbid.bid.mtype`, and
  string-substring VAST sniffing on `bid.adm`.
- `packages/core/knowledge_base/` — curated fixtures organized by
  spec × side × format. Ships 11 hand-synthesized seeds covering
  banner/video/audio/native/inapp/dooh/ctv-rewarded/banner-response
  - push/pops/inpage. `manifest.json` indexes provenance.
    `SOURCES.md` documents the license-clean ingestion playbook for
    Phase 10c automation (Prebid.js, IAB markdown, vendor docs).
- `knowledge-base.js` (Node-only loader) exposes `listSamples`,
  `loadSample`, `fewShotForFormat` with anonymised field-name
  extraction. Path-traversal guard on file reads.
- KB round-trip test: every shipped sample is detected as its
  declared format, or the build breaks. 20 new tests; total 302/302.

### Phase 9 — Generic public branding + responsive ad preview (v9.6.x)

- "Standard IAB (oRTB 2.5)" replaces vendor-namespaced default in
  the dialect dropdown across 3 templates.
- "+ partner" → "+ Custom Dialect" wired to the Phase 7b Dialect
  Builder modal (`data-action="open-builder"`). Partner management
  now reachable only via console (`openPartnerModal()`).
- Ad preview shifted from JS `transform: scale` math to CSS
  `aspect-ratio` + `max-width: 100%` driven by `--bid-w` /
  `--bid-h` custom properties. VAST defaults to 640×360, native
  to 320×260. Empty state collapses to a thin `.preview-empty` strip.

### Phase 9b — Sidebar cleanup, auth trigger, URL sanitization (v9.8.1)

- Sidebar login block removed: the saved-list no longer renders an
  anon-CTA + sign-in button. Header sign-in button is the single
  global auth entry point. Frees ~80px of vertical sidebar real
  estate.
- Summary chrome (winning-bid card + os/geo/device/connection rows
  - section title) collapsed by default; revealed by
    `refreshEmptyStateChrome()` on first paint when the editors carry
    data. `mInfo` gained `hidden` in all three templates.
- Save → Auth toast: when an anonymous user clicks "save", a
  `'toast.signin_to_save'` notification fires before the auth modal
  opens, in 3 locales. Toast is non-blocking.
- URL sanitization for temp dialects: `?dialect=temp:<uuid>` is no
  longer written to the URL. Both `iab` (default) AND any
  `temp:*` value strip the param entirely. Named dialects
  (`kadam`, `kadam-inpage-push`) still serialise. localStorage
  tracks the author's active temp dialect locally.

### Phase 8 — UX/UI overhaul (v9.5.x)

- Visual hierarchy: typography step-down for admin-density
  surfaces; `section-title--sub` modifier for nested sections;
  collapsible cards for bidReq / bidRes editors with summary bars
  showing the bid id when collapsed.
- Safe demo mode: `?demo=safe` blurs creatives via CSS filter and
  masks domain text in the summary, so screenshots and shareable
  links don't leak real-publisher branding from test payloads.
- Clickable JSONPath: validation findings link to the exact AST
  position; clicking scrolls and highlights the corresponding
  textarea selection range.
- Email verification banner + reset-password flow (with
  zero-knowledge wrap rotation in mode='rotate' / mode='recover').

### Phase 7c — Local LLM integration (v9.4.0)

- Self-hosted Ollama bridge (`intel-llm.js`) for two narrow tasks:
  cluster naming + per-field purpose detection. Default model
  `gemma3:4b` (~7 GB on disk, 16 GB RAM headroom on i7-7700-class
  hardware). Acoustic budget validated under stress: ~3 min/day at
  realistic usage tier.
- Hard timeout: 30s `AbortController` keeps a hung Ollama from
  piling up requests. `format: 'json'` constrains gemma3 output to
  parseable JSON.
- Cache: `intel_llm_cache` IndexedDB store keyed by
  `cacheKey(['suggest-name', bucket, format, ...sortedFields])`
  with 30-day TTL — same field set never burns a second LLM call.
- Server endpoints `/api/intel/suggest-name` and
  `/api/intel/field-purpose` rate-limited at 30/min/IP. 503 on
  Ollama-unavailable; frontend latches `_llmUnavailable` and hides
  AI affordances quietly. **No values from the bid stream ever
  enter the prompt — only field paths, char-class hints, and
  bucket names.**
- Docker network: Spyglass attaches to the external `ollama_default`
  network. Configured via `OLLAMA_URL` / `OLLAMA_MODEL` env. See
  [LLM_SETUP.md](./LLM_SETUP.md).

### Phase 7b — Co-occurrence clustering + Dialect Builder (v9.3.0)

- Anchored clustering with `MIN_FIELD_SCORE=5`,
  `MIN_COOCCURRENCE=3`, `MAX_CLUSTER_SIZE=8`. Replaces the naive
  "everything-with-everything" connected-components approach so
  surfaced clusters are real signals, not coincidence.
- Dialect Builder modal: review suggested cluster, pick fields by
  checkbox, name and save. Phase 7c adds a 🤖 Suggest button that
  fills the name from the local LLM (graceful 503 hide).
- Temporary dialect runtime: `applyTempDialect(req, res, dialect)`
  walks logical paths through arrays, emits findings in the engine
  shape, pushes them onto `validation.findings`, and re-rolls
  `validation.status` if any new ERROR appeared.
- IndexedDB schema bump v2 → v3 (additive): adds `co_occurrence`,
  `temporary_dialects`, `intel_llm_cache` stores. Existing v1/v2
  data preserved.

### Phase 7a — Discovery foundation (v9.2.0)

- Browser-local IndexedDB observer (`spyglass_intel_v1`) watching
  `*.ext.*` subtrees on every analyze. Walker capped at depth 4
  with a `PII_TOKENS` denylist (`buyeruid`, `ifa`, `idfa`, `ip`,
  `ipv6`, `consent`, `gpp`, `gpp_sid`, `geo.lat`, `geo.lon`,
  `user.id`, …) plus a regex denylist (`/.*consent.*/i`).
- `field_observations` store keyed by `{bucket}::{path}`. Tracks
  count + first/last seen + decayed score (24h half-life:
  `score(t) = score(t0) * 0.5^((t-t0)/halfLife)`).
- Discovery banner surfaces the first time a previously-unseen
  cluster reaches the threshold; user opts in to the full
  Discovery flow from there.
- Privacy posture documented: **no values from the bid stream are
  persisted, only paths and char-class shapes**.

### Phase 6 — Static payload analysis (creative content)

- `behavior/rules/static.js`: regex pattern banks for obfuscation
  (eval-base64, hex-string concatenation), miner signatures
  (CoinHive, CryptoLoot, Coinimp), XSS markers (`document.write`
  with concatenation, on-handler in attribute), Shannon entropy
  outliers in the adm body. Adm sent to
  `/api/analyze-behavior` is capped at 64 KB on the wire (engine
  truncates internally to 100 KB).

### Phase 5 — Permission abuse detection

- 6 new probe hooks: `Notification.requestPermission`, `navigator.
geolocation.getCurrentPosition` / `watchPosition`,
  `navigator.mediaDevices.getUserMedia`, `Clipboard.writeText`,
  `navigator.bluetooth.requestDevice`, generic
  `Permissions.query`. Engine flags any permission request inside
  an ad iframe as a `behavior.permission.<api>` finding.

### Phase C / synthetic native rendering / button flash

- `renderNativeToHtml(native)` synthesises a stand-alone HTML card
  (sandboxed iframe, all CSS inline) from a `bid.native` object so
  Behavior probes can observe the click as a navigation event —
  previously native preview was DOM-injected into the parent and
  bypassed instrumentation entirely.
- Button feedback: clear / format / copy actions flash a
  text-swap (`'cleared'` / `'formatted'` / `'copied'`) for 1.5s
  to confirm the action without a toast. Defensive against
  re-entry: `_flashTimers` map per-button.

The library moves from "operator can read everything in SQLite" to a **zero-knowledge** model: I (server operator) hold only opaque ciphertext and a per-user wrapped key. Without the user's password I cannot decrypt their `bid_req` / `bid_res` payloads even with full DB access.

#### Architecture

KEK/DEK pattern (industry-standard — same as 1Password, Bitwarden):

- A random 256-bit **DEK** (Data Encryption Key) is generated per user at register time, **in the browser**.
- A **KEK** (Key Encryption Key) is derived from the user's password via PBKDF2-SHA-256 with 600,000 iterations and a per-user 16-byte salt — also in the browser.
- The DEK is wrapped with the KEK using AES-GCM-256 (12-byte IV) and the wrapped blob + salt + IV are persisted to the server.
- A **second wrap** of the same DEK is made with a KEK derived from a recovery key (32 hex chars). The recovery key is shown to the user once at register and never sent to the server again — it's the only way to regain access if the password is lost.
- `bid_req` and `bid_res` blobs are AES-GCM-256 encrypted in the browser with the DEK before each `POST /api/samples`. Per-blob random IVs.
- `title`, `partner_id`, `notes`, `status`, `created_at` stay plaintext — needed for sorting / filtering, low sensitivity.

#### Schema (PRAGMA user_version: 2 → 3)

`users`:

- `kdf_salt` — base64(16 random bytes), per-user, used to derive KEK from password
- `dek_wrapped` — base64 ciphertext: AES-GCM(KEK, DEK)
- `dek_iv` — base64(12-byte IV) for the wrap above
- `recovery_salt` — second salt for the recovery-key KEK
- `recovery_dek_wrapped` — DEK wrapped with recovery-key KEK
- `recovery_dek_iv` — IV for the recovery wrap

`samples`:

- `req_iv`, `res_iv` — per-blob 12-byte IVs (base64). The existing `bid_req`/`bid_res` columns now store AES-GCM ciphertext (base64) instead of plaintext JSON.

Migration v2→v3 wipes existing samples (they were plaintext relics, all empty in production). Existing user accounts are kept — they bootstrap encryption on next login (the password is in hand at that moment to derive the KEK).

#### New module: `public/spyglass-crypto.js`

Pure browser-side wrapper around Web Crypto API. Zero dependencies. Exposes `SpyglassCrypto.bootstrap(password)`, `openWithPassword(password, state)`, `openWithRecoveryKey(hex, state)`, `encryptBlob(dek, plaintext)`, `decryptBlob(dek, iv, ct)`. All operations happen in the browser; the module never sends anything anywhere.

#### Server changes

- `db.js`: schema migration v3, new `Users.getCryptoState(id)` and `Users.setCryptoState(id, state)`. `Samples` create/get/update accept and return `req_iv` / `res_iv` alongside the now-ciphertext `bid_req` / `bid_res`. Server has zero crypto code beyond passing the opaque blobs through.
- `server.js`: new `POST /api/auth/setup-encryption` (auth-required) accepts the 6-field crypto state and persists it. `/api/auth/me` and the login response now include the user's crypto state so the client can derive KEK + unwrap DEK without a second round-trip.

#### UI flow

- **Register** → bootstrap encryption automatically → show recovery-key modal once with copy-to-clipboard.
- **Login** → if encryption state exists, derive KEK + unwrap DEK locally; if not yet set up (existing pre-Phase-7 user), bootstrap immediately (we have the password in hand).
- **Page reload while logged in** → cookie persists session, but in-memory DEK is gone. The library shows a "Розблокуй бібліотеку" CTA → re-enter password modal → unwrap DEK → continue. We deliberately don't store the DEK anywhere persistent — that would defeat the threat model.
- **Save sample** → encrypt `bid_req` + `bid_res` locally with DEK → POST opaque ciphertext + IVs.
- **Load sample** → GET ciphertext + IVs → decrypt locally with DEK → fill textarea.
- **Sign out** → wipe DEK from memory.

#### Tests

- `tests/crypto.test.js` (new, 13 tests) — base64/hex round-trips, KDF determinism, bootstrap → openWithPassword round-trip, recovery-key path, AES-GCM auth (tampered ciphertext rejected), random IV per encrypt, full simulated two-session flow.
- `tests/db.test.js` — still 17 tests, unchanged (Phase 7 partial scoping rules still apply).
- All 96 tests pass.

#### Tradeoffs surfaced to the user

- Forgot password **and** lost recovery key = lost data. Documented in the recovery-key modal copy. There is no operator-side reset that preserves data — by design.
- Title / partner / notes remain server-readable (so the library can render filters and meta lines without unlock). To fully encrypt those too we'd lose server-side filtering; flagged as a possible v0.2 toggle.
- After page reload, the user has to re-enter the password to unlock the library. Cookie session alone isn't enough. Same UX as Bitwarden/1Password.

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
