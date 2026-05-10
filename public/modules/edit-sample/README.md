# edit-sample — sample-metadata editor modal

Lets the signed-in user rename a saved sample, change its partner,
or update its notes — without touching the encrypted payload
(req/res ciphertext is owned by the save-sample modal). PATCHes
`/api/samples/:id` with metadata only.

## Loading

**Lazy.** This module is fetched only when the user clicks the ✎
pencil button on a library row (case `'sample-edit'` in
spyglass.app.js dispatcher). On first click: ~3KB across
`index.js` and `i18n.js`. On subsequent clicks: cached by the
browser's ES module loader, zero extra fetch.

The dispatcher's `'confirm-edit'` case stays in spyglass.app.js —
it only fires AFTER the modal is open (from the modal's primary
button), by which point this module is already loaded and
`window.confirmEdit` is wired up.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t`
  from `/core/utils.js`. Exports `editSample(id)` and
  `confirmEdit(id)`. Self-registers both on `window.editSample` /
  `window.confirmEdit` for the dispatcher.
- `i18n.js` — 1 key × 3 locales: `modal.edit_sample.title`.
  Everything else (`sample.label.*`, `toast.saved`,
  `toast.save_changes_failed`, `btn.save`, `btn.cancel`) is shared
  with the still-inline save-sample modal and stays in central
  `/i18n.js`.
- `README.md` — this file.

## Window APIs (provides)

- `window.editSample(id)` — entry point, called by dispatcher case
  `'sample-edit'`.
- `window.confirmEdit(id)` — submit handler, called by dispatcher
  case `'confirm-edit'` (the modal's primary button).

## Window APIs (consumes)

- `window.SpyglassSession` — the closure-state facade defined in
  spyglass.app.js. Methods used:
  - `api(method, url, body)` — auth-cookied HTTP wrapper.
  - `partnerOptionsHtml(selectedId)` — renders the partner
    `<select>` from the closure-private `_partnerCache`.
  - `wireEnterSubmit(inputId, fn)` — ⏎ in the title field submits.
  - `currentSampleId` (getter) — sync-meta check (only update the
    loaded-meta if the user is editing the currently loaded sample).
  - `currentSampleMeta` (getter) — same check, plus null-guard.
  - `setCurrentSampleMeta(v)` — write the synced meta back.
  - `refreshSamples()` — re-render the Library after PATCH so the
    new title/partner/notes show immediately.
- `window.closeModal` — modal lifecycle (provided by
  spyglass.app.js; triggered by `data-action="modal-close"` and
  `data-action="modal-backdrop-close"` plus the global Esc handler).

## Auth gate

The ✎ pencil button only renders on library rows, which only
render for signed-in users — by the time `editSample(id)` runs,
sign-in is guaranteed. The dispatcher does not need a separate
auth check for `'sample-edit'`. `confirmEdit(id)` inherits the
guarantee since it can only fire from a button inside an
already-open modal.

## DOM events / contracts

This module neither dispatches nor listens to any `kt:*` events.
It writes its modal into `#modalRoot` (a contract owned by
`modules/inspector/`) and reads its three input fields (`#mTitle`,
`#mPartner`, `#mNotes`).

## Backend

Talks to:

- `GET /api/samples/:id` — fetch current metadata (no decrypt).
- `PATCH /api/samples/:id` — update title/partner_id/notes only.

Both go through `SpyglassSession.api(...)` so cookie-auth + the
shared error shape (`status` + `code` on the thrown Error) are
identical to the rest of the app.

## Dispatcher cases

Two `data-action` cases are wired through spyglass.app.js's central
dispatcher:

- `sample-edit` — lazy-loads this module and calls
  `window.editSample(Number(el.dataset.id))`.
- `confirm-edit` — calls
  `window.confirmEdit(Number(el.dataset.id))` (the module is
  already loaded by this point).
