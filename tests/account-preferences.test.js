'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ACCOUNT_SOURCE = read('public/account.js');

function preferenceSource() {
  const start = ACCOUNT_SOURCE.indexOf('  function setupPreferences() {');
  const end = ACCOUNT_SOURCE.indexOf('\n\n  // POST /api/auth/verify-email/request', start);
  assert.ok(start >= 0 && end > start, 'setupPreferences source must remain extractable');
  return ACCOUNT_SOURCE.slice(start, end);
}

test('all Account locales expose valid, labelled native preference buttons', () => {
  for (const locale of ['en', 'uk', 'ru']) {
    const html = read(`public/account.${locale}.html`);
    assert.match(html, /\.cab-radio\s*\{[^}]*border-radius:\s*var\(--control-radius\)/isu);
    assert.match(
      html,
      /\.cab-radio:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/isu,
    );
    const dom = new JSDOM(html);
    const { document } = dom.window;
    const expected = { prefTheme: 3, prefLocale: 3, prefDialect: 2 };

    for (const [id, count] of Object.entries(expected)) {
      const group = document.getElementById(id);
      assert.ok(group, `${locale}: ${id} exists`);
      assert.equal(group.getAttribute('role'), 'group', `${locale}: ${id} is a labelled group`);
      const labelId = group.getAttribute('aria-labelledby');
      assert.ok(labelId && document.getElementById(labelId), `${locale}: ${id} label resolves`);
      assert.equal(group.parentElement.tagName, 'DIV', `${locale}: no div nested inside span`);

      const buttons = [...group.querySelectorAll('.cab-radio')];
      assert.equal(buttons.length, count, `${locale}: ${id} option count`);
      for (const button of buttons) {
        assert.equal(button.tagName, 'BUTTON', `${locale}: preference option is native`);
        assert.equal(button.type, 'button', `${locale}: option cannot submit a surrounding form`);
        assert.equal(
          button.getAttribute('aria-pressed'),
          'false',
          `${locale}: initial state is explicit`,
        );
      }
    }
    dom.window.close();
  }
});

test('setRadio synchronizes persisted state, active styling, and aria-pressed', () => {
  const dom = new JSDOM(read('public/account.en.html'), {
    runScripts: 'outside-only',
    url: 'https://ortbtools.test/account',
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false });
  window.fetch = async () => ({ ok: true });
  window.localStorage.setItem('kt-theme', 'dark');
  window.localStorage.setItem('kt-lang', 'en');
  window.localStorage.setItem('ortbtools_dialect_v1', 'ext-rtb');
  window.eval(
    `const $ = (id) => document.getElementById(id);\n${preferenceSource()}\nwindow.__setupPreferences = setupPreferences;`,
  );
  window.__setupPreferences();

  const selected = (group) => [
    ...window.document.querySelectorAll(`#${group} .cab-radio[aria-pressed="true"]`),
  ];
  assert.equal(selected('prefTheme')[0].dataset.theme, 'dark');
  assert.equal(selected('prefLocale')[0].dataset.locale, 'en');
  assert.equal(selected('prefDialect')[0].dataset.dialect, 'ext-rtb');
  assert.ok(selected('prefTheme')[0].classList.contains('active'));

  const light = window.document.querySelector('#prefTheme [data-theme="light"]');
  light.click();
  assert.equal(window.localStorage.getItem('kt-theme'), 'light');
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(selected('prefTheme').length, 1);
  assert.equal(selected('prefTheme')[0], light);
  assert.equal(
    window.document.querySelector('#prefTheme [data-theme="dark"]').getAttribute('aria-pressed'),
    'false',
  );

  const iab = window.document.querySelector('#prefDialect [data-dialect="iab"]');
  iab.click();
  assert.equal(window.localStorage.getItem('ortbtools_dialect_v1'), 'iab');
  assert.equal(selected('prefDialect')[0], iab);
  dom.window.close();
});
