'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createBrowserEsmLoader } = require('./browser-esm-loader');

const unsafe = [
  'javascript:void(0)',
  ' JaVaScRiPt:void(0) ',
  'java\nscript:void(0)',
  'data:text/html,synthetic',
  'javascript&#58;void(0)',
  '//example.invalid/news',
  'https:\\example.invalid/news',
  'https://example.invalid\n@other.invalid/news',
  'https://user:password@example.invalid/news',
  'https://',
];
const safe = [
  'https://example.invalid/news?a=1&b=2',
  'http://example.invalid/news',
  ' HTTPS://example.invalid/news ',
  'https://example.invalid/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B0',
  'https://example.invalid/?q="quoted"',
];

test('the real Admin draft renderer preserves HTTP(S) links and makes unsafe source text inert', async () => {
  const module = await createBrowserEsmLoader({
    realmSalt: 'feature019-admin-source-links',
    transforms: {
      '/modules/admin-blog/index.js': (source) => `${source}\nexport { renderTable };`,
    },
  }).import('/modules/admin-blog/index.js');
  for (const lang of ['en', 'uk', 'ru']) {
    const drafts = [...unsafe, ...safe].map((url, index) => ({
      id: `draft-${index}`,
      title: '<b>Synthetic draft</b>',
      summary: 'Synthetic summary',
      lang,
      category: 'news',
      url,
    }));
    const dom = new JSDOM(module.renderTable(drafts, lang));
    try {
      const rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
      for (let index = 0; index < unsafe.length; index += 1) {
        assert.equal(rows[index].querySelector('a'), null, `${lang}: ${unsafe[index]}`);
        assert.equal(rows[index].querySelector('.ablog-source').textContent, unsafe[index]);
      }
      for (let index = 0; index < safe.length; index += 1) {
        const anchor = rows[index + unsafe.length].querySelector('a');
        assert.ok(anchor, `${lang}: ${safe[index]}`);
        assert.ok(['http:', 'https:'].includes(anchor.protocol));
        assert.equal(anchor.getAttribute('href'), safe[index].trim());
        assert.equal(anchor.rel, 'noopener noreferrer');
      }
      assert.equal(dom.window.document.querySelectorAll('b, script, iframe, img').length, 0);
      for (const element of dom.window.document.querySelectorAll('*')) {
        assert.ok(
          Array.from(element.attributes).every((attribute) => !/^on/i.test(attribute.name)),
        );
      }
    } finally {
      dom.window.close();
    }
  }
});

test('Admin surfaces a refused promotion instead of silently treating the HTTP error as success', async () => {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://example.invalid/admin/blog' });
  const root = dom.window.document.getElementById('root');
  const controller = new dom.window.AbortController();
  const alerts = [];
  const originals = new Map();
  dom.window.sessionStorage.setItem('ortbtools_admin_token', 'synthetic-token');
  const globals = {
    window: dom.window,
    document: dom.window.document,
    sessionStorage: dom.window.sessionStorage,
    prompt: () => 'existing-slug',
    alert: (message) => alerts.push(message),
    fetch: async (_url, init) => ({
      ok: init?.method !== 'POST',
      status: init?.method === 'POST' ? 409 : 200,
      json: async () =>
        init?.method === 'POST'
          ? { error: 'An article already uses this locale and slug', code: 'slug_exists' }
          : {
              drafts: [
                { id: 'draft', title: 'Synthetic', category: 'news', lang: 'uk', summary: 'Body' },
              ],
            },
    }),
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  try {
    const module = await createBrowserEsmLoader({ realmSalt: 'feature019-admin-refusal' }).import(
      '/modules/admin-blog/index.js',
    );
    await module.default.mount(root, { lang: 'uk', signal: controller.signal });
    root.querySelector('[data-action="promote"]').click();
    for (let attempt = 0; attempt < 20 && !alerts.length; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(alerts, ['Помилка: An article already uses this locale and slug']);
  } finally {
    controller.abort();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }
});
