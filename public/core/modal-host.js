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
       edit-sample/partners/corpus-save/simulate/mirror) is
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
   the dispatcher introduces no new business logic, it only relocates the
   dispatch plumbing that the modalRoot-ownership move requires.

   The one thing this file DOES own outright is dialog accessibility
   (F-17): role/aria-modal/label, the focus trap, focus restoration and
   the error live region are applied host-side to whatever renders into
   #modalRoot, for the same reason Esc and backdrop-close are — it is the
   single choke point every modal in the app goes through. See the
   "Dialog semantics + focus management" block below.
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
// Moved verbatim from mountInspector (ortbtools.app.js). Recovery-key modal
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
  if (window.__ortbtoolsResetActive && new URLSearchParams(location.search).has('reset')) {
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

      // — mirror modal —
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
        if (typeof window.__ortbtoolsMirrorRefetch === 'function') {
          window.__ortbtoolsMirrorRefetch(newMode);
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

// ── Dialog semantics + focus management (F-17) ───────────────────────────
// Measured before this block existed: the strings `role`, `aria-modal` and
// `dialog` appeared ZERO times in this file, and a live browser reported
//   .modal-backdrop role: null   .modal-card role: null   aria-modal: null
//   accessible label: none       #authError: role=null, aria-live=null
//   Escape: closes, but focus lands on <body>, not the trigger
// So every modal in the app was, to assistive tech, an unlabelled <div>
// stack with the whole page behind it still reachable by Tab.
//
// The fix lives HERE rather than in the thirteen modules that actually
// render modal markup (auth, unlock, recovery, password-reset, save-sample,
// edit-sample, dialect-label, corpus-save, partners, simulate, mirror, embed,
// shortcuts) because #modalRoot is the ONE node all of them pass through —
// the same reason Esc and backdrop-close already live here. All thirteen
// emit the identical `.modal-backdrop > .modal-card` shape with exactly one
// `.modal-title` inside (verified by grep: 13/13 files, one title per card),
// which is what makes a single host-side upgrade sound.

// Deliberately NOT a computed-style check: inline `display:none` is the only
// hiding the modal renderers actually use, and layout-based visibility tests
// (offsetParent / getClientRects) report everything as invisible under the
// jsdom harness the regression tests run in.
const FOCUSABLE_SEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Error text rendered by auth/unlock/password-reset. Referenced by id
// because those renderers are owned elsewhere; `[data-modal-error]` is the
// forward-compatible hook for any modal added later.
const ERROR_SEL = '#authError,#unlockError,#resetError,[data-modal-error]';

const DIALOG_LABEL = { en: 'Dialog', uk: 'Діалогове вікно', ru: 'Диалоговое окно' };

let _dialogSeq = 0;
let _opener = null; // element that gets focus back when the modal closes
let _lastPressed = null; // fallback opener — see captureOpener()

function isVisible(el) {
  if (el.hidden) return false;
  if (el.style && el.style.display === 'none') return false;
  return !el.closest('[hidden]');
}

function focusablesIn(card) {
  return Array.from(card.querySelectorAll(FOCUSABLE_SEL)).filter(isVisible);
}

function focusSafely(el) {
  if (!el || typeof el.focus !== 'function') return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

function currentCard() {
  const root = document.getElementById('modalRoot');
  if (!root || !root.children.length) return null;
  return root.querySelector('.modal-card');
}

function upgradeModalCard(card) {
  if (card.getAttribute('role') === 'dialog') return; // already upgraded
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  // Needed so the host can park focus on the card itself for modals whose
  // renderer does not focus a field of its own (mirror/shortcuts/embed).
  if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');

  const title = card.querySelector('.modal-title');
  if (title) {
    if (!title.id) title.id = `modal-host-title-${++_dialogSeq}`;
    card.setAttribute('aria-labelledby', title.id);
  } else if (!card.hasAttribute('aria-label')) {
    const lang = document.documentElement.getAttribute('lang') || 'en';
    card.setAttribute('aria-label', DIALOG_LABEL[lang] || DIALOG_LABEL.en);
  }

  // Validation errors are written into an empty div AFTER submit, so without
  // a live region a screen-reader user pressed "log in" and was told nothing
  // at all. assertive (role=alert) rather than polite: the user is blocked.
  card.querySelectorAll(ERROR_SEL).forEach((el) => {
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.setAttribute('aria-atomic', 'true');
  });
}

function captureOpener(modalRoot) {
  const active = document.activeElement;
  if (active && active.nodeType === 1 && active !== document.body && !modalRoot.contains(active)) {
    _opener = active;
    return;
  }
  // Chrome focuses a <button> on mousedown; Firefox and Safari do not, so
  // document.activeElement is <body> at the instant the modal appears there.
  // Falling back to the last thing the user actually pressed is what makes
  // focus restoration work across browsers rather than only in Chrome.
  if (_lastPressed && _lastPressed.isConnected && !modalRoot.contains(_lastPressed)) {
    _opener = _lastPressed;
  }
}

function restoreOpenerFocus() {
  const el = _opener;
  _opener = null;
  // isConnected guard: signing in replaces the topbar sign-in button with
  // the profile pill, so the opener can legitimately be gone by close time.
  if (el && el.isConnected) focusSafely(el);
}

function bindOpenerTracking() {
  const remember = (ev) => {
    const t = ev.target;
    if (!t || t.nodeType !== 1) return;
    _lastPressed = (t.closest && t.closest(FOCUSABLE_SEL)) || t;
  };
  // Capture phase: runs BEFORE the trigger's own click handler opens the
  // modal, so the opener is recorded even for triggers that never take focus.
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('keydown', remember, true);
}

function bindDialogSemantics(modalRoot) {
  let wasOpen = modalRoot.children.length > 0;
  const sync = () => {
    const open = modalRoot.children.length > 0;
    if (open && !wasOpen) captureOpener(modalRoot);
    // Re-run on every mutation, not just the open transition: the auth modal
    // swaps login↔register by replacing #modalRoot's innerHTML outright, so
    // each swap produces a brand-new, un-upgraded card.
    modalRoot.querySelectorAll('.modal-card').forEach(upgradeModalCard);
    if (open && !wasOpen) {
      const card = currentCard();
      // Only park focus on the card when the renderer has not already put it
      // somewhere better — auth focuses authEmailInput from a setTimeout(0)
      // that runs after this observer, and wins, which is the intent.
      if (card && !card.contains(document.activeElement)) focusSafely(card);
    }
    if (!open && wasOpen) restoreOpenerFocus();
    wasOpen = open;
  };
  // window.MutationObserver, not the bare global: every other browser API in
  // this file is reached through window/document/history/location, and the
  // jsdom test harness aliases those onto the fake window rather than onto
  // globalThis — a bare `MutationObserver` reference throws there.
  const MO = window.MutationObserver;
  if (MO) {
    new MO(sync).observe(modalRoot, { childList: true, subtree: true });
  } else {
    console.warn(
      '[modal-host] MutationObserver unavailable — dialog semantics are install-time only',
    );
  }
  sync(); // catch a modal that somehow rendered before install
}

// Real trap: Tab/Shift+Tab cycle inside the open card instead of walking off
// into the page behind it. aria-modal alone tells AT the background is inert;
// it does not stop the browser's own tab order, which is why this exists too.
function bindFocusTrap() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab') return;
      const card = currentCard();
      if (!card) return;
      const items = focusablesIn(card);
      if (!items.length) {
        e.preventDefault();
        focusSafely(card);
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!card.contains(active)) {
        e.preventDefault();
        focusSafely(e.shiftKey ? last : first);
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        focusSafely(last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        focusSafely(first);
      }
    },
    true,
  );
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
  bindOpenerTracking();
  bindDialogSemantics(modalRoot);
  bindFocusTrap();
}
