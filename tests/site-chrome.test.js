'use strict';

/**
 * tests/site-chrome.test.js — jsdom harness for the global chrome:
 * sidebar account row, topbar breadcrumbs + compact brand, global search
 * index, keyboard shortcuts.
 *
 * Every case below was first reproduced in real headless Chrome against the
 * working tree (stand on :3942, a live ot_session cookie); the numbers in the
 * comments are from that run. jsdom is used here for what it models
 * faithfully — wiring, attributes, event order, module state — not for
 * layout.
 *
 *   1. ACCOUNT ROW. mountNav() painted the rail from `s.getUser()`, a method
 *      window.OrtbtoolsSession has never had (the facade exposes `user` as a
 *      GETTER), so the `typeof === 'function'` guard was false on every load
 *      and the row was painted with a hardcoded null. The other update path,
 *      auth:changed, never fires on boot either — session.ensureBooted()
 *      assigns its user directly instead of going through setUser(). Result:
 *      "Sign in" in the rail while the same page showed the signed-in user's
 *      private samples and a "verify your email" banner only a signed-in user
 *      can see.
 *
 *   2. ⌘1. The Inspector item printed a shortcut badge for a chord nothing
 *      binds and no page can bind (Ctrl/⌘+1 is a reserved browser
 *      tab-switch). Measured: Cmd+1, Ctrl+1 and bare 1 on /library all left
 *      the route untouched.
 *
 *   3. BREADCRUMBS. Two kt:lang-change listeners in mountTopbar, registered
 *      in the wrong order: paintCrumbs (line ~380) ran before onLang (~423),
 *      so it painted the outgoing DOM and onLang then replaced #ktCrumbs with
 *      a fresh, `hidden` node. Measured on 6 of 7 sections: crumb text ""
 *      after any language switch, restored only by the next route change.
 *
 *   4. COMPACT BRAND. .kt-topbar__brand-mini (visible below 1024px) had a
 *      hardcoded href="/inspector", so tapping the logo on /uk/* dropped the
 *      locale: URL said EN, page still rendered UK.
 *
 *   5. SEARCH INDEX. The module-level cache is locale-specific (two of the
 *      four sources are fetched with ?lang=) but nothing invalidated it on a
 *      language switch, so the panel came back with localised group headers
 *      over previous-locale result titles.
 *
 *   6. SHORTCUTS. Ctrl+S and M called window.openSaveModal /
 *      window.openMirrorModal "if defined" — and only a mouse click on the
 *      matching toolbar button ever defines them. M additionally
 *      preventDefault()ed before checking, swallowing the key for a no-op,
 *      and the "?" sheet advertised all five bindings even on sections that
 *      have no editor for three of them.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const NAV_SRC = read('public/modules/nav/index.js');
const TOPBAR_SRC = read('public/modules/topbar/index.js');
const SEARCH_SRC = read('public/modules/search/index.js');
const SHORTCUTS_SRC = read('public/modules/shortcuts/index.js');

const SHELL_HTML = `<!DOCTYPE html><html lang="en"><body>
  <div class="kt-shell">
    <aside id="kt-nav-root" class="kt-nav"></aside>
    <header id="kt-topbar-root"></header>
    <main id="app-root"></main>
    <div id="modalRoot"></div>
  </div>
</body></html>`;

function makeDom({ lang = 'en', url = 'https://ortbtools.test/inspector' } = {}) {
  const dom = new JSDOM(SHELL_HTML.replace('lang="en"', `lang="${lang}"`), {
    runScripts: 'outside-only',
    url,
  });
  return dom.window;
}

/** Mirror lang-switch.js's SPA branch: flip the document lang, then fire. */
function switchLang(w, next) {
  w.document.documentElement.setAttribute('lang', next);
  w.dispatchEvent(new w.CustomEvent('kt:lang-change', { detail: { lang: next } }));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ── nav ──────────────────────────────────────────────────────────────────

/** nav/index.js has no static imports, so it runs as a plain script once the
 *  `export` keywords are dropped — same approach as tests/shell-nav-chrome. */
function mountNav(w) {
  w.eval(NAV_SRC.replace(/^export /gmu, '') + '\nwindow.__nav = { mountNav, SECTIONS };');
  const root = w.document.getElementById('kt-nav-root');
  return { root, unmount: w.__nav.mountNav(root) };
}

const accountLabel = (w) => w.document.getElementById('ktNavAccount').textContent;
const accountState = (w) => w.document.getElementById('ktNavAccountRow').dataset.state;

test('rail: a session already resolved at mount paints the account, not "Sign in"', () => {
  const w = makeDom();
  // The facade as it really is: `user` is a getter, and there is no getUser().
  w.OrtbtoolsSession = {
    get user() {
      return { id: 1, email: 'chrome@example.com' };
    },
  };
  const { unmount } = mountNav(w);

  assert.equal(accountLabel(w), 'chrome');
  assert.equal(accountState(w), 'in');
  assert.equal(
    w.document.querySelector('#ktNavAccountRow .kt-nav__avatar').textContent,
    'C',
    'avatar carries the initial',
  );
  assert.equal(
    w.document.getElementById('ktNavAccountRow').getAttribute('title'),
    'chrome@example.com',
  );
  unmount();
});

test('rail: a getUser() method, if a future facade grows one, is still honoured', () => {
  const w = makeDom();
  w.OrtbtoolsSession = { getUser: () => ({ email: 'legacy@example.com' }) };
  const { unmount } = mountNav(w);
  assert.equal(accountLabel(w), 'legacy');
  assert.equal(accountState(w), 'in');
  unmount();
});

test('rail: no session → "Sign in" (localised), and a later auth:changed paints it', () => {
  const w = makeDom({ lang: 'uk', url: 'https://ortbtools.test/uk/inspector' });
  const { unmount } = mountNav(w);

  assert.equal(accountLabel(w), 'Увійти');
  assert.equal(accountState(w), 'out');

  w.dispatchEvent(
    new w.CustomEvent('auth:changed', { detail: { user: { email: 'later@example.com' } } }),
  );
  assert.equal(accountLabel(w), 'later');
  assert.equal(accountState(w), 'in');

  // …and a sign-out puts it back.
  w.dispatchEvent(new w.CustomEvent('auth:changed', { detail: { user: null } }));
  assert.equal(accountLabel(w), 'Увійти');
  assert.equal(accountState(w), 'out');
  unmount();
});

test('rail: the account survives a language switch and the row stays locale-prefixed', () => {
  const w = makeDom();
  w.OrtbtoolsSession = {
    get user() {
      return { email: 'chrome@example.com' };
    },
  };
  const { w: _unused, unmount } = { w, ...mountNav(w) };

  switchLang(w, 'uk');
  assert.equal(accountLabel(w), 'chrome', 'the re-render repaints from the remembered user');
  assert.equal(accountState(w), 'in');
  assert.equal(w.document.getElementById('ktNavAccountRow').getAttribute('href'), '/uk/account');
  unmount();
});

test('rail: the Inspector item no longer advertises a ⌘1 that nothing binds', () => {
  const w = makeDom();
  const { root, unmount } = mountNav(w);

  const inspector = root.querySelector('.kt-nav__item[data-route="/inspector"]');
  assert.equal(inspector.querySelector('.kt-nav__badge'), null, 'no badge on Inspector');
  assert.equal(inspector.getAttribute('title'), 'Inspector');
  assert.equal(inspector.getAttribute('aria-label'), 'Inspector');

  // The one badge that carries a real disclosure must NOT have been collateral.
  assert.ok(
    root.querySelector('.kt-nav__item[data-route="/live"] .kt-nav__badge--status'),
    'Streams keeps its preview status dot',
  );
  assert.match(
    root.querySelector('.kt-nav__item[data-route="/live"]').getAttribute('title'),
    /preview/,
  );

  // Nothing in the shipped client binds a digit key — the badge promised one.
  const clientJs = ['public/ortbtools.app.js', 'public/modules/shortcuts/index.js']
    .map(read)
    .join('\n');
  assert.equal(
    /e\.key\s*===\s*['"][0-9]['"]/.test(clientJs),
    false,
    'if a digit shortcut is ever bound, revisit the badge instead of leaving this stale',
  );
  unmount();
});

// ── topbar ───────────────────────────────────────────────────────────────

/** topbar/index.js statically imports the session service; the harness swaps
 *  that one line for a stub so the file can be evaluated as a plain script.
 *  Everything else — including listener registration ORDER, which is what
 *  case 3 is about — is the shipped code. */
function mountTopbar(w, { user = null } = {}) {
  const src = TOPBAR_SRC.replace(
    /^import .*$/gmu,
    `const session = { ensureBooted: async () => ({ user: ${JSON.stringify(user)} }) };`,
  ).replace(/^export /gmu, '');
  w.eval(src + '\nwindow.__topbar = { mountTopbar };');
  const root = w.document.getElementById('kt-topbar-root');
  const shell = w.document.querySelector('.kt-shell');
  return { root, unmount: w.__topbar.mountTopbar(root, shell) };
}

const crumbSection = (w) => w.document.getElementById('ktCrumbSection').textContent;
const crumbsHidden = (w) => w.document.getElementById('ktCrumbs').hidden;

test('topbar: the breadcrumb survives a language switch and is re-localised', () => {
  const w = makeDom();
  const { unmount } = mountTopbar(w);

  assert.equal(crumbSection(w), 'Inspector');
  assert.equal(crumbsHidden(w), false);

  switchLang(w, 'uk');
  assert.equal(crumbsHidden(w), false, 'the crumb box must not come back hidden');
  assert.equal(crumbSection(w), 'Інспектор');

  switchLang(w, 'ru');
  assert.equal(crumbSection(w), 'Инспектор');
  unmount();
});

test('topbar: a payload detail set by a section also survives the switch', () => {
  const w = makeDom();
  const { unmount } = mountTopbar(w);

  w.ktSetCrumbDetail('req-42');
  assert.equal(w.document.getElementById('ktCrumbId').textContent, 'req-42');

  switchLang(w, 'uk');
  assert.equal(crumbSection(w), 'Інспектор');
  assert.equal(w.document.getElementById('ktCrumbId').textContent, 'req-42');
  assert.equal(w.document.getElementById('ktCrumbId').hidden, false);
  unmount();
});

test('topbar: exactly one kt:lang-change listener owns the crumbs — order cannot regress', () => {
  // The defect was a SECOND listener registered earlier than the re-render.
  // Registering paintCrumbs separately again would reintroduce it.
  assert.equal(
    /addEventListener\(\s*'kt:lang-change'\s*,\s*paintCrumbs/.test(TOPBAR_SRC),
    false,
    'paintCrumbs must be called from onLang, never bound as its own lang listener',
  );
});

test('topbar: the compact brand keeps the locale prefix', () => {
  const w = makeDom({ lang: 'uk', url: 'https://ortbtools.test/uk/library' });
  const { root, unmount } = mountTopbar(w);

  assert.equal(root.querySelector('.kt-topbar__brand-mini').getAttribute('href'), '/uk/inspector');

  switchLang(w, 'en');
  assert.equal(
    root.querySelector('.kt-topbar__brand-mini').getAttribute('href'),
    '/inspector',
    'EN carries no prefix',
  );
  unmount();
});

// ── search ───────────────────────────────────────────────────────────────

/** Loads the search module into jsdom with a scripted fetch, and exposes the
 *  internals the cache cases need. */
function loadSearch(w) {
  const calls = [];
  w.fetch = (url) => {
    calls.push(url);
    const lang = /lang=(\w+)/.exec(url) ? /lang=(\w+)/.exec(url)[1] : 'en';
    /** @type {any} */
    let body = [];
    if (url.startsWith('/api/v1/sample/list'))
      body = [{ slug: 'gdpr-none', label: 'gdpr no consent' }];
    else if (url.startsWith('/api/v1/behavior/scenarios')) body = { scenarios: [] };
    else if (url.startsWith('/api/v1/finding-catalog'))
      body = [
        {
          id: 'regs.gdpr_consent_missing',
          severity: 'error',
          message: lang === 'uk' ? 'GDPR: відсутній Consent' : 'GDPR Consent Missing',
        },
      ];
    else if (url.startsWith('/api/v1/blog/list')) body = { posts: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  w.eval(
    SEARCH_SRC.replace(/^export /gmu, '') +
      '\nwindow.__search = { loadIndex, resetSearchIndex, buildUrl, search, LANDING_PAGES };',
  );
  return { calls, api: w.__search };
}

test('search: the cached index is rebuilt when the document locale changes', async () => {
  const w = makeDom();
  const { calls, api } = loadSearch(w);

  const en = await api.loadIndex();
  const enFinding = en.find((i) => i.type === 'finding');
  assert.equal(enFinding.message, 'GDPR Consent Missing');
  const firstRound = calls.length;
  assert.ok(firstRound >= 4, 'all sources fetched once');

  // Same locale → cache, no traffic.
  await api.loadIndex();
  assert.equal(calls.length, firstRound, 'a second call in the same locale refetches nothing');

  // Locale switch → refetch, and the RESULTS change, not only the headers.
  w.document.documentElement.setAttribute('lang', 'uk');
  const uk = await api.loadIndex();
  assert.ok(calls.length > firstRound, 'the switch invalidated the cache');
  assert.equal(uk.find((i) => i.type === 'finding').message, 'GDPR: відсутній Consent');
  assert.ok(
    calls.some((u) => u.includes('finding-catalog') && u.includes('lang=uk')),
    'the refetch asks the API for the new locale',
  );
});

test('search: the reference guides are in the index, localised and locale-prefixed', async () => {
  const w = makeDom({ lang: 'uk', url: 'https://ortbtools.test/uk/inspector' });
  const { api } = loadSearch(w);
  const items = await api.loadIndex();

  const vast = items.find((i) => i.type === 'landing' && i.route === '/vast');
  assert.ok(vast, 'the VAST guide is indexed');
  assert.equal(vast.title, 'Валідатор VAST');
  assert.equal(api.buildUrl(vast), '/uk/vast');

  // …and it is findable by the words an operator types.
  const groups = api.search('vast');
  const landingGroup = groups.find((g) => g.type === 'landing');
  assert.ok(landingGroup && landingGroup.items.length, 'a "vast" query surfaces the guide');
  assert.ok(
    api.search('schain').some((g) => g.type === 'landing'),
    'keyword line is searchable',
  );
});

test('search: the indexed guide list matches lib/landings.js exactly', async () => {
  const w = makeDom();
  const { api } = loadSearch(w);
  const { landingPaths } = require('../lib/landings');

  assert.deepEqual(
    // Array.from, not .map: the module's array lives in the jsdom realm and
    // deepStrictEqual compares prototypes across realms.
    Array.from(api.LANDING_PAGES, (p) => p.route).sort(),
    landingPaths().sort(),
    'a guide added to lib/landings.js must also be added to the search index',
  );
  for (const p of api.LANDING_PAGES) {
    for (const l of ['en', 'uk', 'ru']) {
      assert.ok(p.title[l] && p.summary[l], `${p.route} has ${l} copy`);
    }
  }
});

// ── shortcuts ────────────────────────────────────────────────────────────

/** The module is a classic-script IIFE that binds one document keydown
 *  listener; evaluating the source is the whole setup. */
function loadShortcuts(w, { withEditor = false } = {}) {
  if (withEditor) {
    const ta = w.document.createElement('textarea');
    ta.id = 'bidReq';
    w.document.getElementById('app-root').appendChild(ta);
  }
  w.t = (k) => k;
  w.eval(SHORTCUTS_SRC);
}

function press(w, key, opts = {}) {
  const ev = new w.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: !!opts.ctrlKey,
  });
  (opts.target || w.document.body).dispatchEvent(ev);
  return ev;
}

test('shortcuts: M and Ctrl+S fire on a cold page, without a prior mouse click', async () => {
  const w = makeDom();
  loadShortcuts(w, { withEditor: true });

  // The real page reaches these through a dynamic import of the mirror /
  // save-sample modules (verified in Chrome: a fresh /inspector, press m →
  // the mirror modal opens and window.openMirrorModal appears). jsdom has no
  // module loader, so the already-loaded branch is what is asserted here.
  let mirrored = 0;
  let saved = 0;
  w.openMirrorModal = () => mirrored++;
  w.openSaveModal = () => saved++;

  const m = press(w, 'm');
  assert.equal(mirrored, 1);
  assert.equal(m.defaultPrevented, true, 'the key is consumed when it does something');

  const s = press(w, 's', { ctrlKey: true });
  assert.equal(saved, 1);
  assert.equal(s.defaultPrevented, true, '"save page" is replaced, not merely suppressed');
  await tick();
});

test('shortcuts: without an editor the keys are left to the browser', () => {
  const w = makeDom({ url: 'https://ortbtools.test/library' });
  loadShortcuts(w, { withEditor: false });
  let called = 0;
  w.openMirrorModal = () => called++;
  w.openSaveModal = () => called++;

  const m = press(w, 'm');
  assert.equal(m.defaultPrevented, false, 'M must not be swallowed where it cannot act');
  const s = press(w, 's', { ctrlKey: true });
  assert.equal(s.defaultPrevented, false, 'Ctrl+S falls back to the browser');
  assert.equal(called, 0);
});

test('shortcuts: typing "m" in a field is never hijacked', () => {
  const w = makeDom();
  loadShortcuts(w, { withEditor: true });
  let called = 0;
  w.openMirrorModal = () => called++;
  const ta = w.document.getElementById('bidReq');
  const ev = press(w, 'm', { target: ta });
  assert.equal(called, 0);
  assert.equal(ev.defaultPrevented, false);
});

test('shortcuts: the "?" sheet lists only bindings that can fire here', () => {
  const rows = (w) =>
    Array.from(w.document.querySelectorAll('.shortcuts-table tr td:first-child')).map((td) =>
      td.textContent.trim(),
    );

  const onInspector = makeDom();
  loadShortcuts(onInspector, { withEditor: true });
  onInspector.openShortcutsModal();
  assert.deepEqual(rows(onInspector), ['?', 'Ctrl + Enter', 'Ctrl + S', 'M', 'Esc']);

  const onLibrary = makeDom({ url: 'https://ortbtools.test/library' });
  loadShortcuts(onLibrary, { withEditor: false });
  onLibrary.openShortcutsModal();
  assert.deepEqual(
    rows(onLibrary),
    ['?', 'Esc'],
    'a section with no editor must not advertise Run / Save / Mirror',
  );
});
