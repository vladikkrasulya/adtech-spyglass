# Spyglass — Architectural Map

**Purpose**: living dependency map. Read this BEFORE touching any subsystem.
For each entry: where it lives, who uses it, who depends on it, deploy chain,
related tests, known gotchas. Update in the same commit as any change that
shifts a connection.

> **Never trust this doc 100%** — verify with grep. But if a grep result
> contradicts the map, fix the map.

Last touched: 2026-05-13 (post the UX-polish wave v0.42.1 → v0.42.10
that closed the 2026-05-12 GPT-5.5 vision audit; modularization
state unchanged from 2026-05-10).

## 0.1 What changed 2026-05-10 → 2026-05-13

Frontend module count + folder layout are unchanged. The wave was
pure CSS/HTML/JS-inside-existing-modules polish + one IA refactor:

- **`public/account.js`** — `bindScrollSpy()` replaced by
  `bindSectionRouting()`. Cabinet is now Gmail-style: only the
  active `.cab-section` renders (others get the `hidden` attr).
  URL hash drives state via `pushState`/`popstate`. Inner anchors
  like `<a href="#privacy">` resolve to the ancestor `.cab-section`
  via `closest()` and scroll the inner element into view.
- **`public/account.{en,uk,ru}.html`** — added missing `#dialects`
  sidebar nav row (was 7/8 — Dialects section existed but had no
  nav). Added `.cab-nav::after` sticky fade gradient on mobile so
  clipped tabs don't read as broken layout.
- **`public/spyglass.app.js`** — `updateFormatBar()` now paints
  status pill with icon + finding count; `paintFooterDialect()`
  reflects active dialect in footer state-chip;
  `?auth=login|signup` URL handler routes to the auth modal in
  the right mode (signup → register internally).
- **`public/modules/inspector/inspector.css`** — added
  `.format-pill-status { order: -1 }` to hoist the verdict pill,
  expanded `@media (max-width: 720px)` to also wrap toolbar at
  720-900px, dark-theme tab severity hand-off via `:has()`,
  end-of-file mobile letter-spacing block behind a SOURCE-ORDER
  ANCHOR comment.
- **`/srv/DATA/Stacks/kyivtech-portal/public/design-system.css`**
  (shared, bind-mounted into Spyglass) — added `--bg-elev` and
  `--bg-elev-2` token declarations that the cabinet referenced
  via `var()` but were never declared (both themes fell back to
  transparent → cabinet cards lost elevation). Dark `--text-dim`
  bumped `#8A8478` → `#9B968C` to match light theme perceived
  contrast.
- **`public/modules/auth/index.js` + `public/modules/auth/i18n.js`**
  — modal now has `auth.subtitle` line + footer pattern of
  `[cancel] [primary]` right-aligned (switch-mode demoted to a
  centered link above).
- **`public/i18n.js`** — added `status.error_one` /
  `status.warning_one` × 3 locales for grammatically correct
  count-of-1 status pill. Rewrote `toast.signin_to_save` to
  mention encryption + fixed UA from formal "Увійдіть" → informal
  "Увійди".

Two operationally-relevant traps surfaced + got memory entries
(reference these before debugging "why doesn't my change apply"):

- **File-level bind-mount inode trap** — `Edit`/`Write` atomically
  rewrites → new host inode → container holds old. Fix:
  `docker compose restart`. Hit twice (v0.42.5, v0.42.8) when
  editing the shared `design-system.css`. Single-file bind-mounts
  only — directory mounts (like `./public:/app/public`) are fine.
- **CSS source-order trap with mobile @media** — early
  `@media (max-width: 720px) { .foo {x: A} }` + later
  unconditional `.foo {x: B}` → desktop wins on mobile via
  source-order at equal specificity. Two fixes: wrap desktop in
  `@media (min-width: 721px)`, or anchor mobile rule at end of
  file behind a comment. Hit twice in v0.42.9.

---

## 0. Module layout (the big picture as of 2026-05-10)

```
modules/                      backend handler folders (require'd by server.js)
├── account/ admin/ analyze/  one file each: handler.js exporting either a plain
│   auth/ corpus/ health/      `{id, routes}` or a `createXxxModule(deps)` factory
│   intel/ mirror/ partners/   that returns the same shape. Routes registered with
│   proxy/ replay/ sample/     lib/router.js at boot.
│   samples/ stream/
│
lib/
├── router.js                  pattern-based dispatcher (exact / `:id` / trailing-*)
├── http.js                    readJson, sendJson, sendError, makeError
├── replay.js                  DI'd bulk-pipeline engine (consumed by modules/replay)
└── corpus-matrix.js           confusion matrix runner (consumed by modules/corpus)

public/modules/                frontend tool folders (loaded eager via <script>
├── share/ embed/ shortcuts/   in shell, or lazy via `await import()` from the
├── mirror/ live/ simulate/    dispatcher in public/spyglass.app.js)
│   corpus-save/ partners/     each folder has index.js + i18n.js + README.md.
│   auth/ unlock/ recovery/    Crypto goes through window.SpyglassSession facade
│   password-reset/            so DEK never leaves the spyglass.app.js closure.
│   save-sample/ edit-sample/
├── inspector/                 workbench template + mount lifecycle
├── intel/ behavior/           pre-modularization split (banner/builder/observer/…)
└── README.md                  module contract: folder layout, lifecycle, comms

server.js                      ~868 LOC shell. Reads top-level deps, builds the
                                Router, registers all 14 backend modules, runs the
                                static-file fallback, owns the auth + crypto
                                closure that backend modules access via DI.

public/spyglass.app.js         ~4467 LOC inspector shell. Dispatcher routes
                                `data-action="..."` clicks to module lazy stubs.
                                window.SpyglassSession exposes encryptBlob /
                                decryptBlob / bootstrap / openFromPassword
                                without leaking the DEK bytes.
```

**Rule of thumb when fixing a bug**:

1. Front-end UI broken → look in `public/modules/<tool>/` first.
2. Back-end API broken → look in `modules/<tool>/handler.js` first.
3. Both → start from the front-end module; back-end route name is right
   there in the `fetch(...)` call.
4. Auth or crypto → `server.js` IIFE owns `_sessionDEK` + auth lifecycle.
   `window.SpyglassSession` facade is the docs.

---

## 1. Validator core (`packages/core/`)

### 1.1 The graph

```
detect.js ──┐
            ├──> rules-request.js ──┐
helpers.js ─┤    rules-response.js ─┼──> findings.js ──> index.js ──┐
            └──> rules-feed.js ─────┘                                ├──> consumers
                 crosscheck.js ─────────────────────────────────────┤
                 format-detect.js ──────────────────────────────────┤
                 categories.js ─────────────────────────────────────┤
                 behavior/ (analyze + rules/) ──────────────────────┤
                 knowledge-base.js, knowledge_base/data/* ──────────┘
```

**Public API** (`packages/core/index.js`):

- `validate(payload, opts?)` — schema validation per type/dialect/version
- `crosscheck(req, res, opts?)` — semantic comparison
- `mirror(input, opts?)` _(since 0.15.0)_ — generate canonical counterpart of a paste; output is self-tested through `validate` + `crosscheck`, fail/pass counts in `result.selfTest`
- `detectType` / `detectVersion` / `detectFormat`
- `listDialects` / `listLocales`
- `decodeCategory` / `decodeCategories` / `extractAllCategories`
- Re-exports: `TYPES`, `VERSIONS`, `FORMATS`, `CONTEXTS`, `PROTOCOLS`, `LEVELS`, `CROSS_LEVELS`, `nativeAssetCrosscheck`

**Subpath exports** (per `packages/core/package.json` "exports" field):

- `@kyivtech/spyglass-core` → main API
- `@kyivtech/spyglass-core/behavior` → `behavior/index.js` (event-stream analyzer + static creative scan)
- `@kyivtech/spyglass-core/intel` → LLM-bridge primitives (used by `intel-llm.js`)
- `@kyivtech/spyglass-core/knowledge-base` → KB query helpers

### 1.2 Public contract guarantees (since core 0.11.0)

`validate()` and `crosscheck()` outputs are deterministic:

- Order: severity DESC → path ASC → id ASC. Errors first, then warnings, then info. `crit`≡`error`, `warn`≡`warning`, `ok` last.
- Dedup: `(id, path)` pairs collapse; merged finding gets `params.dedupCount` (≥2 only). Uses `dedupCount`, not `count`, to avoid colliding with domain `count` (e.g. `crosscheck.bid.native_complete`).
- `disabledRules: string[]` — exact ids OR trailing-`*` prefixes.

### 1.3 Format detection — VAST sniff & validation

**Canonical sniff helpers** (since core 0.12.0): `isVastShape(s)` and
`detectVastVersion(s)` exported by `packages/core/format-detect.js`.
Anchored regex (`^\s*(<\?xml|<VAST)`); HTML mentioning `<VAST` deep inside
does NOT false-positive.

| File                                                    | Lines              | Sniff     | Used for                                             | Status                                                                                                     |
| ------------------------------------------------------- | ------------------ | --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`format-detect.js`](../packages/core/format-detect.js) | helper exports     | canonical | format-detect itself + rules-vast.js                 | ✅ canonical                                                                                               |
| [`rules-vast.js`](../packages/core/rules-vast.js)       | imports helpers    | reuses    | 8 VAST validation rules                              | ✅ canonical                                                                                               |
| [`crosscheck.js`](../packages/core/crosscheck.js#L258)  | 258 (inline regex) | local     | emits `crosscheck.bid.video_vast` / `video_not_vast` | ⚠ deferred consolidation — works, has tests, separate refactor when there's a reason                       |
| [`spyglass.app.js`](../public/spyglass.app.js#L816)     | 816 (inline regex) | local     | UI-side preview branching                            | ⚠ same; the UI already loads the bundled core, could switch to `SpyglassCore.isVastShape` in a future pass |

**Rule for new code**: import `isVastShape` / `detectVastVersion` from
`format-detect.js`. Don't write a 4th sniff regex.

### 1.3.0 oRTB 3.0 routing (since 0.13.0; response since 0.14.0)

- Detection (`detect.js`): presence of `openrtb` object (any shape, even
  broken `ver=""`) OR top-level `item[]` classifies the payload as 3.0
  with confidence 1. Envelope discrimination: `openrtb.response{}` →
  ORTB_RESPONSE, else → ORTB_REQUEST.
- Routing (`index.js validate()`): version-dispatch on both sides:
  V_3_0 + ORTB_REQUEST → `validateRequest30()`,
  V_3_0 + ORTB_RESPONSE → `validateResponse30()`.
  Same `disabledRules` / `dialect` / `locale` opts.
- Request rules (`rules-request-30.js`): 12 — 7 envelope-level, 4
  per-item, 1 always-fire INFO.
- Response rules (`rules-response-30.js`): 16 — envelope (4), response
  body (4 incl. `no_bid` INFO), per-seatbid + per-bid (5 incl.
  `bid.item_required` since 3.0 uses `bid.item` instead of 2.x
  `bid.impid`), plus `deep_validation_limited` INFO.
- Test surface: `tests/ortb30.test.js` (~36 cases).
- AdCOM 1.0 placement validation (item.spec.placement, bid.media,
  AdCOM creative specs) NOT covered. The always-fire INFO
  `*.30.deep_validation_limited` tells users so they aren't surprised
  by a thin findings list.

### 1.3.1 VAST validation surface (since 0.12.0; expanded 0.14.0)

- **12 rules** in `packages/core/rules-vast.js`, fired from
  `rules-response.js` per bid (when `isVastShape(adm)` is true)
- Envelope rules (8): `vast.version_missing` (ERR),
  `version_unknown` (WARN), `inline_or_wrapper_required` (ERR),
  `adsystem_missing` (ERR — InLine), `adtitle_missing` (ERR — InLine),
  `mediafile_missing` (ERR — InLine), `wrapper_no_tag_uri` (ERR —
  Wrapper), `insecure_url` (WARN; carries `count` + `sampleUrl`)
- Quality rules added in 0.14.0 (4): `vast.ad_pod` (INFO — multiple
  `<Ad>` = sequential ad-pod, count param), `linear_duration_missing`
  (ERR — `<Linear>` without `<Duration>`),
  `vpaid_deprecated` (WARN — `apiFramework="VPAID"`),
  `impression_tracking_missing` (WARN — InLine without `<Impression>`)
- 4 synthetic samples in `samples/`: `synthetic-vast-clean-inline`,
  `synthetic-vast-broken-inline`, `synthetic-vast-insecure-wrapper`,
  `synthetic-vast-vpaid-deprecated`
- ~34 tests in `tests/vast.test.js`
- UI dropdown: "VAST (video)" section, 4 buttons per locale
- The pre-existing crosscheck rules `video_vast` / `video_not_vast` (about
  format-vs-slot match) are independent and untouched. They check whether
  a video imp got a VAST adm; rules-vast.js checks whether the VAST itself
  is well-formed. Both can fire on the same bid.
- **Sniffer consolidation (since 0.14.0)**: `crosscheck.js` now imports
  `isVastShape` from `format-detect.js` instead of inline regex. Browser
  `public/spyglass.app.js` regex aligned but still inline (browser
  doesn't have direct access to bundled core helpers; future
  `window.SpyglassCore` exposure would let us drop the duplication).

### 1.3.2 Mirror generator (since 0.15.0; modes + diff added 0.16.0)

- `packages/core/mirror.js` — rule-based generator that turns the
  validator inside-out. Same rule knowledge as `rules-request.js` /
  `rules-response.js` / `crosscheck.js`, used in reverse: instead of
  flagging missing fields, fill them with canonical defaults.
- Public entry: `mirror(input, opts)` in `index.js`. Wrapper runs the
  raw generator output through `validate()` (counterpart shape) and
  `crosscheck(req, res)` (semantic alignment). Returns rolled-up
  `{ validate.{errorCount,warningCount}, crosscheck.{critCount,warnCount,okCount} }`
  in `result.selfTest`. **Contract**: a successful mirror must produce
  output with `errorCount === 0` and `critCount === 0`. Drift here is
  a generator bug, not a user bug — surface it.
- Per-decision `notes[]` carry stable ids (`mirror.note.*`) decorated
  with localized `msg`. Three locales as usual.
- 2.5/2.6 only in v0; 3.0 envelope returns
  `mirror.note.ortb_30_not_supported` instead of half-baked output.
  AdCOM-aware 3.0 mirror is a follow-up tied to Chapter C of
  `next-chapters-2026-05-09.md`.
- **Modes** (since 0.16.0): `opts.mode` ∈ `{'minimal', 'best-practice'}`.
  Default `'minimal'` = required-only fields. `'best-practice'` runs
  additive enrichers that add recommended IAB fields (response: crid /
  cid / cattax / lurl / nurl / ext.dsa / bidid / seat. request:
  source.ext.schain / regs.coppa / regs.ext.gdpr / user.ext.consent /
  device.sua). Enrichers never overwrite a minimal-set field.
- HTTP: `POST /api/v1/mirror`, body `{ input, mode? }`. Reuses the
  analyze rate-limiter (60/min/IP) — generation is on the same
  human-paste cadence so sharing the bucket keeps fuzz protection
  coherent.
- UI: button + modal in inspector (3 locales). When both `bidReq` and
  `bidRes` are filled the modal also renders a top-level JSON diff
  between the user's counterpart and the canonical mirror output
  (≠ / + / − markers, colour-coded). "Load into the other editor"
  wires the generated result into the empty textarea.

### 1.3.3 Live stream UI (since 0.27.0)

- **SSE endpoint** `/api/v1/stream` — synthetic RTB specimens emitted at
  ~1Hz from `samples/synthetic-generator.js`. Existed since Stream
  Pivot foundation; UI shipped 0.27.0.
- **Modal frontend** in `public/spyglass.app.js` (`window.openLiveModal`).
  EventSource connect on open, captured envelopes rendered as
  newest-on-top rows; cap of 50 (matches server replay window).
  Pause/resume gates DOM appends without dropping the connection.
- **Specimen storage**: rows store `data-row-id="N"` only; the spec
  itself lives in a JS `Map<id, specimen>` keyed by row seq. Reason:
  `core/utils.escapeHtml` uses text-node serialisation which doesn't
  escape `"` — putting JSON in an attribute would close on the first
  internal quote. The dispatcher's `live-load` case resolves id →
  spec from the map. Map cleared on cap-trim and on tearDownLive.
- **Cleanup**: closeModal is patched on open, restored on teardown.
  Any close path (Esc / backdrop / button / follow-up modal) tears
  down the EventSource and clears the map. `__spyglassLivePauseToggle`
  / `__spyglassLiveSpecimens` are nulled afterwards so there's no
  reference to the closed stream.

### 1.3.4 Finding-detail expand panel (since 0.28.0)

- Each finding rendered by the validation tab is wrapped in a native
  `<details class="finding-detail">`. Summary mirrors the original
  one-line row (icon + msg + path button + spec link); body is lazy-
  rendered on first open via a toggle-event listener at capture.
- Body shows: JSON path · user's value at path · severity meaning
  (error/warning/info → consequence copy) · spec URL · canonical
  rule id.
- **Path resolution**: `window.__spyglassLast` stashes the parsed
  `req` and `res`. `getJsonAtPath(obj, path)` walks paths like
  `imp[0].banner.w` or `seatbid[0].bid[1].price`. Returns
  `undefined` for absent paths (which is the legit case for
  `*_required` rules — UI surfaces a "field absent" message).
- **Outside-click closer scope**: tightened to
  `.kt-example-menu[open], .kt-lang-menu[open]` so opening a finding
  detail doesn't get auto-closed by clicking elsewhere on the page.

### 1.3.5 Behavior corpus (since 0.29.0; Chapter B v0)

- **Schema v7** adds `behavior_corpus(id, user_id, label, events_json,
source_sample_id, notes, created_at)`. CHECK constraint on label;
  FK CASCADE on user; indexes on user_id / label / created_at DESC.
  `events_json` capped 1 MB; `notes` capped 4 kB.
- **Model** `BehaviorCorpus` in `db.js`: `create / listForUser /
getById / countsForUser / destroy`. Listing is metadata-only
  (event_count via `json_array_length`, event_bytes via `length()`).
  Full events_json fetched only via getById (matrix runner consumer).
- **API** at `/api/behavior/corpus` (auth-required, per-user):
  POST creates · GET lists with `?label=` filter + counts · GET /:id
  full row · DELETE /:id scoped destroy.
- **Capture UI** lives in inspector behavior tab. `injectCorpusBar`
  prepends a green strip when there are events AND user is authed.
  Modal collects label (legitimate / fraud / ambiguous) + notes.
- **Cabinet card** in `/account` (3 locales) shows totals + entry
  list with delete. Refreshes via `window.refreshCorpus()` after
  delete without full re-init.
- **Consumer (deferred)**: confusion-matrix runner that replays
  corpus entries through all 16 detection patterns (12 runtime +
  4 static creative scan) and reports
  precision/recall per id. Schema + listing in place; runner is the
  next Chapter B sprint.

### 1.3.6 Confusion-matrix runner (since 0.30.0; Chapter B v1)

- **Module** `lib/corpus-matrix.js` — pure DI: takes `{BehaviorCorpus,
analyzeBehavior}` as deps, returns `{totals, patterns[]}`.
  Independent of DB / HTTP, fully tested in isolation.
- **Math**: for each pattern emitted by `behavior.analyze` over corpus
  events, count TP/FP/FN/TN against fraud/legitimate labels. Ambiguous
  excluded. Within-entry dedup so a noisy rule firing 3× in one entry
  counts as 1 TP, not 3.
- **HTTP**: `GET /api/behavior/corpus/matrix` (auth-required) calls
  the runner with the user's corpus. On-demand; no caching.
- **UI** lives in `/account` cabinet under the corpus card. Rows
  colour-graded by precision, sorted by F1 desc. Refresh button
  re-fetches without full init.
- **Limit**: listForUser caps at 500 entries. Larger corpora would
  need pagination + caching keyed on max(corpus.created_at).

### 1.3.7 Specimen replay endpoint (since 0.33.0; Chapter A foundation)

- **Module** `lib/replay.js` — pure DI, takes
  `{validate, crosscheck, analyzeBehavior}` as deps. Returns
  `{results, summary}`. Independent of DB / HTTP, testable in isolation.
- **HTTP**: `POST /api/v1/replay` accepts `{samples: [...]}`. Public
  endpoint, no auth (matches /api/analyze). Hard cap 100 samples
  per call server-side.
- **Per-sample envelope**: `{bidReq?, bidRes?, behaviorEvents?, adm?,
label?}`. Empty samples skip with `reason: 'empty_sample'`.
- **Status rollup**: worst across validate / crosscheck CRIT / behavior
  errors. Severity rank: invalid > errors > warnings > clean.
- **Summary**: total / accepted / skipped, statusCounts histogram,
  totalFindings (errors/warnings/info/crits), topFindings (top-K
  most frequent finding ids), locale + dialect echo.
- **Use cases**: CI test fixtures, archive replay (Stream Pivot
  consumer), partner audit batches, regression grading.

### 1.3.8 Exact finding→source navigation (CP2–CP3.2; core 0.30.0 / app 1.2.0)

Clicking a validation finding or a crosscheck highlights the exact key/value in
the user's pasted JSON, in the correct pane. The whole chain is **additive** —
legacy finding fields and validation/crosscheck output are unchanged.

- **Canonical source-map** — [`packages/core/source-map.js`](../packages/core/source-map.js):
  dependency-free JSON parser; `buildSourceMap(text)` resolves an RFC-6901
  pointer to an exact character range (`key` / `value` / `node`), `positionAt`
  gives line/column. Pure + isomorphic.
- **Generated browser copy** — [`public/core/source-map.js`](../public/core/source-map.js):
  a byte-for-byte copy shipped to the page (the engine is otherwise NOT bundled
  into the browser — see 1.4).
- **Generator + parity guard** — [`scripts/gen-browser-core.js`](../scripts/gen-browser-core.js)
  regenerates the browser copy; [`tests/browser-core-parity.test.js`](../tests/browser-core-parity.test.js)
  fails the build if the two diverge (SHA-256 byte parity). `--check` is a CI gate.
- **Location contract** — [`packages/core/finding-location.js`](../packages/core/finding-location.js)
  builds the additive `finding.location` (`buildNormalLocation` /
  `buildCrosscheckLocation` / `attachLocations`);
  [`modules/analyze/handler.js`](../modules/analyze/handler.js) attaches it to
  findings + crosschecks at analyze time. Pane **side comes only from the
  validation call context** — no id/path regex side-guessing.
- **Browser navigation** — [`public/modules/inspector/source-nav.js`](../public/modules/inspector/source-nav.js)
  (`window.SpyglassSourceNav`): resolves the pointer against the live pane text,
  paints exact / container / related overlays, prev/next + Alt+↑/↓ with
  wrap-around.
  [`source-nav.i18n.js`](../public/modules/inspector/source-nav.i18n.js) registers
  EN/UK/RU strings (standard queue-or-direct).
- **Rendering / integration** — [`public/spyglass.app.js`](../public/spyglass.app.js):
  findings and crosscheck paths render the **`data-loc` / `goto-path`** contract;
  the click dispatcher calls `SourceNav.navigate(JSON.parse(el.dataset.loc))`;
  `SourceNav.onAnalyzed(findings ∪ crosschecks)` arms the toolbar;
  `SourceNav.resetNavigation()` runs at the start of every analyze. Request ↔
  response related highlights.
- **Lifecycle** — a per-instance `AbortController` owns every listener; a
  lifecycle-owned `ResizeObserver` re-aligns the overlay on geometry change and
  is `disconnect()`-ed on teardown; editing a pane invalidates the analyzed
  revision (stale → highlight torn down); inspector unmount calls `teardown()`.
  Idempotent across SPA remounts (no listener stacking).
- **Security / privacy** — the location contract carries only
  `side / pointer / display / target / precision / role / dialect` — **no payload
  values**. The overlay inserts payload text only through
  `document.createTextNode` (the only built element is `<mark>` — never
  `innerHTML`). Navigation makes **no** additional network calls, beacons, or
  storage writes; no telemetry.
- **Size policy** — ≤1 MB panes build the source-map eagerly at analyze; 1–2 MB
  build a lazy full index on first jump; >2 MB is disabled (honest no-jump).
- **Tests** — [`source-map`](../tests/source-map.test.js),
  [`finding-location`](../tests/finding-location.test.js) +
  [`corpus`](../tests/finding-location-corpus.test.js),
  [`analyze-location-api`](../tests/analyze-location-api.test.js),
  [`browser-core-parity`](../tests/browser-core-parity.test.js),
  [`source-nav`](../tests/source-nav.test.js) (jsdom),
  [`source-nav-i18n`](../tests/source-nav-i18n.test.js).

### 1.4 Consumers

| Consumer                        | File                                                              | What it uses                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server.js` (Spyglass HTTP API) | top of [server.js:50-52](../server.js#L50)                        | full `validate` / `crosscheck` + `behavior.analyze` + `knowledge-base`                                                                                                   |
| Browser (validator card)        | [`public/spyglass.app.js`](../public/spyglass.app.js)             | POSTs the payload to `POST /api/analyze` — validation runs **server-side** (core is NOT bundled into the page; the browser only renders the findings the server returns) |
| Browser (behavior tab)          | [`public/modules/behavior/index.js`](../public/modules/behavior/) | `behavior` subpath — server-side proxy, but UI consumes findings                                                                                                         |
| Tests                           | `tests/{validator,dialects,format-detect,behavior,intel}.test.js` | every public surface                                                                                                                                                     |
| `intel-llm.js`                  | [intel-llm.js](../intel-llm.js)                                   | uses LLM-bridge primitives from `core/intel`                                                                                                                             |

### 1.5 Tests by surface (so changes know where to look)

| Touching...              | Run these                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findings.js`            | `tests/api-stability.test.js` + `tests/validator.test.js` (snapshots)                                                                                                        |
| `rules-request.js`       | `tests/validator.test.js` (~50 cases) + `tests/dialects.test.js`                                                                                                             |
| `rules-response.js`      | `tests/validator.test.js`                                                                                                                                                    |
| `crosscheck.js`          | `tests/validator.test.js` (crosscheck section, ~40 cases)                                                                                                                    |
| `format-detect.js`       | `tests/format-detect.test.js` (~30 cases)                                                                                                                                    |
| `behavior/`              | `tests/behavior.test.js`                                                                                                                                                     |
| `mirror.js`              | `tests/mirror.test.js` (21 cases — both directions, banner/video/native/no-bid/round-trip + best-practice mode)                                                              |
| `BehaviorCorpus` (db.js) | `tests/db.test.js` (8 cases — create/list/scoping, label whitelist, counts, getById, destroy, FK cascade)                                                                    |
| `lib/corpus-matrix.js`   | `tests/corpus-matrix.test.js` (9 cases — perfect P+R, 50% precision, missed-fraud, ambiguous-skip, within-entry dedup, sort tiebreak, divbyzero, corrupt JSON, empty corpus) |
| `lib/replay.js`          | `tests/replay.test.js` (16 cases — input validation, pipeline routing, status rollup, severity counts, topFindings, maxSamples cap, label echo)                              |
| Any new message key      | manually check 3 locales (`messages/{en,uk,ru}.json`) — there's no test that enforces this; _yet_                                                                            |

**Total suite**: 469 tests (as of 2026-05-10 post-modularization). Run
`node --test tests/` from repo root, ~8s. The extra 13 cases (vs 456)
came in with `lib/router.js` (6) + later patches around the auth/intel
modules during the backend migration.

---

## 1.6 Blog / SEO / sitemap / news indexing flow (since app 1.2.2)

Two post sources, one indexing contract.

- **Sources.** Editorial = markdown at `CONTENT_DIR/<lang>/<slug>.md` (prod
  `CONTENT_DIR=/data/content-posts`, a persistent volume seeded from the repo's
  `content/posts/`). Firehose = `analytics.blog_posts` (ClickHouse), written by
  the AI auto-publisher `lib/news-moderator.js` ← `lib/news-crawler.js` (RSS
  ingest → `analytics.blog_drafts` → score/translate → publish). Firehose posts
  store `body == summary` (thin by construction).
- **Read/SEO layer (`lib/blog-service.js`).** `getPost()` is tri-state
  (`found` / `confirmed_absent` / `unavailable`) — absence comes ONLY from a
  fresh authoritative CH query, never a cached list. `listAllPublishedRefs()` =
  availability (markdown ∪ CH) for hreflang; `listIndexablePostRefs()` /
  `listIndexablePosts()` = approved-markdown-only for sitemap + RSS;
  `langsForSlug()` = existing-locale set. `isIndexable(post)` is the
  default-deny quality gate (markdown source + frontmatter `indexable: true` +
  real body + `body != summary` + word floor).
- **Emitter (`lib/seo.js`, pure/no-I/O).** `parseRoute` → `sectionSeo`/`postSeo`
  return canonical/hreflang/title/desc/OG + a `robots` field; `applySeoToHtml`
  rewrites them into the served shell (replaces the robots meta, never appends).
  `NOINDEX_SECTIONS = {/blog,/insights,/live}` keep a per-route canonical but emit
  `noindex,follow`. `renderSitemap()` is a flat `<loc>` list (no `xhtml:link`);
  hreflang is HTML-head only (single source). `EXTRA_SITEMAP_PATHS=['/about']`.
- **Serving (`server.js`).** `serveSitemap` (`/sitemap.xml`, intercepted before
  the static handler — the static `public/sitemap.xml` was removed in 1.2.2) →
  `renderSitemap(listIndexablePostRefs())`. Per-route HTML rewrite in
  `serveStaticFile`'s `text/html` branch: blog posts use the `getPost` tri-state
  (`confirmed_absent` → 404; `unavailable` → 200 noindex shell; `found` → SSR +
  per-`isIndexable` robots). `resolveLocaleRoute` blog-deep locale is
  `(en|uk|ru)` case-insensitive (in sync with `parseRoute`), so `/blog/<other>/…`
  → 404. Non-HTML static assets get `X-Robots-Tag: noindex`. `/blog/rss.xml` →
  `modules/blog/handler.js` (RSS = indexable-only; list/post = full corpus).
- **Gotchas.** Firehose posts are NEVER indexable (no persisted review-state yet)
  — `source==='db'` fails `isIndexable` first. Do not delete `SECTION_SEO` keys
  to drop a section from the sitemap (that re-introduces the homepage-canonical
  leak); use `NOINDEX_SECTIONS` + the `indexable`-skip in `renderSitemap`. The
  news pipeline is paused in prod via `NEWS_CRAWLER_DISABLED=1` (see OPERATIONS
  §4.9) — that gate is read at boot, so it needs a container recreate.

---

## 2. Deploy chain (the stuff that bites you)

### 2.1 What rebuilds vs what doesn't

**Since v1.1.5 (immutable image): EVERYTHING is baked.** There are no source
bind-mounts. `./public/`, `./packages/`, `./modules/`, `server.js`, `lib/`,
`intel-llm.js`, `./samples/`, and the `content/posts` seed all ship inside the
image. A `compose restart` no longer reloads any source — every change goes
through a rebuild+redeploy (`scripts/deploy.sh`, see docs/OPERATIONS.md §9).

The only mount left (since v1.1.6) is persistent data (`/data`, which now also
holds `content-posts/`). The design-system CSS is vendored into
`public/design-system.css` and **baked into the image** (`design-system.vendor.json`);
the transitional portal overlay was removed in v1.1.6, so the container is fully
self-contained with a single `/data` mount and no cross-project runtime dependency.

_Historical (pre-v1.1.5): `./public`, `./packages`, `./intel-llm.js` and
`./samples` were bind-mounted for live edit, while `server.js`/`lib/`/`modules/`
were baked — the asymmetry was a frequent "edit not visible" trap. The immutable
image removes the asymmetry entirely._

> If you edit ANY file, commit to `main` and redeploy
> (`./scripts/deploy.sh`). `compose restart` no longer picks up source — the
> image is immutable. The pre-push hook runs CI but doesn't rebuild.

### 2.2 Public exposure

```
Browser (https://spyglass.kyivtech.com.ua)
    │
    ▼  Cloudflare (DNS + edge)
    │
    ▼  CF Tunnel → 192.168.1.4
    │
    ▼  kyivtech-portal (host network) — proxies admin tiles
    │  PUBLIC_PROXIES=Set(['spyglass']) anon-allowed
    │  src/routes/admin/proxies.js, src/config.js (PROXY_TARGETS)
    │
    ▼  127.0.0.1:8090 → adtech-spyglass container :3000
```

**So**: any URL change in spyglass affects portal's proxy paths. Re-test BOTH `localhost:8090/...` (direct) AND `https://spyglass.kyivtech.com.ua/...` (full chain) after deploy.

### 2.3 Cross-stack dependencies of Spyglass

| Spyglass needs...            | From...               | How it connects                                                                                                                         |
| ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| LLM (intel)                  | `ollama` container    | shared docker network `ollama_default`, `OLLAMA_URL=http://ollama:11434`                                                                |
| Design system CSS            | vendored (build-time) | baked from `public/design-system.css` (`design-system.vendor.json`) — **no runtime mount / no kyivtech-portal dependency** since v1.1.6 |
| Persistent SQLite            | host fs               | `/srv/DATA/AppData/adtech-spyglass:/data`                                                                                               |
| Email (recovery key, verify) | Resend                | `RESEND_API_KEY` from `.env` (gitignored)                                                                                               |
| Health monitoring            | `uptime-kuma`         | HTTP probe of public URL                                                                                                                |

### 2.4 SemVer bump locations (9 files, do all in one commit)

Per `feedback_spyglass_semver_bump.md`:

1. `package.json` (root, app version)
2. `packages/core/package.json` (engine version)
3. `public/version.js` (browser-side `VERSION` constant)
   4-6. `public/about.{en,uk,ru}.html` (eyebrow + footer span × 2 each = 2 spots × 3 locales, but search is `v9.X.Y`)
   7-9. `public/modules/inspector/template.{en,uk,ru}.html` (topnav brand + footer #engineVer × 3 locales)

Use `version.js` for runtime paint via `data-spyglass-version`, but the static fallback strings in HTML still need to bump (browsers without JS see them, and bundle metadata in `export.js` reads `#engineVer.textContent`).

---

## 3. Surrounding stack pointers

### 3.1 Validator-aware components elsewhere

- **kyivtech-portal**:
  - `src/services/stats.js:96` — `Spyglass RTB` health tile
  - `src/routes/admin/proxies.js` — `PUBLIC_PROXIES = new Set(['spyglass'])` makes the tile anon-public
  - `src/routes/bot/index.js:49` — Telegram bot status command lists `adtech-spyglass`
- **uptime-kuma** monitor on `https://spyglass.kyivtech.com.ua`
- **n8n**: no direct integration today (Mozok bot doesn't call validator)

### 3.2 Schema / migration reminders for adjacent data

- `news` Postgres DB: `items` table — `hot_score` column DROPPED 2026-05-09 (was always 0). `hot_score_llm` (LLM 0..1) is the live signal. `news_schema.sql` is the source-of-truth doc.
- ClickHouse OLAP: `analytics.news_events` mirrors `items` minus `hot_score`. CH script: `/srv/DATA/Stacks/clickhouse/scripts/replicate-news.sh`.

---

## 4. "Things that broke last time" (chronological warnings)

| When                       | What                                                                                                       | Root cause                                                       | How to avoid                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 2026-05-09 sprint 1        | Pre-existing test broke after rule rename `response.seatbid_required` → `response.seatbid_or_nbr_required` | yesterday's P1 bundle renamed the rule, didn't update the test   | grep `tests/` for the OLD rule id BEFORE renaming                                 |
| 2026-05-09 sprint 1        | dedup `count` collided with `crosscheck.bid.native_complete` domain `count`                                | I assumed `count` was free                                       | grep messages for `{count}` BEFORE introducing a synthetic param of the same name |
| 2026-05-09 sprint 1        | `disabledRules` ignored by `/api/analyze` despite working in core                                          | `server.js` baked-in, not bind-mounted                           | always check whether the file is bind-mounted; baked = `--build`                  |
| 2026-05-09 sprint 2 (VAST) | `/api/v1/sample?type=vast-broken-inline` returned random sample                                            | `samples/` baked-in, new files invisible to running container    | rebuild after adding samples; future fix: bind-mount `samples/`                   |
| 2026-05-04                 | n8n `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` → Mozok 100% fail                                                  | env-access flag default changed; agent code couldn't read tokens | for any code-node that reads env, verify the flag                                 |

---

## 5. Time-estimate calibration

Estimates that ignore the connection-audit + regression-test + rollback verification phases are wrong by 1.5-2×. For Spyglass, multiply pure-coding estimates by 1.5 minimum, plus add:

- +0.5h connection-audit BEFORE (grep callers + tests + deploy chain)
- +0.5h SemVer bump + CHANGELOG + map update
- +1h regression test + smoke through public URL + rollback path

**Realistic floors** (revised from validator-roadmap-2026-05-09.md):

| Item                                                                            | Original est | Honest est     | Actual | Why                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------ | -------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ① API stability                                                                 | 3-4h         | 3-4h ✓         | ~2.5h  | done; small surface, accurate                                                                                                                 |
| ② Tier 1 + drop hot_score                                                       | 2h           | 2h ✓           | ~1h    | done; smaller than expected (column already had 0 non-zero rows)                                                                              |
| ③ VAST validation (minimal)                                                     | 1-2 days     | **2-3 days**   | ~3h    | done at REDUCED scope (8 rules vs 13). User chose minimal; defers VPAID/ad-pod/Linear duration/OMID.                                          |
| ④ oRTB 3.0 routing (request-only, minimal)                                      | 1 day        | **1.5-2 days** | ~2.5h  | done at REDUCED scope — request envelope + item shape only. Pre-flight cut the honest estimate.                                               |
| Functional close (v0.14.0): 4 VAST rules + 3.0 response + sniffer consolidation | 4-5h         | **4-5h**       | ~3h    | done; closes the deferrals from items ③ and ④. Only AdCOM 1.0 deep validation remains intentionally deferred (no production 3.0 traffic yet). |
