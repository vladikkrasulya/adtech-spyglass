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
   the lazy stub in ortbtools.app.js dispatcher (cases
   'open-unlock' + 'do-unlock'). On first click: ~3KB across
   this file + i18n.js. On subsequent clicks: cached by the
   module loader, zero extra fetch.

   Exposed window APIs (consumed by ortbtools.app.js dispatcher):
     - window.openUnlockModal()  — entry point, called by
                                    'open-unlock'.
     - window.doUnlock()         — submit handler, called by
                                    'do-unlock' (the modal's
                                    primary button + Enter key).

   Consumes:
     - $, escapeHtml, toast, t            from /core/utils.js
     - window.closeModal                  modal lifecycle
     - window.lazyOpenAuth                fallback when a guest hits
                                          unlock, or when the session
                                          turns out to be dead on submit
                                          (imports /modules/auth/ first;
                                          window.openAuthModal is only a
                                          last-resort fallback because it
                                          exists only after that import)
     - window.OrtbtoolsSession.user        currently signed-in user
     - window.OrtbtoolsSession.api         HTTP helper (for /auth/me)
     - window.OrtbtoolsSession.openFromPassword
                                          re-derives DEK + persists
                                          it (DEK never crosses the
                                          module boundary)
     - window.OrtbtoolsSession.refreshSamples
                                          re-render saved-list once
                                          the DEK is back
     - window.OrtbtoolsSession.wireEnterSubmit
                                          ⏎-to-submit on the input

   Auth gate: the dispatcher's 'open-unlock' case is responsible
   for the guest fallback (it's a UX courtesy — falling through to
   the sign-in modal means the user can sign in fresh). Inside this
   module, openUnlockModal() also re-checks via
   OrtbtoolsSession.user as a defensive guard — if the cookie
   evaporated between dispatcher and modal open, we redirect.
   That guard reads a CLIENT-SIDE cache, so it cannot see a cookie
   that died server-side; doUnlock() therefore re-checks against
   the /api/auth/me answer before interpreting anything else as a
   crypto or password problem.
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

// Every "you are not signed in after all" exit from this modal routes
// here. window.openAuthModal only exists once /modules/auth/ has been
// imported, and nothing on the unlock path imports it — so calling it
// directly was a coin flip that landed on "nothing happens at all"
// whenever the user reached unlock without having opened the sign-in
// modal earlier in the page's life. window.lazyOpenAuth (installed at
// boot by /core/modal-host.js) does the import first; the same call the
// topbar and save-sample gates already make.
function openAuthInstead(mode) {
  if (typeof window.lazyOpenAuth === 'function') return window.lazyOpenAuth(mode || 'login');
  if (typeof window.openAuthModal === 'function') return window.openAuthModal(mode || 'login');
  if (typeof window.closeModal === 'function') window.closeModal();
}

export function openUnlockModal() {
  const user = window.OrtbtoolsSession && window.OrtbtoolsSession.user;
  if (!user) {
    return openAuthInstead('login');
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
  if (window.OrtbtoolsSession && typeof window.OrtbtoolsSession.wireEnterSubmit === 'function') {
    window.OrtbtoolsSession.wireEnterSubmit('unlockPwInput', () => window.doUnlock());
  }
}

export async function doUnlock() {
  const session = window.OrtbtoolsSession;
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
    // The cookie can die between opening this modal and submitting it —
    // a sign-out in another tab, a password reset, ordinary expiry. The
    // `session.user` this modal greeted the user by is a stale client-side
    // copy, and /api/auth/me answers 200 with user:null + encryption:null
    // rather than 401, so without this branch the next line told someone
    // whose account IS encrypted that "encryption is not set up" — a false
    // statement about their account, printed inside a modal still showing
    // their email, with no way forward. Say what actually happened and
    // hand them the sign-in modal.
    if (!me.user) {
      if (typeof session.clearSession === 'function') session.clearSession();
      toast(t('unlock.err.session_expired'), 'error');
      openAuthInstead('login');
      return;
    }
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

// Expose for the dispatcher in ortbtools.app.js. The dispatcher does:
//   await import('/modules/unlock/index.js'); window.openUnlockModal();
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, the assignments are no-ops.
window.openUnlockModal = openUnlockModal;
window.doUnlock = doUnlock;
