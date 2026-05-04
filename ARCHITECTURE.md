# Spyglass — Architecture

OpenRTB inspector and validator. Paste a `BidRequest`/`BidResponse` JSON, get human-readable explanations of every issue, semantic crosscheck between request and response, creative preview, and a saved-sample library per partner.

This document describes the **target architecture**. The current state has converged toward this target on most axes; what's still in flight is called out in the **Current State** section just below. Sequencing of remaining work lives in [ROADMAP.md](./ROADMAP.md) (with status markers per phase).

---

## 0. Current state (as of 2026-05-04)

A snapshot of what's actually live on `spyglass.kyivtech.com.ua`. Anything below differs from later sections — those describe target architecture, this section describes today.

**Live and working:**

- **Validator core in `packages/core/`** — extracted from `server.js`, used by both the Node server and (planned) the browser. Pure JS, no Node-only APIs. 209 unit tests pass. Phase 1 ✅, Phase 4 🟢 (npm publish pending).
- **3 locales** (`/`, `/uk/`, `/ru/`) with **seamless DOM-morph language switch** (no full reload, preserves analysis state). About pages parallel: `/about`, `/uk/about`, `/ru/about`. SEO via hreflang + sitemap.
- **Anonymous-first UX**: paste-and-validate works without login. Login is opt-in for the encrypted library (zero-knowledge AES-GCM-256, PBKDF2 600k, recovery key) + partner profiles.
- **JsonFeed validators** for non-RTB CIS adtech: Kadam push + clickunder, ExoClick `rtb.php`, RichAds, Zeropark.
- **AdKernel routing detection** as info-level finding (49+ alias networks share the same wire format).
- **Format-pill bar** in inspector — surfaces type / status / oRTB version / dialect at a glance.
- **Operations**: SQLite daily backup (cron, gzipped, 30-day rotation, restore drill verified), per-IP rate-limiting (60/min on analyze, 10/15min on login, 5/hour on register), HttpOnly+SameSite+Secure cookies, full `npm run ci` green (format/lint/typecheck/tests).

**Diverges from target (still on the roadmap):**

- ❌ **No public/private domain split** — Phase 5 was rejected 2026-05-04 (anonymous use already works, single domain is the simpler architecture; see decision log in ROADMAP.md). The "free public demo" tier in §1 below is therefore _the same domain_, with login as opt-in unlock.
- 🟢 **Validator strictness levels** (`lax`/`normal`/`pedantic`) and full version-aware rule gating (Phase 2) are partially shipped — `detectVersion()` works with confidence + signals, but most rules don't yet branch by version.
- 🟢 **`@spyglass/core` is extracted as a workspace** but **not yet npm-published** — held back until Phase 2 strict-mode work stabilises the public API.
- ⏹️ **`@spyglass/cli` (Phase 6)** not started.
- 🟢 **Phase 7 Pro features**: multi-user accounts ✅, encrypted library ✅, per-user history ✅. Per-partner default profiles, share read-only sample, mock generation, schema diff, browser extension — not started.
- ❌ **Operationalize gaps** (Phase 8 ⏸️ partial): error tracking (Sentry/GlitchTip), structured logging (Pino), build-SHA in `/api/health`, content-hashed cache-bust automation — all on the backlog.

For day-to-day status of what's done vs in-flight, see [ROADMAP.md](./ROADMAP.md).

---

## 1. Vision and positioning

**Problem.** Ad-tech engineers debugging RTB bids today have walled-garden tools (Xandr Console, Magnite RP Console, GAM Inspect Creative) tied to a single seat, dead npm packages stuck on OpenRTB 2.3, and JSON Schema validators that emit `instancePath: /imp/0/banner/format/1/h is required`. There is no "Postman for OpenRTB" — no tool you paste a bid into and get a sentence telling you what's wrong, why it's wrong, and how to fix it.

**Spyglass fills that gap.** Three distinguishing capabilities:

1. **Human-readable, localized errors with fix hints.** "Banner slot 2 has no height — OpenRTB 2.6 §3.2.10 requires `h` when using `format[]` with absolute pixels. Add `h: 250` or use the `wmin/wmax/hmin/hmax` ranges." In Ukrainian, Russian, English.
2. **Strict IAB OpenRTB 2.6 + errata** as the source of truth, with **per-partner dialect overlays** (Kadam, PropellerAds, Adsterra, MGID …) layered on top — never as the default. Auto-detect the OpenRTB version from payload signals.
3. **Semantic crosscheck** beyond schema: `bid.impid` ↔ `imp.id` resolution, `price` vs `bidfloor`, `bcat`/`badv`/`battr` enforcement, Native asset-id back-reference, VAST detection in `bid.adm`, auction summary.

**Positioning** (validated by competitive research):

- **Free public demo** — paste-and-validate, no auth, no storage. Showcase tier. Drives organic discovery.
- **Authenticated workspace** — saved samples per partner, history, dialects, team features. Behind login.
- **Open-source validator core** (`@spyglass/core` on npm) — solves the trust gap (engineers won't paste real bid traffic into a black box) and replaces the dead `openrtb-validator` package.
- **Niche wedge:** CIS/EE push and pop SSPs first (Kadam, PropellerAds, Adsterra, MGID, RTB House) — localization plus dialect overlays = no competition. Then mainstream programmatic.

---

## 2. Architectural layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Surfaces                                                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ public demo  │  │ auth'd workspace │  │ CLI / CI         │   │
│  │ (static)     │  │ (Node + SQLite)  │  │ npx @spyglass/cli│   │
│  └──────────────┘  └──────────────────┘  └──────────────────┘   │
│         │                  │                       │             │
│         └──────────┬───────┴───────────────────────┘             │
│                    │                                             │
│  ┌─────────────────▼──────────────────┐                          │
│  │ @spyglass/core (validator engine)  │  ← pure JS, no Node deps │
│  │   - detectVersion(payload)         │     runs in browser + CI │
│  │   - validate(payload, opts)        │     published to npm     │
│  │   - crosscheck(req, res)           │                          │
│  │   - dialects: iab | kadam | …      │                          │
│  │   - findings + spec refs           │                          │
│  │   - i18n string keys (no copy)     │                          │
│  └─────────────────┬──────────────────┘                          │
│                    │                                             │
│  ┌─────────────────▼──────────────────┐                          │
│  │ @spyglass/i18n                     │  ← string registry       │
│  │   /locales/{uk,en,ru}.json         │     ICU MessageFormat    │
│  │   keyed by stable IDs              │     loaded on demand     │
│  └────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

**Why this split:** the validator core is the thing every surface consumes. Putting it in a single browser-+-Node module means:

- the public demo runs validation **client-side** (no bid JSON ever leaves the browser — privacy is table-stakes for ad-tech)
- the auth'd backend reuses the same engine for `/api/analyze`
- the CLI wraps it for CI pipelines (`npx spyglass validate req.json resp.json --dialect=iab --version=auto`)
- a future browser extension can `import` it directly

---

## 3. Validator core (`@spyglass/core`)

### 3.1 API shape

```js
import { validate, detectVersion, crosscheck, listDialects } from '@spyglass/core';

const detection = detectVersion(payload);
//   → { version: '2.6-202309', confidence: 0.95, signals: ['regs.gpp', 'imp[0].rwdd'] }

const result = validate(payload, {
  version: 'auto', // 'auto' | '2.5' | '2.6' | '2.6-202309' | …
  dialect: 'iab', // 'iab' | 'kadam' | 'propellerads' | …
  strictness: 'normal', // 'lax' | 'normal' | 'pedantic'
  locale: 'uk', // resolved client-side; server passes through
});
//   → {
//       version: '2.6-202309',
//       dialect: 'iab',
//       status: 'errors' | 'warnings' | 'clean',
//       findings: [
//         {
//           id: 'imp.banner.size_required',
//           level: 'error' | 'warning' | 'info',
//           path: 'imp[0].banner',
//           params: { idx: 0 },
//           specRef: 'https://github.com/.../2.6.md#3210-object-banner',
//           messageKey: 'finding.imp.banner.size_required',
//           fixKey: 'finding.imp.banner.size_required.fix',
//         },
//         …
//       ],
//     }

const cross = crosscheck(bidReq, bidRes, { version: 'auto' });
```

### 3.2 Findings model — three levels

| Level     | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| `error`   | Spec violation that an exchange will reject. Fail the bid.          |
| `warning` | Spec violation tolerated by most exchanges. Reduces fill / quality. |
| `info`    | Best-practice or recommendation. Optional improvement.              |

Findings carry **structured `id`s and `params`** — never inline copy. Localization happens at presentation time, by the consuming surface, via `@spyglass/i18n` (see §5). This is non-negotiable for the OSS-able core.

### 3.3 Version detection

Pasted JSON has no HTTP headers, so `X-Openrtb-Version` is unavailable. Detection uses **field-presence signals** in tiered confidence:

| Tier              | Signals (subset)                                                                                                        | Verdict        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------- |
| OpenRTB 3.0       | `item[]`, `context`, top-level `openrtb` envelope                                                                       | `3.0` (DOA)    |
| ≥ 2.6-202505      | `data.cids`, `content.genres` as string                                                                                 | newest 2.6     |
| ≥ 2.6-202501      | `content.gtax`, `content.genres`                                                                                        |                |
| ≥ 2.6-202409      | `eid.inserter`, `eid.matcher`, `eid.mm`                                                                                 |                |
| ≥ 2.6-202402      | `video.poddedupe`                                                                                                       |                |
| ≥ 2.6-202309      | `acat`, `durfloors`, `deal.guaranteed`, `deal.mincpmpersec`                                                             |                |
| ≥ 2.6-202303      | `imp.video.plcmt`, `imp.refresh`, `${AUCTION_IMP_TS}`                                                                   |                |
| ≥ 2.6-202211      | `regs.gpp`, `regs.gpp_sid`, `dooh`, `imp.qty`, first-class `inventorypartnerdomain`                                     |                |
| ≥ 2.6 baseline    | `imp.rwdd`, `imp.ssai`, `bid.mtype`, `bid.apis`, any `*.cattax`, `device.sua`, `langb`, `Network`/`Channel`, pod fields | 2.6            |
| ≥ 2.5             | `source`, `source.pchain`, `bseat`, `wlang`, `imp.metric[]`, `banner.vcm`, …                                            | 2.5            |
| Default           | none of the above + valid 2.5-shaped payload                                                                            | assume 2.5     |
| Deprecated/legacy | `banner.wmax`, `video.protocol` singular, `device.didsha1`, `user.yob`, …                                               | hint as legacy |

**OpenRTB 3.0 is intentionally not a primary target.** Production adoption is essentially zero (BidSwitch's own blog title: "OpenRTB 3.0: What Is It, and Why Is (Almost) Nobody Using It?"). IAB back-ported the wanted bits into 2.6. Spyglass detects 3.0 and labels it; full validation deferred until adoption changes.

### 3.4 Strictness levels

The OpenRTB spec is full of "should" and "recommended". Treating those as errors makes Spyglass annoying to bidder devs.

- `lax` — only what spec marks "must" or what exchanges actively reject. Good for production replay.
- `normal` — default. Errors for "must" violations; warnings for "should" violations.
- `pedantic` — surface every "recommended" hint. Good for cleaning a freshly-built bidder.

### 3.5 Dialect overlays

Each dialect is an **additive layer** (not a replacement) over the IAB base. A dialect file declares:

- additional fields it expects (e.g. Kadam: `imp.ext.subage`, `imp.ext.bsection`, `imp.ext.btags`, `site.ext.idzone`)
- field-presence rules conditional on shape (e.g. "if `site.ext.idzone` matches `/push|sub/i`, treat as push and require `subage`")
- known-supported macros / unsupported macros (e.g. Kadam supports only `${AUCTION_PRICE/CURRENCY/LOSS}`)
- specific recommended values

Dialects ship in `/dialects/{name}.js` next to the core. The current Kadam validator code becomes `@spyglass/dialect-kadam` — separate from the core. New dialects (PropellerAds, Adsterra, MGID, Galaksion) follow the same pattern.

### 3.6 Spec deep-links

Every finding carries a `specRef` pointing into the IAB markdown spec on GitHub:

```
https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#3210-object-banner
```

We control this via a **section-id table** in the core: `'imp.banner' → '3210-object-banner'`. When IAB ships a new tag (e.g. `2.6-202506`), we bump the table, not the rules.

The IAB does **not publish official JSON Schemas** — Spyglass derives rules from the markdown specs directly. We commit to tracking new tags within 2 weeks of publication.

---

## 4. Frontend (web surface)

### 4.1 Stack

Vanilla JS + design-system CSS — no React/Vue. Current code is already this shape; no reason to adopt a framework for what is fundamentally a JSON inspector with one main view. State is minimal (current sample, validation result, locale, theme, partner filter).

### 4.2 Theme system

Light + dark themes via CSS custom properties bound to `:root[data-theme="…"]`. Existing `--bg`, `--surface`, `--text`, `--accent` tokens get dark counterparts. A theme toggle in the header writes `localStorage.theme` and updates `document.documentElement.dataset.theme`. On first load, `prefers-color-scheme` decides default. **Two themes is the cap** — we don't ship an "auto" pseudo-mode that complicates the picker; OS preference becomes the load-time default.

### 4.3 i18n

String registry under `/locales/{uk,en,ru}.json` keyed by stable IDs. Both validator findings and UI labels go through it. Format is **ICU MessageFormat** — handles plurals, gender, parameter interpolation cleanly:

```json
{
  "finding.imp.banner.size_required": "Слот {idx, number} → банер без розмірів. {count, plural, one {Вкажи w і h} other {Вкажи розміри для всіх банерів}} (наприклад 300×250) або масив format[].",
  "finding.imp.banner.size_required.fix": "Додай у imp[{idx}].banner поля w і h, або format: [{w: 300, h: 250}, ...]"
}
```

Resolution order at runtime: `localStorage.locale` → `?locale=` query param → `navigator.language` → `'en'`. English is the global fallback (not Ukrainian) — the auth'd workspace will have international partners.

Locale files load lazily (browser fetches `/locales/uk.json` only when needed).

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

Node.js + Express. SQLite via `better-sqlite3` for the partner/sample/history store. Bcrypt session auth via the kyivtech-portal pattern (already in place). No PocketBase, no Postgres yet — single-writer SQLite is ample until multi-user team workspaces land.

### 5.2 Endpoints (current + planned)

```
POST   /api/analyze           validate + crosscheck (server-side mirror of core)
POST   /api/proxy             SSRF-guarded forwarder (test endpoints allow-list)

GET    /api/partners          list
POST   /api/partners          create
PATCH  /api/partners/:id      update
DELETE /api/partners/:id      delete (samples → unassigned)

GET    /api/samples           list (filter by partner_id)
GET    /api/samples/:id       full body
POST   /api/samples           create
PATCH  /api/samples/:id       update
DELETE /api/samples/:id       delete

GET    /api/profiles          (planned) per-partner default version + dialect + strictness
POST   /api/profiles          (planned)

GET    /api/history           (planned) persistent history per user

POST   /api/share/:id         (planned) generate read-only share link for a saved sample
```

### 5.3 Schema (current + planned)

Current (`db.js`):

- `partners(id, name, slug, notes, created_at)`
- `samples(id, partner_id, title, bid_req, bid_res, status, notes, created_at)`

Planned additions:

- `samples.version_pinned` — `null` for auto-detect, else explicit `'2.6'` etc.
- `samples.dialect` — `null` for `'iab'`, else specific dialect.
- `partners.default_version`, `partners.default_dialect`, `partners.default_strictness` — applied when saving a sample with that partner.
- `users(id, email, password_hash, locale, theme, created_at)` — for multi-user.
- `histories(id, user_id, sample_snapshot_json, created_at)` — persistent history when logged in.

### 5.4 Privacy posture

- Bid JSON is potentially sensitive (deal IDs, user IDs, supply paths). The product surfaces this loudly: public demo says "validation runs in your browser, nothing is uploaded"; auth'd version says "your saved samples are visible only to your workspace".
- No analytics SDK that captures input fields.
- `Content-Security-Policy` disallows third-party script and frame sources.
- Creative previews iframe-sandboxed.

---

## 6. Deploy modes

### 6.1 Public demo

- Static frontend on Cloudflare Pages or similar (or just our portal serving `/spyglass-public/`).
- Domain: `rtb.kyivtech.com.ua` (subdomain split — separate Cloudflare Tunnel route, no auth gate).
- Validator runs in-browser; no `/api/samples` or `/api/partners` exist. `/api/analyze` is unnecessary if the core runs client-side.
- Could share the same code build with a feature flag — `BUILD_TARGET=public` strips the library UI.

### 6.2 Authenticated workspace

- Current setup: portal proxy at `/spyglass-proxy/*` (kyivtech.com.ua, behind admin login).
- May graduate to its own subdomain `spyglass.kyivtech.com.ua` once team accounts land.
- Container: `adtech-spyglass` on host network, port `127.0.0.1:8090`.
- DB: `/srv/DATA/AppData/adtech-spyglass/spyglass.db` (bind-mounted).
- Backups: rotation needed before launch (currently absent — see [ROADMAP](./ROADMAP.md) phase 4).

### 6.3 Self-hosted / enterprise

- `docker-compose.yml` shipped publicly.
- Configuration via env (DB path, allowed origins, OAuth provider hooks if added).
- Same image, different env.

### 6.4 CLI

- `npx @spyglass/cli validate req.json [resp.json] [--dialect=iab] [--version=auto] [--format=json|tap|junit]`
- Wraps `@spyglass/core` directly. Exit code 0 on clean, 1 on errors, 2 on warnings (configurable).
- CI integration: GitHub Action wrapper that comments on PRs with finding deltas.

---

## 7. Data model — findings (`@spyglass/core` output)

```ts
type Finding = {
  id: string; // 'imp.banner.size_required' — stable, namespaced
  level: 'error' | 'warning' | 'info';
  path: string; // JSON pointer-ish: 'imp[0].banner'
  params?: Record<string, unknown>; // for ICU interpolation: { idx: 0, count: 3 }
  specRef?: string; // permalink into IAB GitHub markdown
  versionRequired?: string; // 'requires ≥ 2.6-202309 for durfloors'
  fixKey?: string; // i18n key for actionable fix hint
  messageKey: string; // i18n key for explanation
  detail?: object; // arbitrary structured data for UI rendering
};

type ValidationResult = {
  version: string; // detected or pinned
  versionDetect: { confidence: number; signals: string[] };
  dialect: string;
  status: 'clean' | 'warnings' | 'errors';
  findings: Finding[];
};
```

**Findings are i18n-neutral.** The core never returns a copy string, only keys + params. This is the linchpin that makes localization, OSS, and CI-mode all work from the same engine.

---

## 8. Open questions / decisions deferred

- **License** for `@spyglass/core`: MIT vs Apache-2.0. MIT is friendlier for vendors to embed; Apache-2.0 includes patent grant. Decision before first npm publish.
- **3.0 support timeline.** Currently: detect and label only. If/when a major SSP ships 3.0 for real, escalate to a phase.
- **Hosted backend for public demo** — none planned, but if `/api/proxy`-style replay is needed, it becomes a Cloudflare Worker rather than a Node server (rate-limit + serverless cost shape).
- **Auth provider** for multi-user: keep bcrypt sessions for v1, evaluate Auth.js / Clerk / Lucia later.
- **Mock / fixture generation** as a feature (generate a valid `BidRequest` matching given constraints). Post-MVP. Strong magnet for organic discovery if it works well.

---

## 9. What we deliberately do NOT do

- **Render VAST video in-page.** Embed/iframe IAB's VAST validator instead. Reinventing it is years of work for marginal value.
- **Decode TCF / GPP consent strings.** Surface presence and validity-pattern, defer string decoding to dedicated tools. Maybe later.
- **Real bid simulation against live exchanges.** Spyglass is an inspector, not a load tester or auction simulator.
- **Adapter SDK / bidder framework.** Prebid Server already exists and dominates. Stay in our lane.
- **Historical / time-series analytics on saved bids.** Possible future, but not core mission.
