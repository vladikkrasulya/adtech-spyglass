'use strict';

/**
 * tests/categories.test.js — packages/core/categories.js
 *
 * Two layers:
 *   1. The decoder API (decodeCategory + decodeCategories + extractAllCategories)
 *      — locale routing, fallback chain, code shape resolution.
 *   2. 3-locale parity — en / uk / ru must share an identical key set
 *      so the decoder never silently falls through for a locale that
 *      simply forgot a code (parity test catches that at CI time).
 *
 * Backward-compat: every existing call site that omits the locale arg
 * must keep getting the English label. Two tests pin this contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  decodeCategory,
  decodeCategories,
  extractAllCategories,
} = require('../packages/core/categories');

const CORE_DIR = path.join(__dirname, '..', 'packages', 'core');
const LOCALES = ['en', 'uk', 'ru'];

function loadDict(locale) {
  return JSON.parse(fs.readFileSync(path.join(CORE_DIR, `iab-categories.${locale}.json`), 'utf8'));
}

// ── decodeCategory ──────────────────────────────────────────────────────────

test('decodeCategory: known top-level code in default (en) locale', () => {
  const label = decodeCategory('IAB1');
  assert.equal(typeof label, 'string');
  assert.ok(label.length > 0);
});

test('decodeCategory: known sub-code in default locale → "Top → Sub"', () => {
  const label = decodeCategory('IAB1-1');
  assert.ok(label, 'IAB1-1 should resolve');
  assert.ok(label.includes(' → '), `expected separator, got: ${label}`);
});

test('decodeCategory: unknown sub-code falls back to parent', () => {
  // IAB1-9999 doesn't exist; resolver returns parent IAB1's label.
  const sub = decodeCategory('IAB1-9999');
  const parent = decodeCategory('IAB1');
  assert.equal(sub, parent, 'unknown sub should fall back to parent label');
});

test('decodeCategory: unknown top-level returns null', () => {
  assert.equal(decodeCategory('NOT_A_CODE'), null);
  assert.equal(decodeCategory('IAB9999'), null);
});

test('decodeCategory: non-string / empty input returns null', () => {
  assert.equal(decodeCategory(null), null);
  assert.equal(decodeCategory(undefined), null);
  assert.equal(decodeCategory(''), null);
  assert.equal(decodeCategory(42), null);
  assert.equal(decodeCategory({}), null);
});

test('decodeCategory: explicit en locale returns the same as default', () => {
  assert.equal(decodeCategory('IAB1-1'), decodeCategory('IAB1-1', 'en'));
});

test('decodeCategory: uk + ru produce strings for known codes', () => {
  // Don't assert specific translations — they're produced by the
  // upstream translation pipeline and may evolve. Just check the
  // wiring: each locale returns a non-empty string.
  assert.equal(typeof decodeCategory('IAB1', 'uk'), 'string');
  assert.equal(typeof decodeCategory('IAB1', 'ru'), 'string');
  assert.equal(typeof decodeCategory('IAB1-1', 'uk'), 'string');
  assert.equal(typeof decodeCategory('IAB1-1', 'ru'), 'string');
});

test('decodeCategory: unsupported locale falls back to en', () => {
  // 'fr' isn't in DICTS — decoder picks en silently.
  assert.equal(decodeCategory('IAB1', 'fr'), decodeCategory('IAB1', 'en'));
});

// ── decodeCategories ────────────────────────────────────────────────────────

test('decodeCategories: preserves order, includes nulls for unknown', () => {
  const out = decodeCategories(['IAB1', 'NOT_A_CODE', 'IAB2']);
  assert.equal(out.length, 3);
  assert.equal(out[0].code, 'IAB1');
  assert.ok(out[0].label);
  assert.equal(out[1].code, 'NOT_A_CODE');
  assert.equal(out[1].label, null);
  assert.equal(out[2].code, 'IAB2');
  assert.ok(out[2].label);
});

test('decodeCategories: routes locale through', () => {
  const enOut = decodeCategories(['IAB1'], 'en');
  const ukOut = decodeCategories(['IAB1'], 'uk');
  assert.equal(typeof enOut[0].label, 'string');
  assert.equal(typeof ukOut[0].label, 'string');
});

test('decodeCategories: non-array input returns []', () => {
  assert.deepEqual(decodeCategories(null), []);
  assert.deepEqual(decodeCategories(undefined), []);
  assert.deepEqual(decodeCategories('IAB1'), []);
});

// ── extractAllCategories ────────────────────────────────────────────────────

test('extractAllCategories: walks bcat / site.cat / app.cat / bid.cat', () => {
  const payload = {
    bcat: ['IAB7-39'],
    site: { cat: ['IAB1'], sectioncat: ['IAB2'] },
    seatbid: [{ bid: [{ cat: ['IAB3'] }] }],
  };
  const out = extractAllCategories(payload);
  assert.ok(out['bcat']);
  assert.ok(out['site.cat']);
  assert.ok(out['site.sectioncat']);
  assert.ok(out['seatbid[0].bid[0].cat']);
});

test('extractAllCategories: routes locale through to every entry', () => {
  const payload = { bcat: ['IAB1'], site: { cat: ['IAB2'] } };
  const ukOut = extractAllCategories(payload, 'uk');
  assert.equal(typeof ukOut['bcat'][0].label, 'string');
  assert.equal(typeof ukOut['site.cat'][0].label, 'string');
});

test('extractAllCategories: non-object input returns {}', () => {
  assert.deepEqual(extractAllCategories(null), {});
  assert.deepEqual(extractAllCategories(undefined), {});
  assert.deepEqual(extractAllCategories('garbage'), {});
});

// ── 3-locale parity ─────────────────────────────────────────────────────────

test('parity: en, uk, ru share the same finding-code key set', () => {
  const dicts = LOCALES.map((L) => ({ L, d: loadDict(L) }));
  const keysetOf = (d) => new Set(Object.keys(d).filter((k) => !k.startsWith('_'))); // strip metadata
  const en = keysetOf(dicts[0].d);
  for (const { L, d } of dicts.slice(1)) {
    const other = keysetOf(d);
    const missingHere = [...en].filter((k) => !other.has(k));
    const extraHere = [...other].filter((k) => !en.has(k));
    assert.equal(
      missingHere.length,
      0,
      `${L} is missing ${missingHere.length} codes that en has:\n  ${missingHere.slice(0, 10).join(', ')}${missingHere.length > 10 ? ', …' : ''}`,
    );
    assert.equal(
      extraHere.length,
      0,
      `${L} has ${extraHere.length} codes not in en:\n  ${extraHere.slice(0, 10).join(', ')}${extraHere.length > 10 ? ', …' : ''}`,
    );
  }
});

test('parity: every locale carries a non-empty string for every code', () => {
  for (const L of LOCALES) {
    const d = loadDict(L);
    const bad = Object.entries(d)
      .filter(([k]) => !k.startsWith('_'))
      .filter(([, v]) => typeof v !== 'string' || v.length === 0);
    assert.equal(
      bad.length,
      0,
      `${L} has ${bad.length} non-string or empty values:\n  ${bad
        .slice(0, 5)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ')}`,
    );
  }
});
