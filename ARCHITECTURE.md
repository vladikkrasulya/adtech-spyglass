# ortbtools — Architecture

OpenRTB inspector and validator. Paste a `BidRequest`/`BidResponse` JSON, get human-readable explanations of every issue, semantic crosscheck between request and response, creative preview, and a saved-sample library per partner.

This page gives a compact current-state view, followed by the original target
design for historical context. The detailed, file-level dependency source of
truth is [docs/ARCHMAP.md](./docs/ARCHMAP.md); current work order lives in
[ROADMAP.md](./ROADMAP.md).

---

## 0. Current state (2026-08-11)

- **Surfaces:** the localized vanilla-JS SPA exposes Inspector, Live/Stream,
  Behavior, Library, Dialects, Blog, Docs and Insights. Account is a separately
  served localized page. The shell owns navigation, session and modal
  lifecycle; SPA section modules mount lazily and clean up listeners through
  their lifecycle contract.
- **Server:** a vanilla Node `node:http` process uses `lib/router.js` and
  handler modules under `modules/`. It serves the SPA, authenticated APIs,
  analysis, replay/mirror/stream, blog, analytics and optional integrations.
- **Core:** `@ortbtools/core` `0.31.0` supplies deterministic type, version and
  format detection, rule-based validation, request/response crosscheck,
  behavior analysis and knowledge helpers. The hosted web app invokes it via
  `POST /api/analyze`; validation does not run in the browser.
- **CLI:** `@ortbtools/cli` `0.1.1` wraps Core for offline terminal use. Core
  and CLI are repository workspaces and are not currently published to npm.
- **Data:** SQLite stores accounts, saved samples, plaintext account metadata
  and operational state. The current web flow AES-GCM encrypts sample bodies in
  the browser, but the API does not enforce ciphertext; raw `/api/analyze`
  bodies are processed transiently and not persisted server-side.
  ClickHouse receives derived analytics and sampled request metadata.
- **Intelligence boundary:** interactive `/api/intel/*` features and news
  relevance use deterministic `lib/intel-rules.js`. OpenRouter is isolated to
  news translation/categorization; it is not on an interactive bid-analysis
  path.
- **Operations:** production uses immutable exact-SHA Docker images with one
  `/data` mount, readiness and public smoke gates, and automatic rollback.
  Sentry is configuration-gated and reports readiness through `/api/health`;
  the last verified production baseline had `sentry.ready:false` and used
  Telegram for alerts.

See [docs/OPERATIONS.md](./docs/OPERATIONS.md) for the runbook and
[docs/PRIVACY.md](./docs/PRIVACY.md) for the code-verified data-flow contract.

## Historical target/design record

Sections 1–9 below preserve the original design that guided the build. They
are not an inventory of the current runtime. When they conflict with section 0
or ARCHMAP, the current-state documents win.

---

## 1. Vision and positioning

**Problem.** Ad-tech engineers debugging RTB bids today have walled-garden tools (Xandr Console, Magnite RP Console, GAM Inspect Creative) tied to a single seat, dead npm packages stuck on OpenRTB 2.3, and JSON Schema validators that emit `instancePath: /imp/0/banner/format/1/h is required`. There is no "Postman for OpenRTB" — no tool you paste a bid into and get a sentence telling you what's wrong, why it's wrong, and how to fix it.

**ortbtools fills that gap.** Three distinguishing capabilities:

1. **Human-readable, localized errors with fix hints.** "Banner slot 2 has no height — OpenRTB 2.6 §3.2.10 requires `h` when using `format[]` with absolute pixels. Add `h: 250` or use the `wmin/wmax/hmin/hmax` ranges." In Ukrainian, Russian, English.
2. **Strict IAB OpenRTB 2.6 + errata** as the source of truth, with **per-partner dialect overlays** layered on top — never as the default. Auto-detect the OpenRTB version from payload signals.
3. **Semantic crosscheck** beyond schema: `bid.impid` ↔ `imp.id` resolution, `price` vs `bidfloor`, `bcat`/`badv`/`battr` enforcement, Native asset-id back-reference, VAST detection in `bid.adm`, auction summary.

**Positioning** (validated by competitive research):

- **Free public demo** — paste-and-validate, no auth, no storage. Showcase tier. Drives organic discovery.
- **Authenticated workspace** — saved samples per partner, history, dialects, team features. Behind login.
- **Open-source validator core** (`@ortbtools/core` workspace; npm publication
  is still pending) — solves the trust gap and replaces the dead
  `openrtb-validator` package.
- **Niche wedge:** CIS/EE push and pop SSPs first — localization plus dialect overlays = no competition. Then mainstream programmatic.

---

## 2. Architectural layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Surfaces                                                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ public demo  │  │ auth'd workspace │  │ CLI / CI         │   │
│  │ (static)     │  │ (Node + SQLite)  │  │ local CLI workspace│  │
│  └──────────────┘  └──────────────────┘  └──────────────────┘   │
│         │                  │                       │             │
│         └──────────┬───────┴───────────────────────┘             │
│                    │                                             │
│  ┌─────────────────▼──────────────────┐                          │
│  │ @ortbtools/core (validator engine)  │  ← main APIs: no network │
│  │   - detectVersion(payload)         │     server-side + CI/CLI │
│  │   - validate(payload, opts)        │     repository workspace │
│  │   - crosscheck(req, res)           │                          │
│  │   - dialects: iab | ext-rtb | …    │                          │
│  │   - stable IDs + localized msg     │     KB loader: Node-only │
│  └─────────────────┬──────────────────┘                          │
│                    │                                             │
│  ┌─────────────────▼──────────────────┐                          │
│  │ web + core locale registries       │  ← current implementation│
│  │   public/i18n.js                   │     module registries     │
│  │   core/messages/{uk,en,ru}.json    │     localized findings   │
│  └────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

> **Deployment note:** on ortbtools.com both anonymous and authenticated
> Inspector use validates **server-side**. The browser POSTs the payload to
> `POST /api/analyze` and renders the returned findings. Core runs in-process
> in the Node server, the offline CLI and tests; its package and CLI workspaces
> are not currently published to npm.

**Why this split:** the validator workspace is the shared engine used by the
server, CLI, and CI:

- the public demo validates **server-side** — the browser POSTs the bid JSON to `/api/analyze` over HTTPS and renders the findings the server returns (it is **not** validated locally in the browser); the bodies are processed transiently and never stored
- the auth'd backend reuses the same engine for `/api/analyze`
- the local CLI wraps it for CI pipelines
  (`node packages/cli/bin/ortbtools.js validate req.json`)
- a future browser extension would need its own explicitly tested browser build;
  the current package contract is Node/CommonJS and the optional knowledge-base
  loader is Node-only

---

## 3. Validator core (`@ortbtools/core`)

### 3.1 API shape

```js
const { validate, detectVersion, crosscheck, listDialects } = require('@ortbtools/core');

const detection = detectVersion(payload);
//   → { version: '2.6', confidence: 1, signals: ['regs.gpp', 'imp[].rwdd'] }

const result = validate(payload, {
  expectedVersion: '2.6', // optional target bucket: 2.5 | 2.6 | 3.0
  dialect: 'iab', // iab | ext-rtb | inpage-push
  strictness: 'normal', // 'lax' | 'normal' | 'pedantic'
  locale: 'uk', // uk | en | ru
});
//   → {
//       type: 'oRTB BidRequest',
//       version: { version: '2.6', confidence: 1, signals: [...] },
//       status: 'invalid' | 'errors' | 'warnings' | 'clean',
//       findings: [
//         {
//           id: 'imp.banner.size_required',
//           level: 'error' | 'warning' | 'info' | 'question',
//           path: 'imp[0].banner',
//           params: { idx: 0 },
//           specRef: 'https://github.com/.../2.6.md#3210-object-banner', // or null
//           msg: 'Localized human-readable finding',
//         },
//         …
//       ],
//     }

const cross = crosscheck(bidReq, bidRes, { locale: 'uk' });
```

### 3.2 Findings model — four validator levels

| Level      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `error`    | Spec violation that an exchange will reject. Fail the bid.          |
| `warning`  | Spec violation tolerated by most exchanges. Reduces fill / quality. |
| `info`     | Best-practice or recommendation. Optional improvement.              |
| `question` | Non-blocking ambiguity that may need a user/vendor decision.        |

Crosscheck results use their own `ok` / `warn` / `crit` scale. Findings carry
stable, structured `id`s and `params`; the current Core also
decorates them with a localized `msg`. Web chrome strings live in
`public/i18n.js` and per-module registries, while validator messages live in
`packages/core/messages/{en,uk,ru}.json`.

### 3.3 Version detection

Pasted JSON has no HTTP headers, so `X-Openrtb-Version` is unavailable.
`detectVersion()` uses field-presence signals and returns only the `2.5`, `2.6`,
`3.0`, or `unknown` buckets:

| Bucket    | Signals (subset)                                                                  | Confidence |
| --------- | --------------------------------------------------------------------------------- | ---------- |
| `3.0`     | top-level `openrtb` object or `item[]`                                            | 1          |
| `2.6`     | `imp[].rwdd`, `device.sua`, `regs.gpp`, `*.cattax`, `video.plcmt`, `bid[].mtype`… | 1          |
| `2.5`     | `source`, `bseat`, `wlang`, `imp[].metric`, `banner.vcm`, `bid[].burl`…           | 0.7        |
| `2.5`     | object with no recognized version marker (low-confidence default)                 | 0.3        |
| `unknown` | non-object input                                                                  | 0          |

Dated OpenRTB 2.6 revisions are grouped into the `2.6` bucket; per-revision
detection and rule gating are not implemented.

**OpenRTB 3.x has deep rule coverage, not exhaustive schema conformance.** The
engine validates the envelope and core request/response context, privacy,
placement, media, creative and embedded VAST fields; additional AdCOM fields
may remain unchecked.

### 3.4 Strictness levels

The OpenRTB spec is full of "should" and "recommended". Treating those as errors makes ortbtools annoying to bidder devs.

- `lax` — errors only.
- `normal` — errors, warnings, and non-blocking questions.
- `pedantic` — all findings, including informational recommendations; this is
  the compatibility default.

### 3.5 Dialect overlays

Each dialect overlays the IAB base. Most rules are additive, but a dialect may
claim a custom bid shape and suppress an incompatible base rule; for example,
`inpage-push` suppresses `response.bid.payload_missing` when creative fields live
under `bid.ext`. A dialect file can declare:

- additional fields it expects (e.g. `imp.ext.subage`, `imp.ext.bsection`, `imp.ext.btags`, `site.ext.idzone`)
- field-presence rules conditional on shape (e.g. "if `site.ext.idzone` matches `/push|sub/i`, treat as push and require `subage`")
- known-supported macros / unsupported macros (e.g. only `${AUCTION_PRICE/CURRENCY/LOSS}` substituted by some vendors)
- specific recommended values

Built-in dialects ship in `packages/core/dialects/*.js` and are registered in
`packages/core/index.js`. New dialects must be added to that registry as well as
implemented in their own file.

Beyond findings, a loaded **user dialect also feeds format detection**: its saved signal mappings let `scanExtForFormatHints` recognise vendor-coded formats (e.g. a numeric pop `ad_type`) with no core change. See §3.7.

### 3.6 Spec deep-links

IAB findings carry a `specRef` when a maintained mapping exists. Vendor,
behavior and meta findings may return `null`:

```
https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#3210-object-banner
```

Mappings live in `packages/core/spec-refs.json` and are tested alongside rule
IDs. The IAB does **not publish official JSON Schemas**; ortbtools implements
maintained rules from the published specifications.

### 3.7 Non-IAB format detection (pop family)

Pop / popunder / clickunder are not canonical OpenRTB — there is no `imp.pop` field in any version. Vendors signal them through extensions, so detection (`non-iab-formats.js` → `scanExtForFormatHints`, consumed by `format-detect.js` and the `pop-request` / `pop-response` rule plugins) draws on three sources, first-seen-wins per format:

1. **User-dialect mappings (dynamic).** When a payload is validated with a loaded user dialect, each `ext` key is resolved via `userDialect.lookupMapping(signalPath, value)` — `imp[].ext.<key>` for per-imp ext, `ext.<key>` otherwise. A mapping whose `semantic_label` is a recognised non-standard format registers as that hint. This is how a pop vendor that signals with a numeric code (e.g. `ext.ad_type = 40`) is onboarded **without hardcoding the vendor's value in core** — the mapping lives in the user's saved dialect (§3.5). `detectFormat(payload, userDialect)` threads the dialect through; the analyze handler passes the session's default dialect.
2. **Canonical string + flag hints.** `ext.adtype = "popunder"` and boolean flag keys (`ext.popunder = 1`, etc.).
3. **Shape heuristics (no dialect required).** The same vendor-shape signals the suggestion engine (`analyzeShape`, `dialects/shape-fingerprint.js`) scores — `allowMT` / `allowLayer` / `allowShock` / `viewOnClick` / `directLink` flags and `sizeID:[0]` — are treated as `pop` hints directly, so format-detect and the pop rules stay aligned with the suggestion engine.

**Response side.** `pop-response` also honours `ctx.req`: if the paired bid request was a pop slot, the response is validated as pop traffic even when a bid carries no ext hint of its own (pop bids commonly ship just a redirect `adm`). `ctx.req` is supplied by `validate(payload, { pairReq })`.

**Pop request rules** assert IAB-correct invariants on a detected pop slot: `imp.pop.battr_popup_blocked` (WARNING — `imp.banner.battr` blocks creative attribute 8 / Pop, AdCOM Creative Attributes / IAB List 5.3, contradicting the pop intent) and `imp.pop.instl_conflict` (WARNING — `imp.instl = 1`, an in-page full-screen interstitial, contradicts a separate-window pop). The earlier `btype:[4]` nudge was removed as a `btype`-vs-`battr` conflation (btype 4 = iframe).

---

## 4. Frontend (web surface)

### 4.1 Stack

Vanilla JS + design-system CSS — no React/Vue. Current code is already this shape; no reason to adopt a framework for what is fundamentally a JSON inspector with one main view. State is minimal (current sample, validation result, locale, theme, partner filter).

### 4.2 Theme system

Light + dark themes via CSS custom properties bound to `:root[data-theme="…"]`. Existing `--bg`, `--surface`, `--text`, `--accent` tokens get dark counterparts. A theme toggle in the header writes `localStorage.theme` and updates `document.documentElement.dataset.theme`. On first load, `prefers-color-scheme` decides default. **Two themes is the cap** — we don't ship an "auto" pseudo-mode that complicates the picker; OS preference becomes the load-time default.

### 4.3 i18n

English, Ukrainian and Russian ship together. Web chrome uses `public/i18n.js`,
per-module registries and locale-specific HTML templates. Core finding messages
live in `packages/core/messages/{en,uk,ru}.json`; stable IDs and params make the
localized output testable across surfaces.

### 4.4 Editor and preview

- Two textareas (request, response) with live JSON-validity badge — current behavior.
- Future: monaco-editor or codemirror for syntax highlighting + folding (consider after MVP — adds 200KB).
- Creative preview pane: VAST (XML render) / Native (mocked card from assets) / HTML banner (sandboxed iframe with `allow-scripts` only, CSP `script-src 'unsafe-inline'`).
- `bid.adm` extraction: handle string-escaped Native JSON, raw VAST XML, banner HTML — current heuristics stay.

### 4.5 Saved samples (auth'd surface only)

Library panel with partner filter (`all` / `unassigned` / specific partner). Click loads into editor; edit/delete inline; save current via header button. Public demo hides this panel entirely.

---

## 5. Backend (auth'd workspace)

### 5.1 Stack

Vanilla Node `node:http` with the custom `lib/router.js` dispatcher. SQLite via
`better-sqlite3` stores accounts, saved samples, plaintext account metadata and
operational state. Authentication uses bcrypt and server-side sessions.

### 5.2 Routes

The route table is deliberately not duplicated here. Backend handlers under
`modules/*/handler.js` export their route definitions and `server.js` registers
them with `lib/router.js`. Locale-aware SPA paths are owned by
`lib/locale-routes.js`. See ARCHMAP for the handler-to-route map and inspect a
module's exported `routes` array before changing an endpoint.

### 5.3 Storage

`db.js` owns SQLite schema v10 and atomic `PRAGMA user_version` migrations for
users, sessions, partners, saved samples, analyze history, behavior corpus and
user dialect data. ClickHouse-backed services keep derived analytics and
blog/news records outside SQLite. Column-level truth belongs in migrations and
queries, not in a duplicated architecture table.

### 5.4 Privacy posture

- Bid JSON is potentially sensitive (deal IDs, user IDs, supply paths). The
  public demo POSTs pasted bids over HTTPS to `/api/analyze`, validates them
  **server-side**, and does not persist the bodies server-side (derived metadata
  and sampled request metadata including IP are retained). The browser keeps up
  to 50 raw recent entries in `localStorage`. The current web save path encrypts
  request/response bodies before upload, while sample notes, partner profiles,
  dialect mappings, and other account metadata remain server-readable; direct
  API clients are not forced to encrypt.
- No analytics SDK that captures input fields.
- `Content-Security-Policy` disallows third-party script and frame sources.
- Creative previews iframe-sandboxed.

---

## 6. Deploy and offline modes

### 6.1 Hosted application

- One immutable Node image serves the localized SPA and APIs on
  `ortbtools.com`.
- Source, workspace packages and public assets are baked into an exact-SHA
  image; `/data` is the only runtime mount.
- `BUILD_SHA`, OCI labels, readiness, public smoke and automatic rollback are
  release gates. See [docs/OPERATIONS.md](./docs/OPERATIONS.md).

### 6.2 Self-hosted

- `docker-compose.yml` uses the same application image and environment-based
  integration configuration.
- Operators must provide their own persistent `/data` path, secrets, network
  attachments and backup destination.

### 6.3 CLI workspace

- `node packages/cli/bin/ortbtools.js validate req.json` runs locally after a
  workspace install and makes no network calls.
- It wraps `@ortbtools/core`. Exit code `0` means the selected threshold was
  not reached, `1` means findings reached it, and `2` is reserved for CLI
  usage/input errors.
- Registry installation instructions remain disabled until the first npm
  publication is verified.

---

## 7. Data model — findings (`@ortbtools/core` output)

```ts
type Finding = {
  id: string; // 'imp.banner.size_required' — stable, namespaced
  level: 'error' | 'warning' | 'info' | 'question' | 'crit' | 'warn' | 'ok';
  path: string; // JSON pointer-ish: 'imp[0].banner'
  params: Record<string, unknown>;
  specRef: string | null;
  msg: string; // localized presentation copy
  ok?: boolean; // crosscheck findings
  detail?: object;
};

type ValidationResult = {
  type: string;
  version: { version: '2.5' | '2.6' | '3.0' | 'unknown'; confidence: number; signals: string[] };
  status: 'clean' | 'warnings' | 'errors' | 'invalid';
  findings: Finding[];
  urlRequest?: object; // present for recognized URL-style input
};
```

The actual Core finding contract includes stable IDs and params plus a
localized `msg`; `specRef` is nullable for vendor, behavior and meta findings.
Consumers should key automation on `id`, `level` and `path`, not translated
copy.

---

## 8. Decisions and remaining questions

- **License:** Core and CLI are MIT.
- **3.x coverage:** deep request/response rules are implemented for core OpenRTB
  and AdCOM structures, but they are not exhaustive AdCOM schema conformance.
- **Hosted backend:** the public Inspector uses the existing Node backend; a
  browser-only validation split is not planned.
- **Auth provider** for multi-user: keep bcrypt sessions for v1, evaluate Auth.js / Clerk / Lucia later.
- **Mock / fixture generation** as a feature (generate a valid `BidRequest` matching given constraints). Post-MVP. Strong magnet for organic discovery if it works well.

---

## 9. What we deliberately do NOT do

- **Render VAST video in-page.** Embed/iframe IAB's VAST validator instead. Reinventing it is years of work for marginal value.
- **Decode TCF / GPP consent strings.** Surface presence and validity-pattern, defer string decoding to dedicated tools. Maybe later.
- **Real bid simulation against live exchanges.** ortbtools is an inspector, not a load tester or auction simulator.
- **Adapter SDK / bidder framework.** Prebid Server already exists and dominates. Stay in our lane.
- **Historical / time-series analytics on saved bids.** Possible future, but not core mission.
