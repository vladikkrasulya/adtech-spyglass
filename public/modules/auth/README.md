# auth — login + register modal

The two-tab modal that swaps between "sign in" and "create account" — entry
point for the whole authenticated experience. POSTs against
`/api/auth/{login,register}`; on success delegates the DEK lifecycle to
`window.SpyglassSession` (the closure-scoped facade in `spyglass.app.js`).
The DEK never leaves that scope — this module never touches raw key bytes
or the closure-private `_sessionDEK` variable.

## Loading

**Lazy.** Fetched only when the user clicks the "увійти" button (header,
`data-action="open-auth"`) or when an auth-gated action fires on a guest
(save-sample, save-corpus, etc.) — see case `'open-auth'` in
`spyglass.app.js` dispatcher and the inline `lazyOpenAuth()` helper. On
first activation: ~3.5KB across `index.js` + `i18n.js`. On subsequent
activations: cached by the browser's ES module loader.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t` from
  `/core/utils.js`. Exports `openAuthModal(mode)`, `doLogin()`,
  `doRegister()`. Self-registers on `window.openAuthModal`,
  `window.doLogin`, `window.doRegister` for the dispatcher.
- `i18n.js` — 13 keys × 3 locales (auth-modal-exclusive: titles,
  password hint, primary buttons, login↔register switch, server-error
  codes mapped via `humanAuthError`, plus `toast.hello`,
  `toast.account_created`, `toast.account_created_email_failed`).
- `README.md` — this file.

## Window APIs (provides)

- `window.openAuthModal(mode)` — `'login'` | `'register'`. Renders the
  modal + wires the Enter-submit handler.
- `window.doLogin()` — POST /api/auth/login + DEK unlock via
  `SpyglassSession.openFromPassword` (or bootstrap-on-first-login for
  legacy pre-Phase-7 accounts).
- `window.doRegister()` — POST /api/auth/register + bootstrap fresh
  DEK via `SpyglassSession.bootstrap` + show recovery key once.

## Window APIs (consumes)

- `window.SpyglassSession.{api, refreshPartners, refreshSamples,
renderAuthWidget, setUser, openFromPassword, bootstrap}` — facade for
  HTTP, sample/partner reloads, auth-widget paint, DEK lifecycle. The
  facade keeps `_sessionDEK` in its closure; we never see raw bytes.
- `window.closeModal` — modal lifecycle (provided by spyglass.app.js;
  triggered by `data-action="modal-close"` /
  `data-action="modal-backdrop-close"` plus the global Esc handler).
- `window.openRecoveryKeyModalLazy(recoveryKey)` — lazy-imports
  `/modules/recovery/` (already its own module) and shows the recovery
  key once. Invoked from the register flow + the legacy-account
  bootstrap path inside `doLogin`. We use the lazy wrapper, not
  `window.showRecoveryKeyModal` directly, because the recovery module
  is fetched on demand and may not be loaded yet on first activation.
- `window.snapshotPendingHistoryMerge()` — sets the closure-private
  `_pendingHistoryMerge` flag (mirrors `historyStore.length > 0` at
  call time). Snapshot must happen **before** the bootstrap shows the
  recovery modal so `closeRecoveryKeyModal` can chain the import-
  history prompt once the user acknowledges the key. Helper is a
  one-liner exposed by `spyglass.app.js`; the flag itself stays in
  the closure because `closeRecoveryKeyModal` (also closure-private)
  reads it.

## DOM events

This module neither dispatches nor listens to any `kt:*` events. It
writes its modal into `#modalRoot` (a contract owned by
`modules/inspector/`) and reads two input fields (`#authEmailInput`,
`#authPasswordInput`).

## Backend

Talks to:

- `POST /api/auth/login` — credential check + (if Phase-7 set up)
  encryption blob in the response
- `POST /api/auth/register` — account create + verify-email send (best-
  effort; surfaces `email_sent: false` so the modal can warn)
- `POST /api/auth/setup-encryption` — opaque crypto-state bootstrap;
  called exclusively from `bootstrapAndShowRecovery` (covers both new
  registrations and legacy pre-Phase-7 first-logins)

Server error codes (`invalid_email`, `weak_password`, `email_taken`,
`invalid_credentials`, `rate_limited`) map to localized messages via
`humanAuthError(e)` — table lives inside `index.js` because no caller
outside auth ever translates these codes.

## Dispatcher cases

Two `data-action` cases stay in spyglass.app.js's central dispatcher:

- `open-auth` — opens the modal (lazy-loads this module, then calls
  `window.openAuthModal(el.dataset.mode || 'login')`). Also fired by
  the auth-gate fallback in `openSaveModal`, `open-corpus-save`, and
  `open-unlock` (for guests with no cookie session).
- `do-auth` — primary-button submit; `el.dataset.mode === 'register'`
  picks `doRegister` else `doLogin`. By the time this fires the modal
  is on screen, so the module is already loaded — direct
  `window.doLogin/Register()` works without re-importing.

## Why crypto stays behind the SpyglassSession facade

`_sessionDEK` is a `CryptoKey` (extractable, `AES-GCM`). Keeping it in
the IIFE closure means **no module — even this one — can read its
bytes**. SpyglassSession exposes verbs (`openFromPassword`,
`bootstrap`, `encryptBlob`, `decryptBlob`) that perform operations
internally; the auth module just hands over a password and gets back
metadata (`{state, recoveryKey}` from bootstrap) or nothing (login
case). If a future module is compromised it cannot exfiltrate the
DEK — only request operations from the facade, which an attacker
needs an active modal/UI flow to drive.
