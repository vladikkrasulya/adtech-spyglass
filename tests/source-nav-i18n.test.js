'use strict';

/**
 * Locale parity for the source-nav i18n module: every key MUST exist (non-empty)
 * in uk/en/ru, and every {placeholder} set MUST match across the three locales
 * (so a localized announcement never silently drops a variable). The file is a
 * browser IIFE that pushes its spec to window.kt_i18n_modules — we run it with a
 * minimal window stub and inspect the pushed spec.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'public/modules/inspector/source-nav.i18n.js'),
  'utf8',
);

function loadSpec() {
  const win = { kt_i18n_modules: [] };
  // eslint-disable-next-line no-new-func
  new Function('window', SRC)(win);
  assert.equal(win.kt_i18n_modules.length, 1, 'exactly one i18n spec pushed');
  return win.kt_i18n_modules[0];
}

const vars = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');

test('source-nav i18n: every key present in uk/en/ru', () => {
  const spec = loadSpec();
  assert.equal(spec.id, 'inspector-nav');
  const keys = Object.keys(spec.keys);
  assert.ok(keys.length >= 12, `expected ≥12 keys, got ${keys.length}`);
  for (const k of keys) {
    for (const loc of ['uk', 'en', 'ru']) {
      const v = spec.keys[k][loc];
      assert.ok(typeof v === 'string' && v.length > 0, `${k} missing/empty for ${loc}`);
    }
  }
});

test('source-nav i18n: {placeholder} sets match across uk/en/ru', () => {
  const spec = loadSpec();
  for (const k of Object.keys(spec.keys)) {
    const en = vars(spec.keys[k].en);
    assert.equal(vars(spec.keys[k].uk), en, `${k}: uk placeholders differ from en`);
    assert.equal(vars(spec.keys[k].ru), en, `${k}: ru placeholders differ from en`);
  }
});

test('source-nav i18n: registers via both queue push and registerI18nModule', () => {
  let registered = /** @type {any} */ (null);
  const win = { kt_i18n_modules: [], registerI18nModule: (s) => (registered = s) };
  // eslint-disable-next-line no-new-func
  new Function('window', SRC)(win);
  assert.ok(
    registered && registered.id === 'inspector-nav',
    'late-load path calls registerI18nModule',
  );
  assert.equal(win.kt_i18n_modules.length, 1, 'also pushed to the boot-drain queue');
});
