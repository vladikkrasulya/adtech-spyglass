# mirror — canonical-counterpart generator

Generates the canonical BidRequest/BidResponse counterpart for a pasted
specimen, runs validate+crosscheck self-test on the result, and shows a
top-level structural diff between the user's version and the canonical
one when both panes are populated.

## Loading

**Lazy.** This module is fetched only when the user clicks the
"дзеркало ↔" button (case `'mirror'` in spyglass.app.js dispatcher).
On first click: ~25KB across `index.js` + `i18n.js`. On subsequent
clicks: cached by the browser's ES module loader, zero extra fetch.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t` from
  `/core/utils.js`. Exports `openMirrorModal()`. Self-registers on
  `window.openMirrorModal` for the dispatcher.
- `i18n.js` — 26 keys × 3 locales (`modal.mirror.*` + `toast.mirror_*`
  - `toast.nothing_to_mirror`).
- `README.md` — this file.

## Window APIs (provides)

- `window.openMirrorModal()` — entry point, called by dispatcher
- `window.__spyglassMirrorRefetch(mode)` — closure called when the user
  flips the mode radio (`minimal` / `best-practice`); triggers a
  re-fetch with the new mode

## Window APIs (consumes)

- `window.closeModal` — modal lifecycle (provided by spyglass.app.js)
- `window.buildShareUrl` — provided by `modules/share/` when present;
  modal hides the "share with pair" button when absent

## Backend

Talks to `POST /api/v1/mirror` (handler in `server.js:1213`,
implementation in `packages/core/mirror.js`). Backend migration to a
proper `modules/mirror/` server-side module is separate work.

## Dispatcher cases

Five `data-action` cases are handled by spyglass.app.js's central
dispatcher (NOT by this module — they manipulate DOM that exists only
after the modal is open, so they don't need to be inside the lazy
module):

- `mirror` — opens the modal (lazy-loads this module, then calls
  `window.openMirrorModal()`)
- `mirror-copy`, `mirror-load`, `mirror-mode-change`, `mirror-share` —
  in-modal button handlers
