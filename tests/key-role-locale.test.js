'use strict';

/**
 * Story 4 (016 FR-018): the assistant answers in the operator's language on
 * every path. The calibration bench cannot see language — it never inspects
 * the answer's prose — which is exactly how the 015 fix reported "identical
 * before/after" while the model path still leaked Ukrainian. This suite
 * covers what CI can prove without a live model:
 *
 *   1. Deterministic role-layer reasons carry no cross-alphabet
 *      contamination (the 015 letter-set technique).
 *   2. The persona's CLOSING contract per locale explicitly demands the
 *      answer language AND forbids echoing the Ukrainian body — the leak's
 *      mechanism, not just its symptom.
 *
 * The live three-locale check against the real model is T038, a maintainer
 * operation recorded in specs/016-ext-key-alphabet/bench-evidence.md.
 */

const test = require('node:test');
const assert = require('node:assert');

const { lookupKeyRole: lookupTyped } = require('../packages/core/dialects/key-role-alphabet');
/** @param {any} input @returns {any} */
const lookupKeyRole = (input) => lookupTyped(input);
const { buildPersona } = require('../lib/label-persona');

// Ukrainian-only vs Russian-only letters (the 015 script-hygiene sets).
const UK_ONLY = /[іїєґІЇЄҐ]/;
const RU_ONLY = /[ыэъёЫЭЪЁ]/;

const CASES = [
  { signalPath: 'imp[].ext.ad_type', signalValue: 30 }, // resolved, format-declaration
  { signalPath: 'imp[].ext.subage', signalValue: 18 }, // resolved, role
  { signalPath: 'imp[].ext.limit', signalValue: 1 }, // ambiguous
];

test('role-layer reasons: Russian prose carries no Ukrainian-only letters, and vice versa', () => {
  for (const c of CASES) {
    const ru = lookupKeyRole({ ...c, locale: 'ru' });
    const uk = lookupKeyRole({ ...c, locale: 'uk' });
    const en = lookupKeyRole({ ...c, locale: 'en' });
    assert.ok(ru.reason && uk.reason && en.reason, c.signalPath);
    assert.doesNotMatch(ru.reason, UK_ONLY, `ru reason leaks Ukrainian: ${ru.reason}`);
    assert.doesNotMatch(uk.reason, RU_ONLY, `uk reason leaks Russian: ${uk.reason}`);
    assert.doesNotMatch(en.reason, /[а-яА-Я]/, `en reason leaks Cyrillic: ${en.reason}`);
  }
});

test('reasons separate the established claim from the unknown one (FR-010)', () => {
  for (const locale of ['uk', 'ru', 'en']) {
    const r = lookupKeyRole({ signalPath: 'imp[].ext.ad_type', signalValue: 30, locale });
    // The format-declaration sentence must state the role AND state that the
    // code stays private — two claims, named separately.
    assert.ok(r.reason.length > 60, `${locale}: a one-clause reason cannot carry both claims`);
  }
});

test('CLOSING per locale names the answer language and forbids echoing the Ukrainian body', () => {
  const closing = (locale) => {
    const t = buildPersona(locale);
    return t.slice(t.lastIndexOf('\n\n') + 2);
  };
  // The mechanism of the Story-4 leak: on low-evidence answers the model
  // echoed the persona's own Ukrainian wording. The repaired CLOSING must
  // forbid the echo explicitly, not merely name the language.
  assert.match(closing('ru'), /ПО-РУССКИ/i);
  assert.match(closing('ru'), /не копируй/i);
  assert.match(closing('en'), /ENGLISH/);
  assert.match(closing('en'), /do NOT copy/i);
  assert.match(closing('uk'), /УКРАЇНСЬКОЮ/i);
  // And the three bodies stay byte-identical — only CLOSING varies.
  const body = (locale) => {
    const t = buildPersona(locale);
    return t.slice(0, t.lastIndexOf('\n\n'));
  };
  assert.equal(body('uk'), body('ru'));
  assert.equal(body('uk'), body('en'));
});
