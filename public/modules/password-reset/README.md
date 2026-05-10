# password-reset — forgot/reset password flow

Three-screen state machine for credential recovery:

1. **Forgot password** — user types email, server emails a `?reset=<token>`
   link.
2. **Reset password** — landing modal after the email click. User picks a
   mode (rotate / recover / wipe) and enters a new password.
3. **Submit** — for rotate/recover, the module unwraps the existing DEK
   _locally_ (KEK from old password OR recovery key), re-wraps it under a
   freshly-derived KEK, ships the new wrap-state to the server, and
   installs the live DEK so the user is unlocked immediately. For wipe
   mode, the server drops the user's encrypted blobs and the module
   nukes its local DEK.

## Loading

**Lazy.** Three triggers:

- URL boot: `?reset=<token>` detected in the shell (`spyglass.app.js`)
  → shell awaits `import('/modules/password-reset/...')` then calls
  `window.openPasswordResetFlow(token)`.
- "Forgot password?" link in the login modal / unlock modal → dispatcher
  case `'open-forgot'` lazy-imports + calls `window.openForgotPasswordFlow()`.
- `'do-forgot'` / `'do-reset'` / `'reset-cancel'` data-actions all run
  AFTER one of the two above triggers (the modal can't be open without
  the module already being loaded).

On first trigger: ~16KB (`index.js` + `i18n.js`). On subsequent triggers:
cached by the browser's ES module loader, zero extra fetch.

## Files

- `index.js` — ES module. Imports `$`, `escapeHtml`, `toast`, `t` from
  `/core/utils.js`. Self-registers entry points on `window` for the
  shell dispatcher and the inline `onchange="updateResetModeUI()"`
  attribute in the rendered radio inputs.
- `i18n.js` — 31 keys × 3 locales (`forgot.*`, `reset.*`,
  `modal.password_reset.title`, `toast.password_reset`).
- `README.md` — this file.

## Window APIs (provides)

- `window.openForgotPasswordFlow()` — entry from `'open-forgot'` action
- `window.openPasswordResetFlow(token)` — entry from URL `?reset=<token>` boot
- `window.doForgotPassword()` — submit handler (`'do-forgot'`)
- `window.doResetPassword()` — submit handler (`'do-reset'`)
- `window.updateResetModeUI()` — radio-toggle handler (called from inline
  `onchange=` attribute in the rendered modal — must remain on `window`)
- `window.cancelPasswordReset()` — clears in-flight context (called from
  the dispatcher's `'reset-cancel'` case)
- `window.__spyglassResetActive` — boolean flag the shell's `closeModal`
  reads to decide whether to strip `?reset=` from the URL on Esc/backdrop
  close

## SpyglassSession methods consumed

- `api(method, url, body)` — HTTP wrapper
- `setUser(u)` — install fresh user record after server returns it
- `setPendingUnlock(v)` — true after wipe (forces unlock-modal on next save)
- `clearDEK()` — drops in-memory + persisted DEK after wipe
- `importDEKFromBytes(dekBytes)` — installs the unwrapped DEK as a live
  CryptoKey in the shell closure. Bytes are not retained by the facade.
- `renderAuthWidget()`, `renderVerifyBanner()`, `refreshSamples()` —
  post-success UI refresh

## SpyglassCrypto methods consumed (via `window.SpyglassCrypto`)

- `deriveKEK(password, salt)` — PBKDF2 → AES-KW key
- `unwrapBytes(kek, iv, ct)` — extract raw DEK bytes from the wrapped
  blob (for rotate: with old password's KEK; for recover: with recovery
  key's KEK)
- `wrapBytes(kek, dekBytes)` — re-wrap under the new KEK
- `_b64ToBytes`, `_bytesToB64` — helpers for transmitting wrap-state

## DEK isolation (security invariants)

Raw DEK bytes appear ONLY as a local `let dekBytes` inside
`doResetPassword()`. They are produced by `Crypto.unwrapBytes` and
consumed by `Crypto.wrapBytes` + `Session.importDEKFromBytes`, then go
out of scope when the function returns. They are NEVER:

- Stored on `window`
- Stored in module-level `let`/`const` (the only module-level state is
  `_resetCtx` which holds the token + wrap-metadata, never raw DEK bytes)
- Attached to `_resetCtx`
- Held longer than one async function invocation

The CryptoKey object (the imported live DEK) lives only in the shell's
IIFE closure — neither this module nor any other module ever sees it.

## Backend

- `POST /api/auth/forgot-password` — anti-enumerating "email sent" 200.
- `POST /api/auth/reset-password/state` — proves token validity, returns
  the user's encryption blob (kdf*salt, dek_iv, dek_wrapped, recovery*\*).
- `POST /api/auth/reset-password` — accepts {token, mode, newPassword,
  optional oldPassword, new wrap-state} and persists the rotation
  atomically.

## Dispatcher cases (stay in `spyglass.app.js`)

- `'open-forgot'` — lazy-loads this module, then calls `openForgotPasswordFlow`
- `'do-forgot'` — calls `window.doForgotPassword` (always present once
  module loaded)
- `'do-reset'` — calls `window.doResetPassword`
- `'reset-cancel'` — closes modal + strips URL + calls `cancelPasswordReset`

## Boot-time URL trigger (stays in `spyglass.app.js`)

`?reset=<token>` detection at boot stays in the shell. On detection the
shell lazy-imports this module and calls `window.openPasswordResetFlow(token)`.
