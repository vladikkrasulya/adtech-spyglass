# unlock — re-derive DEK from password

Surfaces a minimal modal that takes only the password and re-derives
the session DEK against the live cookie session. Used when the cookie
is alive but `sessionStorage` was cleared (different tab, manual
clean-up, page reload edge case) — the library list is logged-in but
locked, and the user wants the saved samples back without the full
login dance.

## Loading

**Lazy.** Fetched only when the user clicks the "розблокувати" CTA in
the saved-list shell, or hits any `data-action="open-unlock"` button
(case `'open-unlock'` in ortbtools.app.js dispatcher). On first click:
~3KB across `index.js` + `i18n.js`. On subsequent clicks: cached by the
browser's ES module loader, zero extra fetch.

The dispatcher's `'do-unlock'` case stays in ortbtools.app.js — it
fires AFTER the modal is open (from the modal's primary button or
⏎-to-submit), by which point this module is already loaded and
`window.doUnlock` is wired up.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t`
  from `/core/utils.js`. Exports `openUnlockModal()` and
  `doUnlock()`. Self-registers both on `window.openUnlockModal` /
  `window.doUnlock` for the dispatcher.
- `i18n.js` — 7 keys × 3 locales: `modal.unlock.title`,
  `unlock.subtitle`, `unlock.err.no_crypto`,
  `unlock.err.wrong_password`, `btn.unlock`, `btn.signout_instead`,
  `toast.library_unlocked`.
- `README.md` — this file.

## Window APIs (provides)

- `window.openUnlockModal()` — entry point, called by dispatcher
  case `'open-unlock'`.
- `window.doUnlock()` — submit handler, called by dispatcher
  case `'do-unlock'` (the modal's primary button + ⏎ on the input).

## Window APIs (consumes)

- `window.closeModal` — modal lifecycle (provided by ortbtools.app.js).
- `window.openAuthModal` — guest fallback (provided by ortbtools.app.js;
  the unlock modal is for signed-in-but-locked users only).
- `window.OrtbtoolsSession.user` — currently signed-in user (read for
  the email-in-subtitle + presence guard).
- `window.OrtbtoolsSession.api` — HTTP helper (for `/api/auth/me`).
- `window.OrtbtoolsSession.openFromPassword(password, encState, opts)` —
  re-derives KEK from password, unwraps DEK, persists it. The raw
  CryptoKey never crosses the module boundary; the facade keeps it
  in the shell closure.
- `window.OrtbtoolsSession.refreshSamples` — re-renders the saved-list
  once the DEK is back in place.
- `window.OrtbtoolsSession.wireEnterSubmit` — ⏎-to-submit on the
  password input.

## Auth gate

The dispatcher's `'open-unlock'` case lazy-loads this module
unconditionally (no cookie ⇒ `OrtbtoolsSession.user` is null ⇒ the
modal redirects to `openAuthModal('login')` itself). `doUnlock()`
relies on the live cookie for the `/api/auth/me` round-trip; if the
cookie has expired between modal-open and submit, the API call fails
and we surface `unlock.err.wrong_password` (best-effort UX — the user
re-tries via the auth modal).

## DOM events / contracts

This module neither dispatches nor listens to any `kt:*` events. It
writes into `#modalRoot` and reads `#unlockPwInput` / `#unlockError`
inside the modal.

## Dispatcher cases

Two `data-action` cases are wired through ortbtools.app.js's central
dispatcher:

- `open-unlock` — lazy-loads this module and calls
  `window.openUnlockModal()`.
- `do-unlock` — calls `window.doUnlock()` (the module is already
  loaded by this point).

The `'signout'` action inside this modal (the "sign out instead"
button) is handled by the central dispatcher, not by this module —
it shares the header sign-out button's logic.
