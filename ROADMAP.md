# Spyglass Roadmap (revised 2026-05-23)

---

## How to use this document

This is the canonical roadmap for Spyglass / ortbtools.com. Single source of truth.

- **At the start of every session**: re-read this file. Memory pointer: `[Spyglass multi-section](project_spyglass_multi_section.md)`.
- **Stage numbering is stable**: Stages 0-5 are committed and ordered; Stage 6+ is the backlog (unordered, priority changes).
- **All decisions are locked** (see Decisions log). If a decision needs to change, change THIS document first, then proceed.
- **No open questions in the active plan.** If a question surfaces mid-stage, resolve it before proceeding or escalate to user. Do not silently defer.
- **Reality audit** at the bottom of this document records what the audit docs in `docs/` said vs HEAD code as of 2026-05-23. Those audit docs in `docs/` are snapshots — this ROADMAP is the live plan.

---

## Mini-tasks (not stage-bound)

### Domain migration — spyglass.kyivtech.com.ua → ortbtools.com
Status: pending. Configure 301 redirect from `spyglass.kyivtech.com.ua` to `ortbtools.com` for 60-90 days, then drop the subdomain DNS record. Verify via Cloudflare page rules or the cloudflared tunnel config (check `~/server/cloudflared/` or `/srv/DATA/Stacks/cloudflared/` on OptiPlex for the right approach). ~1 hour config + 60-90 days passive monitoring.

---

## Where we are

Spyglass is a mature OpenRTB inspector at ortbtools.com (v0.51.0 as of 2026-05-23). The validator engine (`packages/core/`, v0.25.0) covers oRTB 2.5/2.6/3.0 detection with confidence scoring, version-aware rule sets, VAST 12-rule validation, semantic crosscheck, URL-style request validation (new in v0.51.0), and 5 JSON-feed shape handlers (Clickunder, Link-Feed, Value-Feed, Bid-Price, Bid-Redirect). Three dialects ship: `iab` (canonical), `ext-rtb` (formerly kadam — renamed 2026-05-23 as part of the partner-name scrub), and `inpage-push`. Strictness levels (`lax`/`normal`/`pedantic`) are fully wired through the API (`packages/core/index.js` `applyStrictness()`). Three locales (uk/en/ru). 16 behavior detection patterns. Specimen replay endpoint (`/api/v1/replay`) and SSE stream generator (`/api/v1/stream`) are wired and functional.

The auth and crypto layer is solid: zero-knowledge encrypted library, per-user partners, bcrypt sessions, PBKDF2-SHA-256 AES-GCM for stored samples. The backend is modular: `server.js` is a thin router; each feature lives in `modules/*/handler.js`. Structured logging via pino (`lib/logger.js`). GlitchTip error tracking is wired end-to-end: `lib/logger.js` initialises `@sentry/node` against a self-hosted GlitchTip instance; `modules/sentry-ingest/handler.js` proxies browser error envelopes from `POST /glitchtip-ingest/*`. Daily SQLite backups at 03:30. Rate limiting on all public endpoints. CI green. Docker bind-mounts cover both `./packages` and `./modules`, so validator and handler edits do not require a rebuild.

What is NOT done: the inspector is still a single-screen paste tool. The `public/stream.html` page exists (canonical URL `ortbtools.com/stream`, SSE backed by synthetic corpus), but it is a standalone HTML file with no shared navigation. The zero-knowledge library lives inside `/account`. There is no `/docs`, `/dialects`, or `/blog` surface. There is no side navigation connecting the sections. Seven pop-vendor dialects are not started — gated on real samples per project reactive-only policy. `@spyglass/core` is not published to npm: the `private` field has been removed and `publishConfig.access: "public"` is set in `packages/core/package.json`, but the actual publish is held back pending API stabilisation.

The product is real and useful. The ceiling it is hitting: the inspector is the entire UI, so every new capability either crowds the single screen or goes undiscoverable. The multi-section architecture below is the answer to that ceiling.

---

## What changed in direction (2026-05-23)

The decision: Spyglass becomes a multi-section site with a **wide grouped sidebar** (~220px) and a **thin global topbar** (~44px). The inspector retains flagship status but becomes one of 8 sections. Path-based URLs on a single domain (ortbtools.com). The old stream-platform-pivot plan (stream as the default landing, inspector demoted to `/playground`) is **superseded** — stream is now Stage 2 of the multi-section rollout, not a landing-page replacement. The superseded doc lives at `docs/stream-platform-pivot-2026-05-05.md` and will be annotated.

**8 sections:**

| Path | Purpose |
|------|---------|
| `/inspector` (default) | Paste and validate — existing core product |
| `/live` | Synthetic SSE stream of oRTB specimens at 60–120 req/min |
| `/behavior` | Behavior corpus labelling UI and confusion matrix |
| `/library` | Zero-knowledge saved samples (moved from `/account`) |
| `/dialects` | Public catalog of known dialects and user dialect builder |
| `/blog` | Editorial posts (markdown) and firehose-sourced posts (ClickHouse) |
| `/docs` | Reference: spec coverage, finding IDs, API, integration guide |
| `/account` | Auth and profile settings (login/logout/password) |

**Sidebar grouping:**
- РОБОТА: Інспектор / Стрім / Behavior
- ДАНІ: Зразки / Діалекти
- ЗНАННЯ: Блог / Доки

**Architectural choices:**
- Path-based routing (pushState), single domain, single Node process
- Sidebar: ~220px on desktop; drawer below 1024px breakpoint (tablets 768-1023px get the drawer because the inspector dual-panel needs the horizontal space)
- Topbar: logo, disabled search slot (`🔎 пошук — скоро`, real search Stage 5+), lang switcher, theme toggle, profile avatar (~44px)
- Blog: hybrid — editorial posts as `content/posts/{lang}/*.md` with frontmatter (git-versioned); firehose posts in ClickHouse `analytics.blog_drafts` with manual approval gate at `/admin/blog`; default approval publishes to `analytics.blog_posts` DB; opt-in markdown promotion for evergreen content
- Root URL `ortbtools.com/` issues a 301 redirect to `/inspector` — explicit URL makes section structure clear and keeps `/` free for a future marketing landing

---

## Stage 0 — Shell + routing + stubs (3–5 days)

The goal: wire the URL structure and chrome without building any new feature.

**Deliverables:**

1. **Side nav component** (`public/modules/nav/index.js`) — groups РОБОТА/ДАНІ/ЗНАННЯ, highlights active section based on `location.pathname`, collapses to a drawer below 1024px. State lives in the URL, not in component memory.
2. **Thin global topbar** (`public/modules/topbar/index.js`) — logo, disabled `🔎 пошук — скоро` slot (consistent visual chrome from day one; real search Stage 5+), lang picker, theme toggle, profile avatar if logged in. Replaces the current per-page header duplication across 6 HTML files.
3. **pushState router** (`public/modules/router/index.js`) — intercepts `<a href="/...">` clicks, updates the URL, mounts the matching section module. Hash-based routing rejected (breaks SEO canonical URLs and OG image references).
4. **Inspector into `/inspector` route** — `mountInspector()` in `public/spyglass.app.js` becomes the section handler for the `/inspector` path. `window.toast` and other exposed globals remain, cleaned up on unmount via the existing cleanup list.
5. **Stub pages** for the 7 sections not yet built — each renders a one-paragraph description of what will be there and its estimated stage. No lorem ipsum.
6. **Server-side catch-all** — `server.js` must serve the SPA shell HTML for all pushState paths (`/inspector`, `/live`, `/library`, `/dialects`, `/blog`, `/docs`, `/account`, `/behavior`) so direct navigation and browser refresh work.
7. **Root redirect** — `server.js` route `GET /` issues `301` to `/inspector`.

**Acceptance criteria:**
- `ortbtools.com/` redirects 301 to `ortbtools.com/inspector`
- `ortbtools.com/inspector` loads the full existing inspector; all 715+ tests pass
- `ortbtools.com/live` renders a stub with Stage 2 copy
- Browser back/forward works across all 8 paths
- Side nav visible and correct at 1440px and 375px (drawer on mobile/tablet below 1024px)
- Topbar shows disabled search slot at all widths
- No regression on existing share-link, embed, download-bundle flows

**Risk:** `public/spyglass.app.js` is 4785 lines and bootstraps many `window.*` globals. The mount/unmount lifecycle needs care to avoid leaks when navigating away from `/inspector`. The existing `mountInspector()` cleanup list (which already covers `window.toast`, `window.openEmbedModal`, etc.) is the model to follow.

**Files touched:**
- `public/modules/nav/` — new
- `public/modules/topbar/` — new
- `public/modules/router/` — new
- `public/spyglass.app.js` — guard existing init behind `mountInspector()` route lifecycle
- `public/index.{en,uk,ru}.html` — strip per-page nav; add SPA shell scaffold
- `public/spyglass-shell.css` — sidebar and topbar layout tokens
- `server.js` — `GET /` 301 → `/inspector`; catch-all HTML route for pushState paths

---

## Stage 1 — Relocate existing surfaces (1–2 weeks)

No new features. Move what exists into the right navigation slots.

**`/library` from `/account` ZK library panel**

The saved-samples list currently lives inside `account.{en,uk,ru}.html` and `public/account.js`. Extract into the `/library` section. Backend stays unchanged — `modules/samples/handler.js` and `/api/samples` routes are already correct.

- `public/modules/library/index.js` — extract sample list and sample detail from `account.js`
- `/account` retains only auth/profile/password-reset

**`/docs` from about pages and finding reference**

Current `about.{en,uk,ru}.html` covers spec support, architecture, integration notes. Merge into a `/docs` section with docs-internal sub-nav. Add a **Finding ID reference** page auto-generated from `packages/core/messages/en.json` — lists every finding ID, severity, message template, and specRef URL. Makes the tooltips searchable and linkable.

- `public/modules/docs/index.js` — new; renders about content and generated finding list
- Server routes: `/docs` and `/docs/:page`
- `about.{en,uk,ru}.html` become redirects or are absorbed

**`/dialects` from dialect builder (currently inside Intel tab)**

The User Dialects feature (v0.42.0) lets logged-in users create custom dialect overlays. Currently buried in the inspector cabinet. Extract into its own section: (a) public catalog of the 3 built-in dialects with rule counts and purpose; (b) user dialect builder for logged-in users.

- `public/modules/dialects/index.js` — new; wraps existing dialect builder
- `modules/dialects/handler.js` — already exists; no backend changes needed

**Acceptance criteria for Stage 1:** `/library`, `/docs`, `/dialects` each render a useful, populated surface for both anonymous and logged-in users. Zero new backend endpoints required.

---

## Stage 2 — Stream MVP (2–3 weeks)

Activates the `/live` section.

**Backend (already largely built):**
- `modules/stream/handler.js` and `streamGenerator` in `server.js` already exist. Generator emits synthetic oRTB specimens at ~1Hz with a 15s heartbeat comment to keep CF/nginx from killing idle connections.
- Add `GET /api/v1/stream/stats` — returns in-memory aggregate of last 1000 specimens: format distribution, top-5 finding IDs by count, oRTB version mix. Drives the mini-dashboard above the stream rows.
- Add `cached_specimens` SQLite table: `(hash TEXT PK, json TEXT, created_at INTEGER, last_accessed INTEGER)`. Hash = `sha256(canonical-json).slice(0,12)`. TTL: 90 days from `last_accessed`. Route `GET /r/:hash` serves the cached specimen into the inspector. (No route conflict — verified via grep of `server.js` + `modules/*/handler.js`; no existing route matches `/r/*` or `/r/:hash`.)

**Frontend:**
- `public/stream.html` exists (211 lines, canonical URL `ortbtools.com/stream`) but is a standalone page. Absorb into the section framework from Stage 0.
- `public/modules/live/index.js` — connects to `/api/v1/stream` (SSE), appends rows to a virtual scroll list.
- Each row: timestamp, format pill, oRTB version badge, finding count. Click navigates to `/inspector?specimen={hash}`.
- Filter rail: format / version / severity, URL-reflected via pushState so filters survive refresh.
- Pause/resume button toggles SSE subscribe/unsubscribe.

**Acceptance criteria:**
- Stream visible at `/live` with rows updating at 60–120 req/min
- Filter by format narrows stream rows and updates URL
- Click a row — specimen loads in `/inspector` with all tabs working
- `/r/{hash}` permalink resolves after container restart (SQLite cache)
- Stats panel shows format breakdown and top-5 finding IDs

**Files touched:**
- `public/modules/live/` — new
- `public/stream.html` — absorbed into section framework
- `modules/stream/handler.js` — add `/api/v1/stream/stats`
- `server.js` — `cached_specimens` table init; `/r/:hash` route
- `public/spyglass.app.js` — `?specimen=` query param hydration path in `mountInspector()`

---

## Stage 3 — Blog (1–2 weeks)

Activates `/blog` and `/blog/:slug`.

**Editorial posts — `content/posts/{lang}/*.md`**

Frontmatter keys: `title`, `date` (ISO-8601), `category` (новини|розбори|гайди), `tags` (array), `lang` (uk|en|ru), `slug`. Same slug across locales: `content/posts/uk/ortb-3-zero-adoption.md` and `content/posts/en/ortb-3-zero-adoption.md` share the `slug` field. Rendered at request time via `marked` or `markdown-it` — consistent with the no-bundler project philosophy.

**Firehose posts — ClickHouse `analytics.blog_drafts` → `analytics.blog_posts`**

The Mozok news pipeline surfaces adtech articles daily. A subset should become Spyglass blog posts. Schema for `analytics.blog_drafts`: `(id UUID, title String, url String, summary String, category String, lang String, created_at DateTime64, approved_at Nullable(DateTime64), approved_by Nullable(String), slug Nullable(String), status Enum8('pending'=1, 'published'=2, 'promoted'=3))`.

Admin page `/admin/blog` (auth-gated): lists unapproved candidates; two actions per draft:
- **Approve + publish to DB** (default, faster, auto-refreshable, no git): draft moves from `analytics.blog_drafts` → `analytics.blog_posts` (published table), served from DB. Status set to `published`.
- **Approve + promote to markdown** (for evergreen / lasting content): writes `content/posts/{lang}/{slug}.md` from the draft; marks CH row as `promoted` (kept as audit trail). Requires manual `git add && git commit` after — surfaced in admin UI as a hint. Default UI choice = DB publish; markdown promotion is opt-in per post.

**Additional deliverables:**
- `GET /blog/rss.xml` — last 20 posts across locales
- `/blog` listing: cards sorted by date, category filter, locale switcher per post
- Three categories: новини (adtech news from firehose), розбори (technical breakdowns), гайди (integration guides)
- Per-locale slug routing: `/blog/uk/ortb-3-zero-adoption`, `/blog/en/ortb-3-zero-adoption`

**Files touched:**
- `content/posts/` — new directory, git-tracked
- `public/modules/blog/` — new
- `modules/blog/handler.js` — new (list, slug, rss routes)
- `modules/admin/blog.js` — new (approval endpoint, supports both DB-publish and markdown-promote actions)
- `server.js` — mount blog and admin/blog modules

---

## Stage 4 — Behavior corpus UI (1 week)

Activates the `/behavior` section.

The corpus capture pipeline shipped in v0.29.0. `modules/corpus/handler.js` exposes: `GET /api/behavior/corpus` (list with optional `?label=` filter), `POST /api/behavior/corpus` (save new entry), `DELETE /api/behavior/corpus/:id`, `GET /api/behavior/corpus/matrix` (confusion matrix runner). These routes work. What is missing is a first-class UI.

**Deliverables:**
1. `/behavior` section with three sub-tabs: Corpus / Matrix / Patterns
2. Corpus tab — lists saved behavior entries with tag filter (legitimate/fraud/ambiguous) and delete button
3. Matrix tab — calls `/api/behavior/corpus/matrix` and renders per-pattern FP/FN table (currently API-only)
4. Two deferred patterns (`bot.center_pixel_perfect`, `bot.double_too_fast`) — ship once the corpus has at least 100 labelled samples per pattern. Deferred status set in `docs/next-chapters-2026-05-09.md` remains valid.

**Files touched:**
- `public/modules/behavior/` — new
- `modules/corpus/handler.js` — no changes needed; wire UI to existing routes

---

## Stage 5 — Insights (1 week, opportunistic)

Self-validation analytics surface. Aggregates everything a user has run through their own inspector locally (Spyglass Intel walker already writes to IndexedDB; `analytics.intel_llm_calls` in ClickHouse mirrors LLM-touched samples). The section answers: what does MY pipeline look like across the last N sessions — format mix, version mix, top-N findings, dialect distribution, behavior-probe hit rate.

Inspiration: openrtb.ovh ships an aggregate route titled "All requests combined" — proves there is appetite for a personal aggregate view alongside per-sample validation.

**Two scopes, decide at build time:**
- Local-only: IndexedDB-backed, zero server cost, no auth required. Each user sees only their own browser history.
- Account-scoped: synced via ZK library (already encrypted server-side), available across devices for logged-in users. Adds a query layer on top of the existing `cached_specimens` table.

**Files (new):** `public/modules/insights/index.js`, optionally `modules/insights/handler.js` for the account-scoped variant.

Gated on Stage 1 settling (the `/library` move is a prerequisite for the account-scoped variant).

---

## Stage 6+ — Backlog (not committed)

Ordered by likelihood it will eventually matter:

1. **Validator-depth gaps vs openrtb.ovh** — competitor research 2026-05-23 surfaced 19 IAB 2.5/2.6 baseline checks we skipped. Most are low-effort additions in `rules-request.js`/`rules-response.js`:
   - **AdPod** (2.6 multi-bid video): `ADPOD_DETECTED`, `ADPOD_DURATION_INVALID`, `ADPOD_PODSEQ_INVALID`
   - **Identity graph**: `EID_SOURCE_MISSING`, `EID_SOURCE_TYPE_INVALID`, `EID_UIDS_MISSING`, `EID_EXT_TYPE_INVALID`, `UID_ID_MISSING`, `UID_ID_TYPE_INVALID`, `UID_ATYPE_TYPE_INVALID`, `UID_EXT_ATYPE_MISSING`
   - **Supply chain transparency**: `SCHAIN_VERSION_MISSING`, `SCHAIN_VERSION_NONSTANDARD`, `SCHAIN_NODES_MISSING`
   - **In-app musts**: `APP_BUNDLE_MANDATORY_INAPP`, `DEVICE_IFA_MANDATORY_INAPP`, `DEVICE_LMT_DETECTED`
   - **Bid price sanity**: `BID_NEGATIVE_PRICE`, `BID_ZERO_PRICE`, `BID_HIGH_PRICE` (today we crosscheck against bidfloor but not sanity-check the absolute value)
   - **Baseline checks**: `TMAX_INVALID`, `CURRENCY_FORMAT`, `BANNER_POS_NONSTANDARD`, `BANNER_MIMES_RECOMMENDED`
   - **Native granularity**: `NATIVE_ASSET_TYPE_REQUIRED` (we have `imp.native.ver_missing` but not the per-asset type check)
   - **HTML creative inspection**: `HTML_UNSAFE_SCRIPT`, `HTML_LIMITED_MEDIA` (overlaps our behavior probe but at static-scan level)
   - **Business framing**: `BUSINESS_DOMAIN_FORMAT`, `BUSINESS_EMPTY_DOMAIN`, `BUSINESS_ADOMAIN_REQUIRED` (they aggregate adomain/cid/crid under a "Business" category; we scatter these across response.* and crosscheck.bid.*)

   We retain wide leadership on `behavior.*` (17), `crosscheck.*` (28), `feed.*` (30), `vast.*` (20), `inpage-push.*` (9) — openrtb.ovh has zero overlap with any of these. Closing the 19-item gap brings us to parity on baseline + keeps our differentiators.

2. **Version-aware rule gating** — some rules fire on payload versions where they should be silent. Tracked in `packages/core/rules-request.js` and `rules-response.js`. Needs a `version` argument threaded into each rule function and per-rule `appliesTo` declarations. Gated on a real false-positive complaint caused by this gap.

3. **`@spyglass/core` npm publish** — `private` field is already removed from `packages/core/package.json`; `publishConfig.access: "public"` is set. Blocked by: (a) finalising the `strictness` API surface (the last open Phase 2 item), (b) deciding whether the package name stays `@kyivtech/spyglass-core` or migrates to `@ortbtools/core`. Expect this after Stage 2 settles the API surface.

4. **`@spyglass/cli`** — gated on npm publish. Estimated 3–5 days once unblocked. Flags: `--dialect`, `--strictness`, `--format=json|tap|junit|github-actions`.

5. **Seven pop-vendor dialects** — reactive only (policy in `feedback_spyglass_iab_dialects.md`). The `cu-pops-audit-2026-05-12.md` listed all 7 as CRITICAL; the audit's own calibration note recalibrated severity as inflated. The gap is real but each dialect is gated on receiving a real sample from a partner integration.

6. **AdCOM 1.0 deep validation** — gated on real 3.0 traffic appearing. Currently every 3.0 payload emits `deep_validation_limited INFO` from `packages/core/rules-request-30.js` and `rules-response-30.js`. Do not start without traffic to validate against (see `docs/next-chapters-2026-05-09.md` §Chapter C).

7. **Real-traffic ingest** — gated on employer legal clearance. Unknown timeline. The anonymisation architecture (ring buffer in `modules/stream/`) is ready for this path when/if clearance arrives.

8. **i18n debt** — the ~30 hardcoded Cyrillic strings flagged in `docs/tech-debt-2026-05-04.md` are **resolved**. `public/spyglass.app.js` contains 9 Cyrillic lines, all in code comments, not in UI copy. The i18n.js registry plus per-module i18n files cover all UI strings. No open debt here.

9. **`spyglass.app.js` modularisation** — currently 4785 lines (was 4505 at audit time; grew with new features). The Stage 0 routing approach naturally slows growth: each Stage 0–2 feature lands as a `public/modules/*/` IIFE rather than extending the main file.

10. **Cache-bust automation** — still manual `?v=N` bumps. Low priority while the project has no build step by design.

11. **Health endpoint metadata** — `/api/health` responds `{success:true, db:"ok"}`. Build SHA and validator version missing. One-day task, low priority.

12. **Quality Score 0–100** — competitor research 2026-05-23: openrtb.ovh shows a `Score: 100/100` pill at the top of every validation. Single-number quality summary is more digestible for non-developers than raw finding counts. Formula candidate: `max(0, 100 - errors*20 - warnings*5 - info*1)`, clamped. Renders as a pill badge alongside the existing severity counters. ~1-2 days in `public/spyglass.app.js` validation render + `packages/core/findings.js` aggregator.

13. **Request Analysis summary strip** — openrtb.ovh shows a structured metadata strip above findings: `OpenRTB Version · Traffic Type · Device Category · Privacy Signals · Ad Formats`. We have format-chips today but not the structured strip with device/privacy/traffic. Strip lives in inspector section between editors and Inspector/Validation/Crosscheck/Behavior tabs. ~1 day in `public/spyglass.app.js` `renderSummaryStrip()` + small helpers in `packages/core/`.

14. **Severity tabs in findings panel** — openrtb.ovh splits findings into `Errors (N) | Warnings (N) | Info (N)` tabs with counters. We use semantic tabs (Inspector/Validation/Crosscheck/Behavior) which group by *domain*; layer a severity filter on top. Empty-state with friendly tone (`No errors detected! 🎉`). ~0.5 day, mostly CSS + small DOM rewrite.

15. **Test Cases public gallery (Stage 1 expansion)** — openrtb.ovh `/testcases` is a public-facing catalog of curated valid/invalid samples with copy + download. Their best SEO + onboarding surface. We have ~25 synthetic specimens hidden in the `приклад` dropdown. Promote them to `/library` Stage 1 as a public catalog (no auth required) sectioned as: Valid Cases (banner / video / native / pop / 3.0 / inpage-push) vs Invalid Cases (attack patterns, malformed shapes). Each card: title, description, Valid|Invalid badge, Copy, Download. Authenticated users see their own ZK-encrypted saves in a separate tab on the same page. This expands the original Stage 1 scope.

16. **shadcn-style design tokens migration** — competitor research 2026-05-23: openrtb.ovh ships clean shadcn/ui aesthetics on Tailwind. We can match the look without adopting Tailwind/React. Refactor `public/spyglass-shell.css` design tokens from our ad-hoc set (`--accent`, `--text`, `--bg`, `--border`, etc.) to shadcn-semantic structure: `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--border`, `--input`, `--destructive`, `--destructive-foreground`, plus single `--radius` with derived `calc(var(--radius) - 2px)` rhythm. Add severity colour tokens (`--error`, `--warning`, `--info`, `--success`) using Tailwind defaults. System-font stack confirmed clean. ~1-2 days mechanical migration with `git grep` of token usages across `public/`. Bundled naturally with Stage 0 shell refactor — fresh CSS surface is cheaper than retrofitting later.

17. **Global Search (Stage 5+ unlock)** — unified full-text search across blog posts, finding IDs + descriptions, dialect names, doc pages. Backend: ClickHouse full-text indexes on `analytics.blog_posts` (TokenBF for blog body, NGRAM for slugs/tags) + a new `analytics.findings_catalog` mirror of `packages/core/spec-refs.json`. Frontend: `/search?q=...` route + topbar input that hits `GET /api/search?q=`. Gated on blog (Stage 3) and insights (Stage 5) shipping — there's nothing meaningful to search before that. ~3-5 days. ClickHouse chosen over MeiliSearch to avoid adding a new container.

---

18. **Chrome-level auth modal (popup on any page)** — current Stage 1 sign-in flow SPA-navigates to /inspector?auth=login when the user clicks because the auth modal depends on the inspector closure-scoped SpyglassSession (DEK + crypto state). To open the modal in place from /library or /docs etc., SpyglassSession must be hoisted to the shell-boot level: a small standalone facade exposing api/setUser/openFromPassword/bootstrap that the inspector and other sections share. Stage 2+ work — ~3-5 days. Until then sign-in from any section opens the modal but routes through /inspector first.

## Decisions log (2026-05-23)

- **Multi-section site with wide grouped sidebar.** The inspector was hitting a single-screen ceiling. A proper navigation shell makes each capability discoverable without crowding the paste surface. 8 sections, 3 groups (РОБОТА / ДАНІ / ЗНАННЯ).
- **pushState over hash routing.** SEO canonical URLs matter for the blog and docs sections. Hash routing rejected.
- **Stream is Stage 2, not the landing.** The 2026-05-05 stream-platform-pivot doc proposed making the stream the default landing and demoting the inspector to `/playground`. That framing is superseded. Stream is a sibling section; inspector remains default.
- **Hybrid blog stack.** Editorial posts in git for durability and diff history; firehose-sourced posts in ClickHouse for the automated Mozok news candidate pipeline, with manual approval gate at `/admin/blog`.
- **Pop-vendor dialects remain reactive.** The cu-pops-audit listed 7 missing dialects as CRITICAL — the audit's own calibration note recalibrated severity as inflated. Policy unchanged: one real sample from a partner integration → one dialect.
- **Root URL `GET /` → 301 → `/inspector`.** Single canonical URL. Keeps `/` free for a future marketing/dashboard landing. Implemented in `server.js` route table during Stage 0.
- **Mobile breakpoint is `<1024px` (drawer mode).** Tablets (768-1023px) get the drawer because the inspector dual-panel (request|response) needs the horizontal space. Desktop (≥1024px): sidebar always visible.
- **Global search: disabled slot Stage 0, full build Stage 5+.** Topbar shows a disabled `🔎 пошук — скоро` slot from day one for consistent visual chrome. Full unified search via ClickHouse full-text indexes (TokenBF / NGRAM) after blog (Stage 3) ships and there is content worth indexing. ClickHouse chosen over MeiliSearch — no new container.
- **`/r/{hash}` route is free.** Verified via grep of `server.js` + `modules/*/handler.js`: no existing route matches `/r/*` or `/r/:hash`. Safe to register in Stage 2.
- **Blog approval is hybrid: DB publish (default) + opt-in markdown promotion.** Firehose candidates approved via `/admin/blog` default to publishing into `analytics.blog_posts` (DB-backed, fast, auto-refreshable). Evergreen posts can be optionally promoted to `content/posts/{lang}/{slug}.md` in git (admin UI surfaces a hint to `git add && git commit`). CH row kept as audit trail with status `promoted`.

---

## What this roadmap is NOT

- Not a commitment to npm publish timeline — gated on API stability.
- Not a commitment to legal-cleared real traffic ingest — timeline unknown.
- Not a commitment to any specific pop-vendor dialect — reactive to corpus, not proactive by market share.
- Not a SaaS pricing or auth-gated feature plan — all current inspector functionality stays free and anonymous.
- Not a v1.0.0 stability declaration — project stays 0.x until the multi-section shell is stable and settled.

---

## Reality audit: reconciled status (2026-05-23)

Cross-check of claims in `docs/tech-debt-2026-05-04.md`, `docs/functional-audit-2026-05-12.md`, `docs/cu-pops-audit-2026-05-12.md`, and the old ROADMAP against HEAD code.

| Old claim | Audit doc | Status at HEAD | Evidence |
|-----------|-----------|----------------|---------|
| `packages/core` not bind-mounted (CRITICAL) | tech-debt-2026-05-04 | **RESOLVED** | `docker-compose.yml` line 47: `./packages:/app/packages:ro` |
| SQLite backup missing (CRITICAL) | tech-debt-2026-05-04 | **RESOLVED** | `scripts/backup-db.sh`, cron 03:30 |
| GlitchTip not integrated | ROADMAP Phase 8 | **RESOLVED** | `lib/logger.js` (`@sentry/node` init), `modules/sentry-ingest/handler.js` (proxy), wired in `server.js` |
| Pino not in package.json | tech-debt-2026-05-04 | **RESOLVED** | `lib/logger.js` uses `require('pino')` |
| Strictness levels not wired to API | ROADMAP Phase 2 | **RESOLVED** | `packages/core/index.js` `applyStrictness()`; documented in `packages/core/README.md` line 67 |
| `@spyglass/core` private:true | ROADMAP Phase 4 | **PARTIALLY DONE** | `private` field removed; `publishConfig.access:"public"` set; actual `npm publish` not done |
| ~30 hardcoded Cyrillic strings | next-chapters-2026-05-09 | **RESOLVED** | `wc -l` grep: 9 Cyrillic lines in `spyglass.app.js`, all in comments |
| `spyglass.app.js` 4505 lines | functional-audit-2026-05-12 | **STALE** (grew) | Currently 4785 lines |
| Stream endpoint missing | ROADMAP Phase 8 | **RESOLVED** | `modules/stream/handler.js`, `public/stream.html` at `ortbtools.com/stream` |
| Replay endpoint missing | next-chapters-2026-05-09 | **RESOLVED** | `modules/replay/handler.js`, `GET /api/v1/replay` |
| Confusion matrix missing | next-chapters-2026-05-09 | **RESOLVED** | `modules/corpus/handler.js` `GET /api/behavior/corpus/matrix` |
| "All 7 pop-vendor dialects missing" | cu-pops-audit-2026-05-12 | **CONFIRMED** | `packages/core/dialects/` has only `ext-rtb.js`, `iab.js`, `inpage-push.js` |
| AdCOM 1.0 deep validation missing | functional-audit-2026-05-12 | **CONFIRMED (gated)** | `rules-request-30.js` emits `deep_validation_limited INFO` by design |
| Phase 5 public/private domain split REJECTED | old ROADMAP | **OBSOLETE** | Decision logged; single domain confirmed; domain is now ortbtools.com |
| stream-platform-pivot as landing strategy | stream-platform-pivot-2026-05-05 | **SUPERSEDED** | Stream is Stage 2 of multi-section, not landing pivot |
