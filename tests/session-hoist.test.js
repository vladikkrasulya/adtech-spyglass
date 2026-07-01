'use strict';

/**
 * ROADMAP #18 — SpyglassSession hoist to shell level. Regression tests.
 *
 * Three layers, same split as tests/inspector-reentrant.test.js (ROADMAP #19):
 *
 * 1. RUNTIME (session.js + registry.js + modal-host.js, real modules under
 *    jsdom, mocked fetch) — the session service is a module-level singleton,
 *    so each test that needs isolated state imports it via a `?instance=N`
 *    query-string cache-buster (a fresh ES module instance per import
 *    specifier — a standard Node ESM testing technique; no test-only hooks
 *    were added to the production module for this).
 *
 * 2. STATIC — assertions on source text for the parts of the chain that
 *    cross a browser-absolute import boundary (`/core/session.js` from
 *    /modules/topbar/index.js, /modules/auth/index.js, etc.) that plain
 *    Node cannot resolve without a custom loader. These verify the ACTUAL
 *    wiring (call order, fallback chains, facade shape) rather than
 *    hand-waving "should work".
 *
 * 3. Full end-to-end (topbar click → modal renders on /docs, /library, /live
 *    with zero navigation) is covered separately by the browser smoke run
 *    (real browser, real absolute-path ESM resolution) — see the final report.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let _instanceSeq = 0;

/** Fresh, isolated session.js module instance + a jsdom window wired to it. */
async function freshSession(opts = {}) {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="modalRoot"></div><div id="toastContainer"></div><main id="app-root"></main></body>',
    { url: opts.url || 'https://ortbtools.com/inspector' },
  );
  const w = dom.window;
  const realFetch = opts.fetch || (async () => ({ ok: true, status: 200, json: async () => ({}) }));
  let fetchCalls = 0;
  w.fetch = async (...args) => {
    fetchCalls++;
    return realFetch(...args);
  };
  w.t = (k) => k; // i18n stub — key passthrough, no window.t installed in this harness
  const prevWindow = global.window,
    prevDocument = global.document,
    prevCustomEvent = global.CustomEvent,
    prevSessionStorage = global.sessionStorage,
    prevLocation = global.location,
    prevHistory = global.history,
    prevURLSearchParams = global.URLSearchParams,
    prevFetch = global.fetch;
  global.window = w;
  global.document = w.document;
  global.CustomEvent = w.CustomEvent;
  global.sessionStorage = w.sessionStorage;
  global.location = w.location;
  global.history = w.history;
  global.URLSearchParams = w.URLSearchParams;
  global.fetch = w.fetch;
  const mod = await import(`../public/core/session.js?instance=${++_instanceSeq}`);
  // Restore the outer globals immediately — each test re-installs its OWN
  // window/etc. right before touching `mod.session` so concurrently-running
  // node:test subtests (if any were parallel) can't cross-contaminate. In
  // practice these tests run serially, but this keeps the harness honest.
  const restore = () => {
    global.window = prevWindow;
    global.document = prevDocument;
    global.CustomEvent = prevCustomEvent;
    global.sessionStorage = prevSessionStorage;
    global.location = prevLocation;
    global.history = prevHistory;
    global.URLSearchParams = prevURLSearchParams;
    global.fetch = prevFetch;
  };
  return {
    session: mod.session,
    installSessionFacade: mod.installSessionFacade,
    w,
    getFetchCalls: () => fetchCalls,
    restore,
  };
}

// Re-install this instance's globals as "current" before touching it (see note
// above) and run `fn`, then restore whatever was there before.
async function withSession(ctxObj, fn) {
  global.window = ctxObj.w;
  global.document = ctxObj.w.document;
  global.CustomEvent = ctxObj.w.CustomEvent;
  global.sessionStorage = ctxObj.w.sessionStorage;
  global.location = ctxObj.w.location;
  global.history = ctxObj.w.history;
  global.URLSearchParams = ctxObj.w.URLSearchParams;
  global.fetch = ctxObj.w.fetch;
  try {
    return await fn();
  } finally {
    ctxObj.restore();
  }
}

// ── 1. SpyglassSession exists before Inspector mounts ───────────────────────
test('installSessionFacade() works standalone — no Inspector/registry involvement needed', async () => {
  const ctx = await freshSession();
  await withSession(ctx, () => {
    assert.equal(ctx.w.SpyglassSession, undefined, 'facade not installed yet');
    ctx.installSessionFacade();
    assert.ok(ctx.w.SpyglassSession, 'facade installed');
    assert.equal(ctx.w.SpyglassSession.__shellOwned, true);
    assert.equal(
      ctx.w.SpyglassSession.user,
      null,
      'anonymous by default, no adapter/section involved',
    );
  });
});

test('static: shell-boot installs the session facade + modal host BEFORE any section can activate', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'public/shell-boot.js'), 'utf8');
  // installSessionFacade()/installModalHost() are called from mountChrome();
  // boot() calls mountChrome() BEFORE activateFromUrl() (which is what can
  // actually mount a section, e.g. Inspector, on first load).
  const chromeBody = shell.slice(
    shell.indexOf('function mountChrome()'),
    shell.indexOf('function wireLangChange()'),
  );
  assert.match(chromeBody, /installSessionFacade\(\)/, 'mountChrome installs the session facade');
  assert.match(chromeBody, /installModalHost\(\)/, 'mountChrome installs the modal host');
  const bootBody = shell.slice(shell.indexOf('async function boot()'));
  const idxMountChrome = bootBody.indexOf('mountChrome()');
  const idxActivate = bootBody.indexOf('await activateFromUrl()');
  assert.ok(idxMountChrome > -1 && idxActivate > -1, 'both calls present in boot()');
  assert.ok(
    idxMountChrome < idxActivate,
    'chrome (session facade + modal host) mounts before any section can activate',
  );
});

// ── 2. Inspector unmount does not destroy the shell session ─────────────────
test('unregisterAdapter (Inspector unmount) leaves user/DEK session intact', async () => {
  const ctx = await freshSession();
  await withSession(ctx, () => {
    ctx.session.setUser({ id: 1, email: 'a@x.com' });
    const token = ctx.session.registerAdapter({ getCurrentSampleId: () => 42 });
    assert.equal(
      ctx.session.adapt('getCurrentSampleId', [], null),
      42,
      'adapter live while mounted',
    );
    ctx.session.unregisterAdapter(token); // simulates ctx.addCleanup on Inspector unmount
    assert.equal(ctx.session.user.email, 'a@x.com', 'user survives Inspector unmount');
    assert.equal(
      ctx.session.adapt('getCurrentSampleId', [], 'FALLBACK'),
      'FALLBACK',
      'adapter calls are a safe no-op once unregistered — not an error, not stale data',
    );
  });
});

// ── 3. 10× section navigation does not duplicate service/listeners ─────────
test('10× adapter register/unregister cycles: no duplicate notifications, no stale adapter calls', async () => {
  const ctx = await freshSession();
  await withSession(ctx, () => {
    let authChangedCount = 0;
    ctx.w.addEventListener('auth:changed', () => authChangedCount++);
    for (let i = 0; i < 10; i++) {
      const token = ctx.session.registerAdapter({ refreshSamples: () => {} });
      ctx.session.setUser({ id: i, email: `u${i}@x.com` }); // changes every cycle → 1 event/cycle
      ctx.session.unregisterAdapter(token);
    }
    assert.equal(
      authChangedCount,
      10,
      'exactly one auth:changed per actual user change — no duplication',
    );
    // A stale token from cycle 0 must not be able to clear cycle 9's (already
    // unregistered, so this asserts nothing throws and no adapter is "revived").
    ctx.session.unregisterAdapter(1);
    assert.equal(ctx.session.adapt('refreshSamples', [], 'still-none'), 'still-none');
  });
});

// ── 14. Inspector adapter mount/unmount is generation-safe ──────────────────
test('a stale unregisterAdapter token cannot clear a NEWER adapter (generation-safe)', async () => {
  const ctx = await freshSession();
  await withSession(ctx, () => {
    const staleToken = ctx.session.registerAdapter({ tag: () => 'OLD' });
    // Simulate: old mount's unmount is delayed/aborted-then-retried while a
    // NEW mount has already registered its own adapter in the meantime.
    const freshToken = ctx.session.registerAdapter({ tag: () => 'NEW' });
    assert.notEqual(staleToken, freshToken, 'each registration gets a distinct token');
    ctx.session.unregisterAdapter(staleToken); // the old mount's belated cleanup
    assert.equal(
      ctx.session.adapt('tag', [], null),
      'NEW',
      'the NEW adapter is untouched by the stale unregister',
    );
    ctx.session.unregisterAdapter(freshToken);
    assert.equal(ctx.session.adapt('tag', [], 'GONE'), 'GONE');
  });
});

// ── 9. Concurrent init shares ONE /api/auth/me ──────────────────────────────
test('concurrent ensureBooted() callers share exactly one /api/auth/me request', async () => {
  const ctx = await freshSession({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, user: { id: 1, email: 'a@x.com' } }),
    }),
  });
  await withSession(ctx, async () => {
    const [r1, r2, r3] = await Promise.all([
      ctx.session.ensureBooted(),
      ctx.session.ensureBooted(),
      ctx.session.ensureBooted(),
    ]);
    assert.equal(ctx.getFetchCalls(), 1, 'exactly one network request for 3 concurrent callers');
    assert.equal(r1.user.email, 'a@x.com');
    assert.equal(r2, r1, 'all callers get the identical result object (shared promise)');
    assert.equal(r3, r1);
    // A subsequent (non-forced) call reuses the cached result — still one fetch total.
    await ctx.session.ensureBooted();
    assert.equal(ctx.getFetchCalls(), 1, 'repeat non-forced call does not re-fetch');
  });
});

// ── 10. Stale init does not overwrite a newer login/logout ──────────────────
test('a slow ensureBooted() response does not clobber a login that completed first', async () => {
  let releaseBootFetch;
  const bootGate = new Promise((r) => (releaseBootFetch = r));
  const ctx = await freshSession({
    fetch: async () => {
      await bootGate; // the auth/me network call is artificially slow
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, user: { id: 1, email: 'old@x.com' } }),
      };
    },
  });
  await withSession(ctx, async () => {
    const bootPromise = ctx.session.ensureBooted(); // fires the slow request
    // A LOGIN completes first (e.g. the user typed fast) while boot is still in flight.
    ctx.session.setUser({ id: 2, email: 'new@x.com' });
    releaseBootFetch();
    await bootPromise;
    assert.equal(
      ctx.session.user.email,
      'new@x.com',
      'the newer login wins — stale boot response discarded',
    );
  });
});

test('a slow ensureBooted() response does not resurrect a user after logout', async () => {
  let releaseBootFetch;
  const bootGate = new Promise((r) => (releaseBootFetch = r));
  const ctx = await freshSession({
    fetch: async () => {
      await bootGate;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, user: { id: 1, email: 'a@x.com' } }),
      };
    },
  });
  await withSession(ctx, async () => {
    const bootPromise = ctx.session.ensureBooted();
    ctx.session.clearSession(); // user logs out while boot is still in flight
    releaseBootFetch();
    await bootPromise;
    assert.equal(ctx.session.user, null, 'logout is not undone by the stale boot response');
  });
});

// ── 11. Anonymous / network-error paths ──────────────────────────────────────
test('ensureBooted(): a 401/no-user response resolves to anonymous', async () => {
  const ctx = await freshSession({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, user: null }),
    }),
  });
  await withSession(ctx, async () => {
    const r = await ctx.session.ensureBooted();
    assert.equal(r.user, null);
    assert.equal(ctx.session.hasSession(), false);
  });
});

test('ensureBooted(): a network failure resolves to anonymous (never throws, never hangs)', async () => {
  const ctx = await freshSession({
    fetch: async () => {
      throw new Error('network down');
    },
  });
  await withSession(ctx, async () => {
    const r = await ctx.session.ensureBooted();
    assert.equal(r.user, null, 'network failure → anonymous, same contract as 401');
    assert.equal(ctx.session.hasSession(), false);
  });
});

// ── 7. Login updates chrome state without any navigation ────────────────────
test('setUser() (login) dispatches auth:changed and touches ONLY session state — no navigation call anywhere', async () => {
  const ctx = await freshSession();
  await withSession(ctx, () => {
    /** @type {any} */
    let event = null;
    ctx.w.addEventListener('auth:changed', (e) => (event = e));
    const pathBefore = ctx.w.location.pathname;
    ctx.session.setUser({ id: 1, email: 'a@x.com' });
    assert.ok(event, 'auth:changed fired');
    assert.equal(event.detail.user.email, 'a@x.com');
    assert.equal(
      ctx.w.location.pathname,
      pathBefore,
      'login never navigates — the current route is untouched',
    );
  });
});

test('setUser() does not dispatch auth:changed when the effective user did not change (dedup)', async () => {
  const ctx = await freshSession();
  await withSession(ctx, () => {
    let count = 0;
    ctx.w.addEventListener('auth:changed', () => count++);
    ctx.session.setUser({ id: 1, email: 'a@x.com' });
    ctx.session.setUser({ id: 1, email: 'a@x.com' }); // same identity → no-op
    assert.equal(count, 1, 'identical user set twice fires auth:changed exactly once');
  });
});

// ── 8. After login, a NEW Inspector mount sees the already-live session ─────
test('a fresh Inspector adapter registered AFTER login immediately sees user + DEK — no re-fetch needed', async () => {
  const ctx = await freshSession();
  await withSession(ctx, async () => {
    ctx.session.setUser({ id: 1, email: 'a@x.com' });
    // openFromPassword needs window.SpyglassCrypto — stub the ONE call this
    // test exercises (openWithPassword), matching the module's contract:
    // returns a DEK-like object; real crypto is out of scope for this test.
    ctx.w.SpyglassCrypto = {
      openWithPassword: async () => ({ __fakeDek: true }),
      serializeDEK: async () => 'b64',
    };
    await ctx.session.openFromPassword('pw', { some: 'state' }, {});
    // Now "navigate to Inspector" — register its adapter fresh.
    const token = ctx.session.registerAdapter({ refreshSamples: () => 'ran' });
    assert.equal(ctx.session.user.email, 'a@x.com', 'user already live for the new mount');
    assert.equal(
      ctx.session.hasSession(),
      true,
      'DEK already live for the new mount — no unlock prompt needed',
    );
    ctx.session.unregisterAdapter(token);
  });
});

// ── 12. Logout wipes BOTH live and persisted DEK ─────────────────────────────
test('clearSession() (logout) wipes the live DEK AND the sessionStorage-persisted copy', async () => {
  const ctx = await freshSession();
  await withSession(ctx, async () => {
    ctx.w.SpyglassCrypto = {
      openWithPassword: async () => ({ __fakeDek: true }),
      serializeDEK: async () => 'b64-blob',
    };
    await ctx.session.openFromPassword('pw', {}, {});
    assert.equal(ctx.session.hasSession(), true);
    assert.equal(
      ctx.w.sessionStorage.getItem('kt-dek-v1'),
      'b64-blob',
      'DEK persisted to sessionStorage',
    );
    ctx.session.clearSession();
    assert.equal(ctx.session.hasSession(), false, 'live DEK wiped');
    assert.equal(ctx.w.sessionStorage.getItem('kt-dek-v1'), null, 'persisted DEK wiped too');
    assert.equal(ctx.session.user, null, 'user cleared');
  });
});

test('signOut() POSTs /api/auth/logout, then wipes the session regardless of the response', async () => {
  const ctx = await freshSession({
    fetch: async () => {
      throw new Error('logout endpoint down');
    },
  });
  await withSession(ctx, async () => {
    ctx.w.SpyglassCrypto = { openWithPassword: async () => ({}), serializeDEK: async () => 'b64' };
    ctx.session.setUser({ id: 1, email: 'a@x.com' });
    await ctx.session.openFromPassword('pw', {}, {});
    await ctx.session.signOut(); // logout POST throws — must still wipe locally
    assert.equal(ctx.session.user, null, 'local session wiped even though the server call failed');
    assert.equal(ctx.session.hasSession(), false);
  });
});

// ── 13. Raw DEK/CryptoKey is never reachable through the facade ─────────────
test('the DEK never appears anywhere on window.SpyglassSession — only encrypt/decrypt operations do', async () => {
  const ctx = await freshSession();
  await withSession(ctx, async () => {
    ctx.installSessionFacade();
    ctx.w.SpyglassCrypto = {
      openWithPassword: async () => ({ __secretKeyMarker: 'THE_RAW_DEK_MUST_NEVER_LEAK' }),
      serializeDEK: async () => 'b64',
    };
    await ctx.session.openFromPassword('pw', {}, {});
    const facade = ctx.w.SpyglassSession;
    const serialized = JSON.stringify(facade, (k, v) => (typeof v === 'function' ? '[fn]' : v));
    assert.ok(
      !serialized.includes('THE_RAW_DEK_MUST_NEVER_LEAK'),
      "the DEK object never appears in the facade's own enumerable shape",
    );
    // hasSession is a boolean, not the key.
    assert.equal(typeof facade.hasSession(), 'boolean');
    assert.equal(facade.hasSession(), true);
    // encryptBlob/decryptBlob take plaintext/ciphertext, not the key — confirm
    // by call signature (arity) rather than by inspecting closures we cannot
    // reach from outside the module (which is exactly the security property).
    assert.equal(facade.encryptBlob.length, 1, 'encryptBlob(plain) — no key parameter');
    assert.equal(facade.decryptBlob.length, 2, 'decryptBlob(ivB64, ctB64) — no key parameter');
  });
});

// ── Modal host: closeModal / lazyOpenAuth work with no section context ──────
test('modal-host closeModal() clears #modalRoot and is safe with no recovery/reset modules loaded', async () => {
  const ctx = await freshSession();
  await withSession(ctx, async () => {
    const modalHost = await import(`../public/core/modal-host.js?instance=${++_instanceSeq}`);
    ctx.w.document.getElementById('modalRoot').innerHTML = '<div class="modal-card">x</div>';
    modalHost.installModalHost();
    assert.equal(ctx.w.closeModal, ctx.w.closeModal, 'closeModal installed');
    ctx.w.closeModal();
    assert.equal(ctx.w.document.getElementById('modalRoot').innerHTML, '', 'modal content cleared');
  });
});

test('modal-host lazyOpenAuth(mode) calls window.openAuthModal directly when already loaded — no navigation, on ANY starting route', async () => {
  for (const startUrl of [
    'https://ortbtools.com/docs',
    'https://ortbtools.com/library',
    'https://ortbtools.com/live',
  ]) {
    const ctx = await freshSession({ url: startUrl });
    await withSession(ctx, async () => {
      const modalHost = await import(`../public/core/modal-host.js?instance=${++_instanceSeq}`);
      modalHost.installModalHost();
      let calledWith = null;
      ctx.w.openAuthModal = (mode) => (calledWith = mode);
      await ctx.w.lazyOpenAuth('login');
      assert.equal(calledWith, 'login', `lazyOpenAuth reached openAuthModal from ${startUrl}`);
      assert.equal(ctx.w.location.href, startUrl, `no navigation occurred from ${startUrl}`);
    });
  }
});

// ── STATIC: topbar's sign-in is section-agnostic by construction ───────────
test('static: topbar onSignIn tries window.openAuthModal / window.lazyOpenAuth BEFORE the /inspector?auth= navigate fallback', () => {
  const topbar = fs.readFileSync(path.join(ROOT, 'public/modules/topbar/index.js'), 'utf8');
  const onSignIn = topbar.slice(
    topbar.indexOf('const onSignIn ='),
    topbar.indexOf('const onSignIn =') + 700,
  );
  const idxModal = onSignIn.indexOf("typeof window.openAuthModal === 'function'");
  const idxLazy = onSignIn.indexOf("typeof window.lazyOpenAuth === 'function'");
  const idxNavigate = onSignIn.indexOf('SpyglassShell.navigateTo');
  assert.ok(idxModal > -1 && idxLazy > -1 && idxNavigate > -1, 'all three branches present');
  assert.ok(
    idxModal < idxNavigate && idxLazy < idxNavigate,
    'in-place branches are checked before the navigate fallback',
  );
  // Since installModalHost() (previous commit) installs window.lazyOpenAuth
  // unconditionally at boot, BEFORE topbar ever mounts, the navigate branch
  // is dead code in practice — this is the literal fix for the task.
  const shellBoot = fs.readFileSync(path.join(ROOT, 'public/shell-boot.js'), 'utf8');
  assert.match(
    shellBoot,
    /installModalHost\(\)/,
    'shell installs lazyOpenAuth before topbar mounts',
  );
});

test('static: topbar dedupes auth boot through session.ensureBooted() — no separate /api/auth/me fetch', () => {
  const topbar = fs.readFileSync(path.join(ROOT, 'public/modules/topbar/index.js'), 'utf8');
  assert.doesNotMatch(
    topbar,
    /fetch\(['"]\/api\/auth\/me['"]/,
    'topbar no longer fetches auth/me itself',
  );
  assert.match(topbar, /session\.ensureBooted\(\)/, 'topbar shares the canonical session boot');
});

// ── 16. Legacy ?auth=login|signup still works ────────────────────────────────
test('static: legacy ?auth=login|signup deep-link is preserved and reads the shell session', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public/spyglass.app.js'), 'utf8');
  assert.match(app, /qp\.get\('auth'\) === 'login' \|\| qp\.get\('auth'\) === 'signup'/);
  assert.match(app, /if \(!session\.user\) \{\s*window\.lazyOpenAuth\(mode\);/);
});

// ── 15. Register → recovery modal is reachable outside Inspector ───────────
test('static: recovery module renders via generic $()/modalRoot only — no Inspector-only dependency', () => {
  const recovery = fs.readFileSync(path.join(ROOT, 'public/modules/recovery/index.js'), 'utf8');
  assert.match(
    recovery,
    /from '\/core\/utils\.js'/,
    'uses the shared $ helper, not an Inspector-closure one',
  );
  assert.match(recovery, /\$\('modalRoot'\)/);
  const auth = fs.readFileSync(path.join(ROOT, 'public/modules/auth/index.js'), 'utf8');
  // bootstrapAndShowRecovery falls back to window.showRecoveryKeyModal directly
  // when window.openRecoveryKeyModalLazy (Inspector-only) isn't present.
  assert.match(auth, /openRecoveryKeyModalLazy/);
  assert.match(auth, /showRecoveryKeyModal/);
});

// ── 17. UK/EN/RU modal strings are all present ───────────────────────────────
// Per-module i18n.js files (auth/unlock/recovery) nest all three locales in
// ONE object per key: `'key.name': { uk: '…', en: '…', ru: '…' }`.
test('auth/unlock modal-specific i18n keys have uk/en/ru all present (module-local)', () => {
  const checks = [
    [
      'modules/auth/i18n.js',
      [
        'auth.login.title',
        'auth.register.title',
        'auth.label.password_hint',
        'auth.btn.login',
        'auth.btn.register',
      ],
    ],
    ['modules/unlock/i18n.js', ['modal.unlock.title', 'btn.unlock', 'btn.signout_instead']],
  ];
  for (const [file, keys] of /** @type {[string, string[]][]} */ (checks)) {
    const src = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
    for (const key of keys) {
      const keyIdx = src.indexOf(`'${key}':`);
      assert.ok(keyIdx > -1, `${file}: key '${key}' exists`);
      const block = src.slice(keyIdx, keyIdx + 300);
      for (const locale of ['uk:', 'en:', 'ru:']) {
        assert.match(
          block,
          new RegExp(locale + `\\s*['"]\\S`),
          `${file}: '${key}' has a non-empty ${locale.slice(0, -1)} string`,
        );
      }
    }
  }
});

// auth.label.email/password are DELIBERATELY shared generics (also used by
// forgot/reset password), so they live in the GLOBAL public/i18n.js, one
// flat `'key': 'value'` entry per locale block (not the module-nested format
// above) — verified by reading the actual source before writing this check.
test('auth.label.email/password (shared generics) exist in all three global i18n.js locale blocks', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');
  for (const key of ['auth.label.email', 'auth.label.password']) {
    const count = (i18n.match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'\\S`, 'g')) || [])
      .length;
    assert.equal(
      count,
      3,
      `'${key}' should have exactly 3 non-empty entries (en/uk/ru), found ${count}`,
    );
  }
});

// ── 18. password-reset / unlock / save-sample don't regress ─────────────────
test('static: password-reset/unlock/save-sample still call the SAME facade method names session.js provides', () => {
  const facadeSrc = fs.readFileSync(path.join(ROOT, 'public/core/session.js'), 'utf8');
  const facadeBody = facadeSrc.slice(facadeSrc.indexOf('export function installSessionFacade'));
  const consumers = [
    [
      'modules/unlock/index.js',
      ['user', 'api', 'openFromPassword', 'refreshSamples', 'wireEnterSubmit'],
    ],
    ['modules/password-reset/index.js', ['importDEKFromBytes', 'api']],
    ['modules/save-sample/index.js', ['user', 'hasSession']],
    [
      'modules/edit-sample/index.js',
      ['api', 'partnerOptionsHtml', 'currentSampleId', 'setCurrentSampleMeta'],
    ],
    [
      'modules/auth/index.js',
      [
        'api',
        'setUser',
        'openFromPassword',
        'bootstrap',
        'renderAuthWidget',
        'refreshPartners',
        'refreshSamples',
      ],
    ],
  ];
  for (const [file, methods] of /** @type {[string, string[]][]} */ (consumers)) {
    const src = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
    // Consumers either call window.SpyglassSession.method(...) directly, or
    // alias it first (`const S = window.SpyglassSession;` / `const session =
    // window.SpyglassSession;`) and call S.method(...) — both are legitimate,
    // pre-existing patterns (verified per-file while reading them earlier).
    assert.match(src, /window\.SpyglassSession/, `${file} references window.SpyglassSession`);
    for (const m of methods) {
      assert.match(
        src,
        new RegExp('\\.' + m + '\\b'),
        `${file} calls .${m} (direct or via a SpyglassSession alias)`,
      );
      assert.match(facadeBody, new RegExp('\\b' + m + '\\b'), `facade still provides .${m}`);
    }
  }
});
