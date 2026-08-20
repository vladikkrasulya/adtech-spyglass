'use strict';

/**
 * tests/site-auth.test.js — regression pins for the auth / recovery /
 * password-reset front-end modules.
 *
 * Every case here failed against the code as it shipped, and each one maps to
 * a defect that a user could hit without doing anything unusual:
 *
 *   1. Registering produced no recovery key. The reveal was routed through
 *      window.openRecoveryKeyModalLazy / window.showRecoveryKeyModal and
 *      NEITHER is defined on that path, so the one and only copy of the key
 *      was dropped while the server kept its wrap and reported
 *      recovery_configured:true. A forgotten password then left "wipe" as the
 *      only way back in.
 *   2. Leaving and re-entering Inspector killed the sign-in button for the
 *      rest of the page's life: the section sweep deletes window.openAuthModal
 *      et al., and re-import()ing an already-evaluated ES module does not
 *      re-run its top-level assignments.
 *   3. A double click on "create" registered once and then painted "this email
 *      is already registered" over the account it had just created; on login
 *      it minted a second server session and orphaned the first.
 *   4. After a successful register the filled-in form stayed on screen.
 *   5. The verify-email banner only appeared after a reload.
 *   7. Password-reset printed the server's English sentences into the
 *      Ukrainian/Russian UI.
 *
 * These run in jsdom against the real module sources (loaded through the same
 * root-absolute ESM loader the blog tests use), not against copies — the
 * dynamic import of /modules/recovery/ from inside /modules/auth/ is exercised
 * for real, because that import IS the fix for (1).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { createBrowserEsmLoader, throwingModuleSource } = require('./browser-esm-loader');

// The shared ESM loader finds a module's dependencies with a regex that does
// not know about comments, so a comment line documenting the lazy-import call
// site (`//   await import('/modules/auth/index.js');`) reads as the module
// importing ITSELF and the loader rejects the graph as a cycle. Both
// /modules/auth/ and /modules/recovery/ document their own call sites that
// way. We hand the loader the same source with only those comment lines
// blanked — code is untouched, and the modules still import each other for
// real, which is the whole point of the register test.
const withoutSelfImportComments = ({ filePath }) =>
  fs
    .readFileSync(filePath, 'utf8')
    .replace(/^[ \t]*\/\/.*\bimport\(\s*['"]\/.*$/gmu, '// [call-site example elided for tests]');

// Keys the central /i18n.js owns (the module i18n files deliberately don't
// duplicate them). Copied here so the harness can resolve what the modules
// ask for without loading the whole 1300-line locale file.
const CENTRAL_KEYS = {
  'reset.err.link_expired': { uk: 'Посилання застаріло — запитай нове' },
  'reset.err.link_tampered': { uk: 'Посилання пошкоджено' },
  'toast.error_generic': { uk: 'Помилка: {error}' },
  'auth.label.email': { uk: 'email' },
  'auth.label.password': { uk: 'пароль' },
  'auth.forgot_password': { uk: 'забув пароль?' },
  'btn.cancel': { uk: 'скасувати' },
  'btn.copy': { uk: 'копіювати' },
  'btn.recovery_saved': { uk: 'я зберіг ключ' },
  'modal.recovery.title': { uk: 'recovery key' },
  'recovery.body': { uk: 'збережи цей ключ' },
};

const RECOVERY_KEY = '0123456789abcdef0123456789abcdef';

let realmCounter = 0;

// The browser modules are evaluated as data:-URL modules in the Node realm, so
// `document`, `window` & co. have to exist on globalThis. They are installed
// ONCE as accessors pointing at whichever jsdom window booted last, rather than
// installed and removed per test: the modals schedule deferred focus with
// setTimeout(…, 0), and a timer from a finished test that lands after its
// globals were removed dies with "document is not defined" and gets reported
// against whatever test happens to be running. Pointing at the newest window
// instead means such a timer resolves an element that isn't there and returns.
//
// Timers are deliberately NOT aliased onto jsdom's: jsdom's window.setTimeout
// resolves the global setTimeout internally, so aliasing recurses until the
// stack blows.
let CURRENT = null;
let _globalsBound = false;

function bindGlobalsTo(next) {
  CURRENT = next;
  if (_globalsBound) return;
  _globalsBound = true;
  const fromWindow = [
    'document',
    'location',
    'history',
    'navigator',
    'sessionStorage',
    'localStorage',
    'CustomEvent',
    'Element',
    'HTMLElement',
    'Node',
    'MutationObserver',
    'URL',
    'URLSearchParams',
  ];
  for (const name of fromWindow) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => CURRENT.window[name],
    });
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get: () => CURRENT.window,
  });
  Object.defineProperty(globalThis, 'console', {
    configurable: true,
    get: () => CURRENT.console,
  });
}

/**
 * Boots a jsdom page with the shell surfaces the modules touch (#modalRoot,
 * #toastContainer, #verifyBanner), a stubbed OrtbtoolsSession facade and a
 * stubbed i18n, then loads the requested modules from public/ for real.
 *
 * @param {{substitutions?: Record<string, any>, apiHandler?: Function}} [opts]
 */
async function boot({ substitutions = {}, apiHandler } = {}) {
  const realmSalt = `site-auth-${++realmCounter}`;
  const dom = new JSDOM(
    '<!doctype html><html lang="uk"><body>' +
      '<div id="verifyBanner" style="display:none"><button data-action="verify-email">send</button></div>' +
      '<div id="toastContainer"></div><div id="modalRoot"></div></body></html>',
    { url: 'https://ortbtools.test/uk/inspector', runScripts: 'outside-only' },
  );
  const { window } = dom;

  const logs = [];
  const consoleSpy = {};
  for (const method of ['debug', 'error', 'info', 'log', 'warn']) {
    consoleSpy[method] = (...args) => logs.push({ method, text: args.map(String).join(' ') });
  }
  window.console = consoleSpy;

  // ── i18n (mirrors /i18n.js: module registration + {var} interpolation) ──
  const table = {};
  for (const [key, value] of Object.entries(CENTRAL_KEYS)) table[key] = value.uk;
  window.registerI18nModule = (mod) => {
    if (!mod || !mod.keys) return;
    for (const [key, value] of Object.entries(mod.keys)) {
      if (typeof value.uk === 'string') table[key] = value.uk;
    }
  };
  window.t = (key, params) => {
    const tpl = table[key];
    if (typeof tpl !== 'string') return '[' + key + ']';
    if (!params) return tpl;
    return tpl.replace(/\{(\w+)\}/g, (_m, k) =>
      params[k] != null ? String(params[k]) : '{' + k + '}',
    );
  };

  // ── OrtbtoolsSession facade stub ────────────────────────────────────────
  const apiCalls = [];
  const counts = { renderAuthWidget: 0, renderVerifyBanner: 0, closeModal: 0, bootstrap: 0 };
  const session = {
    user: null,
    api: async (method, url, body) => {
      apiCalls.push({ method, url, body });
      if (apiHandler) return apiHandler({ method, url, body });
      return { success: true };
    },
    setUser(u) {
      session.user = u;
    },
    renderAuthWidget() {
      counts.renderAuthWidget++;
    },
    renderVerifyBanner() {
      counts.renderVerifyBanner++;
      const banner = window.document.getElementById('verifyBanner');
      // Same rule as the real Inspector renderer.
      banner.style.display = session.user && !session.user.email_verified_at ? 'flex' : 'none';
    },
    refreshPartners: async () => {},
    refreshSamples() {},
    openFromPassword: async () => {},
    bootstrap: async () => {
      counts.bootstrap++;
      return { state: { kdf_salt: 'salt' }, recoveryKey: RECOVERY_KEY };
    },
    importDEKFromBytes: async () => {},
    setPendingUnlock() {},
    clearDEK() {},
    wireEnterSubmit() {},
  };
  window.OrtbtoolsSession = session;
  window.closeModal = () => {
    counts.closeModal++;
    if (
      typeof window.isRecoveryKeyModalActive === 'function' &&
      window.isRecoveryKeyModalActive()
    ) {
      window.closeRecoveryKeyModal();
      return;
    }
    window.document.getElementById('modalRoot').innerHTML = '';
  };

  bindGlobalsTo({ window, console: consoleSpy });

  const loader = createBrowserEsmLoader({
    realmSalt,
    substitutions: {
      '/modules/auth/index.js': withoutSelfImportComments,
      '/modules/recovery/index.js': withoutSelfImportComments,
      ...substitutions,
    },
  });

  return {
    window,
    document: window.document,
    session,
    apiCalls,
    counts,
    logs,
    table,
    loader,
    modalHtml: () => window.document.getElementById('modalRoot').innerHTML,
    toastText: () => window.document.getElementById('toastContainer').textContent.trim(),
    async load(specifier) {
      return loader.import(specifier);
    },
    // Nothing to tear down: the globals are accessors onto whichever window
    // booted last (see bindGlobalsTo), so a stray timer from a finished test
    // still lands on a live document and simply finds no element.
    async close() {},
  };
}

/** Loads the auth module (plus its i18n) and fills the modal fields. */
async function openRegisterModal(h, mode = 'register') {
  await h.load('/modules/auth/i18n.js');
  await h.load('/modules/auth/index.js');
  h.window.openAuthModal(mode);
  h.document.getElementById('authEmailInput').value = 'flow@example.com';
  h.document.getElementById('authPasswordInput').value = 'Str0ng-Passw0rd-2026!';
}

const registerOk = ({ url }) => {
  if (url === 'api/auth/register') {
    return { success: true, user: { id: 1, email: 'flow@example.com', email_verified_at: null } };
  }
  return { success: true };
};

// ── 1 + 4: the recovery key is actually shown, and it replaces the form ─────
test('register reveals the recovery key and takes over the modal', async () => {
  const h = await boot({ apiHandler: registerOk });
  try {
    await openRegisterModal(h);
    await h.window.doRegister();

    assert.equal(
      typeof h.window.showRecoveryKeyModal,
      'function',
      'auth must import /modules/recovery/ itself — the shell wrapper it used to call is never on window',
    );
    assert.equal(h.window.isRecoveryKeyModalActive(), true);
    // Key is rendered in 4-char groups by the recovery module.
    assert.match(h.modalHtml(), /0123-4567-89ab-cdef-0123-4567-89ab-cdef/);
    // The crypto state reached the server, so the wrap the server stores has
    // a counterpart the user has actually seen.
    assert.ok(h.apiCalls.some((c) => c.url === 'api/auth/setup-encryption'));
    // F5-survival mirror, so an accidental reload can re-show the key.
    assert.equal(h.window.sessionStorage.getItem('ortbtools_recovery_pending_v1'), RECOVERY_KEY);
    // The filled-in "create account" form must be gone.
    assert.equal(h.document.getElementById('authPasswordInput'), null);
    assert.equal(h.counts.closeModal, 0, 'closing here would dismiss the key');
  } finally {
    await h.close();
  }
});

// ── 1 (failure branch): a key that cannot be shown is never silent ──────────
test('register that cannot show the key says so and clears the form', async () => {
  const h = await boot({
    apiHandler: registerOk,
    substitutions: { '/modules/recovery/index.js': throwingModuleSource('recovery offline') },
  });
  try {
    await openRegisterModal(h);
    await h.window.doRegister();

    assert.equal(h.window.isRecoveryKeyModalActive, undefined);
    assert.match(h.toastText(), /recovery key/i);
    assert.notEqual(
      h.toastText(),
      '[auth.err.recovery_modal_failed]',
      'message must be translated',
    );
    // Stale form must not sit there implying the registration failed.
    assert.equal(h.counts.closeModal, 1);
    assert.equal(h.document.getElementById('authPasswordInput'), null);
  } finally {
    await h.close();
  }
});

// ── 2: the section sweep must not be able to kill the sign-in button ────────
test('window.openAuthModal survives the Inspector unmount sweep', async () => {
  const h = await boot();
  try {
    await openRegisterModal(h, 'login');
    // Verbatim shape of the sweep in ortbtools.app.js.
    for (const name of ['openAuthModal', 'doLogin', 'doRegister']) {
      try {
        delete h.window[name];
      } catch (_) {
        /* non-configurable, ignore */
      }
      assert.equal(
        typeof h.window[name],
        'function',
        `${name} must outlive the sweep — the module only evaluates once, so a re-import cannot restore it`,
      );
    }
    // Still functional, not just present.
    h.window.openAuthModal('login');
    assert.ok(h.document.getElementById('authEmailInput'));
  } finally {
    await h.close();
  }
});

// ── 3: one click, one account ───────────────────────────────────────────────
test('double-clicking create registers exactly once', async () => {
  const h = await boot({ apiHandler: registerOk });
  try {
    await openRegisterModal(h);
    const btn = h.document.querySelector('#modalRoot [data-action="do-auth"]');
    const first = h.window.doRegister();
    assert.equal(btn.disabled, true, 'the button must be inert while the request is in flight');
    const second = h.window.doRegister();
    await Promise.all([first, second]);
    assert.equal(
      h.apiCalls.filter((c) => c.url === 'api/auth/register').length,
      1,
      'the second click must not hit the server — it comes back 409 and paints "email taken" over a live account',
    );
    assert.equal(h.document.getElementById('authError'), null);
  } finally {
    await h.close();
  }
});

test('double-clicking sign in opens exactly one session', async () => {
  const h = await boot({
    apiHandler: ({ url }) => {
      if (url === 'api/auth/login') {
        return {
          success: true,
          user: { id: 1, email: 'flow@example.com', email_verified_at: '2026-01-01' },
          encryption: { kdf_salt: 'salt', dek_wrapped: 'w', dek_iv: 'iv' },
        };
      }
      return { success: true };
    },
  });
  try {
    await openRegisterModal(h, 'login');
    const first = h.window.doLogin();
    const second = h.window.doLogin();
    await Promise.all([first, second]);
    assert.equal(h.apiCalls.filter((c) => c.url === 'api/auth/login').length, 1);
    assert.equal(h.counts.closeModal, 1);
  } finally {
    await h.close();
  }
});

// ── 5: the verify banner appears without a reload ───────────────────────────
test('register and login paint the verify-email banner immediately', async () => {
  const h = await boot({ apiHandler: registerOk });
  try {
    await openRegisterModal(h);
    await h.window.doRegister();
    assert.equal(h.counts.renderVerifyBanner, 1);
    assert.equal(h.document.getElementById('verifyBanner').style.display, 'flex');
  } finally {
    await h.close();
  }
});

test('login on a legacy account shows the key instead of closing the modal', async () => {
  // No `encryption` on the login response → the module bootstraps crypto now
  // and must reveal the key. Closing the modal here would route straight into
  // the recovery modal's "did you really save it?" gate for a key the user was
  // never shown.
  const h = await boot({
    apiHandler: ({ url }) => {
      if (url === 'api/auth/login') {
        return { success: true, user: { id: 2, email: 'legacy@example.com' } };
      }
      return { success: true };
    },
  });
  try {
    await openRegisterModal(h, 'login');
    await h.window.doLogin();
    assert.equal(h.window.isRecoveryKeyModalActive(), true);
    assert.equal(h.counts.closeModal, 0);
    assert.match(h.modalHtml(), /0123-4567-89ab-cdef/);
    assert.equal(h.counts.renderVerifyBanner, 1);
  } finally {
    await h.close();
  }
});

// ── 7: no English server sentence in a Ukrainian modal ──────────────────────
const SERVER_RATE_LIMIT = 'Too many reset attempts. Try again in 15 minutes.';
const SERVER_BAD_LINK = 'Reset link is invalid or expired';

/** Drives the reset modal into wipe mode with the confirm box ticked. */
async function openResetModal(h, token = 'tok') {
  await h.load('/modules/password-reset/i18n.js');
  await h.load('/modules/password-reset/index.js');
  await h.window.openPasswordResetFlow(token);
  const wipe = h.document.querySelector('input[name="resetMode"][value="wipe"]');
  wipe.checked = true;
  h.window.updateResetModeUI();
  h.document.getElementById('resetWipeConfirm').checked = true;
  h.document.getElementById('resetNewPwInput').value = 'NewStr0ng-Pass-2026!';
}

test('a rate-limited reset speaks the interface language', async () => {
  const h = await boot({
    apiHandler: ({ url }) => {
      if (url === 'api/auth/reset-password/state') {
        return { success: true, email: 'flow@example.com', encryption: null };
      }
      const err = /** @type {any} */ (new Error(SERVER_RATE_LIMIT));
      err.status = 429;
      err.code = 'rate_limited';
      throw err;
    },
  });
  try {
    await openResetModal(h);
    await h.window.doResetPassword();
    const shown = h.document.getElementById('resetError').textContent;
    assert.equal(shown, h.table['reset.err.rate_limited']);
    assert.ok(!shown.includes('Too many'), `raw server English leaked: ${shown}`);
  } finally {
    await h.close();
  }
});

test('a dead reset link is reported in the interface language', async () => {
  const h = await boot({
    apiHandler: () => {
      const err = /** @type {any} */ (new Error(SERVER_BAD_LINK));
      err.status = 400;
      err.code = 'expired';
      throw err;
    },
  });
  try {
    await h.load('/modules/password-reset/i18n.js');
    await h.load('/modules/password-reset/index.js');
    await h.window.openPasswordResetFlow('dead-token');
    const shown = h.toastText();
    assert.ok(shown.includes(h.table['reset.err.link_expired']), `got: ${shown}`);
    assert.ok(!shown.includes('invalid or expired'), `raw server English leaked: ${shown}`);
  } finally {
    await h.close();
  }
});

test('every reset error code maps to a translated string', async () => {
  const codes = [
    'rate_limited',
    'expired',
    'malformed',
    'tampered',
    'wrong-purpose',
    'invalid_token',
    'stale_token',
    'invalid_credentials',
    'weak_password',
    'invalid_mode',
    'invalid_state',
    'invalid_request',
    'sessions_invalidate_failed',
    'something_new_from_the_server',
  ];
  for (const code of codes) {
    const h = await boot({
      apiHandler: ({ url }) => {
        if (url === 'api/auth/reset-password/state') {
          return { success: true, email: 'flow@example.com', encryption: null };
        }
        const err = /** @type {any} */ (new Error('English sentence the server made up'));
        err.code = code;
        throw err;
      },
    });
    try {
      await openResetModal(h);
      await h.window.doResetPassword();
      const shown = h.document.getElementById('resetError').textContent;
      assert.ok(shown.length > 0, `${code}: no message at all`);
      assert.ok(!shown.includes('English sentence'), `${code}: raw server message leaked`);
      assert.ok(!/^\[.*\]$/.test(shown), `${code}: unresolved i18n key ${shown}`);
    } finally {
      await h.close();
    }
  }
});
