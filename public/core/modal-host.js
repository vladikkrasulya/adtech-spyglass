/* ============================================================
   public/core/modal-host.js — chrome-level modal host (ROADMAP #18).

   Owns the SINGLE #modalRoot node (declared once in index.{en,uk,ru}.html,
   outside #app-root — see the note there) for the lifetime of the page,
   independent of which section (or none) is mounted. This is the
   structural piece that makes the auth modal (and unlock/recovery/
   password-reset, which share the same modal chrome) open in place from
   ANY section: previously #modalRoot lived INSIDE the inspector template,
   so it only existed while Inspector was mounted.

   Installed ONCE by shell-boot.js's boot(). Everything here is permanent —
   never torn down by a section mount/unmount — because #modalRoot itself
   is now permanent chrome, not section-owned DOM.

   Dispatch split (why some data-action cases live here and not in
   mountInspector's own delegated dispatcher):
     - mountInspector's dispatcher is bound to root (#app-root) — it only
       ever sees clicks on Inspector's OWN workbench elements.
     - #modalRoot is now a SIBLING of #app-root, not a descendant — so any
       modal-content click (submit/cancel/backdrop/mode-switch buttons
       rendered by auth/unlock/recovery/password-reset/save-sample/
       edit-sample/partners/corpus-save/simulate/mirror/live) is
       structurally invisible to root's dispatcher regardless of which
       section is active. Those cases live here instead, delegated off
       #modalRoot itself — scoping by DOM subtree, not by section state,
       so there is no double-fire risk between the two dispatchers.
     - 'signout' is the one action reachable from BOTH subtrees (Inspector's
       own inline auth-widget button, and the unlock modal's escape route)
       — the tiny 2-line case is intentionally duplicated in both
       dispatchers rather than forcing a shared abstraction for it.

   Every case below delegates to a window.* global that a lazy-loaded
   module already exposes (window.doLogin, window.confirmSave, etc.) —
   this file introduces no new business logic, it only relocates the
   dispatch plumbing that the modalRoot-ownership move requires.
   ============================================================ */
'use strict';

// ── CSS (once) ───────────────────────────────────────────────────────────
let _cssLoaded = false;
function loadModalHostCss() {
  if (_cssLoaded) return;
  _cssLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/core/modal-host.css';
  document.head.appendChild(link);
}

// ── closeModal ───────────────────────────────────────────────────────────
// Moved verbatim from mountInspector (spyglass.app.js). Recovery-key modal
// has a "really?" confirm gate — Esc/backdrop/close all route through it
// instead of a silent close.
function closeModal() {
  if (typeof window.isRecoveryKeyModalActive === 'function' && window.isRecoveryKeyModalActive()) {
    window.closeRecoveryKeyModal();
    return;
  }
  const root = document.getElementById('modalRoot');
  if (root) root.innerHTML = '';
  // If the user closes the reset-password modal via Esc/backdrop (rather
  // than the cancel button), still strip ?reset=... so a refresh doesn't
  // silently re-trigger the same flow. Flag owned by /modules/password-reset/
  // — undefined when the module isn't loaded → falsy → normal close.
  if (window.__spyglassResetActive && new URLSearchParams(location.search).has('reset')) {
    if (typeof window.cancelPasswordReset === 'function') {
      window.cancelPasswordReset();
    }
    history.replaceState({}, '', location.pathname);
  }
}

// ── lazyOpenAuth ─────────────────────────────────────────────────────────
// Moved from mountInspector — has ZERO Inspector-specific dependency (it
// only lazy-imports /modules/auth/ then calls window.openAuthModal). Making
// it chrome-level (assigned once at boot) is what lets topbar's sign-in
// button — and Inspector's own inline "sign in" button, and every guest-gate
// fallback (save-sample, corpus-save, unlock) — open the modal from ANY
// section. topbar's onSignIn already checks window.lazyOpenAuth first and
// only falls back to /inspector?auth=login when it's undefined; since this
// is now installed unconditionally at boot, that fallback never fires.
async function lazyOpenAuth(mode) {
  if (typeof window.openAuthModal === 'function') {
    return window.openAuthModal(mode);
  }
  try {
    await Promise.all([import('/modules/auth/i18n.js'), import('/modules/auth/index.js')]);
    window.openAuthModal(mode);
  } catch (err) {
    console.error('[modal-host] auth module lazy import failed:', err);
  }
}

// ── #modalRoot delegated dispatcher (installed once, permanent) ─────────
function bindModalDispatcher(modalRoot) {
  modalRoot.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !modalRoot.contains(el)) return;
    if (el.tagName === 'A') ev.preventDefault();
    const action = el.dataset.action;
    switch (action) {
      // — generic close paths —
      case 'modal-backdrop-close':
        // Only fire when the click is directly on the backdrop, not a
        // child (otherwise clicks inside the modal card would close it).
        if (ev.target === el) closeModal();
        return;
      case 'modal-backdrop-close-recovery':
        if (ev.target === el) window.closeRecoveryKeyModal();
        return;
      case 'modal-close':
        return closeModal();
      case 'close-recovery':
        return window.closeRecoveryKeyModal();
      case 'reset-cancel':
        if (typeof window.cancelPasswordReset === 'function') {
          window.cancelPasswordReset();
        }
        closeModal();
        history.replaceState({}, '', location.pathname);
        return;

      // — auth / unlock / recovery / reset action verbs —
      // 'open-auth' is dual-subtree, same reasoning as 'signout' below: the
      // auth modal's own login↔register mode-switch link carries
      // data-action="open-auth" and renders INSIDE #modalRoot, so it needs a
      // copy here — Inspector's inline auth-widget button (data-action=
      // "open-auth" too, but living in its own template inside #app-root)
      // keeps the copy in Inspector's own dispatcher.
      case 'open-auth':
        return window.lazyOpenAuth(el.dataset.mode || 'login');
      case 'do-auth':
        return el.dataset.mode === 'register'
          ? window.doRegister && window.doRegister()
          : window.doLogin && window.doLogin();
      case 'do-unlock':
        return window.doUnlock && window.doUnlock();
      case 'do-forgot':
        return window.doForgotPassword && window.doForgotPassword();
      case 'do-reset':
        return window.doResetPassword && window.doResetPassword();
      case 'open-forgot': {
        if (typeof window.openForgotPasswordFlow === 'function') {
          return window.openForgotPasswordFlow();
        }
        (async () => {
          try {
            await Promise.all([
              import('/modules/password-reset/i18n.js'),
              import('/modules/password-reset/index.js'),
            ]);
            window.openForgotPasswordFlow();
          } catch (err) {
            console.error('[modal-host] password-reset lazy import failed:', err);
          }
        })();
        return;
      }
      case 'copy-recovery':
        return window.copyRecoveryKey && window.copyRecoveryKey();

      // — sample / partner CRUD verbs (edit-sample / save-sample / partners) —
      case 'confirm-save':
        return window.confirmSave({ asNew: el.dataset.asNew === '1' });
      case 'confirm-edit':
        return window.confirmEdit(Number(el.dataset.id));
      case 'confirm-add-partner':
        return window.confirmAddPartner && window.confirmAddPartner();
      case 'delete-partner':
        return window.deletePartner && window.deletePartner(Number(el.dataset.id));

      // — sign out (also reachable from Inspector's own inline auth widget;
      // that copy lives in mountInspector's root-scoped dispatcher — see
      // the file header for why this is intentionally duplicated) —
      case 'signout':
        closeModal();
        return window.signOut && window.signOut();

      // — live modal (Inspector-toolbar-triggered only, but its content now
      // renders into #modalRoot, outside root's dispatch reach) —
      case 'live-pause':
        return window.__spyglassLivePauseToggle && window.__spyglassLivePauseToggle();
      case 'live-load': {
        const id = Number(el.dataset.rowId);
        const map = window.__spyglassLiveSpecimens;
        const spec = map && map.get ? map.get(id) : null;
        if (!spec) return;
        const isReq = Array.isArray(spec.imp);
        const target = isReq ? 'bidReq' : 'bidRes';
        const ta = document.getElementById(target);
        if (!ta) return;
        ta.value = JSON.stringify(spec, null, 2);
        if (typeof window.updateCharCount === 'function') window.updateCharCount(target);
        closeModal();
        return;
      }

      // — mirror modal (same reasoning as live) —
      case 'mirror-copy': {
        const out = document.getElementById('mMirrorOutput');
        if (!out) return;
        navigator.clipboard.writeText(out.value).catch(() => {});
        return;
      }
      case 'mirror-load': {
        const out = document.getElementById('mMirrorOutput');
        const target = el.dataset.target;
        if (!out || !target) return;
        const ta = document.getElementById(target);
        if (!ta) return;
        ta.value = out.value;
        if (typeof window.updateCharCount === 'function') window.updateCharCount(target);
        closeModal();
        return;
      }
      case 'mirror-mode-change': {
        const newMode = el.value;
        if (typeof window.__spyglassMirrorRefetch === 'function') {
          window.__spyglassMirrorRefetch(newMode);
        }
        return;
      }
      case 'mirror-share': {
        const out = document.getElementById('mMirrorOutput');
        if (!out || typeof window.buildShareUrl !== 'function') return;
        const loadBtn = document.querySelector('[data-action="mirror-load"]');
        const target = loadBtn ? loadBtn.dataset.target : 'bidRes';
        const source = target === 'bidRes' ? 'bidReq' : 'bidRes';
        const srcEl = document.getElementById(source);
        const sourceText = srcEl ? srcEl.value : '';
        const reqText = target === 'bidRes' ? sourceText : out.value;
        const resText = target === 'bidRes' ? out.value : sourceText;
        (async () => {
          try {
            const url = await window.buildShareUrl(reqText, resText);
            await navigator.clipboard.writeText(url);
          } catch (_e) {
            /* best effort */
          }
        })();
        return;
      }
      default:
        return;
    }
  });
}

// ── Escape (global, permanent — replaces the old ctx.signal-scoped one) ──
function bindEscape() {
  document.addEventListener('keydown', (e) => {
    const root = document.getElementById('modalRoot');
    if (e.key === 'Escape' && root && root.children.length) {
      closeModal();
    }
  });
}

// ── Install (idempotent) ─────────────────────────────────────────────────
let _installed = false;
export function installModalHost() {
  if (_installed) return;
  const modalRoot = document.getElementById('modalRoot');
  if (!modalRoot) {
    console.error('[modal-host] #modalRoot not found in shell chrome');
    return;
  }
  _installed = true;
  loadModalHostCss();
  window.closeModal = closeModal;
  window.lazyOpenAuth = lazyOpenAuth;
  bindModalDispatcher(modalRoot);
  bindEscape();
}
