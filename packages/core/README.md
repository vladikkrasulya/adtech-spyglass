# @ortbtools/core

OpenRTB inspection engine — pass a `BidRequest`, `BidResponse`, supported vendor-feed payload, or recognized URL-style request and get deterministic, structured findings with stable IDs and localized messages. It provides heuristic version and format detection, rule-based validation for supported IAB fields, and semantic request/response crosscheck.

The supported package boundary is Node.js `>=18` with CommonJS. The main validation, detection, and crosscheck APIs are deterministic data-to-data functions and make no network calls. Browser bundling is not a documented or tested distribution contract. The optional `@ortbtools/core/knowledge-base` loader is explicitly Node-only because it reads bundled samples with `fs` and `path`.

This offline library boundary is different from the hosted inspector at [ortbtools.com](https://ortbtools.com): the website sends pasted payloads to `POST /api/analyze` for transient server-side analysis. Raw payload bodies are not persisted; see the parent repository's privacy documentation for the metadata that may be retained.

## Why this exists

Use this package when an application, service, or local tool needs the same deterministic findings contract as ortbtools. The parent repository contains the hosted UI and HTTP API; `@ortbtools/cli` is the local command-line wrapper.

## Package status

The repository Core version is `0.47.0`; the CLI is `0.1.4` with dependency `^0.47.0`. These are workspace versions, not evidence of an npm publication.

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
- `completeness` — present after a caught rule-family fault as `{ complete: false, failedFamilies: [...] }`; family IDs are sorted and contain no exception or payload text. This metadata survives filtering, and an incomplete result cannot have status `clean`.
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

The [finding ID policy](../../specs/032-close-cleanup-inventory/contracts/finding-id-policy.md) freezes the compatibility allowlist. Legacy finding IDs, including historical hyphenated IDs, are retained. New IDs use dotted lowercase names; message copy is not a rule identifier. `response.bid.price_required` and `err-bid-price-negative` deliberately retain their different finite-number and non-negative-number trigger sets.

CI consumers can rely on this exact ordering — they don't need to re-sort.

### `crosscheck(req, res, opts?)`

Semantic comparison between request and response: id alignment, currency, `bid.impid` resolution, `price` vs `bidfloor`, `bcat`/`badv` enforcement, banner size match, native asset back-reference, VAST detection, auction summary.

Request validation emits `floor.negative` warnings for negative supplied impression/item/deal floors. Crosscheck excludes those unusable floors from above/below-floor verdicts. A matched negative deal never falls back to the impression floor. Zero and absent floors retain their existing behavior. Positive 3.0 deal comparisons remain outside crosscheck's existing eligibility; the negative matched-deal veto does not activate them. Response plugins receive only the currency of an enveloped 3.0 paired request.

### `parseVastTimeline(xml)` and `VAST_DIAGNOSTICS`

These retained package-root exports provide deterministic static VAST extraction and its frozen diagnostic catalog:

```js
const { parseVastTimeline, VAST_DIAGNOSTICS } = require('@ortbtools/core');
const timeline = parseVastTimeline(xml);
```

See [the extractor contract](vast-timeline/README.md) for limits, Wrapper handling and result fields. The package API does not promise that every extracted field has a dedicated Inspector panel; static extraction and Inspector presentation are separate capabilities.

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

## Vendor inspection in Core 0.46.0

Documented EXADS JSON request and outer-bid carriers receive vendor-specific validation, while EXADS, PPCmate and Kadam GET families use the existing canonical URL-request result. Encoded query evidence, duplicate-key precedence and repair warnings remain available. Explicit source-backed subtype fields drive formats; opaque account keys and absent optional subscription data do not disclose hidden inpage provisioning.

Kadam Native material accepts its documented `url`/`image`/`cpc` roles without fabricating an IAB Native assets envelope. Inpage extension hints and nested AdCOM Native objects contribute format evidence while mandatory IAB media findings and actual banner alternatives remain intact.

Adon3-shaped inputs are inspected as **provisional and unsupported**. Response prices remain decimal strings, and the result contains an explicit limitation warning; recognition is not vendor certification. Recognized EXADS request/response pairs do not run inapplicable IAB impression, floor or currency crosscheck, and no vendor payload is rewritten into an OpenRTB auction. Core makes no request to a vendor endpoint and does not render a creative.

The [Core contract](../../specs/000-platform-baseline/contracts/core-validator.md) owns these semantics; [feature 028](../../specs/028-vendor-request-dialects/spec.md) records the scope, proof and independently owned browser residuals.

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

### Supply-chain inspection and declared routes

`inspectSchain(input, {locale, declaredSender})` inspects a structured request, serialized SChain, or explicit query/URL carrier without network access. It returns schemaVersion1, input kind/status, located copies and node counts, decorated findings, sources and a comparison marked with declaration provenance. The optional sender has `{asi,sid,provenance:'declared'}`. Missing/malformed/incompatible data is not silently accepted; additional nodes alone do not imply a violation.

`listInspectionProfiles({locale})` returns the bounded pinned-source adapter catalog. `evaluateDeclaredRoute(input, {adapterId,direction,revision,provenance:'declared'}, {locale})` explains known/unknown applicability against that exact revision. A payload name or endpoint never supplies this declaration. None of these APIs fetches an advertiser or adapter URL.

Route relevance visits at most10000 carrier values across all statements and aliases, with nesting capped at32. Malformed impression entries or exceeded traversal bounds return `unknown` with reason `incompatible_input`; unrelated extension subtrees are not scanned.
