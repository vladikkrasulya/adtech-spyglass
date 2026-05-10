# live — RTB sample stream viewer

Opens an EventSource on `/api/v1/stream` and renders an auto-trimming
list (cap = 50 rows) of incoming RTB specimens. Each row shows a
timestamp, a kind chip (`req` / `res` / `?`), the source name, and an
optional banner-size hint. Click a row to load that specimen into the
matching editor (BidRequest if `imp[]` is present, BidResponse if
`seatbid[]` is present) and close the modal.

## Loading

**Lazy.** This module is fetched only when the user clicks the
"live" button (case `'live'` in spyglass.app.js dispatcher). On first
click: ~7KB across `index.js` + `i18n.js`. On subsequent clicks:
cached by the browser's ES module loader, zero extra fetch.

The dispatcher cases `'live-pause'` and `'live-load'` stay in
spyglass.app.js — they only fire AFTER the modal is open, by which
point this module is already loaded and the window APIs below are
wired up.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `t` from
  `/core/utils.js`. Exports `openLiveModal()`. Self-registers on
  `window.openLiveModal` for the dispatcher.
- `i18n.js` — 11 keys × 3 locales: `modal.live.*` (9 keys) plus
  `toast.live_loaded` and `toast.live_load_failed`.
- `README.md` — this file.

## Window APIs (provides)

- `window.openLiveModal()` — entry point, called by dispatcher
- `window.__spyglassLivePauseToggle()` — toggles paused state from
  outside the modal body. Consumed by the `'live-pause'` dispatcher
  case. Set to `null` on close.
- `window.__spyglassLiveSpecimens` — `Map<rowId, specimen>` so the
  dispatcher's `'live-load'` case can resolve a clicked row id back to
  its raw JSON. Cleared and set to `null` on close.

## Window APIs (consumes)

- `window.closeModal` — modal lifecycle (provided by spyglass.app.js).
  Patched on open so any close path (Esc, backdrop, button, follow-up
  modal) tears down the `EventSource` and clears the maps. Restored on
  close.

## DOM events / contracts

- Reads from server-sent events on `/api/v1/stream`. Each event's
  `data` is a JSON envelope `{ emittedAt, source, specimen }`.
- Renders into `#modalRoot` (shared modal mount point).
- Internal DOM ids (within the modal): `#mLiveStatus`,
  `#mLivePauseBtn`, `#mLiveList`. None outlive the modal.

## Dispatcher cases

Three `data-action` cases are handled by spyglass.app.js's central
dispatcher (NOT by this module — they manipulate DOM that exists only
after the modal is open, so they don't need to be inside the lazy
module):

- `live` — opens the modal (lazy-loads this module, then calls
  `window.openLiveModal()`)
- `live-pause` — toggles pause/resume via
  `window.__spyglassLivePauseToggle()`
- `live-load` — loads the clicked row's specimen into the matching
  editor and closes the modal
