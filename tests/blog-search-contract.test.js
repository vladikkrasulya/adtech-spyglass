'use strict';

/**
 * Browser contract for the real global-search module.
 *
 * Covers Blog entries (original scope) plus two regressions:
 *   F-06 — finding results linked to `#<id>` while /docs/findings renders
 *          `<tr id="finding-<id>">`, so the anchor matched nothing and the
 *          browser never scrolled (target measured at top:10477px).
 *   F-07 — the dropdown claimed role=listbox but the input had no combobox
 *          wiring and the rows were tabindex="-1", making the whole widget
 *          keyboard-dead.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const SEARCH_MODULE = path.join(__dirname, '../public/modules/search/index.js');

async function waitFor(predicate, label) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function snapshotGlobal(name) {
  return {
    name,
    owned: Object.hasOwn(global, name),
    value: Reflect.get(global, name),
  };
}

function restoreGlobal(snapshot) {
  if (snapshot.owned) Reflect.set(global, snapshot.name, snapshot.value);
  else Reflect.deleteProperty(global, snapshot.name);
}

test('global search indexes an escaped Blog result and navigates through the SPA shell', async () => {
  const dom = new JSDOM(
    '<!doctype html><html lang="uk"><head></head><body><div class="kt-topbar__search"><input id="search"></div></body></html>',
    { url: 'https://ortbtools.com/uk/blog' },
  );
  const { window } = dom;
  const navigations = [];
  const fetchCalls = [];
  const previousGlobals = [
    'window',
    'document',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'fetch',
  ].map(snapshotGlobal);

  global.window = window;
  global.document = window.document;
  global.Event = window.Event;
  global.KeyboardEvent = window.KeyboardEvent;
  global.MouseEvent = window.MouseEvent;
  window.OrtbtoolsShell = { navigateTo: (url) => navigations.push(url) };
  global.fetch = async (url) => {
    const href = String(url);
    fetchCalls.push(href);
    const payload = href.startsWith('/api/v1/blog/list')
      ? {
          ok: true,
          items: [
            {
              slug: 'safe-blog-result',
              lang: 'en',
              title: 'Boundary <strong>Guide</strong>',
              category: 'guide',
              summary: 'A searchable Blog summary',
            },
          ],
        }
      : { ok: true, items: [], scenarios: [], findings: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  let cleanup = () => {};
  try {
    const source = fs.readFileSync(SEARCH_MODULE, 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#blog-search-contract`;
    const { initSearch } = await import(moduleUrl);
    const input = window.document.querySelector('#search');
    cleanup = initSearch(input, window.document.body);

    input.dispatchEvent(new window.Event('focus'));
    await waitFor(() => fetchCalls.length === 4, 'the four search-index requests');
    assert.deepEqual(fetchCalls, [
      '/api/v1/sample/list',
      '/api/v1/behavior/scenarios',
      '/api/v1/finding-catalog?lang=uk',
      '/api/v1/blog/list?lang=uk&limit=50',
    ]);

    input.value = 'boundary';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await waitFor(
      () => window.document.querySelector('.sg-search-row') !== null,
      'the debounced Blog result',
    );

    const row = window.document.querySelector('.sg-search-row');
    assert.ok(row, 'Blog result is rendered');
    assert.equal(row.dataset.searchUrl, '/uk/blog/en/safe-blog-result');
    assert.equal(
      row.querySelector('.sg-search-row__title').textContent,
      'Boundary <strong>Guide</strong>',
    );
    assert.equal(
      row.querySelector('.sg-search-row__title strong'),
      null,
      'title markup remains text',
    );
    assert.equal(row.querySelector('.sg-badge').textContent, 'guid');

    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(navigations, ['/uk/blog/en/safe-blog-result']);
    assert.equal(fetchCalls.length, 4, 'search uses its loaded in-memory index during navigation');
  } finally {
    cleanup();
    for (const snapshot of previousGlobals) restoreGlobal(snapshot);
    window.close();
  }
});

// ── Shared harness for the F-06 / F-07 regressions ──────────────────────────
// Same global-swapping shape as the Blog test above; factored out only for the
// two tests added afterwards so that one keeps its original inline form.
async function withSearch({ lang, url, findings, instance }, body) {
  const dom = new JSDOM(
    `<!doctype html><html lang="${lang}"><head></head><body><div class="kt-topbar__search"><input id="search"></div><div id="page"></div></body></html>`,
    { url },
  );
  const { window } = dom;
  const navigations = [];
  const scrolled = [];
  const previousGlobals = [
    'window',
    'document',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'fetch',
  ].map(snapshotGlobal);

  global.window = window;
  global.document = window.document;
  global.Event = window.Event;
  global.KeyboardEvent = window.KeyboardEvent;
  global.MouseEvent = window.MouseEvent;
  // jsdom ships no scrollIntoView; the module calls it both for the virtual
  // listbox cursor and for the F-06 anchor landing.
  window.Element.prototype.scrollIntoView = function () {
    scrolled.push(this.id || this.className);
  };
  window.OrtbtoolsShell = { navigateTo: (u) => navigations.push(u) };
  global.fetch = async (u) => {
    const href = String(u);
    const payload = href.startsWith('/api/v1/finding-catalog')
      ? { ok: true, items: findings }
      : { ok: true, items: [], scenarios: [], findings: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  let cleanup = () => {};
  try {
    const source = fs.readFileSync(SEARCH_MODULE, 'utf8');
    // Fresh module instance per test — the search index is a module-level cache.
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${instance}`;
    const { initSearch } = await import(moduleUrl);
    const input = window.document.querySelector('#search');
    cleanup = initSearch(input, window.document.body);
    await body({ window, input, navigations, scrolled });
  } finally {
    cleanup();
    for (const snapshot of previousGlobals) restoreGlobal(snapshot);
    window.close();
  }
}

const FINDING = {
  id: 'vast.version_missing',
  severity: 'error',
  message: 'VAST version attribute is missing',
};

test('F-06: a finding result links to the row id /docs/findings actually renders, and lands on it', async () => {
  await withSearch(
    {
      lang: 'en',
      url: 'https://ortbtools.com/',
      findings: [FINDING],
      instance: 'f06-finding-anchor',
    },
    async ({ window, input, navigations, scrolled }) => {
      input.dispatchEvent(new window.Event('focus'));
      input.value = 'vast';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await waitFor(
        () => window.document.querySelector('.sg-search-row') !== null,
        'the finding result row',
      );

      const row = window.document.querySelector('.sg-search-row');
      // Pre-fix this was '/docs/findings#vast.version_missing' — docs renders
      // <tr id="finding-vast.version_missing">, so nothing ever matched.
      assert.equal(row.dataset.searchUrl, '/docs/findings#finding-vast.version_missing');

      // Ids with dots are legal in HTML but hostile to CSS selectors — the
      // reason the module resolves the anchor with getElementById.
      const targetId = row.dataset.searchUrl.split('#')[1];
      window.document.getElementById('page').innerHTML =
        `<table><tbody><tr id="${targetId}"><td>x</td></tr></tbody></table>`;
      assert.ok(window.document.getElementById(targetId), 'getElementById resolves the dotted id');
      assert.equal(
        window.document.querySelector('#' + targetId),
        null,
        "querySelector('#a.b') parses the dot as a class — must never be used for these ids",
      );

      row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.deepEqual(navigations, ['/docs/findings#finding-vast.version_missing']);

      // pushState does not scroll to a fragment and docs renders its table
      // asynchronously, so the module has to find the row itself.
      await waitFor(() => scrolled.includes(targetId), 'the anchor scroll');
      assert.equal(
        window.document.activeElement.id,
        targetId,
        'keyboard focus lands on the finding row, not just the viewport',
      );
    },
  );
});

test('F-07: the results dropdown is a complete, localized combobox reachable from the keyboard', async () => {
  await withSearch(
    {
      lang: 'uk',
      url: 'https://ortbtools.com/uk/',
      findings: [FINDING, { id: 'vast.linear_missing', severity: 'warning', message: 'no linear' }],
      instance: 'f07-combobox',
    },
    async ({ window, input, navigations }) => {
      const doc = window.document;
      // Pre-fix measurement of the input: every one of these was null.
      assert.equal(input.getAttribute('role'), 'combobox');
      assert.equal(input.getAttribute('aria-autocomplete'), 'list');
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      const listboxId = input.getAttribute('aria-controls');
      const listbox = doc.getElementById(listboxId);
      assert.ok(listbox, 'aria-controls resolves to a real element');
      assert.equal(listbox.getAttribute('role'), 'listbox');
      // Pre-fix this was the hardcoded English 'Search results' on /uk and /ru.
      assert.equal(listbox.getAttribute('aria-label'), 'Результати пошуку');

      input.focus();
      input.dispatchEvent(new window.Event('focus'));
      input.value = 'vast';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await waitFor(() => doc.querySelectorAll('.sg-search-row').length === 2, 'both findings');

      assert.equal(input.getAttribute('aria-expanded'), 'true');
      const rows = Array.from(doc.querySelectorAll('.sg-search-row'));
      assert.deepEqual(
        rows.map((r) => r.getAttribute('role')),
        ['option', 'option'],
      );
      assert.equal(new Set(rows.map((r) => r.id)).size, 2, 'option ids are unique');
      assert.ok(
        rows.every((r) => r.getAttribute('tabindex') === '-1'),
        'options stay out of the tab order — the input holds focus',
      );
      assert.equal(
        doc.querySelector('.sg-search-group').getAttribute('role'),
        'group',
        'group wrappers are valid listbox children, not stray divs',
      );

      const key = (k) =>
        input.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
        );

      key('ArrowDown');
      assert.equal(input.getAttribute('aria-activedescendant'), rows[0].id);
      assert.equal(rows[0].getAttribute('aria-selected'), 'true');
      key('ArrowDown');
      assert.equal(input.getAttribute('aria-activedescendant'), rows[1].id);
      assert.equal(rows[0].getAttribute('aria-selected'), 'false');
      key('ArrowUp');
      assert.equal(input.getAttribute('aria-activedescendant'), rows[0].id);

      key('Enter');
      assert.deepEqual(navigations, ['/uk/docs/findings#finding-vast.version_missing']);
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      assert.equal(input.getAttribute('aria-activedescendant'), null);

      // Escape must dismiss the popup and KEEP focus in the combobox — pre-fix
      // it called inputEl.blur(), dumping the keyboard user onto <body>.
      input.focus();
      input.value = 'vast'; // navigate() clears the box, so re-type to reopen
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await waitFor(() => doc.querySelectorAll('.sg-search-row').length > 0, 'reopened list');
      key('Escape');
      assert.equal(listbox.hidden, true);
      assert.equal(input.getAttribute('aria-expanded'), 'false');
      assert.equal(doc.activeElement, input, 'focus stays in the combobox after Escape');
    },
  );
});
