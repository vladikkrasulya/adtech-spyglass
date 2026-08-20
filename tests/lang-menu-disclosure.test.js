'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const LANG_SRC = fs
  .readFileSync(path.join(__dirname, '..', 'public/lang-switch.js'), 'utf8')
  .replace("import('/core/routes.js')", 'Promise.resolve(null)');

function setup() {
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><body>
      <details class="kt-lang-menu" open>
        <summary class="kt-lang-toggle">EN</summary>
        <div class="kt-lang-menu-list"><a href="/uk/account" lang="uk">Українська</a></div>
      </details>
      <button id="outside" type="button">Outside</button>
    </body></html>`,
    { runScripts: 'outside-only', url: 'https://ortbtools.test/account' },
  );
  dom.window.fetch = async () => ({ ok: true, text: async () => '' });
  dom.window.eval(LANG_SRC);
  return dom;
}

test('Escape closes the language disclosure and restores its summary focus', () => {
  const dom = setup();
  const { document, KeyboardEvent } = dom.window;
  const details = document.querySelector('.kt-lang-menu');
  const summary = details.querySelector('summary');
  details.querySelector('a').focus();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.equal(details.open, false);
  assert.equal(document.activeElement, summary);
  dom.window.close();
});

test('a click outside closes the language disclosure without stealing focus', () => {
  const dom = setup();
  const { document } = dom.window;
  const details = document.querySelector('.kt-lang-menu');
  const outside = document.getElementById('outside');

  outside.focus();
  outside.click();

  assert.equal(details.open, false);
  assert.equal(document.activeElement, outside);
  dom.window.close();
});
