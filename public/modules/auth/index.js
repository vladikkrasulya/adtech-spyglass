/* ============================================================
   modules/auth/index.js — Login + register modal
   (lazy-loaded ES module).

   The two-tab modal that swaps between "sign in" and "create
   account" — entry point for the whole authenticated experience.
   POSTs against /api/auth/{login,register}; on success delegates
   the DEK lifecycle to window.SpyglassSession (the closure-scoped
   facade in spyglass.app.js — the DEK never leaves that scope).

   Loaded ONLY when the user clicks the "увійти" button (header,
   data-action="open-auth"), or when an auth-gated action fires
   on a guest (save-sample, save-corpus, etc.) — see the lazy stub
   in spyglass.app.js dispatcher (case 'open-auth'). On first
   click: ~3.5KB across this file + i18n.js. On subsequent
   activations: cached by the browser's ES module loader.

   Crypto contract — DEK NEVER touched directly:
     - LOGIN  → SpyglassSession.openFromPassword(password, encState)
                or SpyglassSession.bootstrap(password) for legacy
                accounts that pre-date Phase 7 (no encryption blob
                yet on /api/auth/me).
     - REGISTER → SpyglassSession.bootstrap(password) returns
                  { state, recoveryKey }; we POST the state to
                  /api/auth/setup-encryption ourselves and hand the
                  recoveryKey to window.showRecoveryKeyModal — that
                  modal is still closure-private in spyglass.app.js
                  (recovery-key flow is its own future migration).

   Exposed window APIs (consumed by spyglass.app.js dispatcher cases
   'open-auth' and 'do-auth', plus the auth-gate fallbacks in
   openSaveModal / open-corpus-save / SpyglassSession.requireAuth):
     - window.openAuthModal(mode)  — 'login' | 'register'
     - window.doLogin()            — POST /api/auth/login
     - window.doRegister()         — POST /api/auth/register

   Consumes (via SpyglassSession + /core/utils.js + window globals):
     - SpyglassSession.{api, refreshPartners, refreshSamples,
                        renderAuthWidget, setUser,
                        openFromPassword, bootstrap}
     - $, escapeHtml, toast, t              — DOM + i18n helpers
     - window.closeModal                    — modal lifecycle
     - window.showRecoveryKeyModal          — recovery-key reveal
                                              (post-register only;
                                              still closure-private
                                              in spyglass.app.js)
     - window.snapshotPendingHistoryMerge() — sets the closure-
                                              private flag that
                                              chains the import-
                                              history modal once
                                              the recovery key is
                                              acknowledged. Snapshot
                                              must happen BEFORE
                                              bootstrap opens the
                                              recovery modal.
   ============================================================ */
import { $, toast, t } from '/core/utils.js';

// Centralizes the "code → human-friendly localized message" map.
// Stays inside this module because no caller outside auth ever
// translates these specific server error codes.
function humanAuthError(e) {
  const code = e.code || '';
  if (code === 'invalid_email') return t('auth.err.invalid_email');
  if (code === 'weak_password') return t('auth.err.weak_password');
  if (code === 'email_taken') return t('auth.err.email_taken');
  if (code === 'invalid_credentials') return t('auth.err.invalid_creds');
  if (code === 'rate_limited') return t('auth.err.rate_limited');
  return e.message || t('toast.error_generic', { error: '' }).replace(/[:\s]+$/, '');
}

export function openAuthModal(mode) {
  const isReg = mode === 'register';
  // Preserve any email/password the user already typed before switching
  // login ↔ register so the field doesn't reset on every toggle.
  const prevEmail = $('authEmailInput')?.value || '';
  const prevPassword = $('authPasswordInput')?.value || '';
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card">' +
    '<div class="modal-title">' +
    t(isReg ? 'auth.register.title' : 'auth.login.title') +
    '</div>' +
    '<div class="modal-row"><label>' +
    t('auth.label.email') +
    '</label><input id="authEmailInput" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
    '<div class="modal-row"><label>' +
    t(isReg ? 'auth.label.password_hint' : 'auth.label.password') +
    '</label><input id="authPasswordInput" type="password" autocomplete="' +
    (isReg ? 'new-password' : 'current-password') +
    '"></div>' +
    '<div id="authError" style="color:var(--danger);font-size:var(--fs-sm);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
    (isReg
      ? ''
      : '<div style="margin-bottom:var(--space-2);text-align:right"><a href="#" data-action="open-forgot" style="font-size:var(--fs-sm);color:var(--text-dim)">' +
        t('auth.forgot_password') +
        '</a></div>') +
    '<div class="modal-actions" style="justify-content:space-between">' +
    '<button class="btn btn-ghost btn-sm" data-action="open-auth" data-mode="' +
    (isReg ? 'login' : 'register') +
    '">' +
    t(isReg ? 'auth.switch_to_login' : 'auth.switch_to_register') +
    '</button>' +
    '<div style="display:flex;gap:var(--space-2)">' +
    '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
    t('btn.cancel') +
    '</button>' +
    '<button class="btn btn-primary btn-sm" data-action="do-auth" data-mode="' +
    (isReg ? 'register' : 'login') +
    '">' +
    t(isReg ? 'auth.btn.register' : 'auth.btn.login') +
    '</button>' +
    '</div></div></div></div>';
  setTimeout(() => {
    // Restore prior values from previous mode (preserved across switches).
    // Don't auto-focus password if it was empty — focus email first.
    if (prevEmail) $('authEmailInput').value = prevEmail;
    if (prevPassword) $('authPasswordInput').value = prevPassword;
    const focusTarget = prevEmail && !prevPassword ? 'authPasswordInput' : 'authEmailInput';
    $(focusTarget).focus();
  }, 0);
  // Submit on Enter — wired AFTER assignment of window.doLogin/Register
  // below, so by the time a key is pressed both fns are reachable.
  const submit = isReg ? () => window.doRegister() : () => window.doLogin();
  ['authEmailInput', 'authPasswordInput'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
  });
}

export async function doLogin() {
  const session = window.SpyglassSession;
  const email = $('authEmailInput').value.trim();
  const password = $('authPasswordInput').value;
  const errEl = $('authError');
  errEl.textContent = '';
  try {
    const j = await session.api('POST', 'api/auth/login', { email, password });
    session.setUser(j.user);
    // Resolve session DEK. Two paths:
    //   - Existing user with crypto already set up → derive KEK from
    //     password, unwrap DEK, keep in memory for this session.
    //   - Existing pre-Phase-7 user with no crypto state yet → bootstrap
    //     now (we have the password in hand). Show recovery key.
    if (j.encryption) {
      await session.openFromPassword(password, j.encryption, { extractable: true });
    } else {
      await bootstrapAndShowRecovery(password);
    }
    session.renderAuthWidget();
    if (typeof window.closeModal === 'function') window.closeModal();
    toast(t('toast.hello', { email: j.user.email }), 'success');
    await session.refreshPartners();
    session.refreshSamples();
  } catch (e) {
    errEl.textContent = humanAuthError(e);
  }
}

export async function doRegister() {
  const session = window.SpyglassSession;
  const email = $('authEmailInput').value.trim();
  const password = $('authPasswordInput').value;
  const errEl = $('authError');
  errEl.textContent = '';
  try {
    const j = await session.api('POST', 'api/auth/register', { email, password });
    session.setUser(j.user);
    // Snapshot history-presence BEFORE bootstrap modal opens.
    // closeRecoveryKeyModal checks this flag and chains the
    // import-history modal once the recovery key is acknowledged.
    // Flag itself stays closure-private in spyglass.app.js — we
    // call a tiny window helper to set it.
    if (typeof window.snapshotPendingHistoryMerge === 'function') {
      window.snapshotPendingHistoryMerge();
    }
    await bootstrapAndShowRecovery(password); // brand-new user → always bootstrap
    session.renderAuthWidget();
    // Don't closeModal() — bootstrapAndShowRecovery opened the recovery
    // modal; closing here would dismiss it before user saves the key.
    toast(t('toast.account_created', { email: j.user.email }), 'success');
    // Server attempts the verify email synchronously; if delivery failed
    // (Resend down, domain unverified, etc.) surface a warning so the
    // user knows to retry from the banner instead of waiting forever.
    if (j.email_sent === false) {
      toast(t('toast.account_created_email_failed'), 'error');
    }
    await session.refreshPartners();
    session.refreshSamples();
  } catch (e) {
    errEl.textContent = humanAuthError(e);
  }
}

// Generates DEK + recovery key via the facade, persists the opaque
// crypto state to the server, and shows the recovery key once. The
// facade keeps the DEK in its closure; we never see raw bytes here.
// `openRecoveryKeyModalLazy` is the shell-side wrapper that lazy-
// imports /modules/recovery/ on first use and then calls
// window.showRecoveryKeyModal — recovery has its own module already.
async function bootstrapAndShowRecovery(password) {
  const session = window.SpyglassSession;
  const { state, recoveryKey } = await session.bootstrap(password);
  await session.api('POST', 'api/auth/setup-encryption', state);
  if (typeof window.openRecoveryKeyModalLazy === 'function') {
    await window.openRecoveryKeyModalLazy(recoveryKey);
  } else if (typeof window.showRecoveryKeyModal === 'function') {
    // Defensive fallback: if shell didn't expose the lazy wrapper for
    // some reason, fall back to the directly-exposed modal.
    window.showRecoveryKeyModal(recoveryKey);
  }
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/auth/index.js'); window.openAuthModal(mode);
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, assignments are no-ops.
window.openAuthModal = openAuthModal;
window.doLogin = doLogin;
window.doRegister = doRegister;
