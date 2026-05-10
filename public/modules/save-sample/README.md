# save-sample — encrypted-sample save / update modal

Opens the "save sample" / "update sample" modal, encrypts BidRequest +
BidResponse with the in-memory session DEK, and POSTs (or PATCHes) to
the sample API. Drives the inline partner-inference banner (Phase C-1):
gemma names the SSP/vendor while the user is still typing the title;
banner offers a one-click "use this partner" / "create partner" path.

## Loading

**Lazy.** This module is fetched only when the user clicks the
"💾 зберегти" button (case `'save-sample'` in spyglass.app.js
dispatcher). On first click: ~10KB across `index.js` + `i18n.js`. On
subsequent clicks: cached by the browser's ES module loader, zero extra
fetch.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t` from
  `/core/utils.js`. Exports `openSaveModal`, `confirmSave`,
  `pickPartner`, `createPartner`. Self-registers all four on `window.*`
  for the central dispatcher.
- `i18n.js` — 10 keys × 3 locales (`modal.save_sample.*` +
  save-sample-specific `toast.*` + `hint.partner.*`).
- `README.md` — this file.

## Window APIs (provides)

- `window.openSaveModal()` — entry point; opens the modal (or the auth
  modal if the user isn't signed in).
- `window.confirmSave(opts)` — submit handler. `opts.asNew` forks the
  current sample.
- `window._spy_pickPartner(id)` — partner-hint banner action: select
  the suggested existing partner.
- `window._spy_createPartner(name)` — partner-hint banner action:
  POST + select a new partner.

## Window APIs (consumes)

- `window.closeModal` — modal lifecycle (provided by spyglass.app.js).
- `window.refreshSamples` — library list refresh (provided by
  spyglass.app.js).
- `window.openAuthModal` — auth-gate redirect for guests (provided
  by spyglass.app.js).
- `window.SpyglassCrypto` — AES-GCM blob encryption helper (global,
  loaded eagerly in the HTML shell).
- `window.__spyglassSaveDeps` — bridge object exposed by
  spyglass.app.js's IIFE so this lazy module can read/write the
  closure-private state and helpers it needs:
  - getters: `getCurrentUser`, `getSessionDEK`, `getCurrentSampleId`,
    `getCurrentSampleMeta`, `getPartnerCache`
  - setters: `setCurrentSampleId`, `setCurrentSampleMeta`, `setIsDirty`,
    `setPartnerCache`
  - functions: `api(method, url, body)`, `refreshPartners()`,
    `partnerOptionsHtml(selectedId)`, `wireEnterSubmit(inputId, action)`

## Backend

- `POST /api/samples` — create a new encrypted sample.
- `PATCH /api/samples/:id` — update an existing sample.
- `POST /api/intel/suggest-partner` — gemma SSP/vendor inference for
  the partner banner (Phase C-1, local Ollama).
- `POST /api/partners` + `GET /api/partners` — partner CRUD when the
  banner offers "create new partner".

## Dispatcher cases

The central `data-action` dispatcher in spyglass.app.js handles four
cases that lazy-load this module on first hit:

- `save-sample` — opens the modal (lazy-loads this module, then calls
  `window.openSaveModal()`).
- `confirm-save` — fires `window.confirmSave({ asNew })`. Module is
  guaranteed loaded by the time the modal is open.
- `hint-pick-partner`, `hint-create-partner` — banner button handlers;
  fire `window._spy_pickPartner` / `window._spy_createPartner`. Same
  guarantee — the banner only exists after the modal is open.

## Events

This module dispatches no custom `kt:*` events. State changes
propagate through:

- `window.refreshSamples()` — library list pickup after a successful
  save / update.
- `window.__spyglassSaveDeps.setIsDirty(false)` — clears the
  unsaved-edits flag in the central IIFE.
