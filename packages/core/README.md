# @ortbtools/core

OpenRTB inspection engine — pass a `BidRequest`, `BidResponse`, supported vendor-feed payload, or recognized URL-style request and get deterministic, structured findings with stable IDs and localized messages. It provides heuristic version and format detection, rule-based validation for supported IAB fields, and semantic request/response crosscheck.

The supported package boundary is Node.js `>=18` with CommonJS. The main validation, detection, and crosscheck APIs are deterministic data-to-data functions and make no network calls. Browser bundling is not a documented or tested distribution contract. The optional `@ortbtools/core/knowledge-base` loader is explicitly Node-only because it reads bundled samples with `fs` and `path`.

This offline library boundary is different from the hosted inspector at [ortbtools.com](https://ortbtools.com): the website sends pasted payloads to `POST /api/analyze` for transient server-side analysis. Raw payload bodies are not persisted; see the parent repository's privacy documentation for the metadata that may be retained.

## Why this exists

Use this package when an application, service, or local tool needs the same deterministic findings contract as ortbtools. The parent repository contains the hosted UI and HTTP API; `@ortbtools/cli` is the local command-line wrapper.

## Package status

`@ortbtools/core` is not currently published to the npm registry. Inside this monorepo it is available as an npm workspace. Registry installation instructions will be added after the first verified public release.

## Usage

```js
const {
  validate,
  crosscheck,
  detectVersion,
  listDialects,
  rawDiff,
  semanticDiff,
} = require('@ortbtools/core');

const result = validate(bidRequest, {
  dialect: 'iab', // 'iab' | 'ext-rtb' | 'inpage-push'
  locale: 'uk', // 'uk' | 'en' | 'ru'
  expectedVersion: '2.6',
});

// → {
//     type: 'oRTB BidRequest',
//     version: { version: '2.6', confidence: 1, signals: ['imp[].rwdd', 'device.sua'] },
//     status: 'errors' | 'warnings' | 'clean' | 'invalid',
//     findings: [
//       {
//         id: 'imp.banner.size_required',
//         level: 'error',
//         path: 'imp[0].banner',
//         params: { num: 1 },
//         specRef: 'https://github.com/InteractiveAdvertisingBureau/openrtb2.x/...', // or null
//         msg: 'Слот #1: банер без розмірів. Вкажи w і h ...',
//       },
//       …
//     ],
//   }

const cross = crosscheck(bidRequest, bidResponse, { locale: 'uk' });
// → [{ id, ok, level, path, params, msg, specRef }]

const detection = detectVersion(bidRequest);
// → { version: '2.6', confidence: 1, signals: [...] }

const rawChanges = rawDiff(before, after);
const semanticChanges = semanticDiff(before, after);
// → { mode, equal, changes, warnings }
```

## API

### `validate(payload, opts?)`

Validates a `BidRequest`, `BidResponse`, supported vendor-feed payload, or recognized URL-style request string. JSON Feed 1.1 is recognized by shape but is not structurally validated; it returns the informational `jsonfeed.not_validated` finding. The function auto-detects type and version and returns:

- `type` — detected OpenRTB, URL-request, JSON Feed, or vendor-feed label
- `version` — `{ version, confidence, signals[] }`
- `status` — rollup: `'clean' | 'warnings' | 'errors' | 'invalid'`
- `findings[]` — list of `{ id, level, path, params, specRef, msg }`; `specRef` is a URL or `null`

Options:

- `dialect` — `'iab'` (default), `'ext-rtb'`, or `'inpage-push'`; unknown ids fall back to `iab`
- `locale` — `'uk'` (default), `'en'`, or `'ru'`; unknown ids fall back to English, then Ukrainian (ADR-014)
- `disabledRules` — `string[]` of finding ids to suppress; supports trailing `*` prefix (e.g. `['imp.bidfloorcur_missing', 'regs.*']`)
- `strictness` — `'pedantic'` (default, all findings) | `'normal'` (errors, warnings, and non-blocking questions) | `'lax'` (errors only). Applies to both validator and crosscheck scales (`crit`≡`error`, `warn`≡`warning`).
- `expectedVersion` — `'2.5' | '2.6' | '3.0'`; emits `version.mismatch` when heuristic detection selects another bucket
- `pairReq` — optional paired BidRequest supplied while validating a response, used by response-side floor and currency plugins
- `userDialect` — optional loaded user-dialect object used by extension-aware rules; intended for advanced/server integrations

### API stability contract (since 0.11.0)

`validate()` and `crosscheck()` guarantee a deterministic findings array:

1. **Order**: severity descending → `path` ascending (lex) → `id` ascending. The shared order is error/crit, warning/warn, info, question, then ok.
2. **Dedup**: repeated `(id, path)` pairs collapse into one finding. When 2+ copies were merged, the surviving finding gets a `params.dedupCount` integer. The first occurrence wins on level / params / msg. The new key is `dedupCount` (not `count`) to avoid colliding with rules that already use `count` for domain meaning.
3. **disabledRules**: `validate(req, { disabledRules: ['regs.*'] })` filters before dedup/sort. Accepts exact ids or trailing-`*` prefixes. Empty / falsy → no filter.
4. **strictness**: supported values are `'pedantic'` (default), `'normal'`, `'lax'`; unset or unrecognised → `'pedantic'`. Applied after dedup+sort, so ordering contract still holds on the filtered set.

CI consumers can rely on this exact ordering — they don't need to re-sort.

### `crosscheck(req, res, opts?)`

Semantic comparison between request and response: id alignment, currency, `bid.impid` resolution, `price` vs `bidfloor`, `bcat`/`badv` enforcement, banner size match, native asset back-reference, VAST detection, auction summary.

### `detectVersion(payload)`

Heuristically selects an OpenRTB bucket from field-presence signals: `'2.5' | '2.6' | '3.0' | 'unknown'`. An object with no version markers defaults to `2.5` with confidence `0.3`; `unknown` is returned when the input is not an object that can be inspected.

### `detectType(payload)`

Detects payload top-level shape.

### `listDialects()` / `listLocales()`

Enumerate supported dialect overlays / locales.

### Additional root exports

- `mirror(payload, opts?)` — generate a minimal or best-practice request/response counterpart and self-test it
- `diffJson(left, right, { mode })`, `rawDiff(left, right)`, `semanticDiff(left, right)` — pure deterministic JSON comparison; semantic mode matches `imp[]`, `seatbid[]`, and `bid[]` by their documented identities and uses only an explicit registry for set-like arrays
- `OPENRTB_ARRAY_IDENTITIES`, `OPENRTB_SET_PATHS` — immutable registries defining semantic array behavior
- `detectFormat(payload, userDialect?)` — detect format, context, and creative-protocol tags
- `decodeCategory()`, `decodeCategories()`, `extractAllCategories()` — IAB Content Taxonomy helpers
- `rollupStatus(findings)` — apply the same status rollup used by `validate()`
- `TYPES`, `VERSIONS`, `FORMATS`, `CONTEXTS`, `PROTOCOLS`, `LEVELS`, `CROSS_LEVELS` — public constants
- `nativeAssetCrosscheck()` — lower-level Native asset comparison helper

The package also ships specialized CommonJS subpaths such as `@ortbtools/core/behavior` and `@ortbtools/core/intel`. The Node-only knowledge-base loader is available at `@ortbtools/core/knowledge-base`.

## Dialects

The detected OpenRTB version selects the base validator. Dialects are optional overlays for vendor-specific fields and creative carriers:

- `iab` — base OpenRTB rules, no vendor extras
- `ext-rtb` — `ext.bsection`, `ext.btags`, push signals, and macro checks
- `inpage-push` — response-side validation for creatives carried in `bid.ext`

To add a built-in dialect in this repository, create its module under `dialects/`:

```js
module.exports = {
  name: 'mydialect',
  validateRequest(req) {
    /* return [findings] */
  },
  validateResponse(res) {
    /* return [findings] */
  },
};
```

Then require it and register its slug in the static `DIALECTS` map in `index.js`; dialect files are not discovered automatically.

## OpenRTB version coverage

- OpenRTB 2.5 / 2.6 — a shared broad BidRequest/BidResponse rule set, not
  exhaustive schema conformance. The detector uses markers such as `rwdd`,
  `sua`, `cattax`, `langb`, and pod fields to select the `2.6` bucket, but 2.x
  field validity is not yet gated by the detected minor version.
- OpenRTB 2.6 dated revisions — currently grouped into the `2.6` bucket;
  per-revision detection and gating are not implemented
- OpenRTB 3.x — envelope plus deep request/response rules for core context, privacy, placement, media, and embedded VAST fields; coverage is not exhaustive AdCOM schema conformance

## i18n

Findings carry stable `id`s and params, and `validate()` decorates each result
with a localized `msg` for the selected locale:

```js
const result = validate(payload, { locale: 'uk' });
result.findings[0].msg; // 'Слот #1: банер без розмірів...'
```

Shipping locales: English (`en`), Ukrainian (`uk`), and Russian (`ru`). Unknown locale ids fall back to English, then Ukrainian (ADR-014).

## How validation works (the 5-second map)

```
              ┌──────────────────────────────────────────────────┐
   payload ── │  validate(payload, { dialect?, locale?, … })     │
   (any JSON) │     │                                            │
              │     ├─ detectType    → ORTB_REQUEST/RESPONSE/…   │
              │     ├─ detectVersion → 2.5 / 2.6 / 3.0           │
              │     │                                            │
              │     │   ── Base version validators ─────          │
              │     ├─→ validateRequest* / validateResponse* ─┐  │
              │     │                                     │      │
              │     │   ── Plugin rules ─────────         │      │
              │     ├─→ runRulePlugins(req, type, ctx) ──┤       │
              │     │   rules/                            │      │
              │     │   ├─ client-hints / imp-secure      │      │
              │     │   ├─ pop / schain / eids / adpod    │      │
              │     │   └─ currency / price-floor / tmax  │      │
              │     │                                     │      │
              │     │                       findings ←────┘      │
              │     │                                            │
              │     ├─ applyDisabledRules  (skip suppressed)     │
              │     ├─ dedupFindings       (collapse (id,path))  │
              │     ├─ sortFindings        (severity DESC → …)   │
              │     └─ decorate            (localize msg + spec) │
              │                                                  │
              └──────────────────────────────────────────────────┘
                                      │
                                      ▼
              { type, version, status, findings: [...] }
```

**Where the rules live:**

| Surface                            | Folder / file                                  | Style                                                        |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| OpenRTB 2.x BidRequest baseline    | `rules-request.js`                             | Flat baseline validator                                      |
| OpenRTB 2.x BidResponse baseline   | `rules-response.js`                            | Flat baseline validator                                      |
| OpenRTB 3.x request/response rules | `rules-request-30.js` / `rules-response-30.js` | Envelope and deep field rules                                |
| VAST rules                         | `rules-vast.js`                                | Embedded creative validation                                 |
| Supported vendor-feed responses    | `rules-feed.js`                                | Shape-specific feed validators                               |
| Modular rule groups                | `rules/<plugin>/index.js`                      | Plugin contract — see [`rules/README.md`](./rules/README.md) |

**Pattern for adding new rules**: drop a folder under `rules/<name>/`,
register in `rules/index.js`, add message keys to `messages/{en,uk,ru}.json`.
That's it. See [`rules/README.md`](./rules/README.md) for the contract.

## Design principles

- **Stable machine identity** — consumers key automation on `id`, `level`, and
  `path`; localized `msg` is presentation copy, not an API identifier.
- **Node/CommonJS distribution** — Node.js `>=18` is the supported package runtime; browser consumers need their own explicitly tested adaptation rather than relying on an undocumented bundle contract.
- **No phoning home** — validation takes data in and returns data; it has no fetch, telemetry, or analytics path.
- **Source-anchored where applicable** — IAB findings include a maintained spec link when one exists; vendor, behavior, and meta findings may return `specRef: null`.

## License

MIT — see [LICENSE](./LICENSE).

## Not affiliated with IAB Tech Lab.

OpenRTB® is a trademark of IAB Tech Lab. This package consumes the public OpenRTB specifications but is not an official IAB tool.
