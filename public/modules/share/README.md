# share — fragment-encoded permalinks

Encodes the current BidRequest / BidResponse panes into a hash-fragment
URL so the link, when opened, restores both panes and re-runs analysis.
Hash fragments never reach the server — preserves Spyglass's
zero-knowledge posture.

## Files

- `index.js` — boot + encode/decode pipeline
- `i18n.js` — 7 namespaced strings × 3 locales
- `README.md` — this file

## Window APIs (provides)

- `window.copyShareLink()` — wired to the topnav share button
- `window.buildShareUrl(reqText, resText) → Promise<string>` — used by
  the mirror module to build permalinks for the canonical pair
- `window.spyglassShareSupported() → boolean` — feature-detect for
  `embed.js`

## Window APIs (consumes)

- `window.t(key, params)` — i18n lookup
- `window.toast(msg, type)` — toast surface
- `window.runAnalysis()` — kicks analysis after a hash-load restore

## Events

- Listens: `kt:inspector-ready` (once) — workbench DOM ready signal
- Dispatches: none

## Browser requirements

CompressionStream `deflate-raw` (Chrome 103+, Safari 16.4+, Firefox 113+).
On older browsers, surfaces a toast pointing the user at Download.

## URL shape

```
https://spyglass.kyivtech.com.ua/?#req=<b64url(deflate(json))>&res=<...>
```

URL_BUDGET = 7000 chars (chat clients truncate longer links).
