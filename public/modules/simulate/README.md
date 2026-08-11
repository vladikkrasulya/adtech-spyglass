# simulate — bid simulator (3 DSP strategies)

POSTs the raw BidRequest to `/api/intel/simulate-bids` and renders
three DSP strategies (aggressive / conservative / quality)
side-by-side. Each strategy gets bid yes/no, price, and a one-sentence
rationale from deterministic server-side rules. The server parses and
processes the BidRequest transiently; this endpoint does not persist the
raw body, and no external model receives it. Best run with a non-trivial
request loaded in `#bidReq`.

## Loading

**Lazy.** This module is fetched only when the user clicks the
"🤖 симуляція" button (case `'sim-bids'` in ortbtools.app.js
dispatcher). On first click: ~6KB across `index.js` + `i18n.js`. On
subsequent clicks: cached by the browser's ES module loader, zero
extra fetch.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t` from
  `/core/utils.js`. Exports `openSimBidsModal()`. Self-registers on
  `window.openSimBidsModal` for the dispatcher.
- `i18n.js` — 12 keys × 3 locales (`modal.simbids.*` + `toast.simbids_*`).
- `README.md` — this file.

## Window APIs (provides)

- `window.openSimBidsModal()` — entry point, called by dispatcher.

## Window APIs (consumes)

- `window.closeModal` — modal lifecycle (provided by ortbtools.app.js;
  triggered by the `data-action="modal-close"` /
  `data-action="modal-backdrop-close"` buttons rendered by this
  module, plus the global Esc handler).

## DOM events

This module neither dispatches nor listens to any `kt:*` events. It
reads `#bidReq` directly (a contract owned by `modules/inspector/`)
and writes its modal into `#modalRoot`.

## Backend

Talks to `POST /api/intel/simulate-bids`. The handler parses the
BidRequest transiently and delegates to the deterministic formulas in
`lib/intel-rules.js`: format-aware reference CPM, metadata-completeness
quality score, and explicit per-strategy floor multipliers and limits.
The same input produces the same output, with `engine: "rules"`
provenance. It makes no Ollama, cloud AI, or other model call and does
not persist the raw BidRequest.

The client retains the legacy `modal.simbids.ollama_down` translation
key for compatibility; the current deterministic handler does not emit
`ollama_unavailable`.

## Dispatcher cases

Only one `data-action` case is handled by ortbtools.app.js's central
dispatcher:

- `sim-bids` — opens the modal (lazy-loads this module, then calls
  `window.openSimBidsModal()`).

The modal itself only uses generic `modal-close` /
`modal-backdrop-close` actions — no simulate-specific in-modal
dispatch is needed.
