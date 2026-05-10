# recovery — single-show recovery-key modal

Shows the freshly-generated recovery key to the user **exactly once**
after register (or after an F5-survival re-show). The server only stores
the _wrap_, never the key bytes themselves — losing this modal without
saving the key means losing the only path back into the library if the
user forgets their password.

That single-show invariant is why close goes through a "did you really
save it?" confirm gate — Esc, backdrop click, and the explicit "I saved
it" button all share the same gate.

## Loading

**Lazy.** This module is fetched only on two paths:

- The dispatcher's `case 'show-recovery'` stub fires after register
  (called by `bootstrapNewCrypto` in `spyglass.app.js`).
- The boot-time F5-survival check in `spyglass.app.js` reads
  `sessionStorage.spyglass_recovery_pending_v1` directly (one cheap
  line, no module load) and only lazy-loads this module when a key is
  actually pending.

On first call: ~6KB across `index.js` + `i18n.js`. On subsequent calls:
cached by the browser's ES module loader, zero extra fetch.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t` from
  `/core/utils.js`. Exports `showRecoveryKeyModal`,
  `closeRecoveryKeyModal`, `copyRecoveryKey`,
  `isRecoveryKeyModalActive`. Self-registers all four on `window` for
  the dispatcher.
- `i18n.js` — 5 keys × 3 locales (`modal.recovery.title`,
  `recovery.body`, `btn.recovery_saved`, `toast.recovery_key_copied`,
  `confirm.recovery_save`).
- `README.md` — this file.

## Window APIs (provides)

- `window.showRecoveryKeyModal(key)` — open the modal, persist key to
  sessionStorage for F5-survival.
- `window.closeRecoveryKeyModal()` — confirm-gated close. Wipes the
  in-memory key, clears sessionStorage, calls
  `window.__spyglassRecoveryClosed` (shell hook) to clear `#modalRoot`
  and chain the post-register history-merge prompt.
- `window.copyRecoveryKey()` — clipboard copy with button flash. Pulls
  the key from module closure (NOT from a window global, NOT from a DOM
  attribute) so the secret never leaves this module's scope.
- `window.isRecoveryKeyModalActive()` — tested by the shell's
  `closeModal()` so it can route Esc/backdrop on OTHER modals through
  this one's confirm gate while the recovery modal is open.

## Window APIs (consumes)

- `window.closeModal` — fallback only (the shell installs
  `__spyglassRecoveryClosed` at boot and that's the normal path).
- `window.__spyglassRecoveryClosed` — shell hook that clears
  `#modalRoot` and chains the history-merge prompt if needed. Set by
  the shell's IIFE, cleared by the registry's deactivate cleanup.

## Sensitive-data discipline

The recovery key lives in module-scope `_currentRecoveryKey` for the
lifetime of the modal only. It is mirrored to `sessionStorage` (per-tab,
auto-cleared on tab close — same threat surface as the in-memory DEK)
so an accidental F5 doesn't lose it before the user has saved it. Both
copies are wiped on confirm-gated close. The key never enters
`localStorage`, the DOM dataset, or any URL.

## Dispatcher cases

Three `data-action` cases stay in `spyglass.app.js`'s central
dispatcher (they're trivial trampolines into the four `window.*`
exports — keeping them in the dispatcher matches the pattern used by
mirror/live/etc.):

- `copy-recovery` — `window.copyRecoveryKey()`
- `close-recovery` — `window.closeRecoveryKeyModal()`
- `modal-backdrop-close-recovery` — same as `close-recovery` but only
  when `ev.target === el` (so clicks inside the card don't close).

Plus the lazy-load entry point used by `bootstrapNewCrypto` and the
F5-survival path:

- `show-recovery` — lazy-imports `i18n.js` + `index.js`, then calls
  `window.showRecoveryKeyModal(key)`.
