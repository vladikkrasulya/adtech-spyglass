/* ============================================================
   modules/auth/index.js — Login + register modal
   (lazy-loaded ES module).

   The two-tab modal that swaps between "sign in" and "create
   account" — entry point for the whole authenticated experience.
   POSTs against /api/auth/{login,register}; on success delegates
   the DEK lifecycle to window.OrtbtoolsSession (the closure-scoped
   facade in ortbtools.app.js — the DEK never leaves that scope).

   Loaded ONLY when the user clicks the "увійти" button (header,
   data-action="open-auth"), or when an auth-gated action fires
   on a guest (save-sample, save-corpus, etc.) — see the lazy stub
   in ortbtools.app.js dispatcher (case 'open-auth'). On first
   click: ~3.5KB across this file + i18n.js. On subsequent
   activations: cached by the browser's ES module loader.

   Crypto contract — DEK NEVER touched directly:
     - LOGIN  → OrtbtoolsSession.openFromPassword(password, encState)
                or OrtbtoolsSession.bootstrap(password) for legacy
                accounts that pre-date Phase 7 (no encryption blob
                yet on /api/auth/me).
     - REGISTER → OrtbtoolsSession.bootstrap(password) returns
                  { state, recoveryKey }; we POST the state to
                  /api/auth/setup-encryption ourselves and show the
                  recoveryKey by importing /modules/recovery/
                  OURSELVES (see showRecoveryKey below) — the shell
                  wrapper this used to call was never reachable.

   Exposed window APIs (consumed by ortbtools.app.js dispatcher cases
   'open-auth' and 'do-auth', plus the auth-gate fallbacks in
   openSaveModal / open-corpus-save / OrtbtoolsSession.requireAuth):
     - window.openAuthModal(mode)  — 'login' | 'register'
     - window.doLogin()            — POST /api/auth/login
     - window.doRegister()         — POST /api/auth/register
   These three are installed NON-CONFIGURABLE (see expose() at the
   bottom) — the Inspector's unmount sweep still lists them, and a
   `delete window.openAuthModal` on a module that only evaluates once
   left the sign-in button permanently dead until F5.

   Consumes (via OrtbtoolsSession + /core/utils.js + window globals):
     - OrtbtoolsSession.{api, refreshPartners, refreshSamples,
                        renderAuthWidget, renderVerifyBanner, setUser,
                        openFromPassword, bootstrap}
     - $, escapeHtml, toast, t              — DOM + i18n helpers
     - window.closeModal                    — modal lifecycle
     - /modules/recovery/                   — recovery-key reveal
                                              (post-register + legacy
                                              login bootstrap),
                                              imported on demand
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

// ── Single-flight guard for the submit button ────────────────────
// The primary button used to stay live for the whole round-trip, so a
// double click sent TWO requests. On register the second one came back
// 409 and painted "this email is already registered" over an account
// that had just been created (and signed in) by the first; on login it
// minted a SECOND server session, orphaning the first for its full
// 30-day TTL because the second Set-Cookie overwrote the cookie.
// One flag, because only one auth modal can be on screen at a time.
let _authInFlight = false;

function setAuthBusy(busy) {
  _authInFlight = busy;
  // Queried live rather than cached: openAuthModal rewrites #modalRoot
  // wholesale on every login↔register switch, so any held reference is
  // stale by the time the user submits.
  const btn = document.querySelector('#modalRoot [data-action="do-auth"]');
  if (btn) {
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
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
    // P1 #17 — one-liner explains what an account is for (the value
    // prop, not the action). Mentions encryption so users coming from
    // privacy-sensitive contexts (adtech engineers reviewing real
    // bid payloads) know data isn't leaving their session.
    '<div class="modal-subtitle" style="font-size:var(--fs-sm);color:var(--text-dim);margin:calc(-1*var(--space-2)) 0 var(--space-4);line-height:1.4">' +
    t('auth.subtitle') +
    '</div>' +
    '<div class="modal-row"><label for="authEmailInput">' +
    t('auth.label.email') +
    '</label><input id="authEmailInput" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
    '<div class="modal-row"><label for="authPasswordInput">' +
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
    // P1 #18 — switch-mode link moved out of the footer into a small
    // text row above it; the footer keeps the conventional
    // [cancel] [primary] pair right-aligned. Before, switch-mode sat
    // far-left with `justify-content: space-between`, putting weight
    // on the secondary path.
    '<div style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:var(--space-3);text-align:center">' +
    '<a href="#" class="auth-switch-link" data-action="open-auth" data-mode="' +
    (isReg ? 'login' : 'register') +
    '" style="color:var(--text-dim);text-decoration:underline;text-underline-offset:2px">' +
    t(isReg ? 'auth.switch_to_login' : 'auth.switch_to_register') +
    '</a></div>' +
    '<div class="modal-actions" style="justify-content:flex-end;gap:var(--space-2)">' +
    '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
    t('btn.cancel') +
    '</button>' +
    '<button class="btn btn-primary btn-sm" data-action="do-auth" data-mode="' +
    (isReg ? 'register' : 'login') +
    '">' +
    t(isReg ? 'auth.btn.register' : 'auth.btn.login') +
    '</button>' +
    '</div></div></div>';
  setTimeout(() => {
    // Restore prior values from previous mode (preserved across switches).
    // Don't auto-focus password if it was empty — focus email first.
    const emailEl = $('authEmailInput');
    const passwordEl = $('authPasswordInput');
    // A modal that was replaced or closed inside the same tick (submit on
    // Enter, an Esc, the recovery-key modal taking over) leaves these null,
    // and the deferred focus used to die with "Cannot read properties of
    // null" — an uncaught error for something nobody is waiting on.
    if (!emailEl || !passwordEl) return;
    if (prevEmail) emailEl.value = prevEmail;
    if (prevPassword) passwordEl.value = prevPassword;
    (prevEmail && !prevPassword ? passwordEl : emailEl).focus();
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
  if (_authInFlight) return;
  const session = window.OrtbtoolsSession;
  const email = $('authEmailInput').value.trim();
  const password = $('authPasswordInput').value;
  const errEl = $('authError');
  errEl.textContent = '';
  setAuthBusy(true);
  try {
    const j = await session.api('POST', 'api/auth/login', { email, password });
    session.setUser(j.user);
    // Resolve session DEK. Two paths:
    //   - Existing user with crypto already set up → derive KEK from
    //     password, unwrap DEK, keep in memory for this session.
    //   - Existing pre-Phase-7 user with no crypto state yet → bootstrap
    //     now (we have the password in hand). Show recovery key.
    let recoveryShown = false;
    if (j.encryption) {
      await session.openFromPassword(password, j.encryption, { extractable: true });
    } else {
      recoveryShown = await bootstrapAndShowRecovery(password);
    }
    session.renderAuthWidget();
    session.renderVerifyBanner();
    // Closing unconditionally would tear down the recovery-key modal the
    // legacy-bootstrap path just opened — and closeModal() routes into the
    // "did you really save it?" confirm gate, so the user would be asked
    // about a key they were never shown. Only close when nothing replaced us.
    if (!recoveryShown && typeof window.closeModal === 'function') window.closeModal();
    toast(t('toast.hello', { email: j.user.email }), 'success');
    await session.refreshPartners();
    session.refreshSamples();
  } catch (e) {
    errEl.textContent = humanAuthError(e);
  } finally {
    setAuthBusy(false);
  }
}

export async function doRegister() {
  if (_authInFlight) return;
  const session = window.OrtbtoolsSession;
  const email = $('authEmailInput').value.trim();
  const password = $('authPasswordInput').value;
  const errEl = $('authError');
  errEl.textContent = '';
  setAuthBusy(true);
  try {
    const j = await session.api('POST', 'api/auth/register', { email, password });
    // Product telemetry: a bare counter. No email, no user id — the beacon
    // body carries neither, and the server reads the id from the session
    // cookie it just issued.
    if (typeof window.ortbtoolsTrack === 'function') {
      window.ortbtoolsTrack('register');
    }
    session.setUser(j.user);
    // Snapshot history-presence BEFORE bootstrap modal opens.
    // closeRecoveryKeyModal checks this flag and chains the
    // import-history modal once the recovery key is acknowledged.
    // Flag itself stays closure-private in ortbtools.app.js — we
    // call a tiny window helper to set it.
    if (typeof window.snapshotPendingHistoryMerge === 'function') {
      window.snapshotPendingHistoryMerge();
    }
    // brand-new user → always bootstrap
    const recoveryShown = await bootstrapAndShowRecovery(password);
    session.renderAuthWidget();
    session.renderVerifyBanner();
    // Normally we must NOT closeModal() — bootstrapAndShowRecovery replaced
    // #modalRoot with the recovery-key modal and closing would dismiss the
    // key before the user saved it. But when the reveal did not happen
    // (recovery module failed to load), leaving the filled-in "create
    // account" form on screen reads as "nothing happened" even though the
    // account exists and is signed in — so close it in that case.
    if (!recoveryShown && typeof window.closeModal === 'function') window.closeModal();
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
  } finally {
    setAuthBusy(false);
  }
}

// Puts the freshly-generated recovery key on screen. Returns true only
// when the modal is actually up — callers use that to decide whether
// they may close #modalRoot themselves.
//
// This used to hand the key to window.openRecoveryKeyModalLazy and, as a
// fallback, to window.showRecoveryKeyModal. NEITHER of those is ever
// defined on this path: the lazy wrapper is a closure-local function in
// ortbtools.app.js that is never assigned to window, and
// showRecoveryKeyModal only exists once /modules/recovery/ has been
// imported — which nothing on the register path did. So both branches
// were skipped and the one and only copy of the recovery key was
// dropped on the floor, silently, while the server kept the wrap and
// reported recovery_configured:true. We import the module ourselves.
async function showRecoveryKey(recoveryKey) {
  // Still prefer the shell wrapper when it exists — it is the same
  // import plus the shell's own bookkeeping.
  if (typeof window.openRecoveryKeyModalLazy === 'function') {
    await window.openRecoveryKeyModalLazy(recoveryKey);
    return typeof window.showRecoveryKeyModal === 'function';
  }
  if (typeof window.showRecoveryKeyModal !== 'function') {
    try {
      await Promise.all([
        import('/modules/recovery/i18n.js'),
        import('/modules/recovery/index.js'),
      ]);
    } catch (err) {
      console.error('[auth] recovery module lazy import failed:', err);
    }
  }
  if (typeof window.showRecoveryKeyModal !== 'function') {
    // Never pretend this went fine: without the key the only route back
    // into the library after a forgotten password is the wipe mode.
    toast(t('auth.err.recovery_modal_failed'), 'error');
    return false;
  }
  window.showRecoveryKeyModal(recoveryKey);
  return true;
}

// Generates DEK + recovery key via the facade, persists the opaque
// crypto state to the server, and shows the recovery key once. The
// facade keeps the DEK in its closure; we never see raw bytes here.
// Resolves to whether the recovery modal actually took over #modalRoot.
async function bootstrapAndShowRecovery(password) {
  const session = window.OrtbtoolsSession;
  const { state, recoveryKey } = await session.bootstrap(password);
  await session.api('POST', 'api/auth/setup-encryption', state);
  return showRecoveryKey(recoveryKey);
}

// Expose for the dispatcher in ortbtools.app.js. The dispatcher does:
//   await import('/modules/auth/index.js'); window.openAuthModal(mode);
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, assignments are no-ops.
//
// configurable:false is load-bearing, not paranoia. Inspector's unmount
// sweep (ortbtools.app.js) still lists these three names and runs
// `delete window[name]` on them — a leftover from when they were plain
// globals defined inside mountInspector. They are an ES module now:
// leaving Inspector deleted them, and coming back re-`import()`ed a
// module the loader had already evaluated, so these assignments never
// ran a second time. The sign-in button was then dead for the rest of
// the page's life (lazyOpenAuth threw into console.error, the user saw
// nothing at all). A non-configurable property makes that delete a
// no-op — the sweep already wraps it in try/catch specifically for
// "non-configurable, ignore". writable stays true so an intentional
// reassignment still works.
function expose(name, fn) {
  try {
    Object.defineProperty(window, name, {
      value: fn,
      writable: true,
      enumerable: true,
      configurable: false,
    });
  } catch (_e) {
    // Host object that refuses redefinition — plain assignment is still
    // better than nothing.
    window[name] = fn;
  }
}

expose('openAuthModal', openAuthModal);
expose('doLogin', doLogin);
expose('doRegister', doRegister);
