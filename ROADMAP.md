# ortbtools Roadmap

Last reconciled with the repository on 2026-08-11.

## How to use this document

The current baseline and priorities below are the live plan. The dated Stage
0–6 material later in this file is retained as an implementation and decision
record; it is not a list of unfinished work. Verify architecture details in
[docs/ARCHMAP.md](./docs/ARCHMAP.md) and production procedures in
[docs/OPERATIONS.md](./docs/OPERATIONS.md).

## Current baseline

| Surface        | Version / state                                                        |
| -------------- | ---------------------------------------------------------------------- |
| Web app        | `1.6.0`                                                                |
| Core workspace | `@ortbtools/core` `0.31.0`; not published to npm                       |
| CLI workspace  | `@ortbtools/cli` `0.1.1`; implemented and tested, not published to npm |
| Runtime        | Node `>=22.13.0`; vanilla `node:http` application                      |
| Source repo    | `vladikkrasulya/adtech-spyglass`; GitHub rename remains a decision     |

The npm status was verified against the public registry on 2026-08-11: both
package names returned `E404`. The local model-free cleanup baseline is commit
`89d1af1`; the last production state verified during the audit was `f6bead9`.
This document does not claim that later local commits have been deployed.

The shipped product is a multi-section SPA with Inspector, Live/Stream,
Behavior, Library, Dialects, Blog, Docs and Insights, plus separately served
localized Account pages. The
hosted Inspector sends pasted payloads to `POST /api/analyze`; analysis is
server-side and raw bodies are processed transiently rather than persisted.
The current web save path encrypts sample bodies in the browser before upload;
sample, partner and dialect metadata remains server-readable.

Interactive Intel endpoints and news relevance use deterministic
`lib/intel-rules.js` rules. OpenRouter remains isolated to news translation and
categorization. Sentry support is configuration-gated and exposes readiness in
`/api/health`; the verified production baseline reported `sentry.ready:false`,
with Telegram as the active alert path.

Production uses an immutable, exact-tag Docker image. Application source and
the vendored design system are baked into the image; `/data` is the only
runtime mount. Deploys run readiness and smoke gates with automatic rollback.

## Current priorities

1. Complete the documentation truth sweep and keep regression guards in CI.
2. Decide whether to rename the existing GitHub repository to `ortbtools`.
   Until then, active source links must use the reachable repository URL shown
   in the baseline above.
3. Decide whether to perform the first verified npm publication. Until it
   succeeds, document Core and CLI as repository workspaces only.
4. Run a fresh dependency/security audit and merge only upgrades that pass the
   complete CI and package smoke gates.
5. Restore or deliberately reconfigure production Sentry, then verify
   readiness and alert delivery without weakening the Telegram fallback.
6. Deploy the reviewed baseline through the normal immutable-image pipeline.
7. Only after these baseline tasks, schedule product features or hotspot-file
   refactors.

## Decisions

- Inspector remains the primary product surface; Live is a sibling tool.
- The web app stays on one domain with path-based SPA navigation.
- Hosted validation is server-side; raw analyze payloads are not persisted.
- Zero-knowledge claims apply to encrypted saved-sample bodies and keys, not
  to every network flow in the product.
- Interactive intelligence is deterministic and model-free. External model
  use is limited to the isolated news translation pipeline.
- Vendor dialect work remains evidence-driven: add named overlays from public
  documentation or representative samples, not guesses.
- Production images are immutable and addressed by exact commit tags.

## Historical implementation plan (superseded)

The sections below preserve the May–July 2026 rollout plan and its original
acceptance criteria. Stages 0–5 shipped and many Stage 6 entries were later
implemented. Version numbers, test counts, route lists, model references and
“not started” labels below are historical unless the current priorities above
repeat them.

---

## Stage 0 — Shell + routing + stubs (3–5 days)

The goal: wire the URL structure and chrome without building any new feature.

**Deliverables:**

1. **Side nav component** (`public/modules/nav/index.js`) — groups РОБОТА/ДАНІ/ЗНАННЯ, highlights active section based on `location.pathname`, collapses to a drawer below 1024px. State lives in the URL, not in component memory.
2. **Thin global topbar** (`public/modules/topbar/index.js`) — logo, disabled `🔎 пошук — скоро` slot (consistent visual chrome from day one; real search Stage 5+), lang picker, theme toggle, profile avatar if logged in. Replaces the current per-page header duplication across 6 HTML files.
3. **pushState router** (`public/modules/router/index.js`) — intercepts `<a href="/...">` clicks, updates the URL, mounts the matching section module. Hash-based routing rejected (breaks SEO canonical URLs and OG image references).
4. **Inspector into `/inspector` route** — `mountInspector()` in `public/ortbtools.app.js` becomes the section handler for the `/inspector` path. `window.toast` and other exposed globals remain, cleaned up on unmount via the existing cleanup list.
5. **Stub pages** for the 7 sections not yet built — each renders a one-paragraph description of what will be there and its estimated stage. No lorem ipsum.
6. **Server-side catch-all** — `server.js` must serve the SPA shell HTML for all pushState paths (`/inspector`, `/live`, `/library`, `/dialects`, `/blog`, `/docs`, `/account`, `/behavior`) so direct navigation and browser refresh work.
7. **Root redirect** — `server.js` route `GET /` issues `302` to `/inspector` (temporary; see Decisions log). Locale-roots (`/en`/`/uk`/`/ru`) and legacy `.html` paths issue `301`.

**Acceptance criteria:**

- `ortbtools.com/` redirects 302 to `ortbtools.com/inspector` (locale-roots `/en`,`/uk`,`/ru` → 301)
- `ortbtools.com/inspector` loads the full existing inspector; all 715+ tests pass
- `ortbtools.com/live` renders a stub with Stage 2 copy
- Browser back/forward works across all 8 paths
- Side nav visible and correct at 1440px and 375px (drawer on mobile/tablet below 1024px)
- Topbar shows disabled search slot at all widths
- No regression on existing share-link, embed, download-bundle flows

**Risk (still relevant):** `public/ortbtools.app.js` remains a large central
hotspot and bootstraps multiple `window.*` facades. The mount/unmount lifecycle
needs care to avoid leaks when navigating away from `/inspector`; re-entrant
lifecycle tests are the safety net for any extraction.

**Files touched:**

- `public/modules/nav/` — new
- `public/modules/topbar/` — new
- `public/modules/router/` — new
- `public/ortbtools.app.js` — guard existing init behind `mountInspector()` route lifecycle
- `public/index.{en,uk,ru}.html` — strip per-page nav; add SPA shell scaffold
- `public/ortbtools-shell.css` — sidebar and topbar layout tokens
- `server.js` — `GET /` 302 → `/inspector` (locale-roots/legacy → 301); catch-all HTML route for pushState paths

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
- **`cached_specimens` SQLite table — already built** in `modules/stream/handler.js` (`initSpecimenStore`), documented here as-built so the remaining Stage-2 work builds on it rather than re-speccing it. Shape: `(hash TEXT PK, envelope_json TEXT, created_at INTEGER)` + a `created_at` index. Hash = `sha1(JSON.stringify(specimen)).slice(0, 8)`. Eviction is **FIFO at 10,000 rows** (drops the oldest ~10% by `created_at` once over cap) — **no `last_accessed` column and no TTL**. The cache is already served by `GET /api/v1/specimen/:hash`. _Remaining Stage-2 work:_ the user-facing `GET /r/:hash` route that hydrates a cached specimen into the inspector. (No route conflict — verified via grep of `server.js` + `modules/*/handler.js`; no existing route matches `/r/*` or `/r/:hash`.)
  - _Contract note:_ the earlier plan specced `sha256(...).slice(0,12)`, a `last_accessed` column, and a 90-day TTL. The shipped code chose `sha1[0:8]` / `created_at` / FIFO-10k instead. This doc was aligned **to the code** (2026-06-14): re-aligning the code would break already-cached `/api/v1/specimen/:hash` links and force a schema change, for a preview-only feature that gets no further 0.x build-out (Decision A). A stable 90-day permalink is therefore **not** currently guaranteed; revisit only if/when permalinks become a real product promise.

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
- `public/ortbtools.app.js` — `?specimen=` query param hydration path in `mountInspector()`

---

## Stage 3 — Blog (1–2 weeks)

Activates `/blog` and `/blog/:slug`.

**Editorial posts — `content/posts/{lang}/*.md`**

Frontmatter keys: `title`, `date` (ISO-8601), `category` (новини|розбори|гайди), `tags` (array), `lang` (uk|en|ru), `slug`. Same slug across locales: `content/posts/uk/ortb-3-zero-adoption.md` and `content/posts/en/ortb-3-zero-adoption.md` share the `slug` field. Rendered at request time via `marked` or `markdown-it` — consistent with the no-bundler project philosophy.

**Firehose posts — ClickHouse `analytics.blog_drafts` → `analytics.blog_posts`**

The Mozok news pipeline surfaces adtech articles daily. A subset should become ortbtools blog posts. Schema for `analytics.blog_drafts`: `(id UUID, title String, url String, summary String, category String, lang String, created_at DateTime64, approved_at Nullable(DateTime64), approved_by Nullable(String), slug Nullable(String), status Enum8('pending'=1, 'published'=2, 'promoted'=3))`.

Admin page `/admin/blog` (auth-gated): lists unapproved candidates; two actions per draft:

- **Approve + publish to DB** (default, faster, auto-refreshable, no git): draft moves from `analytics.blog_drafts` → `analytics.blog_posts` (published table), served from DB. Status set to `published`.
- **Approve + promote to markdown** (for evergreen / lasting content): writes `{lang}/{slug}.md` under `CONTENT_DIR` from the draft; marks CH row as `promoted` (kept as audit trail). Default UI choice = DB publish; markdown promotion is opt-in per post. **Since v1.1.5** (immutable image) `CONTENT_DIR=/data/content-posts` is a persistent volume, so promoted posts survive container recreate and are **no longer** committed to git — the old `git add && git commit` hint is gone.

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

**Later status:** shipped. The implemented surface reads derived validation
analytics through `modules/analytics` and the account Insights API. The
original `analytics.intel_llm_calls` design below was retired with the local
model bridge.

Self-validation analytics surface. The section answers: what does MY pipeline
look like across the last N sessions — format mix, version mix, top-N findings,
dialect distribution, behavior-probe hit rate.

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
   - **Business framing**: `BUSINESS_DOMAIN_FORMAT`, `BUSINESS_EMPTY_DOMAIN`, `BUSINESS_ADOMAIN_REQUIRED` (they aggregate adomain/cid/crid under a "Business" category; we scatter these across response._ and crosscheck.bid._)

   We retain wide leadership on `behavior.*` (17), `crosscheck.*` (28), `feed.*` (30), `vast.*` (20), `inpage-push.*` (9) — openrtb.ovh has zero overlap with any of these. Closing the 19-item gap brings us to parity on baseline + keeps our differentiators.

2. **Version-aware rule gating** — some rules fire on payload versions where they should be silent. Tracked in `packages/core/rules-request.js` and `rules-response.js`. Needs a `version` argument threaded into each rule function and per-rule `appliesTo` declarations. Gated on a real false-positive complaint caused by this gap.

3. **`@ortbtools/core` npm publish** — package metadata and pack-smoke tooling
   exist, but no registry release has succeeded. Publication is now a deliberate
   release/identity decision, not an implementation prerequisite.

4. **`@ortbtools/cli`** — implemented and tested at `0.1.1`; registry
   publication remains pending with Core. Its actual flags are documented in
   `packages/cli/README.md`.

5. **Seven pop-vendor dialects** — reactive only (policy in `feedback_ortbtools_iab_dialects.md`). The `cu-pops-audit-2026-05-12.md` listed all 7 as CRITICAL; the audit's own calibration note recalibrated severity as inflated. The gap is real but each dialect is gated on receiving a real sample from a partner integration. **(v0.52.0 update:** the detection layer is now user-dialect-mapping-aware + shape-based, so a pop vendor's signal can be mapped to `pop` via a saved user dialect with no core change. A full core dialect file is therefore needed only for vendor-specific _rule overlays_, not for format recognition.)

6. **AdCOM 1.0 deep validation** — **SHIPPED (v0.54.0), proactive 3.0-readiness**: validates request context, regs (GDPR/COPPA/CCPA/GPP), distribution channel (site/app/**DOOH**), AdCOM placements (display/video/audio/native — video creative subtypes via `ctype`, not 2.x `protocols`), and response media/creative incl. recursive VAST, in `rules-request-30.js` / `rules-response-30.js`. **NB: this overrides the original "gated on real 3.0 traffic — do not start" deferral.** Production 3.0 adoption is still ~zero, so this is spec-validated future-proofing (cross-checked against AdCOM 1.0), NOT live-traffic-validated. User-approved override 2026-05-25; risk is low since the 3.0 path only fires on 3.0 payloads.

7. **Real-traffic ingest** — gated on employer legal clearance. Unknown timeline. The anonymisation architecture (ring buffer in `modules/stream/`) is ready for this path when/if clearance arrives.

8. **i18n debt** — the ~30 hardcoded Cyrillic strings flagged in `docs/tech-debt-2026-05-04.md` are **resolved**. `public/ortbtools.app.js` contains 9 Cyrillic lines, all in code comments, not in UI copy. The i18n.js registry plus per-module i18n files cover all UI strings. No open debt here.

9. **`ortbtools.app.js` modularisation** — still a hotspot despite section and
   service extraction. Future work should remove cohesive responsibilities with
   re-entrant lifecycle tests rather than chase a line-count target.

10. **Cache-bust automation** — **SHIPPED.** `rewriteAssetVersions()` versions
    module JS/CSS with content hashes at serve time.

11. **Health endpoint metadata** — **SHIPPED.** `/api/health` includes build
    metadata and integration readiness, including `sentry.ready`.

12. **Quality Score 0–100** — **SHIPPED (live 2026-05-26 reality-audit).** The `.quality-pill` renders a 0–100 score with tiered status (excellent/good/needs-attention/critical) in the summary strip; `computeQualityScore()` in `ortbtools.app.js`. Competitor research 2026-05-23: openrtb.ovh shows a `Score: 100/100` pill at the top of every validation. Single-number quality summary is more digestible for non-developers than raw finding counts. Formula candidate: `max(0, 100 - errors*20 - warnings*5 - info*1)`, clamped. Renders as a pill badge alongside the existing severity counters. ~1-2 days in `public/ortbtools.app.js` validation render + `packages/core/findings.js` aggregator.

13. **Request Analysis summary strip** — **SHIPPED (live 2026-05-26 reality-audit).** The `.analysis-strip` renders `ВЕРСІЯ · ТРАФІК · ПРИСТРІЙ · ПРИВАТНІСТЬ · ЦІНА · ЯКІСТЬ` blocks above the tabs. Competitor parity: openrtb.ovh shows a structured metadata strip above findings: `OpenRTB Version · Traffic Type · Device Category · Privacy Signals · Ad Formats`. We have format-chips today but not the structured strip with device/privacy/traffic. Strip lives in inspector section between editors and Inspector/Validation/Crosscheck/Behavior tabs. ~1 day in `public/ortbtools.app.js` `renderSummaryStrip()` + small helpers in `packages/core/`.

14. **Severity tabs in findings panel** — **SHIPPED (`88065f3`, 2026-05-24; confirmed live 2026-05-26).** `renderSeverityTabs()` provides `All / Errors / Warnings / Info` chips with counters and empty states. Optional future polish: `aria-pressed`, delayed-render abort guard, regression tests — not a greenfield build.

15. **Test Cases public gallery (Stage 1 expansion)** — **SHIPPED (live 2026-05-26 reality-audit).** `/library` renders a public catalog (IAB fixtures / clean baselines / attack patterns) with Open-in-inspector + Copy JSON per card, via `GET /api/v1/sample/list`; authenticated users get their own saved metadata in a separate tab and unlock bid bodies encrypted by the current web flow. Competitor parity: openrtb.ovh `/testcases` is a public-facing catalog of curated valid/invalid samples with copy + download. Their best SEO + onboarding surface. We have ~25 synthetic specimens hidden in the `приклад` dropdown. Promote them to `/library` Stage 1 as a public catalog (no auth required) sectioned as: Valid Cases (banner / video / native / pop / 3.0 / inpage-push) vs Invalid Cases (attack patterns, malformed shapes). Each card: title, description, Valid|Invalid badge, Copy, Download. This expands the original Stage 1 scope.

16. **shadcn-style design tokens migration** — competitor research 2026-05-23: openrtb.ovh ships clean shadcn/ui aesthetics on Tailwind. We can match the look without adopting Tailwind/React. Refactor `public/ortbtools-shell.css` design tokens from our ad-hoc set (`--accent`, `--text`, `--bg`, `--border`, etc.) to shadcn-semantic structure: `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--border`, `--input`, `--destructive`, `--destructive-foreground`, plus single `--radius` with derived `calc(var(--radius) - 2px)` rhythm. Add severity colour tokens (`--error`, `--warning`, `--info`, `--success`) using Tailwind defaults. System-font stack confirmed clean. ~1-2 days mechanical migration with `git grep` of token usages across `public/`. Bundled naturally with Stage 0 shell refactor — fresh CSS surface is cheaper than retrofitting later.

17. **Global Search (Stage 5+ unlock)** — unified full-text search across blog posts, finding IDs + descriptions, dialect names, doc pages. Backend: ClickHouse full-text indexes on `analytics.blog_posts` (TokenBF for blog body, NGRAM for slugs/tags) + a new `analytics.findings_catalog` mirror of `packages/core/spec-refs.json`. Frontend: `/search?q=...` route + topbar input that hits `GET /api/search?q=`. Gated on blog (Stage 3) and insights (Stage 5) shipping — there's nothing meaningful to search before that. ~3-5 days. ClickHouse chosen over MeiliSearch to avoid adding a new container.

---

18. **Chrome-level auth modal (popup on any page)** — **SHIPPED (v1.3.0, 2026-07-01).** `OrtbtoolsSession` is now a shell-level service ([`public/core/session.js`](./public/core/session.js)) installed once by [`public/shell-boot.js`](./public/shell-boot.js) alongside nav/topbar — auth, DEK, and the canonical `/api/auth/me` boot live for the whole page lifecycle, independent of which section is mounted. A compatibility facade (`window.OrtbtoolsSession`, `__shellOwned`) preserves the existing consumer surface; inspector-specific state (sample/dirty/partner + DOM renderers) registers via a generation-safe adapter on mount and unregisters on teardown without clearing the shell session. The auth/unlock/recovery/password-reset modals share a single chrome-level [`public/core/modal-host.js`](./public/core/modal-host.js) owner: `#modalRoot` is declared once in `index.{en,uk,ru}.html` (sibling of `#app-root`), so sign-in from `/docs`, `/library`, or `/live` opens the modal **in place** with zero route change. Crypto/session invariants: the raw DEK is not exposed through the public facade or sent to the server; the service can export it internally to `sessionStorage` for tab persistence. Passwords are never cached, logout wipes memory + `sessionStorage`, stale `/api/auth/me` responses are gen-guarded, and Inspector unmount does not destroy the shell session. Regression coverage: [`tests/session-hoist.test.js`](./tests/session-hoist.test.js). Original problem (for history): the auth modal depended on the inspector closure-scoped `OrtbtoolsSession`, so sign-in from any other section had to SPA-navigate through `/inspector?auth=login` first.

19. **Inspector re-entrant mount (un-block inspector SPA navigation)** — **SHIPPED (v1.2.5, 2026-07-01).** `mountInspector()` is now idempotent and re-entrant: every `window`/`document` listener plus both `setInterval` watchdogs are scoped to `ctx.signal` / `ctx.addCleanup` (LIFO teardown on unmount), layout init is recomputable, and the in-flight `analyze` + all secondary read/mutation/boot paths guard on `ctx.signal.aborted` so a torn-down mount can never paint/toast into its successor. The **2026-05-26 mitigation was removed** — `shell-boot.js` `activateFromUrl()` no longer forces a full page load when navigating _to_ the inspector (or `/r/{hash}`); the flagship section now mounts in place via SPA like every other section (verified: Live↔Inspector round-trips and back/forward stay SPA, single document load, no freeze). Regression coverage: `tests/inspector-reentrant.test.js` (re-entrant lifecycle + static guards). Original problem (for history): classic scripts boot once per page, so SPA-remounting the inspector from another section corrupted its workbench layout and could freeze the renderer. Paired naturally with item 9 (modularisation) and item 18 (OrtbtoolsSession hoist).

20. **Module/chrome CSS cache-bust.** — **SHIPPED (2026-05-26).** `rewriteAssetVersions()` now versions bare `'/modules/**/*.css'` string literals in served JS via `MODULE_CSS_STR_RE` (one regex, JS-pass only) — covers every module `css:` field _and_ chrome `loadStylesheet()` call. Verified live: `library.css?v=…`, `docs.css?v=…`, `nav/nav.css?v=…`. (stream still carries its earlier `__STREAM_BUNDLE_HASH__` token — harmless, the regex skips strings that already have `?v=`.) — Original problem: section `mod.css` (8 modules) and chrome `loadStylesheet()` calls (nav/topbar/stub) load CSS as runtime `<link>` hrefs built from `'/modules/x/x.css'` string literals — which the import/`<link>`-tag version-rewrite passes don't see. They ship **unversioned**, so after an edit the browser/CDN serves stale CSS (max-age) and the change doesn't reach users without a hard reload. This is what made the stream-layout bug (see below / fixed 2026-05-26) appear to "need a hard reload". **Mitigated for stream** via a `__STREAM_BUNDLE_HASH__` token on its `css` field. Proper fix: extend `rewriteAssetVersions()` to version `'/modules/**/*.css'` string literals in served JS (one regex — covers all module `css` fields _and_ chrome `loadStylesheet()` calls at once), or add the bundle-hash token to every module's `css` field. The regex approach is centralised and future-proof. Also worth scrubbing other `#app-root { … }` bare rules in module CSS for the same cross-section bleed class of bug (stream was the only offender found, now scoped to `#app-root.stream-view`).

21. **Flaky test: `verifyToken: tampered signature is rejected`** (`tests/tokens.test.js`). Passes 3/3 in isolation but fails intermittently (~1 in 4) under the full parallel `npm run ci` run — likely a timing/resource race or a random-token edge under load, not a real regression. Occasionally blocks pre-push (a re-push clears it). Fix: make the token/signature fixtures deterministic (seed or hard-code the tampered bytes) and/or de-couple the crypto timing from parallel load. Low priority. Spotted 2026-05-26.

## Decisions log (2026-05-23)

- **Multi-section site with wide grouped sidebar.** The inspector was hitting a single-screen ceiling. A proper navigation shell makes each capability discoverable without crowding the paste surface. 8 sections, 3 groups (РОБОТА / ДАНІ / ЗНАННЯ).
- **pushState over hash routing.** SEO canonical URLs matter for the blog and docs sections. Hash routing rejected.
- **Stream is Stage 2, not the landing.** The 2026-05-05 stream-platform-pivot doc proposed making the stream the default landing and demoting the inspector to `/playground`. That framing is superseded. Stream is a sibling section; inspector remains default.
- **Hybrid blog stack (current implementation).** Repository posts seed the image;
  promoted Markdown is written to persistent `/data/content-posts`, not committed
  to git. Firehose drafts live in ClickHouse. The deterministic/OpenRouter
  moderator auto-publishes qualified localized drafts under its daily cap;
  `/admin/blog` remains the manual publish/promote/reject fallback.
- **Pop-vendor dialects remain reactive.** The cu-pops-audit listed 7 missing dialects as CRITICAL — the audit's own calibration note recalibrated severity as inflated. Policy unchanged: one real sample from a partner integration → one dialect.
- **Canonical redirect status codes (revised 2026-05-26).** Locale-roots and `.html`/legacy canonicalisations (`/en`, `/uk`, `/ru`, `/playground`, `/stream.html`, `/en/about`…) → **301** (permanent — stable canonical targets, consolidates SEO signals). Root `/` and `/index.html` → **302** (temporary, on purpose): a 301 would be browser-cached and pin returning visitors to `/inspector` even after a future marketing/dashboard landing reclaims `/`. Implemented via a `route.status` override in `server.js` `resolveLocaleRoute()` on top of the redirect handler's 301 default. Supersedes the original Stage 0 "root → 301" plan, whose own rationale ("keep `/` free for a landing") was incompatible with a cached 301.
- **Mobile breakpoint is `<1024px` (drawer mode).** Tablets (768-1023px) get the drawer because the inspector dual-panel (request|response) needs the horizontal space. Desktop (≥1024px): sidebar always visible.
- **Global search: disabled slot Stage 0, full build Stage 5+.** Topbar shows a disabled `🔎 пошук — скоро` slot from day one for consistent visual chrome. Full unified search via ClickHouse full-text indexes (TokenBF / NGRAM) after blog (Stage 3) ships and there is content worth indexing. ClickHouse chosen over MeiliSearch — no new container.
- **`/r/{hash}` route is free.** Verified via grep of `server.js` + `modules/*/handler.js`: no existing route matches `/r/*` or `/r/:hash`. Safe to register in Stage 2.
- **Blog approval is hybrid: DB publish (default) + opt-in persistent Markdown
  promotion.** Manual `/admin/blog` approval can publish into
  `analytics.blog_posts` or promote to `${CONTENT_DIR}/{lang}/{slug}.md` (production:
  `/data/content-posts`). Promotion does not create a git commit; ClickHouse keeps
  the draft audit status.
- **Inspector-first is the product — Decision A (2026-06-11, user-confirmed).** Closes the primary-surface question open since 2026-05-12. ortbtools IS the paste-JSON inspector/validator — web UI + `@ortbtools/cli` + `/api/analyze`. The stream stays a sibling section on synthetic traffic, now explicitly labeled "Live (preview)" in the nav; it is not the headline and gets no further build-out in 0.x. Everything shipped since May already voted this way: the SEO landings target the validator, the CLI is the validator, the growth positioning is validator + CLI + try-sample. Stream-first remains the v10.0 vector, gated on partner legal approval for real-traffic ingest. Path to declaring v1.0.0: `docs/api-v1.md` public contract (shipped with this decision) → friction sweep → declare; the "Not a v1.0.0 stability declaration" line below stands only until those gates close.
- **Automated firehose moderation (original decision 2026-05-25; engine
  superseded 2026-07-22).** `lib/news-moderator.js` still runs after crawl and
  retains the daily cap plus manual `/admin/blog` fallback. Relevance is now
  deterministic in `lib/intel-rules.js`; the retired Ollama scorer is not part
  of runtime. OpenRouter remains isolated to translation/categorization.

---

## What this roadmap is NOT

- Not a commitment to npm publish timeline — gated on API stability.
- Not a commitment to legal-cleared real traffic ingest — timeline unknown.
- Not a commitment to any specific pop-vendor dialect — reactive to corpus, not proactive by market share.
- Not a SaaS pricing or auth-gated feature plan — all current inspector functionality stays free and anonymous.
- ~~Not a v1.0.0 stability declaration — project stays 0.x until the multi-section shell is stable and settled.~~ **Superseded 2026-06-11: v1.0.0 DECLARED** — Decision A committed, `docs/api-v1.md` contract pinned, friction sweep done (legacy `/stream` page retired → 301 `/live`, stub module removed). The multi-section shell has been stable since Stage 0 shipped; the 0.x caveat served its purpose.

---

## Reality audit: reconciled status (2026-05-23)

Cross-check of claims in `docs/tech-debt-2026-05-04.md`, `docs/functional-audit-2026-05-12.md`, `docs/cu-pops-audit-2026-05-12.md`, and the old ROADMAP against HEAD code.

| Old claim                                    | Audit doc                        | Status at HEAD     | Evidence                                                                                                                    |
| -------------------------------------------- | -------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` not bind-mounted (CRITICAL)  | tech-debt-2026-05-04             | **SUPERSEDED**     | Immutable image bakes all source; `/data` is the only runtime mount                                                         |
| SQLite backup missing (CRITICAL)             | tech-debt-2026-05-04             | **RESOLVED**       | `scripts/backup-db.sh`, cron 03:30                                                                                          |
| GlitchTip not integrated                     | ROADMAP Phase 8                  | **CODE COMPLETE**  | Sentry-compatible code is configuration-gated; verified production baseline reports `sentry.ready:false`                    |
| Pino not in package.json                     | tech-debt-2026-05-04             | **RESOLVED**       | `lib/logger.js` uses `require('pino')`                                                                                      |
| Strictness levels not wired to API           | ROADMAP Phase 2                  | **RESOLVED**       | `packages/core/index.js` `applyStrictness()`; documented in `packages/core/README.md` line 67                               |
| `@ortbtools/core` private:true               | ROADMAP Phase 4                  | **PARTIALLY DONE** | `private` field removed; `publishConfig.access:"public"` set; actual `npm publish` not done                                 |
| ~30 hardcoded Cyrillic strings               | next-chapters-2026-05-09         | **RESOLVED**       | `wc -l` grep: 9 Cyrillic lines in `ortbtools.app.js`, all in comments                                                       |
| `ortbtools.app.js` 4505 lines                | functional-audit-2026-05-12      | **STALE**          | Still a central hotspot; use current `wc -l` rather than preserving another count                                           |
| Stream endpoint missing                      | ROADMAP Phase 8                  | **RESOLVED**       | `modules/stream/handler.js`; SPA section is registered at `/live` in `public/shell-boot.js`                                 |
| Replay endpoint missing                      | next-chapters-2026-05-09         | **RESOLVED**       | `modules/replay/handler.js`, `POST /api/v1/replay`                                                                          |
| Confusion matrix missing                     | next-chapters-2026-05-09         | **RESOLVED**       | `modules/corpus/handler.js` `GET /api/behavior/corpus/matrix`                                                               |
| "All 7 pop-vendor dialects missing"          | cu-pops-audit-2026-05-12         | **CONFIRMED**      | `packages/core/dialects/` has only `ext-rtb.js`, `iab.js`, `inpage-push.js`                                                 |
| AdCOM 1.0 deep validation missing            | functional-audit-2026-05-12      | **PARTIALLY DONE** | Deep 3.x rules exist in `rules-request-30.js` / `rules-response-30.js`; coverage is not exhaustive AdCOM schema conformance |
| Phase 5 public/private domain split REJECTED | old ROADMAP                      | **OBSOLETE**       | Decision logged; single domain confirmed; domain is now ortbtools.com                                                       |
| stream-platform-pivot as landing strategy    | stream-platform-pivot-2026-05-05 | **SUPERSEDED**     | Stream is Stage 2 of multi-section, not landing pivot                                                                       |
