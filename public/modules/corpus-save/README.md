# corpus-save — behavior corpus labeller

Lets the signed-in user pick a label (legitimate / fraud / ambiguous)
and optional notes for the events captured by the current behavior
probe, then POSTs them to `/api/behavior/corpus` so they become a
labeled training sample for the confusion matrix in the cabinet.

## Loading

**Lazy.** This module is fetched only when the user clicks the
"зберегти як corpus" button in the behavior tab (case
`'open-corpus-save'` in spyglass.app.js dispatcher). On first click:
~5KB across `index.js` + `i18n.js`. On subsequent clicks: cached by
the browser's ES module loader, zero extra fetch.

The dispatcher's `'confirm-corpus-save'` case stays in
spyglass.app.js — it only fires AFTER the modal is open (from the
modal's primary button), by which point this module is already
loaded and the window APIs below are wired up.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t`
  from `/core/utils.js`. Exports `openCorpusSaveModal()` and
  `confirmCorpusSave()`. Self-registers both on
  `window.openCorpusSaveModal` / `window.confirmCorpusSave` for the
  dispatcher.
- `i18n.js` — 11 keys × 3 locales: `modal.corpus_save.*` (8 keys)
  plus `toast.corpus_saved`, `toast.corpus_save_failed`,
  `toast.corpus_no_events`.
- `README.md` — this file.

## Window APIs (provides)

- `window.openCorpusSaveModal()` — entry point, called by dispatcher
  case `'open-corpus-save'`.
- `window.confirmCorpusSave()` — submit handler, called by dispatcher
  case `'confirm-corpus-save'` (the modal's primary button).

## Window APIs (consumes)

- `window.closeModal` — modal lifecycle (provided by spyglass.app.js).
- `window.__spyglassBehavior.events` — array of probe events
  (provided by `modules/behavior/`); the modal filters out
  `kind === 'probe_ready'` markers and saves the rest.
- `window._currentSampleId` — optional id of the library sample the
  probe was run against; passed through to the API as
  `sourceSampleId`.

## Auth gate

The dispatcher's `'open-corpus-save'` case is responsible for the
"signed in?" check (it has access to the closure `_currentUser` in
spyglass.app.js). If the user is signed out, the dispatcher toasts
`toast.signin_to_save` and opens the auth modal — this module is
NOT lazy-loaded in that path. By the time `openCorpusSaveModal()`
runs, sign-in is guaranteed; `confirmCorpusSave()` inherits that
guarantee since it can only fire from a button inside an
already-open modal.

## DOM events / contracts

This module neither dispatches nor listens to any `kt:*` events. It
reads `window.__spyglassBehavior.events` (a contract owned by
`modules/behavior/`) and writes its modal into `#modalRoot`.

## Backend

Talks to `POST /api/behavior/corpus`. Each entry is keyed by the
signed-in user. Deletion of an existing entry is handled by the
`'corpus-delete'` dispatcher case in spyglass.app.js (one-shot
fetch, no modal needed) — it stays there.

## Dispatcher cases

Two `data-action` cases are wired through spyglass.app.js's central
dispatcher:

- `open-corpus-save` — auth-gates, then lazy-loads this module and
  calls `window.openCorpusSaveModal()`.
- `confirm-corpus-save` — calls `window.confirmCorpusSave()` (the
  module is already loaded by this point).

The unrelated `'corpus-delete'` case stays in spyglass.app.js — it
neither needs a modal nor migrates with this one. The eager
`injectCorpusBar` helper (which renders the "save as corpus" button
into the behavior tab) also stays — it lives in the inspector
behavior-tab rendering, not in a modal.
