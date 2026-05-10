/* ============================================================
   modules/unlock/index.js — Re-derive DEK from password
   (lazy-loaded ES module).

   Surfaces a minimal modal that takes only the password and
   re-derives the session DEK against the live cookie session.
   Used when the cookie is alive but sessionStorage was cleared
   (different tab, page reload after manual cleanup), so the
   library list is logged-in but locked.

   Loaded ONLY when the user clicks the "розблокувати" CTA in
   the saved-list shell or hits 'open-unlock' from anywhere — see
   the lazy stub in spyglass.app.js dispatcher (cases
   'open-unlock' + 'do-unlock'). On first click: ~3KB across
   this file + i18n.js. On subsequent clicks: cached by the
   module loader, zero extra fetch.

   Exposed window APIs (consumed by spyglass.app.js dispatcher):
     - window.openUnlockModal()  — entry point, called by
                                    'open-unlock'.
     - window.doUnlock()         — submit handler, called by
                                    'do-unlock' (the modal's
                                    primary button + Enter key).

   Consumes:
     - $, escapeHtml, toast, t            from /core/utils.js
     - window.closeModal                  modal lifecycle
     - window.openAuthModal               fallback when guest hits
                                          unlock without a session
     - window.SpyglassSession.user        currently signed-in user
     - window.SpyglassSession.api         HTTP helper (for /auth/me)
     - window.SpyglassSession.openFromPassword
                                          re-derives DEK + persists
                                          it (DEK never crosses the
                                          module boundary)
     - window.SpyglassSession.refreshSamples
                                          re-render saved-list once
                                          the DEK is back
     - window.SpyglassSession.wireEnterSubmit
                                          ⏎-to-submit on the input

   Auth gate: the dispatcher's 'open-unlock' case is responsible
   for the guest fallback (it's a UX courtesy — falling through to
   openAuthModal means the user can sign in fresh). Inside this
   module, openUnlockModal() also re-checks via
   SpyglassSession.user as a defensive guard — if the cookie
   evaporated between dispatcher and modal open, we redirect.
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

export function openUnlockModal() {
  const user = window.SpyglassSession && window.SpyglassSession.user;
  if (!user) {
    return window.openAuthModal && window.openAuthModal('login');
  }
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card">' +
    '<div class="modal-title">' +
    t('modal.unlock.title') +
    '</div>' +
    '<div style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:var(--space-3)">' +
    t('unlock.subtitle', { email: escapeHtml(user.email) }) +
    '</div>' +
    '<div class="modal-row"><label>' +
    t('auth.label.password') +
    '</label><input id="unlockPwInput" type="password" autocomplete="current-password"></div>' +
    '<div id="unlockError" style="color:var(--danger);font-size:var(--fs-sm);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
    '<div style="margin-bottom:var(--space-2);text-align:right"><a href="#" data-action="open-forgot" style="font-size:var(--fs-sm);color:var(--text-dim)">' +
    t('auth.forgot_password') +
    '</a></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost btn-sm" data-action="signout">' +
    t('btn.signout_instead') +
    '</button>' +
    '<button class="btn btn-primary btn-sm" data-action="do-unlock">' +
    t('btn.unlock') +
    '</button>' +
    '</div></div></div>';
  setTimeout(() => {
    const el = $('unlockPwInput');
    if (el) el.focus();
  }, 0);
  if (window.SpyglassSession && typeof window.SpyglassSession.wireEnterSubmit === 'function') {
    window.SpyglassSession.wireEnterSubmit('unlockPwInput', () => window.doUnlock());
  }
}

export async function doUnlock() {
  const session = window.SpyglassSession;
  const pwEl = $('unlockPwInput');
  const errEl = $('unlockError');
  if (!pwEl || !errEl || !session) return;
  const password = pwEl.value;
  errEl.textContent = '';
  try {
    // Re-fetch crypto state via /api/auth/me (it's stable across
    // calls — the server reads it from the user row). Then ask the
    // facade to derive KEK + unwrap DEK; the raw key never leaves
    // the shell closure.
    const me = await session.api('GET', 'api/auth/me');
    if (!me.encryption) {
      errEl.textContent = t('unlock.err.no_crypto');
      return;
    }
    await session.openFromPassword(password, me.encryption, { extractable: true });
    if (typeof window.closeModal === 'function') window.closeModal();
    toast(t('toast.library_unlocked'), 'success');
    if (typeof session.refreshSamples === 'function') session.refreshSamples();
  } catch {
    errEl.textContent = t('unlock.err.wrong_password');
  }
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/unlock/index.js'); window.openUnlockModal();
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, the assignments are no-ops.
window.openUnlockModal = openUnlockModal;
window.doUnlock = doUnlock;
