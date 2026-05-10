# partners — partner-management modal

Tiny CRUD modal for the user's partner list — the per-account labels
attached to saved samples. Lists existing partners with delete buttons;
one input row to add a new one. POSTs/DELETEs against `/api/partners`;
on every mutation re-pulls the cache via `window.refreshPartners()`
(owned by spyglass.app.js — `_partnerCache` is shared with the
partner-suggest banner and the save modal's `<select>`, so the cache
cannot move into this module).

## Loading

**Lazy.** This module is fetched only when the user clicks the
"👥 партнери" button or arrives via the cabinet's "Manage partners"
deep-link (`?open=partners`) — see case `'open-partners'` in
spyglass.app.js dispatcher. On first click: ~3KB across `index.js` +
`i18n.js`. On subsequent clicks: cached by the browser's ES module
loader, zero extra fetch.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t` from
  `/core/utils.js`. Exports `openPartnerModal()`, `confirmAddPartner()`,
  `deletePartner(id)`. Self-registers on `window.openPartnerModal`,
  `window.confirmAddPartner`, `window.deletePartner` for the dispatcher.
- `i18n.js` — 10 keys × 3 locales (`modal.partners.*`, `partner.label.*`,
  `partner.placeholder`, `empty.partners`, partner-CRUD toasts, the two
  `confirm.delete_partner*` strings).
- `README.md` — this file.

## Window APIs (provides)

- `window.openPartnerModal()` — entry point, called by dispatcher and
  by the cabinet deep-link guard.
- `window.confirmAddPartner()` — POST /api/partners + re-render.
  Wired to `data-action="confirm-add-partner"`.
- `window.deletePartner(id)` — DELETE /api/partners/:id + re-render.
  Wired to `data-action="delete-partner"`.

## Window APIs (consumes)

- `window.refreshPartners` — re-pulls `_partnerCache` (owned by
  spyglass.app.js; shared with partner-suggest banner and save-modal
  `<select>`). Called after every successful POST/DELETE.
- `window.getPartners` — read-only getter for `_partnerCache`. The
  module renders the list straight from this getter so it doesn't
  need to duplicate the cache.
- `window.refreshSamples` — re-render Library after partner mutations
  (sample partner names change when a partner is renamed/deleted).
- `window.closeModal` — modal lifecycle (provided by spyglass.app.js;
  triggered by `data-action="modal-close"` /
  `data-action="modal-backdrop-close"` plus the global Esc handler).

## DOM events

This module neither dispatches nor listens to any `kt:*` events. It
writes its modal into `#modalRoot` (a contract owned by
`modules/inspector/`) and reads its single input field
(`#pName`).

## Backend

Talks to:

- `POST /api/partners` — create
- `DELETE /api/partners/:id` — delete
- `GET /api/partners/:id/samples-count` — pre-delete confirm count

Uses an inline `api()` helper that mirrors spyglass.app.js's local
helper (same error shape — `status` + `code` on the thrown Error —
so the `partner_not_found` / 401 paths still surface meaningfully).

## Dispatcher cases

Three `data-action` cases stay in spyglass.app.js's central dispatcher
because they fire from inside the modal body (so they only matter once
this module is already loaded — no point gating them behind a lazy
import):

- `open-partners` — opens the modal (lazy-loads this module, then
  calls `window.openPartnerModal()`)
- `confirm-add-partner` — calls `window.confirmAddPartner()`
- `delete-partner` — calls `window.deletePartner(Number(el.dataset.id))`

## Why state stays in spyglass.app.js

`_partnerCache` and `refreshPartners` are NOT moved here — they're
shared with code that runs **outside** the modal:

- The partner-inference banner in the save modal
  (`window._spy_pickPartner`, `window._spy_createPartner`) reads the
  cache to find an existing match before suggesting a create.
- The save modal's partner `<select>` is rebuilt from the cache on
  every open via `partnerOptionsHtml(selectedId)`.
- `refreshSamples` decorates each row with the partner name from the
  cache (`partnerName(id)`).

If the cache moved into this module, all of those would have to
lazy-import `partners/` on first auth, defeating the lazy-loading
goal. So the rule: cache lives in spyglass.app.js, the modal that
mutates it is lazy.
