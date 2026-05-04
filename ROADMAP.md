# Spyglass — Roadmap

Phased plan for evolving the current single-container app into the architecture described in [ARCHITECTURE.md](./ARCHITECTURE.md). Sized in solo-dev weeks; expand or contract based on availability.

The phases are **sequential where they share substrate** (you can't do the public/private split before the validator core is extracted) and **parallelizable where they don't** (i18n and theme can land any time after Phase 1).

**Status legend** (added 2026-05-04 to track real progress against the original phase plan):
- ✅ DONE — shipped in production
- 🟢 MOSTLY DONE — main scope shipped; minor follow-ups remain
- 🔄 IN PROGRESS — actively being worked on
- ⏸️ DEFERRED — explicitly postponed; see decision log
- ❌ REJECTED — decided not to do; see decision log
- ⏹️ NOT STARTED — on the list but no work yet

---

## Phase 0 — Done (this session) ✅ DONE

- ✅ Competitive landscape research
- ✅ OpenRTB 2.6 version-history research with detection signals
- ✅ Architecture document
- ✅ Roadmap (this file)
- ✅ Memory notes capturing direction

---

## Phase 1 — Foundation refactor (1–2 weeks) ✅ DONE

The single goal: turn the current monolithic `server.js` into a layered codebase the rest of the roadmap can build on.

- **Extract `validator/` directory** inside the spyglass repo. Move `validateRequest`, `validateResponse`, `validateFeedResponse`, `validateORTB`, `crosscheck`, `nativeAssetCrosscheck` out of `server.js` into modules. Pure JS, no Node-only APIs.
- **Strip Kadam-isms from default path.** Move `ext.bsection`, `ext.btags`, `ext.subage`, `site.ext.idzone` rules into `dialects/kadam.js`. Default dialect becomes `iab`.
- **Findings refactor.** Replace inline strings with `{ id, params, level, path, messageKey }`. Build a localization map `messages.uk.json` keyed by id; wire server response to resolve keys → localized strings using request locale (UI passes `?locale=uk` for now).
- **Spec-ref table.** Add `specRefs.js` mapping finding IDs → IAB markdown anchors. Every finding emits `specRef`.
- **Smoke tests** (Node `assert`, no framework yet): paste 5 known-good and 5 known-broken oRTB samples in `/tests/fixtures/`, validate against expected findings.

**Exit criterion:** the validator returns localized findings via id-keys; server.js is < 200 lines; the validator can be `require`'d from another script and used standalone.

---

## Phase 2 — IAB-spec authoritative validator (2 weeks) 🟢 MOSTLY DONE

> Update 2026-05-04: `detectVersion()` shipped with confidence scoring + signals; native 1.1↔1.2 detection works; VAST 4.x in `video.protocols` accepted; canonical fixtures in `tests/fixtures.js`. **Remaining**: full version-aware rule gating (some rules still spec-version-agnostic) and `strictness` levels (lax/normal/pedantic) — not yet wired through the API.

Make Spyglass actually credible against the official spec.

- **`detectVersion()` module** with the tiered signals from [ARCHITECTURE §3.3](./ARCHITECTURE.md#33-version-detection). Returns `{ version, confidence, signals[] }`.
- **Version-aware rules.** Each rule declares which version it applies to. `imp.rwdd` doesn't fire on a 2.5-shaped payload; `regs.gpp_sid` is a hint on 2.6 baseline but a checked field on 2.6-202211+.
- **Native 1.1 vs 1.2.** Detect via `eventtrackers[]` in the request native; switch asset-id matching expectations accordingly.
- **VAST 4.x in `video.protocols`** — accept values 10/11/12 without warning.
- **`strictness` levels** — implement `lax` / `normal` / `pedantic` filtering.
- **Spec deep-links live.** UI surfaces every finding with a "see spec §3.2.10 ↗" link. (Right now they're only in the data model.)
- **Test fixtures** expanded: one canonical sample per version (2.5, 2.6 baseline, 2.6-202211, 2.6-202309) — drawn from IAB examples in the spec markdown.

**Exit criterion:** paste any of the canonical samples → version detected correctly with signals listed → no false-positive findings.

---

## Phase 3 — Foundations: i18n + theme (1 week) ✅ DONE

> Update 2026-05-04: 3 locales (uk/en/ru), URL routing per locale (`/`, `/uk/`, `/ru/`), language dropdown with **seamless DOM-morph switch** (no full reload, preserves analysis state), theme toggle with persistence + system-preference auto, theme-tooltip i18n, modal close-on-swap. `i18n.js` registry covers ~140 chrome strings; backend findings use `messages/{uk,en,ru}.json`.

Already requested. Lands after Phase 1 because the i18n key-extraction depends on the findings refactor, not before — otherwise the keys get baked in twice.

- **`locales/{uk,en,ru}.json`** — string registries. Seed UK from current copy, EN as the canonical translation, RU after.
- **Format: ICU MessageFormat** via `intl-messageformat` (~30KB). Handles plurals, parameter interpolation; standard in modern web apps.
- **Locale resolution** at runtime: `localStorage.spyglass_locale` → `?locale=` → `navigator.language` → `en`.
- **Locale switcher** in UI header (3 options for now).
- **Theme toggle** — light/dark via `:root[data-theme]` with full token table for both. Default: `prefers-color-scheme` on first visit; toggle persists in `localStorage`.
- **All UI copy** routed through i18n lookup. Includes button labels, modal titles, confirm prompts, empty states, finding messages.

**Exit criterion:** switching locale changes every visible string; switching theme repaints the entire UI without layout shift.

---

## Phase 4 — Open-source `@spyglass/core` (1 week) 🟢 MOSTLY DONE

> Update 2026-05-04: `packages/core/` extracted as npm workspace, validator engine pure JS (no Node-only APIs), repo went **public** on GitHub with MIT LICENSE + SECURITY.md + Sources documented. **Remaining**: actual npm publish (still `private: true` in workspace) — held back until API stabilizes after Phase 2 strict-mode work.

The validator engine becomes a public npm package. This is the trust play and the SEO play in one.

- **Move `validator/` to its own GitHub repo:** `kyivtech/spyglass-core`.
- **Build:** rollup → CJS + ESM + `.d.ts`. No browser-only or Node-only deps.
- **Package:** publish `@spyglass/core` (or `@kyivtech/spyglass-core` if scope is taken). Version 0.x while API stabilizes.
- **License decision** before publishing: MIT vs Apache-2.0. Default to MIT unless we have a patent concern.
- **README** with usage examples (browser, Node, CI), feature matrix, version coverage statement.
- **Auth'd workspace consumes the package** — switches `require('./validator')` to `require('@spyglass/core')` once stable.

**Exit criterion:** `npm i @spyglass/core` works; reading the README is enough to integrate.

---

## Phase 5 — Public demo split (1–2 weeks) ❌ REJECTED 2026-05-04

> Decision 2026-05-04: **NOT splitting** the surface to a separate `rtb.kyivtech.com.ua` domain. The public-demo experience already works without an account on `spyglass.kyivtech.com.ua/` — login only unlocks Save/Library/Partners. Real-world adoption confirmed (senior engineer at user's workplace used it for SSP 3027 click-without-click investigation 2026-05-04). Cost of split (2 deployments, 2 DNS, 2 CF Tunnel routes, 2 build configs) > benefit. The single-domain decision is in [memory `spyglass_no_public_split.md`](../../home/vk/.claude/projects/-home-vk/memory/spyglass_no_public_split.md).
>
> What of Phase 5 *was* worth doing happened anyway: anonymous use works, SEO landing exists (`/about` + index pages with hreflang + sitemap), privacy copy is live, og:image for socials shipped (commit `7a606ea`).

The public surface comes online.

- **Build flag:** `BUILD_TARGET=public | private`. Public build excludes the library panel, partner UI, save modal.
- **Domain:** `rtb.kyivtech.com.ua` (or similar). New Cloudflare Tunnel route, no auth gate.
- **Static deploy:** the public surface is just static HTML/CSS/JS + the `@spyglass/core` package bundled in. No Node server needed.
- **Privacy copy:** front-and-center "validation runs in your browser; nothing is uploaded".
- **Analytics:** privacy-respecting (Plausible or Cloudflare Web Analytics); no per-input tracking.
- **SEO landing:** real homepage explaining what Spyglass is, what versions it supports, links to GitHub repo, examples. This is the discoverability channel.

**Exit criterion:** anyone can paste a bid and get instant feedback at the public URL; opening the network tab confirms no `/api/` calls go out.

---

## Phase 6 — `@spyglass/cli` (3–5 days) ⏹️ NOT STARTED

A command-line wrapper for CI use.

- `npx @spyglass/cli validate req.json [resp.json]`
- Flags: `--dialect`, `--version`, `--strictness`, `--format=json|tap|junit|github-actions`, `--exit-on=errors|warnings|none`
- GitHub Action wrapper repo: `kyivtech/spyglass-action` — lets users add Spyglass as a CI step.

**Exit criterion:** `npx @spyglass/cli validate sample.json` works; a published GitHub Action template runs in someone else's repo.

---

## Phase 7 — Pro features (ongoing, prioritized) 🟢 PARTIAL

> Update 2026-05-04: **Multi-user accounts shipped** (`feat(auth): Phase 7 — multi-user accounts with per-user library`, commit `32a756a`); **zero-knowledge crypto shipped** (`feat(crypto): Phase 7 (full)`, commit `ca29b54`); **persistent history** done as part of multi-user library; **share read-only sample** NOT shipped; **per-partner default profiles** NOT shipped; **mock generation, schema diff, browser extension, VAST validator iframe** NOT started.

These are individually shippable; pick whichever the auth'd users ask loudest for.

| Feature                       | Estimate | Notes                                                             |
| ----------------------------- | -------: | ----------------------------------------------------------------- |
| Per-partner default profiles  |   3 days | `partners.default_version/dialect/strictness`; pre-fills on save  |
| Persistent history            |   2 days | Replace in-memory `historyStore` with DB-backed `histories` table |
| Share read-only sample        |   3 days | `/api/share/:id` → public read-only viewer URL                    |
| Mock generation               |   1 week | Generate a valid BidRequest matching given constraints            |
| Schema diff (2.5 → 2.6 → …)   |   3 days | Side-by-side diff of fields per version                           |
| Replay against allow-listed   |   1 week | Extends current `/api/proxy`; rate-limited, opt-in                |
| Team workspaces (multi-user)  |  2 weeks | `users` table, workspace memberships, sharing                     |
| Partner dialect contributions |   1 week | UI to author + propose new dialect overlays                       |
| Browser extension             |   1 week | Capture bid JSON from network tab; pipe into Spyglass             |
| VAST validator integration    |   3 days | Iframe IAB's tester from inside our preview pane                  |

---

## Phase 8 — Operationalize (continuous) 🟢 PARTIAL

> Update 2026-05-04: **SQLite backups** ✅ shipped — daily 03:30 cron via `scripts/backup-db.sh`, gzipped, 30-day rotation, restore drill verified. **Rate limiting** ✅ on `/api/analyze` (60 req/min/IP), `/auth/login` (10/15min), `/auth/register` (5/hour). **Health endpoint** ✅ exists at `/api/health` with DB ping (build SHA + version metadata still missing). **CI** ✅ via GitHub Actions; format/lint/typecheck/tests all green as of commit `affb4ec`. **Cache-bust automation** ❌ still manual `?v=N`. **Error tracking** ❌ Sentry/GlitchTip not integrated. **Structured logging** ❌ still `console.log/.error` (Pino not added).

Things that have to be true before we open the public demo, even if individual phases finish "before" them.

- **SQLite backups.** Daily SQLite `.backup` to `/srv/DATA/Backups/adtech-spyglass/spyglass-YYYY-MM-DD.db`, 30-day rotation. Restore drill once.
- **Rate limiting** on `/api/analyze` and `/api/proxy` (express-rate-limit, IP-keyed, 60 req/min).
- **Cache-bust automation.** Replace manual `?v=N` bumps with content-hashed asset URLs at build time (esbuild / Vite handles this natively).
- **Error tracking.** Sentry or self-hosted GlitchTip. No PII in events.
- **Logging.** Pino (already in portal); rotate via journald.
- **Health endpoint.** `/api/health` with build SHA + version table state.
- **CI:** GitHub Actions running tests on every PR; npm publish on tag.

---

## Decision log (live)

Decisions made during this planning session:

- **Pivot to IAB OpenRTB 2.6+ as the canonical validator base.** Kadam-isms become an opt-in dialect. (See [memory: spyglass_spec_direction.md](../../.claude/projects/-home-vk/memory/spyglass_spec_direction.md).)
- **OpenRTB 3.0 support is detect-and-label only**, no validation. Adoption is essentially zero — IAB back-ported wanted bits into 2.6. Revisit if a major SSP ships 3.0.
- **Public demo runs validator client-side**, not via a hosted endpoint. Privacy plus zero hosting cost.
- **`@spyglass/core` ships as npm package** — open source, MIT or Apache-2.0 (decided before publish).
- **Wedge market: CIS/EE push & pop SSPs** — Kadam, PropellerAds, Adsterra, MGID. Localization + dialect overlays = no competition. Then mainstream programmatic.
- **Two themes only** (light + dark). No "auto" pseudo-mode in the picker; OS preference is the load-time default.
- **Three locales for v1**: UK, EN, RU.
- **2026-05-04 — Phase 5 (public/private domain split) REJECTED.** Anonymous validation already works on the single domain `spyglass.kyivtech.com.ua/`. Login is opt-in for Save/Library/Partners only. Real-world adoption confirmed (senior engineer used the existing single-domain inspector to debug an SSP 3027 click-without-click complaint). Cost > benefit. Dev-environment split (`dev-spyglass.kyivtech.com.ua`) is a **separate idea** — not decided either way; revisit when a specific risky migration warrants side-by-side. See [memory: spyglass_no_public_split.md](../../.claude/projects/-home-vk/memory/spyglass_no_public_split.md).
