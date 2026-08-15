'use strict';

/**
 * tests/plural-forms.test.js — counted nouns must be inflected, not
 * concatenated.
 *
 * Ukrainian and Russian have three plural forms: 1, 2-4, and 5+. Every
 * counted noun in the Inspector used to interpolate a single stored plural,
 * so any figure of five or more produced broken grammar in two of the three
 * product locales — "5 критичні помилки" where the language wants
 * "5 критичних помилок". The defect was old and invisible while the counts
 * lived inside a small pill; putting them into the verdict's sentence made
 * it obvious immediately.
 *
 * The rule itself is the part worth pinning. It is not intuitive (11 takes
 * the 5+ form, 21 takes the singular, 111 takes 5+ again), so a future edit
 * that "simplifies" it to n === 1 would look reasonable and be wrong in two
 * languages nobody reviewing the diff may read.
 *
 * The function is extracted from the module source rather than imported:
 * public/ortbtools.app.js is a browser IIFE with no export surface, and the
 * same extract-and-eval approach is used by tests/source-nav.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');

/** Pull `function pluralKey(...) { ... }` out of the app source and bind it
 *  to a fixed locale, so the rule can be exercised without a DOM. */
function loadPluralKey(locale) {
  const start = APP_SRC.indexOf('function pluralKey(');
  assert.notEqual(start, -1, 'pluralKey() must exist in public/ortbtools.app.js');
  // Balance braces from the function's opening brace to its close.
  let depth = 0;
  let end = -1;
  for (let i = APP_SRC.indexOf('{', start); i < APP_SRC.length; i++) {
    if (APP_SRC[i] === '{') depth++;
    else if (APP_SRC[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.notEqual(end, -1, 'pluralKey() body must be brace-balanced');
  const body = APP_SRC.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(
    '__locale',
    `function activeLocale(){return __locale;}\n${body}\nreturn pluralKey;`,
  )(locale);
}

const ONE = 'one';
const FEW = 'few';
const MANY = 'many';

test('Slavic locales select all three plural forms by the standard rule', () => {
  for (const locale of ['uk', 'ru']) {
    const pick = (n) => loadPluralKey(locale)(n, ONE, FEW, MANY);

    // Singular: n ends in 1, except the teens.
    for (const n of [1, 21, 31, 101, 1001]) {
      assert.equal(pick(n), ONE, `${locale}: ${n} takes the singular`);
    }
    // Few: n ends in 2-4, except the teens.
    for (const n of [2, 3, 4, 22, 33, 104]) {
      assert.equal(pick(n), FEW, `${locale}: ${n} takes the 2-4 form`);
    }
    // Many: 5-9, 0, and the whole teens block — 11 through 14 included,
    // which is the case a naive `n % 10` rule gets wrong.
    for (const n of [0, 5, 9, 10, 11, 12, 13, 14, 25, 100, 111, 112]) {
      assert.equal(pick(n), MANY, `${locale}: ${n} takes the 5+ form`);
    }
  }
});

test('English collapses to singular/plural and never reaches the 5+ key', () => {
  const pick = (n) => loadPluralKey('en')(n, ONE, FEW, MANY);
  assert.equal(pick(1), ONE);
  for (const n of [0, 2, 5, 11, 21, 101]) {
    assert.equal(pick(n), FEW, `en: ${n} takes the plural`);
    assert.notEqual(pick(n), MANY, 'en must never need a third form');
  }
});

test('every counted noun has all three forms in every locale', () => {
  // A helper that picks a key nothing defines renders a bracketed id to the
  // user. Each locale block is checked independently: a key added to English
  // and forgotten in Russian is exactly how a locale goes silently missing.
  const TRIPLES = [
    ['status.error_one', 'status.errors', 'status.errors_many'],
    ['status.warning_one', 'status.warnings', 'status.warnings_many'],
    ['verdict.question_one', 'verdict.questions', 'verdict.questions_many'],
  ];

  // i18n.js holds one object literal per locale; split on the locale headers
  // so a key present in only one block cannot satisfy the others.
  const blocks = {};
  for (const loc of ['uk', 'en', 'ru']) {
    const m = new RegExp(`\\b${loc}\\s*:\\s*\\{`).exec(I18N_SRC);
    assert.ok(m, `i18n.js must contain a ${loc} catalog`);
    blocks[loc] = m.index;
  }
  const bounds = Object.entries(blocks).sort((a, b) => a[1] - b[1]);
  const slices = {};
  bounds.forEach(([loc, at], i) => {
    const next = i + 1 < bounds.length ? bounds[i + 1][1] : I18N_SRC.length;
    slices[loc] = I18N_SRC.slice(at, next);
  });

  for (const [loc, text] of Object.entries(slices)) {
    for (const triple of TRIPLES) {
      for (const key of triple) {
        assert.ok(
          text.includes(`'${key}'`),
          `${loc}: missing ${key} — a counted noun without its ${key.endsWith('_many') ? '5+' : ''} form ` +
            `renders a bracketed id or the wrong inflection`,
        );
      }
    }
  }
});

test('the verdict headline exists in every locale', () => {
  // The verdict is the one line a non-engineer reads. A locale that lost it
  // would fall back to Ukrainian silently, which is worse than an empty box:
  // it looks intentional.
  for (const key of ['verdict.blocked', 'verdict.risky', 'verdict.clean', 'verdict.invalid']) {
    const hits = I18N_SRC.split(`'${key}'`).length - 1;
    assert.equal(hits, 3, `${key} must be defined in all three locales, found ${hits}`);
  }
});
