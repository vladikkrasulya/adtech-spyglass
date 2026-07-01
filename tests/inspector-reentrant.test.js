'use strict';

/**
 * Inspector re-entrant mount lifecycle — regression tests (ROADMAP #19).
 *
 * Two layers:
 *
 * 1. RUNTIME — drives the REAL module registry (public/core/registry.js) under
 *    jsdom. The registry is the mount → unmount → mount mechanism the inspector
 *    (and every section) relies on. Synthetic modules reproduce the inspector's
 *    resource patterns (window listener via ctx.signal, timer + observer via
 *    ctx.addCleanup, a window facade, a stale async continuation). We prove that
 *    a contract-conforming module leaves ZERO residue across repeated remounts,
 *    teardown is idempotent, an abort mid-mount still cleans up, and a stale
 *    async continuation from a prior mount cannot mutate the next mount's DOM.
 *    A contrast case documents that an UNSCOPED listener leaks — the exact bug
 *    class fixed in mountInspector's drag handlers.
 *
 * 2. STATIC — asserts the specific mountInspector / shell-boot fixes are present
 *    (guards against silent regression): drag window-listeners scoped to
 *    ctx.signal, the analyze fetch aborted on unmount + its render paths guarded
 *    by ctx.signal.aborted, the quality-tick chain guarded, and the shell no
 *    longer force-reloads onto the inspector.
 *
 * jsdom is resolved via NODE_PATH (CJS require) — see the run command in the
 * task; the registry is an ES module, loaded with a dynamic import().
 */

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

let registry;

before(async () => {
  const dom = new JSDOM('<!DOCTYPE html><body><main id="app-root"></main></body>', {
    url: 'https://ortbtools.com/inspector',
  });
  const w = dom.window;
  // The registry runs in the node realm; point its browser globals at jsdom's so
  // AbortSignal/addEventListener({signal})/MutationObserver/CustomEvent are the
  // SAME realm (avoids cross-realm `signal instanceof AbortSignal` mismatches).
  global.window = w;
  global.document = w.document;
  global.CustomEvent = w.CustomEvent;
  global.MutationObserver = w.MutationObserver;
  global.AbortController = w.AbortController;
  // Variable specifier: loaded dynamically at runtime, but kept out of tsc's
  // static graph so type-checking this test doesn't drag the browser /core/*
  // ES modules (excluded from the tsconfig program) in with it.
  const registryPath = '../public/core/registry.js';
  registry = await import(registryPath);
});

// Each test starts with nothing mounted (deactivate is a no-op when idle).
beforeEach(async () => {
  if (registry) await registry.deactivate();
});

const root = () => global.document.getElementById('app-root');

// ── RUNTIME: registry lifecycle ────────────────────────────────────────────

test('10× mount→unmount→mount: a signal-scoped listener never accumulates; one dispatch = one call', async () => {
  let calls = 0;
  registry.register({
    id: 'reentrant-listener',
    async mount(el, ctx) {
      global.window.addEventListener('kt:reentrant-ping', () => calls++, { signal: ctx.signal });
    },
  });

  for (let i = 0; i < 10; i++) {
    await registry.activate('reentrant-listener', root());
    await registry.deactivate();
  }
  // All 10 mounts unmounted → every listener detached with its ctx.signal.
  global.window.dispatchEvent(new global.CustomEvent('kt:reentrant-ping'));
  assert.equal(calls, 0, 'no stacked listeners survive 10 unmounts');

  // One live mount → exactly one handler fires per event.
  await registry.activate('reentrant-listener', root());
  global.window.dispatchEvent(new global.CustomEvent('kt:reentrant-ping'));
  assert.equal(calls, 1, 'exactly one live listener after remount');
  global.window.dispatchEvent(new global.CustomEvent('kt:reentrant-ping'));
  assert.equal(calls, 2, 'still exactly one — no duplicate binding');
});

test('10× cycles: timers, observers and window facades registered via addCleanup are all destroyed', async () => {
  let liveTimers = 0;
  let liveObservers = 0;
  registry.register({
    id: 'reentrant-resources',
    async mount(el, ctx) {
      const iv = setInterval(() => {}, 100000);
      liveTimers++;
      ctx.addCleanup(() => {
        clearInterval(iv);
        liveTimers--;
      });

      const mo = new global.MutationObserver(() => {});
      mo.observe(el, { attributes: true });
      liveObservers++;
      ctx.addCleanup(() => {
        mo.disconnect();
        liveObservers--;
      });

      global.window['__reentrantFacade'] = { mountedAt: 1 };
      ctx.addCleanup(() => {
        delete global.window['__reentrantFacade'];
      });
    },
  });

  for (let i = 0; i < 10; i++) {
    await registry.activate('reentrant-resources', root());
    assert.equal(liveTimers, 1, 'exactly one timer while mounted');
    assert.equal(liveObservers, 1, 'exactly one observer while mounted');
    assert.ok(global.window['__reentrantFacade'], 'facade present while mounted');
    await registry.deactivate();
    assert.equal(liveTimers, 0, `timer cleared on unmount (cycle ${i})`);
    assert.equal(liveObservers, 0, `observer disconnected on unmount (cycle ${i})`);
    assert.equal(
      global.window['__reentrantFacade'],
      undefined,
      `facade swept on unmount (cycle ${i})`,
    );
  }
});

test('teardown is idempotent (double deactivate, no throw) and a mount() failure aborts + runs cleanups', async () => {
  // idempotent deactivate
  registry.register({
    id: 'reentrant-idempotent',
    async mount(el, ctx) {
      ctx.addCleanup(() => {});
    },
  });
  await registry.activate('reentrant-idempotent', root());
  await registry.deactivate();
  await assert.doesNotReject(() => registry.deactivate(), 'second deactivate is a safe no-op');

  // mount() throws AFTER registering resources → registry must abort the signal
  // and run the cleanups so nothing leaks from the half-built mount.
  let cleanupRan = false;
  let listenerCalls = 0;
  registry.register({
    id: 'reentrant-throwing',
    async mount(el, ctx) {
      global.window.addEventListener('kt:throw-ping', () => listenerCalls++, {
        signal: ctx.signal,
      });
      ctx.addCleanup(() => {
        cleanupRan = true;
      });
      throw new Error('mount boom');
    },
  });
  await assert.rejects(() => registry.activate('reentrant-throwing', root()), /mount boom/);
  assert.equal(cleanupRan, true, 'cleanups run even when mount() throws');
  global.window.dispatchEvent(new global.CustomEvent('kt:throw-ping'));
  assert.equal(listenerCalls, 0, 'listener from the failed mount was detached (signal aborted)');
  assert.equal(registry.current(), null, 'no active module after a failed mount');
});

test('stale async continuation from mount N is guarded by ctx.signal.aborted and never mutates mount N+1', async () => {
  const pending = [];
  let mountSeq = 0;
  registry.register({
    id: 'reentrant-async',
    async mount(el, ctx) {
      const myId = ++mountSeq;
      // A promise that resolves LATER (we control it) — the inspector's analyze
      // fetch is the real-world analogue. On resolve it must bail if unmounted.
      const p = new Promise((res) => pending.push(res));
      p.then(() => {
        if (ctx.signal.aborted) return; // ← the guard the analyze render now uses
        el.setAttribute('data-touched-by-mount', String(myId));
      });
    },
  });

  await registry.activate('reentrant-async', root()); // mount #1
  await registry.deactivate(); // unmount #1 (its ctx.signal aborts)
  await registry.activate('reentrant-async', root()); // mount #2 — same #app-root

  // Resolve mount #1's pending promise AFTER mount #2 is live.
  pending[0]();
  await Promise.resolve(); // let the .then microtask run
  await Promise.resolve();

  assert.equal(
    root().getAttribute('data-touched-by-mount'),
    null,
    "mount #1's stale continuation saw aborted and did not paint into mount #2",
  );

  // Sanity: mount #2's own continuation DOES paint (guard only blocks the stale one).
  pending[1]();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    root().getAttribute('data-touched-by-mount'),
    '2',
    "mount #2's live continuation paints",
  );
});

test('contract contrast: a listener NOT bound to ctx.signal leaks past deactivate (why drag handlers must pass {signal})', async () => {
  let leaked = 0;
  // Keep a stable reference: removeEventListener only detaches when handed the
  // SAME function object (a fresh arrow removes nothing).
  const leakyHandler = () => leaked++;
  registry.register({
    id: 'reentrant-leaky',
    async mount() {
      // Deliberately UNSCOPED — no {signal}, no addCleanup. This is the bug
      // class fixed in mountInspector's window mousemove/mouseup drag handlers.
      global.window.addEventListener('kt:leak-ping', leakyHandler);
    },
  });
  await registry.activate('reentrant-leaky', root());
  await registry.deactivate();
  global.window.dispatchEvent(new global.CustomEvent('kt:leak-ping'));
  assert.equal(
    leaked,
    1,
    'unscoped listener survives deactivate — registry cleans ONLY contract-bound resources',
  );
  // Detach by the same reference so it can't bleed into other tests.
  global.window.removeEventListener('kt:leak-ping', leakyHandler);
  global.window.dispatchEvent(new global.CustomEvent('kt:leak-ping'));
  assert.equal(leaked, 1, 'removeEventListener with the saved reference actually detached it');
});

// ── STATIC: the specific mountInspector / shell-boot fixes are present ───────

const APP = fs.readFileSync(path.join(ROOT, 'public/spyglass.app.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'public/shell-boot.js'), 'utf8');
// ROADMAP #18 moved api()/ensureBooted() out of spyglass.app.js into the
// shell-level session service — these static checks follow the code there.
const SESSION = fs.readFileSync(path.join(ROOT, 'public/core/session.js'), 'utf8');

test('static: all four drag window-listeners are scoped to ctx.signal', () => {
  for (const ev of ['mousemove', 'mouseup', 'touchmove', 'touchend']) {
    const re = new RegExp(`window\\.addEventListener\\('${ev}',[^;]*signal:\\s*ctx\\.signal`, 's');
    assert.match(APP, re, `drag ${ev} listener must pass { signal: ctx.signal }`);
  }
});

test('static: the in-flight analyze is aborted on unmount and its render paths guard on ctx.signal.aborted', () => {
  // abort-on-unmount cleanup
  assert.match(
    APP,
    /ctx\.addCleanup\(\(\) => \{\s*if \(_analyzeAbort\)/s,
    'expected an addCleanup that aborts _analyzeAbort on unmount',
  );
  // success-render stale/abort guard
  assert.match(
    APP,
    /if \(myReqId !== _analyzeReqSeq \|\| ctx\.signal\.aborted\) return;/,
    'success render must bail when the module unmounted',
  );
  // catch-render abort guard — the guard sits immediately before the
  // "backend offline" paint in the analyze catch.
  assert.match(
    APP,
    /if \(ctx\.signal\.aborted\) return;\s*console\.warn\('Backend unavailable/,
    'analyze catch must bail on abort before painting',
  );
  // quality-tick chain guard (allow the explanatory comment before it)
  assert.match(
    APP,
    /function tickQuality\(\) \{[\s\S]{0,300}?if \(ctx\.signal\.aborted\) return;/,
    'quality-tick chain must stop after unmount',
  );
});

test('static: shell-boot no longer force-reloads onto the inspector (mitigation removed)', () => {
  assert.doesNotMatch(
    SHELL,
    /goesToInspector/,
    'the goesToInspector forced-reload branch must be gone',
  );
  // The /r/{hash} SPA handoff (activate('inspector') via __pendingSpecimenHash)
  // must still be present — /r/ routes through the client router, not a reload.
  assert.match(SHELL, /__pendingSpecimenHash/, '/r/{hash} still routes to the inspector via SPA');
  // The only remaining hard-load is the SSR-landing one; the inspector route
  // now flows through registry.activate() with no reload.
  assert.match(SHELL, /registry\.activate\('inspector'/, 'inspector mounts via registry.activate');
});

// ── RUNTIME: secondary async guard shape ────────────────────────────────────
// The real read/mutation/boot functions (api/bootAuth/refresh*/loadSample/
// loadDemoSample/deleteSample/corpus-delete) all share one shape:
//   await <fetch/op>;  if (ctx.signal.aborted) return;  <DOM|global|toast|refresh>
// registry.deactivate() sets ctx.signal.aborted (proven above); these prove the
// guard then suppresses the stale effect. Modeled directly with an
// AbortController so the timing (unmount WHILE the op is in flight) is exact.

test('delayed READ response from a torn-down mount does not paint (bootAuth/refresh*/loadSample pattern)', async () => {
  const c = new AbortController();
  let painted = null;
  let release = (_v) => {}; // typed callable; the Promise executor (runs sync) reassigns it
  const pending = new Promise((r) => (release = r));
  const read = (async () => {
    const data = await pending; // models `const j = await api('GET', …, {signal})`
    if (c.signal.aborted) return; // the guard we added after every read await
    painted = data; // the DOM/global write that must NOT reach a remount
  })();
  c.abort(); // unmount while the read is in flight
  release('LIST');
  await read;
  assert.equal(painted, null, 'a read resolving after unmount must not paint');
});

test('delayed MUTATION response after unmount does not refresh or toast (deleteSample/corpus-delete pattern)', async () => {
  const c = new AbortController();
  let toasts = 0;
  let refreshes = 0;
  let release = (_v) => {}; // typed callable; the Promise executor (runs sync) reassigns it
  const pending = new Promise((r) => (release = r));
  const del = (async () => {
    await pending; // the mutation itself is NOT aborted — it runs to completion
    if (c.signal.aborted) return; // guard only the response handling
    toasts++;
    refreshes++;
  })();
  c.abort(); // user navigated away before the server replied
  release('OK');
  await del;
  assert.equal(toasts, 0, 'no toast into a remount');
  assert.equal(refreshes, 0, 'no refresh into a remount');
});

test('abort during the initial boot sequence halts subsequent steps (bootAuth→refreshPartners→refreshSamples)', async () => {
  const c = new AbortController();
  const steps = [];
  let releaseBoot = (_v) => {}; // typed callable; the Promise executor (runs sync) reassigns it
  const bootAuthP = new Promise((r) => (releaseBoot = r));
  const boot = (async () => {
    await bootAuthP; // bootAuth()
    if (c.signal.aborted) return;
    steps.push('refreshPartners');
    if (c.signal.aborted) return;
    steps.push('refreshSamples');
  })();
  c.abort(); // unmounted DURING bootAuth
  releaseBoot();
  await boot;
  assert.deepEqual(steps, [], 'no refresh steps run when the mount aborts during boot');
});

// ── STATIC: the secondary async guards are present in the real functions ─────

test('static: secondary read/mutation/boot paths guard on ctx.signal.aborted', () => {
  // api() (ROADMAP #18: moved to /core/session.js) takes an optional signal —
  // inspector reads pass ctx.signal, mutations + the cross-section
  // SpyglassSession.api facade omit it.
  assert.match(
    SESSION,
    /async function api\(method, url, body, opts = \{\}\)/,
    'session.api() accepts opts',
  );
  assert.match(
    SESSION,
    /if \(opts\.signal\) init\.signal = opts\.signal;/,
    'session.api() wires opts.signal into fetch',
  );
  // every inspector-owned read passes ctx.signal via session.api(...) — the
  // auth/me boot read itself moved into session.ensureBooted() (SESSION),
  // shared/canonical and NOT per-mount-abortable by design (a stale boot is
  // guarded by the gen check instead — see the runtime tests above).
  for (const re of [
    /session\.api\('GET', 'api\/partners', undefined, \{ signal: ctx\.signal \}\)/,
    /session\.api\('GET', 'api\/samples' \+ qs, undefined, \{ signal: ctx\.signal \}\)/,
    /session\.api\('GET', 'api\/samples\/' \+ id, undefined, \{ signal: ctx\.signal \}\)/,
    /fetch\(url, \{ signal: ctx\.signal \}\)/, // loadDemoSample
  ]) {
    assert.match(APP, re, 'inspector read must pass ctx.signal: ' + re);
  }
  assert.match(
    SESSION,
    /me = await api\('GET', 'api\/auth\/me'\);/,
    'session.ensureBooted() reads api/auth/me (shared, gen-guarded, not ctx.signal-scoped)',
  );
  // boot sequence halts on abort between the awaited steps (ROADMAP #18:
  // bootAuth() is now the shell-canonical session.ensureBooted())
  assert.match(
    APP,
    /await session\.ensureBooted\(\);\s*if \(ctx\.signal\.aborted\) return;/,
    'boot halts after session.ensureBooted()',
  );
  assert.match(
    APP,
    /await refreshPartners\(\);\s*if \(ctx\.signal\.aborted\) return;/,
    'boot halts after refreshPartners',
  );
  // corpus-delete mutation response guards on abort
  assert.match(
    APP,
    /\.then\(\(j\) => \{\s*if \(ctx\.signal\.aborted\) return;/,
    'corpus-delete response guards on abort',
  );
  // defensive lower bound: the guard is applied broadly, not in one spot
  const guards = (APP.match(/ctx\.signal\.aborted/g) || []).length;
  assert.ok(
    guards >= 15,
    'expected many ctx.signal.aborted guards across async paths, found ' + guards,
  );
});
