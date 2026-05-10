/* ============================================================
   modules/password-reset/index.js — forgot/reset password flow
   (lazy-loaded ES module).

   Spans three modal screens that work as one state-machine:

     1. openForgotPasswordFlow()      — "I forgot my password" form
        ↓ user types email, server emails a link with `?reset=<token>`
     2. openPasswordResetFlow(token)  — landing modal after the email
        click. Fetches crypto state for that token, lets the user pick
        a mode (rotate / recover / wipe), enters new password.
     3. doResetPassword()             — submits. For rotate/recover we
        unwrap the existing DEK *locally* (KEK derived from old
        password OR from recovery key), re-wrap under a freshly-derived
        new KEK, ship the new wrap-state to the server, then install
        the live DEK via SpyglassSession.importDEKFromBytes() so the
        user is unlocked immediately. For wipe we just send the new
        password and nuke our local DEK.

   ── Loading ─────────────────────────────────────────────────
   Lazy. Three triggers:
     a) URL boot: ?reset=<token> detected by shell (spyglass.app.js)
        → shell awaits import(), then calls window.openPasswordResetFlow.
     b) "Forgot password?" link in login modal / unlock modal →
        dispatcher case 'open-forgot' → calls window.openForgotPasswordFlow.
     c) Re-open after URL strip is impossible (token is single-use).

   ── DEK isolation invariants (DO NOT VIOLATE) ───────────────
   • Raw DEK bytes appear ONLY as a local `const dekBytes` inside
     doResetPassword(). They are produced by SpyglassCrypto.unwrapBytes
     and consumed by SpyglassCrypto.wrapBytes + SpyglassSession.
     importDEKFromBytes(), then go out of scope when the function
     returns.
   • DEK bytes are NEVER stored on `window`, NEVER in module-level
     `let`/`const`, NEVER attached to _resetCtx.
   • The CryptoKey itself (the imported DEK) is held by the shell's
     IIFE closure via importDEKFromBytes — never touched from this
     module.

   Exposed window APIs:
     - window.openForgotPasswordFlow()       — entry from 'open-forgot'
     - window.openPasswordResetFlow(token)   — entry from URL boot
     - window.doForgotPassword()             — submit handler ('do-forgot')
     - window.doResetPassword()              — submit handler ('do-reset')
     - window.updateResetModeUI()            — radio onchange (inline attr
                                                in the rendered modal —
                                                MUST stay on window)

   Consumes:
     - window.SpyglassSession (api, wireEnterSubmit, importDEKFromBytes,
       setUser, setPendingUnlock, clearDEK, renderAuthWidget,
       renderVerifyBanner, refreshSamples)
     - window.SpyglassCrypto (deriveKEK, wrapBytes, unwrapBytes,
       _b64ToBytes, _bytesToB64)
     - window.closeModal
     - $, escapeHtml, toast, t   from /core/utils.js
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

// In-progress reset context (token + crypto state + email). Lives only
// for the duration of the modal — set in openPasswordResetFlow, read
// in doResetPassword, cleared on success/cancel/backdrop-close. Module
// scope means only this file can see it; the ES module boundary keeps
// it inaccessible from the shell or other modules.
let _resetCtx = null;

// Lets the shell's closeModal() know a reset is in progress so it can
// strip ?reset= from the URL on Esc/backdrop close. Cleared whenever
// _resetCtx is cleared. We keep this on window because closeModal()
// lives in the shell and can't import from a module.
function setResetActive(v) {
  if (v) {
    window.__spyglassResetActive = true;
  } else {
    delete window.__spyglassResetActive;
  }
}

// ── Forgot password (request reset email) ──────────────────────────
export function openForgotPasswordFlow() {
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card">' +
    '<div class="modal-title">' +
    t('modal.password_reset.title') +
    '</div>' +
    '<div style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:var(--space-3)">' +
    t('forgot.subtitle') +
    '</div>' +
    '<div class="modal-row"><label>' +
    t('auth.label.email') +
    '</label><input id="forgotEmailInput" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
    '<div id="forgotMessage" style="font-size:var(--fs-sm);color:var(--text-dim);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost btn-sm" data-action="open-auth" data-mode="login">' +
    t('forgot.btn.back_to_login') +
    '</button>' +
    '<button class="btn btn-primary btn-sm" data-action="do-forgot">' +
    t('forgot.btn.send') +
    '</button>' +
    '</div></div></div>';
  setTimeout(() => $('forgotEmailInput').focus(), 0);
  $('forgotEmailInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.doForgotPassword();
    }
  });
}

export async function doForgotPassword() {
  const email = $('forgotEmailInput').value.trim();
  const msgEl = $('forgotMessage');
  if (!email) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = t('forgot.email_required');
    return;
  }
  // Client-side email shape check — mirrors auth.js EMAIL_RE on server.
  // Without it, "asdf" hits the API, server returns 200 (anti-enumeration),
  // UI showed misleading "лист відправлено" for an obviously-bad address.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = t('forgot.invalid_email');
    return;
  }
  msgEl.style.color = 'var(--text-dim)';
  msgEl.textContent = t('forgot.sending');
  try {
    await window.SpyglassSession.api('POST', 'api/auth/forgot-password', { email });
    msgEl.style.color = 'var(--success, green)';
    msgEl.textContent = t('forgot.sent');
  } catch (e) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = e.message || t('toast.error_generic', { error: '' });
  }
}

// ── Password reset (after clicking email link with ?reset=<token>) ──
export async function openPasswordResetFlow(token) {
  // Fetch crypto state (proves token is valid via server) before showing UI.
  let stateRes;
  try {
    stateRes = await window.SpyglassSession.api('POST', 'api/auth/reset-password/state', { token });
  } catch (e) {
    toast(t('reset.err.link_invalid', { error: e.message || '' }), 'error');
    // Strip ?reset= from URL so refresh doesn't re-trigger.
    history.replaceState({}, '', location.pathname);
    return;
  }
  const enc = stateRes.encryption;
  const email = stateRes.email;
  _resetCtx = { token, encryption: enc, email };
  setResetActive(true);

  const radioBox = (val, key, hintColor) =>
    '<label style="display:flex;align-items:flex-start;gap:var(--space-2);cursor:pointer;padding:var(--space-2);border:1px solid var(--border);border-radius:4px;margin-bottom:var(--space-2)">' +
    '<input type="radio" name="resetMode" value="' +
    val +
    '"' +
    (val === 'rotate' ? ' checked' : '') +
    ' onchange="updateResetModeUI()" style="margin-top:3px">' +
    '<span><b>' +
    t('reset.mode.' + key) +
    '</b><br><span style="font-size:var(--fs-sm);color:' +
    hintColor +
    '">' +
    t('reset.mode.' + key + '_hint') +
    '</span></span></label>';
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card" style="max-width:520px">' +
    '<div class="modal-title">' +
    t('modal.password_reset.title') +
    '</div>' +
    '<div style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:var(--space-3)">' +
    escapeHtml(email) +
    '</div>' +
    '<div class="modal-row" style="display:block">' +
    radioBox('rotate', 'rotate', 'var(--text-dim)') +
    radioBox('recover', 'recover', 'var(--text-dim)') +
    radioBox('wipe', 'wipe', 'var(--danger)') +
    '</div>' +
    '<div id="resetModeFields"></div>' +
    '<div class="modal-row"><label>' +
    t('reset.label.new_password') +
    '</label>' +
    '<input id="resetNewPwInput" type="password" autocomplete="new-password"></div>' +
    '<div id="resetError" style="color:var(--danger);font-size:var(--fs-sm);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost btn-sm" data-action="reset-cancel">' +
    t('btn.cancel') +
    '</button>' +
    '<button id="resetPrimaryBtn" class="btn btn-primary btn-sm" data-action="do-reset">' +
    t('reset.btn.reset') +
    '</button>' +
    '</div></div></div>';
  window.updateResetModeUI();
  // Auto-focus the first input visible in the default mode (rotate → oldPw).
  setTimeout(() => $('resetOldPwInput')?.focus(), 0);
}

export function updateResetModeUI() {
  const mode = document.querySelector('input[name="resetMode"]:checked').value;
  const f = $('resetModeFields');
  // Preserve any values the user typed in the previous mode so toggling
  // radios doesn't wipe their input.
  const prev = {
    old: $('resetOldPwInput')?.value || '',
    recovery: $('resetRecoveryInput')?.value || '',
    wipeConfirm: $('resetWipeConfirm')?.checked || false,
  };
  if (mode === 'rotate') {
    f.innerHTML =
      '<div class="modal-row"><label>' +
      t('reset.label.old_password') +
      '</label>' +
      '<input id="resetOldPwInput" type="password" autocomplete="current-password" value="' +
      escapeHtml(prev.old) +
      '"></div>';
    setTimeout(() => $('resetOldPwInput')?.focus(), 0);
  } else if (mode === 'recover') {
    f.innerHTML =
      '<div class="modal-row"><label>' +
      t('reset.label.recovery') +
      '</label>' +
      '<input id="resetRecoveryInput" type="text" autocomplete="off" placeholder="xxxx-xxxx-xxxx-xxxx-..." style="font-family:monospace" value="' +
      escapeHtml(prev.recovery) +
      '"></div>';
    setTimeout(() => $('resetRecoveryInput')?.focus(), 0);
  } else {
    f.innerHTML =
      '<div style="background:rgba(220,40,40,.08);border:1px solid var(--danger);padding:var(--space-2);border-radius:4px;margin-bottom:var(--space-3);font-size:var(--fs-sm)">' +
      t('reset.wipe_warn') +
      '<label style="display:flex;align-items:center;gap:var(--space-2);margin-top:var(--space-2);cursor:pointer">' +
      '<input type="checkbox" id="resetWipeConfirm"' +
      (prev.wipeConfirm ? ' checked' : '') +
      '> ' +
      t('reset.wipe_confirm') +
      '</label>' +
      '</div>';
  }
  // Primary button label matches the destructive intent in wipe mode.
  const btn = $('resetPrimaryBtn');
  if (btn) {
    btn.textContent = t(mode === 'wipe' ? 'reset.btn.wipe_reset' : 'reset.btn.reset');
    btn.classList.toggle('danger', mode === 'wipe');
  }
}

export async function doResetPassword() {
  const mode = document.querySelector('input[name="resetMode"]:checked').value;
  const newPassword = $('resetNewPwInput').value;
  const errEl = $('resetError');
  errEl.textContent = '';
  if (newPassword.length < 8) {
    errEl.textContent = t('reset.err.short_password');
    return;
  }
  const ctx = _resetCtx;
  if (!ctx) {
    errEl.textContent = t('reset.err.session_lost');
    return;
  }
  const Crypto = window.SpyglassCrypto;
  const Session = window.SpyglassSession;
  try {
    let body;
    // dekBytes lives ONLY as a local const in this scope. It is produced
    // by Crypto.unwrapBytes (rotate or recover branch) and handed to
    // Crypto.wrapBytes + Session.importDEKFromBytes, then falls out of
    // scope when this function returns. NEVER assigned to window, to
    // _resetCtx, or to any outer scope.
    let dekBytes = null;
    if (mode === 'wipe') {
      if (!$('resetWipeConfirm').checked) {
        errEl.textContent = t('reset.err.wipe_unconfirmed');
        return;
      }
      body = { token: ctx.token, mode: 'wipe', newPassword };
    } else {
      // rotate / recover: unwrap DEK locally, re-wrap under new KEK.
      if (!ctx.encryption) {
        errEl.textContent = t('reset.err.no_state');
        return;
      }
      if (mode === 'rotate') {
        const oldPassword = $('resetOldPwInput').value;
        if (!oldPassword) {
          errEl.textContent = t('reset.err.old_required');
          return;
        }
        const oldSalt = Crypto._b64ToBytes(ctx.encryption.kdf_salt);
        const oldKEK = await Crypto.deriveKEK(oldPassword, oldSalt);
        try {
          dekBytes = await Crypto.unwrapBytes(
            oldKEK,
            ctx.encryption.dek_iv,
            ctx.encryption.dek_wrapped,
          );
        } catch {
          errEl.textContent = t('reset.err.old_wrong');
          return;
        }
        body = {
          token: ctx.token,
          mode: 'rotate',
          oldPassword,
          newPassword,
        };
      } else {
        const recovery = $('resetRecoveryInput')
          .value.replace(/[^0-9a-fA-F]/g, '')
          .toLowerCase();
        if (recovery.length !== 32) {
          errEl.textContent = t('reset.err.recovery_format');
          return;
        }
        const recSalt = Crypto._b64ToBytes(ctx.encryption.recovery_salt);
        const recKEK = await Crypto.deriveKEK(recovery, recSalt);
        try {
          dekBytes = await Crypto.unwrapBytes(
            recKEK,
            ctx.encryption.recovery_dek_iv,
            ctx.encryption.recovery_dek_wrapped,
          );
        } catch {
          errEl.textContent = t('reset.err.recovery_wrong');
          return;
        }
        body = {
          token: ctx.token,
          mode: 'recover',
          newPassword,
        };
      }
      // Re-wrap DEK under new KEK (common for rotate + recover).
      const newSalt = crypto.getRandomValues(new Uint8Array(16));
      const newKEK = await Crypto.deriveKEK(newPassword, newSalt);
      const wrapped = await Crypto.wrapBytes(newKEK, dekBytes);
      body.new_kdf_salt = Crypto._bytesToB64(newSalt);
      body.new_dek_wrapped = wrapped.ct;
      body.new_dek_iv = wrapped.iv;
      // Install the unwrapped DEK into the shell session so the user is
      // unlocked immediately after reset. importDEKFromBytes copies the
      // bytes into a CryptoKey held in the shell closure and does not
      // retain the byte array.
      await Session.importDEKFromBytes(dekBytes);
    }
    const resp = await Session.api('POST', 'api/auth/reset-password', body);
    Session.setUser(resp.user);
    _resetCtx = null;
    setResetActive(false);
    if (mode === 'wipe') {
      // wipe needs fresh bootstrap on next save. Clear any persisted DEK
      // and mark the session as needing unlock.
      Session.clearDEK();
      Session.setPendingUnlock(true);
    } else {
      Session.setPendingUnlock(false);
    }
    history.replaceState({}, '', location.pathname);
    window.closeModal();
    Session.renderAuthWidget();
    Session.renderVerifyBanner();
    Session.refreshSamples();
    toast(t('toast.password_reset'), 'success');
  } catch (e) {
    errEl.textContent = e.message || t('error.generic');
  }
  // Note: dekBytes goes out of scope here. The local `let` does not
  // cross the function boundary; no reference is retained anywhere.
}

// Cancel handler — clears _resetCtx + active flag so a subsequent
// click on a stale ?reset= link can re-run cleanly. Called by the
// shell dispatcher's 'reset-cancel' case (which already strips the
// URL + closes the modal).
export function cancelPasswordReset() {
  _resetCtx = null;
  setResetActive(false);
}

// Expose for the shell dispatcher and the inline `onchange=` attr in
// the rendered modal. First call: lazy-load fetches + evaluates +
// these assignments run. Subsequent calls hit the ES module cache.
window.openForgotPasswordFlow = openForgotPasswordFlow;
window.openPasswordResetFlow = openPasswordResetFlow;
window.doForgotPassword = doForgotPassword;
window.doResetPassword = doResetPassword;
window.updateResetModeUI = updateResetModeUI;
window.cancelPasswordReset = cancelPasswordReset;
