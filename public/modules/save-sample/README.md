# save-sample — library save / update modal

The library "save / update" modal: title + partner picker + notes,
plus the live partner-inference banner that asks the LLM to identify
the SSP / vendor based on the current bid_req / bid_res. Encrypts
blobs locally via the SpyglassSession facade BEFORE POSTing — the
server never sees plaintext.

## Loading

**Lazy.** This module is fetched only when the user clicks the
"💾 зберегти" button (case `'save-sample'` in spyglass.app.js
dispatcher). On first click: ~6KB across `index.js` + `i18n.js`. On
subsequent clicks: cached by the browser's ES module loader, zero
extra fetch.

The dispatcher's `'confirm-save'`, `'hint-pick-partner'`, and
`'hint-create-partner'` cases stay in spyglass.app.js — they only
fire AFTER the modal is open, by which point this module is already
loaded and the window APIs below are wired up.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t`
  from `/core/utils.js`. Exports `openSaveModal()`, `confirmSave()`,
  `pickPartner()`, `createPartnerFromHint()`. Self-registers all
  four on `window.openSaveModal` / `window.confirmSave` /
  `window._spy_pickPartner` / `window._spy_createPartner` for the
  dispatcher.
- `i18n.js` — 2 keys × 3 locales: `modal.save_sample.title` and
  `modal.save_sample.update_title`. Every other string the modal
  uses (`sample.label.*`, `hint.partner.*`, `toast.saved`,
  `toast.updated`, `btn.save`, `btn.cancel`, etc.) is shared with
  non-lazy surfaces and stays in the central `/i18n.js`.
- `README.md` — this file.

## Window APIs (provides)

- `window.openSaveModal()` — entry point, called by dispatcher case
  `'save-sample'`.
- `window.confirmSave({ asNew })` — submit handler, called by
  dispatcher case `'confirm-save'` (modal's primary / save-as-new
  buttons).
- `window._spy_pickPartner(id)` — partner-suggest banner action,
  called by dispatcher case `'hint-pick-partner'`.
- `window._spy_createPartner(name)` — partner-suggest banner action,
  called by dispatcher case `'hint-create-partner'`.

## Window APIs (consumes)

- `window.SpyglassSession` — round-5 facade (added 2026-05-XX in
  commit 42130f6). Provides ALL state + crypto access — this module
  never touches closure-private symbols (`_sessionDEK`, `_currentUser`,
  `_partnerCache`, `_currentSampleId`, `_currentSampleMeta`,
  `_isDirty`). Methods used:
  - `user`, `currentSampleId` / `setCurrentSampleId`,
    `currentSampleMeta` / `setCurrentSampleMeta`, `setDirty`,
    `partnerCache`
  - `api()`, `refreshPartners()`, `refreshSamples()`,
    `partnerOptionsHtml()`, `wireEnterSubmit()`
  - `hasSession()`, `encryptBlob()` — crypto ops; raw DEK bytes
    NEVER cross the facade.
- `window.closeModal` — modal lifecycle (provided by spyglass.app.js).
- `window.openAuthModal` — auth-gate fallback for guests.

## Auth gate

`openSaveModal()` checks `SpyglassSession.user` up front and bounces
guests through `openAuthModal('login')` with an explanatory toast —
guests never see the modal. `confirmSave()` additionally verifies
`SpyglassSession.hasSession()` before encrypting (defence in depth:
if the DEK was cleared mid-flight, e.g. by a sign-out from another
tab, fail loud rather than POST plaintext).

## DOM events / contracts

This module neither dispatches nor listens to any `kt:*` events. It
reads `#bidReq` / `#bidRes` / `#stEntity` (contracts owned by
`modules/inspector/`) and writes its modal into `#modalRoot`.

## Backend

- `POST /api/samples` — create new sample (encrypted blobs).
- `PATCH /api/samples/:id` — update existing sample.
- `POST /api/intel/suggest-partner` — LLM SSP-inference for the
  partner-suggest banner (best-effort; failures silently hide the
  banner).
- `POST /api/partners` — used by `_spy_createPartner` when the user
  accepts the LLM's "create new partner" suggestion.

## Dispatcher cases

Four `data-action` cases are wired through spyglass.app.js's central
dispatcher:

- `save-sample` — auth-gate is INSIDE openSaveModal() (guests see
  the toast + auth-modal redirect). Dispatcher just lazy-loads this
  module and calls `window.openSaveModal()`.
- `confirm-save` — calls `window.confirmSave({ asNew })` (the
  module is already loaded by this point).
- `hint-pick-partner` — calls `window._spy_pickPartner(id)`.
- `hint-create-partner` — calls `window._spy_createPartner(name)`.
