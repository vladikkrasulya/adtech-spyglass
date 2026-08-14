'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createBrowserEsmLoader } = require('./browser-esm-loader');

const ROOT = path.join(__dirname, '..');
const I18N_SOURCE = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');

async function makeHarness(locale) {
  const dom = new JSDOM('<!doctype html><html><body><span id="badge"></span></body></html>', {
    runScripts: 'outside-only',
    url: 'https://ortbtools.test/inspector',
  });
  dom.window.document.documentElement.lang = locale;
  dom.window.eval(I18N_SOURCE);
  const loader = createBrowserEsmLoader({ realmSalt: `inspector-request-badge-${locale}` });
  const subject = await loader.import('/modules/inspector/request-input.js');
  return { dom, subject };
}

test('request badge renders a valid HTTP feed input as a localized URL state', async () => {
  const expected = {
    en: 'URL request',
    uk: 'URL-запит',
    ru: 'URL-запрос',
  };

  for (const [locale, label] of Object.entries(expected)) {
    const { dom, subject } = await makeHarness(locale);
    try {
      const badge = dom.window.document.getElementById('badge');
      subject.renderInputBadge(
        'http://feed.example/search?format=json&feed=demo&auth=redacted&query=test',
        badge,
        dom.window.t,
        { allowUrl: true },
      );
      assert.equal(badge.textContent, label, locale);
      assert.equal(badge.className, 'json-badge url', locale);
    } finally {
      dom.window.close();
    }
  }
});

test('URL state is request-only and malformed URLs stay invalid', async () => {
  const { dom, subject } = await makeHarness('en');
  try {
    const badge = dom.window.document.getElementById('badge');

    subject.renderInputBadge('https://feed.example/search?x=1', badge, dom.window.t, {
      allowUrl: false,
    });
    assert.equal(badge.className, 'json-badge invalid');

    subject.renderInputBadge('http://', badge, dom.window.t, { allowUrl: true });
    assert.equal(badge.className, 'json-badge invalid');
  } finally {
    dom.window.close();
  }
});
