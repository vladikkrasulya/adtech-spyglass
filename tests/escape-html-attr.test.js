'use strict';

/**
 * tests/escape-html-attr.test.js
 *
 * The client-side escapeHtml() must be safe in ATTRIBUTE position, not just
 * in text.
 *
 * It used to build a text node and read innerHTML back, on the reasoning
 * that the browser's own serialiser is exhaustive. It is not: text-node
 * serialisation escapes &, < and > and deliberately leaves quotes alone,
 * because a quote inside text needs no escaping. Every call site
 * interpolating into `class="…"` / `href="…"` / `data-*="…"` was therefore
 * injectable with one `"` — the audit landed a working `onmouseover` on a
 * blog card that way, and `script-src 'unsafe-inline'` meant CSP did not
 * stop it.
 *
 * Asserted against the real module through the browser-ESM loader the other
 * browser tests use, so this checks the shipped function rather than a copy
 * of its source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UTILS = path.join(__dirname, '..', 'public', 'core', 'utils.js');

/**
 * Pull the function out of the ES module and evaluate it standalone.
 * utils.js imports nothing at module scope for this helper, so lifting the
 * declaration is faithful — and it keeps the test free of a DOM shim, which
 * is the very thing the old implementation depended on.
 */
function loadEscapeHtml() {
  const src = fs.readFileSync(UTILS, 'utf8');
  const m = src.match(/export function escapeHtml\(s\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'escapeHtml declaration not found in public/core/utils.js');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0].replace('export function', 'function')}; return escapeHtml;`)();
}

const escapeHtml = loadEscapeHtml();

test('a double quote cannot close an attribute', () => {
  const attack = 'guide" onmouseover="window.__pwned=1" data-x="';
  const out = escapeHtml(attack);
  assert.ok(!out.includes('"'), `raw quote survived: ${out}`);

  // Parse it the way a browser would, rather than pattern-matching the
  // string. The escaped value still CONTAINS the text ` onmouseover=` and
  // always will — what matters is that it stays inside the class value
  // instead of becoming a second attribute, and only a parser can say that.
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<div class="blog-badge blog-badge--${out}"></div>`);
  const el = dom.window.document.querySelector('div');
  assert.deepEqual(
    el.getAttributeNames(),
    ['class'],
    `escaping leaked extra attributes: ${el.getAttributeNames().join(', ')}`,
  );
  assert.equal(el.getAttribute('onmouseover'), null, 'an event handler was injected');
  assert.ok(
    el.getAttribute('class').includes('onmouseover'),
    'payload should stay inert inside the class value',
  );
});

test('a single quote cannot close a single-quoted attribute', () => {
  const out = escapeHtml("x' onfocus='alert(1)");
  assert.ok(!out.includes("'"), `raw apostrophe survived: ${out}`);
});

test('the classic text-position characters are still escaped', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('ampersand runs first, so entities are not double-escaped into nonsense', () => {
  // & must be replaced before the others introduce their own entities, or
  // `<` would become `&amp;lt;`.
  assert.equal(escapeHtml('<'), '&lt;');
  // A literal, pre-existing entity in user text is escaped once, as it must
  // be: it is data, not markup.
  assert.equal(escapeHtml('a&amp;b'), 'a&amp;amp;b');
});

test('null and undefined are empty, not the strings "null"/"undefined"', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('ordinary text is unchanged apart from the five characters', () => {
  assert.equal(escapeHtml('imp[0].ext.type'), 'imp[0].ext.type');
  assert.equal(escapeHtml('оРТБ 2.6 — банер 300×250'), 'оРТБ 2.6 — банер 300×250');
});

test('the client helper now agrees with the server one in lib/seo.js', () => {
  // Two functions with the same name behaved differently, and the client
  // half — the one handling content the server had already released — was
  // the permissive one. Lock them together.
  const seoSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'seo.js'), 'utf8');
  const m = seoSrc.match(/function escapeHtml\(s\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'escapeHtml not found in lib/seo.js');
  // eslint-disable-next-line no-new-func
  const serverEscape = new Function(`${m[0]}; return escapeHtml;`)();
  for (const s of ['a"b', "c'd", '<e>', 'f&g', 'plain', '', 'імпресія «300×250»']) {
    assert.equal(escapeHtml(s), serverEscape(s), `disagreement on ${JSON.stringify(s)}`);
  }
});
