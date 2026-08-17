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

const APP = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'public/shell-boot.js'), 'utf8');
// ROADMAP #18 moved api()/ensureBooted() out of ortbtools.app.js into the
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

// ── STATIC: the analyze-path fixes that a refactor would silently undo ──────
// Each of these was a live defect. Behaviour is covered end-to-end in a real
// browser; these guard the specific line that made the behaviour possible, in
// the file where a careless edit would remove it.

const I18N = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');

test('static: the response pane sends its raw bytes, with the same pretty-print bookkeeping as the request pane', () => {
  // The request pane keeps `_rawBeforePretty` across the pretty-print that
  // erases duplicate keys and oversized integer spellings. Without the same
  // pair for the response pane, `bidResRaw` would carry our re-serialisation
  // and report nothing — the tool destroying its own evidence on the response
  // side only.
  assert.match(APP, /_rawBeforePrettyRes/, 'response pane must stash its pre-pretty-print bytes');
  assert.match(
    APP,
    /const rawResBytes =\s*!fromHist && _prettyPrintedRes !== null && resVal === _prettyPrintedRes/,
    'rawResBytes must fall back to the stash once the pane holds our own pretty-print',
  );
  assert.match(APP, /bidResRaw: rawResBytes/, 'the analyze body must carry the response bytes');
});

test('static: a JSON root that is not a plain object is rejected before anything dereferences it', () => {
  // `JSON.parse('null')` succeeds and `typeof null === 'object'`, so the old
  // `if (reqVal && typeof req === 'object')` guard passed it straight into
  // `(req.site || req.app || {})` — a TypeError from mid-render.
  assert.match(APP, /function assertJsonRoot\(/, 'expected an explicit root-shape check');
  assert.match(
    APP,
    /assertJsonRoot\(req, reqVal, 'peek\.label\.bid_req', true\)/,
    'the request pane is checked (and still admits a bare URL string)',
  );
  assert.match(
    APP,
    /assertJsonRoot\(res, resVal, 'peek\.label\.bid_res', false\)/,
    'the response pane is checked, and a URL is not a response',
  );
  // The check must run before the first property read, not after.
  assert.ok(
    APP.indexOf("assertJsonRoot(req, reqVal, 'peek.label.bid_req'") <
      APP.indexOf('(req.site || req.app || {}).domain'),
    'the root check must precede the entity read that used to throw',
  );
});

test('static: a failed analysis clears the results panel instead of leaving the previous one on screen', () => {
  assert.match(APP, /function clearResultsForError\(/, 'expected an atomic results-panel reset');
  assert.match(
    APP,
    /console\.error\('Analysis error:', e\);[\s\S]{0,600}?if \(!ctx\.signal\.aborted\) clearResultsForError\(e\.message\)/,
    'the analyze catch must clear the panels, not just raise a toast',
  );
  // WHICH panels the reset covers is no longer asserted here.
  //
  // This test used to slice clearResultsForError's source and require the
  // strings 'tValidation', 'stEntity', '__ortbtoolsLast' and so on to appear
  // literally inside it. That passed for the right reason exactly once. When
  // Clear was wired to the same reset, the shared work moved into
  // resetAnalysisArtifacts() and this failed — while the panels were still
  // being reset, by the same call, on the same path. It was reading the
  // shape of one function and reporting it as a property of the product.
  //
  // The property itself is now checked where it is observable rather than
  // inferable: tests/clear-resets-results-browser.test.js analyses a payload,
  // then analyses a broken one, and requires the page to keep nothing from
  // the first. What survives here is the part static analysis can honestly
  // see — that the catch calls the reset at all.
});

test('static: response-only analysis does not accuse a request that was never sent', () => {
  // `empty.no_imp_slots` asserts a defect IN a request. Rendering it as the
  // catch-all told an operator who pasted only a BidResponse that their
  // (non-existent) request was malformed.
  assert.match(
    APP,
    /t\(hasRequestText \? 'empty\.no_imp_slots' : 'empty\.needs_paired_request'\)/,
    'the two states must resolve to two different messages',
  );
  for (const locale of ['en', 'uk', 'ru']) {
    assert.match(
      I18N,
      new RegExp(`'empty\\.needs_paired_request':[\\s\\S]{0,400}?${locale}:`),
      `empty.needs_paired_request must exist in ${locale}`,
    );
  }
});

test('static: ?forgot=1 is handled on boot like every other recovery deep link', () => {
  // public/account.js navigates to /?forgot=1; pre-fix `qp.get('forgot')`
  // appeared zero times here, so the link dropped the user on the inspector
  // with no recovery UI and no message.
  assert.match(APP, /qp\.get\('forgot'\) === '1'/, 'boot must read the forgot param');
  assert.match(
    APP,
    /qp\.get\('forgot'\)[\s\S]{0,900}?window\.openForgotPasswordFlow\(\)/,
    'the forgot branch must call the module entry point',
  );
  assert.match(
    APP,
    /qp\.get\('forgot'\)[\s\S]{0,900}?history\.replaceState\(\{\}, '', location\.pathname\)/,
    'the param must be stripped so a refresh does not re-open the modal',
  );
});

test('static: a repaired URL is shown and offered by Copy, and never written back into the pane', () => {
  // POST /api/analyze has always returned validation.urlRequest.repairs; the
  // string "repairs" appeared nowhere in public/, so the tool analysed a
  // different URL than the one on screen and never said so.
  assert.match(APP, /function urlRepairsHtml\(/, 'expected a renderer for the repair steps');
  assert.match(APP, /ur\.repairs/, 'the renderer must read validation.urlRequest.repairs');
  // Prepended to BOTH validation-render branches — a repaired URL that then
  // validates clean is exactly the case worth stating.
  assert.match(APP, /renderSeverityTabs\(valEl, findings, repairsHtml\)/);
  // Both branches must carry the repairs. The original guard counted how many
  // times repairsHtml was concatenated with a `mono-label` div — the shape the
  // two branches happened to share at the time. When the findings branch
  // dropped its breadcrumb (the mockup has none) the property held and the
  // count did not, so the guard failed on a correct change. It now counts uses
  // of the value itself, which is what "both branches show the repairs" means.
  const uses = (APP.match(/\brepairsHtml\b/g) || []).length;
  assert.ok(
    uses >= 3,
    `repairsHtml must be built once and used by both render branches — found ${uses} references`,
  );
  // Copy hands back the canonical URL; the textarea keeps the operator's text.
  assert.match(APP, /_lastUrlRepair\.repaired/, 'copy() must be able to reach the repaired URL');
  assert.match(
    APP,
    /writeText\(canonical \|\| pasted\)/,
    'copy() must prefer the repaired URL and fall back to the literal value',
  );
  assert.doesNotMatch(
    APP,
    /\$\('bidReq'\)\.value = _lastUrlRepair/,
    'the repair must never be written back into the operator’s pane',
  );
  for (const key of ['repair.title', 'repair.step.html_amp', 'toast.copied_repaired_url']) {
    for (const locale of ['en', 'uk', 'ru']) {
      assert.match(
        I18N,
        new RegExp(`'${key.replace(/\./g, '\\.')}':[\\s\\S]{0,400}?${locale}:`),
        `${key} must exist in ${locale}`,
      );
    }
  }
});

test('static: the URL slot card is driven by the server canonical, not a second client-side parse', () => {
  // The client URL gate now routes schemeless, wrapped, markdown-linked and
  // zero-width-prefixed pastes to the URL branch. `new URL()` throws on every
  // one of them, and the old fallback printed `req.slice(0, 80)` into the
  // endpoint field — the operator's raw text presented as a parsed host+path.
  // The server already parsed the REPAIRED url; one parser, not two.
  assert.match(APP, /function urlSlotCardHtml\(/, 'expected a canonical-driven URL card');
  assert.doesNotMatch(
    APP,
    /const u = new URL\(req\);/,
    'the browser must not re-parse the operator’s raw request text',
  );
  assert.doesNotMatch(
    APP,
    /endpoint = req\.slice\(/,
    'the raw-paste endpoint fallback must be gone',
  );
  // Painted twice: once with nothing known, once from validation.urlRequest.
  assert.match(APP, /return urlSlotCardHtml\(req, null\)/, 'first paint claims nothing');
  assert.match(
    APP,
    /urlSlotCardHtml\(req, validation && validation\.urlRequest\)/,
    'the repaint must come from the server canonical',
  );
  // The undecoded state must be labelled, or a verbatim paste and a decoded
  // host+path look like the same claim.
  for (const locale of ['en', 'uk', 'ru']) {
    assert.match(
      I18N,
      new RegExp(`'slot\\.url\\.not_decoded':[\\s\\S]{0,400}?${locale}:`),
      `slot.url.not_decoded must exist in ${locale}`,
    );
  }
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
  // OrtbtoolsSession.api facade omit it.
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
