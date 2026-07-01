/* ============================================================
   public/core/session.js — shell-level session + zero-knowledge crypto service.

   ROADMAP #18. Previously this state lived inside mountInspector()'s closure,
   so auth/DEK only existed while the Inspector was mounted (sign-in from other
   sections had to bounce through /inspector?auth=login). This service is created
   ONCE by shell boot and lives for the whole page lifecycle — independent of any
   section mount.

   OWNERSHIP
     - Shell (this file): authenticated user, DEK (CryptoKey), pending-unlock,
       authenticated api() helper, DEK persist/restore, crypto lifecycle
       (openFromPassword / bootstrap / importDEKFromBytes / clearDEK / clearSession),
       encrypt/decrypt, canonical /api/auth/me boot, auth:changed notification.
     - Inspector (optional ADAPTER, registered on mount): sample/dirty/partner
       state + the DOM renderers (refreshSamples/refreshPartners/renderAuthWidget/
       partnerOptionsHtml/renderVerifyBanner). When no adapter is registered the
       service still works — inspector-only calls become safe no-ops.

   ZERO-KNOWLEDGE INVARIANTS (unchanged from the prior in-closure model)
     - The raw DEK (CryptoKey) never leaves this module. encrypt/decrypt run
       here; callers pass plaintext/ciphertext + metadata, never the key.
     - The password is never cached — it is consumed by a single crypto call.
     - logout / clearSession wipes both in-memory (_dek) and persisted DEK.
     - No secret/password/DEK is ever logged.
   ============================================================ */
'use strict';

import { toast, t } from '/core/utils.js';

// SpyglassCrypto is a browser global (loaded via <script> in the shell); it is
// the SAME primitive the inspector used — crypto behaviour is byte-for-byte
// unchanged, only its owner moved. index.{en,uk,ru}.html load spyglass-crypto.js
// as a plain blocking <script> BEFORE shell-boot.js (type=module, deferred), so
// window.SpyglassCrypto is always defined by the time any crypto op below runs —
// verified structurally, not just hoped for.
const CRYPTO = () => (typeof window !== 'undefined' ? window.SpyglassCrypto : undefined);

// ── Session state (module-private; never exported raw) ──────────────────────
let _user = null;
let _dek = null; // CryptoKey — NEVER handed out through any public method
let _pendingUnlock = false;

// Generation counter: every setUser/clearSession bumps it. The canonical boot
// captures the generation it started at and refuses to apply a stale
// /api/auth/me response if a newer login/logout happened meanwhile.
let _authGen = 0;
let _bootPromise = null;

// sessionStorage: per-tab, dies on tab close. XSS that can read sessionStorage
// already has DEK access via this module's scope — same threat surface, no new
// vector. Buys F5 survival only. (Identical rationale + key to the old model.)
const DEK_STORAGE_KEY = 'kt-dek-v1';

async function persistDEK(dekKey) {
  if (!dekKey) return;
  try {
    const b64 = await CRYPTO().serializeDEK(dekKey);
    sessionStorage.setItem(DEK_STORAGE_KEY, b64);
  } catch (e) {
    // exportKey('raw') fails for a non-extractable key — soft-fail so F5 falls
    // back to the unlock prompt rather than breaking the active session.
    console.warn('[session] DEK persist failed:', e && e.message);
  }
}
async function loadPersistedDEK() {
  try {
    const b64 = sessionStorage.getItem(DEK_STORAGE_KEY);
    if (!b64) return null;
    return await CRYPTO().deserializeDEK(b64);
  } catch {
    try {
      sessionStorage.removeItem(DEK_STORAGE_KEY);
    } catch (_) {
      /* private mode — ignore */
    }
    return null;
  }
}
function clearPersistedDEK() {
  try {
    sessionStorage.removeItem(DEK_STORAGE_KEY);
  } catch (_) {
    /* sessionStorage may be blocked (Safari private) — ignore */
  }
}

// ── Authenticated API helper (moved verbatim from the inspector closure) ────
async function api(method, url, body, opts = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (opts.signal) init.signal = opts.signal;
  if (body !== undefined) init.body = JSON.stringify(body);
  const absUrl = /^https?:|^\//.test(url) ? url : '/' + url;
  const r = await fetch(absUrl, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    const err = new Error(j.error || 'http ' + r.status);
    err.status = r.status;
    err.code = j.code;
    throw err;
  }
  return j;
}

// ── auth:changed (deduped by identity) ──────────────────────────────────────
function sameUser(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.email === b.email && a.email_verified === b.email_verified;
}
function setUser(u) {
  const next = u || null;
  const changed = !sameUser(_user, next);
  _user = next;
  _authGen++; // any explicit user change wins over an in-flight boot
  if (changed) {
    // Notify chrome (topbar) + the inspector adapter. Never dispatched when the
    // effective state didn't change (avoids duplicate re-renders).
    try {
      window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: next } }));
    } catch (_) {
      /* never block auth on event dispatch */
    }
    if (_adapter && _adapter.onSessionChange) {
      try {
        _adapter.onSessionChange({ user: next });
      } catch (_) {
        /* adapter is best-effort */
      }
    }
  }
}

// ── Inspector adapter registry (generation-safe) ────────────────────────────
let _adapter = null;
let _adapterGen = 0;
function registerAdapter(adapter) {
  _adapter = adapter || null;
  return ++_adapterGen; // token: unregister only succeeds for the current gen
}
function unregisterAdapter(token) {
  // A torn-down mount must not clear a newer mount's adapter.
  if (token === _adapterGen) _adapter = null;
}
// Call an optional adapter method; no-op (returning `fallback`) when the
// inspector isn't mounted so auth works everywhere without DOM errors.
function adapt(name, args, fallback) {
  if (_adapter && typeof _adapter[name] === 'function') {
    try {
      return _adapter[name].apply(_adapter, args || []);
    } catch (e) {
      console.warn('[session] inspector adapter.' + name + ' threw:', e && e.message);
    }
  }
  return fallback;
}

// ── Crypto lifecycle (DEK stays in this module) ─────────────────────────────
async function openFromPassword(password, encState, opts) {
  _dek = await CRYPTO().openWithPassword(password, encState, opts || {});
  await persistDEK(_dek);
}
async function bootstrap(password) {
  const result = await CRYPTO().bootstrap(password, { extractable: true });
  _dek = result.dekKey;
  await persistDEK(_dek);
  return { state: result.state, recoveryKey: result.recoveryKey };
}
async function importDEKFromBytes(dekBytes) {
  _dek = await CRYPTO().importDEK(dekBytes, { extractable: true });
  await persistDEK(_dek);
}
function clearDEK() {
  _dek = null;
  clearPersistedDEK();
}
function clearSession() {
  _dek = null;
  clearPersistedDEK();
  setUser(null); // bumps gen + notifies (also lets the inspector adapter reset)
  adapt('clearInspectorState');
}

// Full sign-out: best-effort server logout (idempotent — a failure here must
// never block the local wipe), then a full session clear (memory + persisted
// DEK + user + adapter reset). Chrome-level so it works regardless of which
// section — or none — triggered it (Inspector header button, unlock-modal
// escape route).
async function signOut() {
  try {
    await api('POST', 'api/auth/logout');
  } catch {
    /* logout is idempotent — ignore failures, still wipe locally */
  }
  clearSession();
  toast(t('toast.signed_out'), 'success');
}

// Enter-to-submit wiring for a modal's input field. Pure DOM utility with no
// session/Inspector state of its own — NOT adapter-routed, so it works
// identically whether or not Inspector is mounted (the auth/unlock modals
// that use it can open from any section).
function wireEnterSubmit(inputId, action) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      action();
    }
  });
}

// ── Canonical boot: one /api/auth/me shared by every consumer ───────────────
// force=true discards the cached result and re-fetches — used after an action
// that changes server-side auth state without going through setUser (e.g. the
// ?verified=1 boot flow, where email_verified_at flips server-side and the
// verify banner needs a fresh read to clear). Still gen-guarded like a normal
// boot, so a login/logout racing this refresh still wins.
async function ensureBooted(force) {
  if (_bootPromise && !force) return _bootPromise;
  const startedGen = _authGen;
  _bootPromise = (async () => {
    let me = null;
    try {
      me = await api('GET', 'api/auth/me');
    } catch {
      me = { __error: true };
    }
    // Stale-guard: a login/logout happened while /api/auth/me was in flight —
    // its result now owns the state, so don't overwrite it.
    if (_authGen !== startedGen) return { user: _user, pendingUnlock: _pendingUnlock };

    if (me && !me.__error) {
      _user = me.user || null;
      maybeLocaleRedirect(me);
      if (me.user && me.encryption) {
        const restored = await loadPersistedDEK();
        if (_authGen !== startedGen) return { user: _user, pendingUnlock: _pendingUnlock };
        if (restored) {
          _dek = restored;
          _pendingUnlock = false;
        } else {
          _dek = null;
          _pendingUnlock = true;
        }
      } else {
        _dek = null;
        _pendingUnlock = false;
        clearPersistedDEK();
      }
    } else {
      // Preserved contract: ANY /api/auth/me failure (401 or network) → anonymous.
      _user = null;
      _dek = null;
      _pendingUnlock = false;
      clearPersistedDEK();
    }
    return { user: _user, pendingUnlock: _pendingUnlock };
  })();
  return _bootPromise;
}

// Locale stickiness heuristic (moved verbatim from bootAuth): on a canonical
// landing route, soft-redirect to the user's server-stored preferred_locale.
function maybeLocaleRedirect(me) {
  try {
    if (!(me.user && me.user.preferred_locale)) return;
    const want = me.user.preferred_locale;
    const path = location.pathname.replace(/\/$/, '') || '/';
    const here = path.startsWith('/uk') ? 'uk' : path.startsWith('/ru') ? 'ru' : 'en';
    if (want === here) return;
    const enPart = path.replace(/^\/(uk|ru)/, '') || '/';
    const target = want === 'en' ? enPart : '/' + want + (enPart === '/' ? '' : enPart);
    if (['/', '/about', '/account'].includes(enPart) && target !== path) location.replace(target);
  } catch (_) {
    /* never block boot on a redirect heuristic */
  }
}

// ── The service (session/crypto surface) ────────────────────────────────────
export const session = {
  // state
  get user() {
    return _user;
  },
  setUser,
  get pendingUnlock() {
    return _pendingUnlock;
  },
  setPendingUnlock(v) {
    _pendingUnlock = !!v;
  },
  // helpers
  api,
  ensureBooted,
  // crypto (DEK never leaves)
  hasSession: () => !!_dek,
  encryptBlob: (plain) => CRYPTO().encryptBlob(_dek, plain),
  decryptBlob: (ivB64, ctB64) => CRYPTO().decryptBlob(_dek, ivB64, ctB64),
  openFromPassword,
  bootstrap,
  importDEKFromBytes,
  clearDEK,
  clearSession,
  signOut,
  wireEnterSubmit,
  // inspector adapter
  registerAdapter,
  unregisterAdapter,
  adapt,
};

// ── Compatibility facade: window.SpyglassSession ────────────────────────────
// Same shape consumers already use. Session/crypto → the service; inspector-
// specific getters/renderers → the registered adapter (no-op when unmounted).
// Installed once by shell boot; idempotent.
export function installSessionFacade() {
  if (typeof window === 'undefined') return;
  if (window.SpyglassSession && window.SpyglassSession.__shellOwned) return;
  // Top-level global (not under the facade object) — matches the pre-existing
  // call convention every consumer already uses: window.signOut(), not
  // window.SpyglassSession.signOut(). Idempotent: re-running installSessionFacade
  // just reassigns the same function.
  window.signOut = signOut;
  window.SpyglassSession = {
    __shellOwned: true,
    // session state
    get user() {
      return _user;
    },
    setUser,
    setPendingUnlock: session.setPendingUnlock,
    // helpers (session-level)
    api: (method, url, body) => api(method, url, body),
    // crypto lifecycle
    hasSession: session.hasSession,
    encryptBlob: session.encryptBlob,
    decryptBlob: session.decryptBlob,
    openFromPassword,
    bootstrap,
    importDEKFromBytes,
    clearDEK,
    clearSession,
    // ── generic DOM utility (NOT adapter-routed — has no Inspector/session
    // state; must work identically whether Inspector is mounted or not) ──
    wireEnterSubmit,
    // ── inspector-specific → adapter (no-op / neutral when unmounted) ──
    get currentSampleId() {
      return adapt('getCurrentSampleId', [], null);
    },
    setCurrentSampleId: (v) => adapt('setCurrentSampleId', [v]),
    get currentSampleMeta() {
      return adapt('getCurrentSampleMeta', [], null);
    },
    setCurrentSampleMeta: (v) => adapt('setCurrentSampleMeta', [v]),
    get isDirty() {
      return adapt('getIsDirty', [], false);
    },
    setDirty: (v) => adapt('setDirty', [v]),
    get partnerCache() {
      return adapt('getPartnerCache', [], []);
    },
    setPartnerCache: (v) => adapt('setPartnerCache', [v]),
    refreshPartners: () => adapt('refreshPartners', [], Promise.resolve()),
    refreshSamples: () => adapt('refreshSamples', [], Promise.resolve()),
    renderAuthWidget: () => adapt('renderAuthWidget'),
    renderVerifyBanner: () => adapt('renderVerifyBanner'),
    partnerOptionsHtml: (sel) => adapt('partnerOptionsHtml', [sel], ''),
  };
  return window.SpyglassSession;
}
