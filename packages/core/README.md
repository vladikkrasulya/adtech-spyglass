# @kyivtech/spyglass-core

OpenRTB inspector engine — paste a `BidRequest` / `BidResponse` JSON, get **stable, structured findings** with stable IDs, IAB spec deep-links, and human-readable messages. Bundles version detection (2.5 / 2.6 / 3.0), strict IAB validation, and semantic crosscheck (id alignment, price vs floor, bcat enforcement, native asset back-reference, VAST detection, auction summary).

Pure JavaScript, no Node-only APIs. **Runs identically in Node and the browser** — privacy-first by design (the public Spyglass demo at [spyglass.kyivtech.com.ua](https://spyglass.kyivtech.com.ua) validates entirely client-side; nothing leaves the browser).

## Why this exists

Existing OpenRTB validators are dead npm packages stuck on 2.3, JSON-schema linters that emit `instancePath: /imp/0/banner/format/1/h is required`, or walled-garden tools tied to a single SSP seat. There's no "Postman for OpenRTB". This is the engine behind one — see the parent repo for the full UI/server.

## Install

```bash
npm install @kyivtech/spyglass-core
```

## Usage

```js
const { validate, crosscheck, detectVersion, listDialects } = require('@kyivtech/spyglass-core');

const result = validate(bidRequest, {
  dialect: 'iab', // 'iab' | 'kadam'
  locale: 'uk', // 'uk' | 'en' (en is stub for now)
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
//         specRef: 'https://github.com/InteractiveAdvertisingBureau/openrtb2.x/...',
//         msg: 'Слот #1: банер без розмірів. Вкажи w і h ...',
//       },
//       …
//     ],
//   }

const cross = crosscheck(bidRequest, bidResponse, { locale: 'uk' });
// → [{ id, ok, level, path, params, msg, specRef }]

const detection = detectVersion(bidRequest);
// → { version: '2.6', confidence: 1, signals: [...] }
```

## API

### `validate(payload, opts?)`

Validates a `BidRequest`, `BidResponse`, or vendor JSON-feed payload. Auto-detects type and version. Returns:

- `type` — `'oRTB BidRequest' | 'oRTB BidResponse' | 'JSON-feed Response (push)' | …`
- `version` — `{ version, confidence, signals[] }`
- `status` — rollup: `'clean' | 'warnings' | 'errors' | 'invalid'`
- `findings[]` — list of `{ id, level, path, params, specRef, msg }`

Options:

- `dialect` — `'iab'` (default, strict OpenRTB spec) or a vendor overlay (adds vendor-specific rules)
- `locale` — `'uk'` (default), `'en'`

### `crosscheck(req, res, opts?)`

Semantic comparison between request and response: id alignment, currency, `bid.impid` resolution, `price` vs `bidfloor`, `bcat`/`badv` enforcement, banner size match, native asset back-reference, VAST detection, auction summary.

### `detectVersion(payload)`

Detects OpenRTB version from field-presence signals. Buckets: `'2.5' | '2.6' | '3.0' | 'unknown'`.

### `detectType(payload)`

Detects payload top-level shape.

### `listDialects()` / `listLocales()`

Enumerate supported dialect overlays / locales.

## Dialects

The default `iab` dialect validates strictly against the IAB OpenRTB 2.6 spec. Vendor-specific extensions (e.g. `ext.bsection` / `ext.btags` / `ext.subage` for push traffic, or unsupported macros in `bid.adm`) live in opt-in dialect overlays:

- `iab` — base, no extras
- vendor overlays — push/pop dialects (one ships in-tree as a reference)

Add a new dialect by dropping a file in `dialects/`:

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

## OpenRTB version coverage

- 2.5 baseline — full
- 2.6 baseline — full (rwdd, sua, cattax, langb, pod fields, etc.)
- 2.6 minor revisions (202211, 202309, 202505, …) — detection signals are in place; per-revision rule gating lands in v0.2.x
- 3.0 — detection only; production adoption is essentially nil per IAB

## i18n

Findings carry stable `id`s and parameter-only message data. Localized text is resolved at presentation time:

```js
const result = validate(payload, { locale: 'uk' });
result.findings[0].msg; // 'Слот #1: банер без розмірів...'
```

Currently shipping locales: Ukrainian (`uk`, complete), English (`en`, stub — falls back to Ukrainian). Russian (`ru`) and English completion land in the consuming app's i18n phase.

## Design principles

- **i18n-neutral findings** — engine emits `{ id, params }`, never inline copy.
- **Browser-runnable** — no Node-only APIs. The same code runs in `node`, in a browser tab, in a Cloudflare Worker.
- **No phoning home** — pure function. Takes JSON in, returns JSON out. No fetch, no telemetry, no analytics.
- **Spec-anchored** — every finding deep-links to the relevant IAB markdown section.

## License

MIT — see [LICENSE](./LICENSE).

## Not affiliated with IAB Tech Lab.

OpenRTB® is a trademark of IAB Tech Lab. This package consumes the public OpenRTB specifications but is not an official IAB tool.
