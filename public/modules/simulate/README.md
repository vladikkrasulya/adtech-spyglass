# simulate — bid simulator (3 DSP strategies)

POSTs the parsed BidRequest to `/api/intel/simulate-bids` and renders
three DSP strategies (aggressive / conservative / quality)
side-by-side. Each strategy gets bid yes/no, price, and a one-sentence
rationale. Best run with a non-trivial request loaded in `#bidReq`.

## Loading

**Lazy.** This module is fetched only when the user clicks the
"🤖 симуляція" button (case `'sim-bids'` in spyglass.app.js
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

- `window.closeModal` — modal lifecycle (provided by spyglass.app.js;
  triggered by the `data-action="modal-close"` /
  `data-action="modal-backdrop-close"` buttons rendered by this
  module, plus the global Esc handler).

## DOM events

This module neither dispatches nor listens to any `kt:*` events. It
reads `#bidReq` directly (a contract owned by `modules/inspector/`)
and writes its modal into `#modalRoot`.

## Backend

Talks to `POST /api/intel/simulate-bids` (handler delegates to local
qwen2.5:3b via Ollama; see `packages/intel/intel-llm.js`). When the
backend returns `{ success: false, code: 'ollama_unavailable' }` the
modal renders a translated friendly error
(`modal.simbids.ollama_down`) instead of the raw error string.

## Dispatcher cases

Only one `data-action` case is handled by spyglass.app.js's central
dispatcher:

- `sim-bids` — opens the modal (lazy-loads this module, then calls
  `window.openSimBidsModal()`).

The modal itself only uses generic `modal-close` /
`modal-backdrop-close` actions — no simulate-specific in-modal
dispatch is needed.
