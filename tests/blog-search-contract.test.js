'use strict';

/** Browser contract for Blog entries in the real global-search module. */

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
