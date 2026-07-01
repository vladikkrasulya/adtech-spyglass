'use strict';

/**
 * tests/rules-dialects-questions.test.js
 *
 * Tests the question-emission plugin in
 *   packages/core/rules/dialects-questions/index.js
 *
 * Assertions:
 *   1. Empty payloads → zero findings.
 *   2. IAB-allowlisted ext.* keys → silently skipped.
 *   3. Unknown imp.ext.* / req.ext.* keys → one question finding each.
 *   4. userDialect.lookupMapping returning non-null → finding suppressed.
 *   5. Hard cap of 20 findings per validate() call.
 *   6. Finding params shape matches the contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../packages/core');
const plugin = require('../packages/core/rules/dialects-questions');
const { validRequest } = require('./fixtures');

// ── helpers ──────────────────────────────────────────────────────────

const NO_MAPPINGS = { lookupMapping: () => null };
const ALWAYS_MAPPED = { lookupMapping: () => ({ semantic_label: 'pop' }) };

function ctx(userDialect) {
  return { dialect: null, version: null, userDialect: userDialect || null };
}

function popFamilyImpRequest() {
  const req = validRequest();
  req.imp[0].ext = {
    allowMT: true,
    allowLayer: true,
    allowShock: true,
    sizeID: [0],
    mystery: 'foo',
  };
  return req;
}

function reqExtUnknownRequest() {
  const req = validRequest();
  req.ext = { mystery_req: 'value' };
  return req;
}

function assertNoInterpolationArtifacts(msg, locale) {
  assert.ok(!msg.includes('{path}'), `${locale}: literal {path}`);
  assert.ok(!msg.includes('{recommended}'), `${locale}: literal {recommended}`);
  assert.ok(!msg.includes('[object Object]'), `${locale}: object stringified`);
}

function dialectQuestionFinding(result, path) {
  return result.findings.find(
    (f) => f.id === 'dialects.question.unknown_ext_signal' && (!path || f.path === path),
  );
}

// ── shape ────────────────────────────────────────────────────────────

test('plugin exports the expected shape', () => {
  assert.strictEqual(plugin.id, 'dialects-questions');
  assert.ok(Array.isArray(plugin.appliesTo));
  assert.ok(plugin.appliesTo.includes('ORTB_REQUEST'));
  assert.strictEqual(typeof plugin.validate, 'function');
});

// ── emission ─────────────────────────────────────────────────────────

test('empty imp array → no findings', () => {
  assert.deepStrictEqual(plugin.validate({ imp: [] }, ctx(NO_MAPPINGS)), []);
});

test('payload with only IAB-allowlisted ext keys → no findings', () => {
  const req = {
    imp: [{ ext: { skadn: {}, gpid: 'abc' } }],
    ext: { schain: {}, eids: [] },
  };
  assert.deepStrictEqual(plugin.validate(req, ctx(NO_MAPPINGS)), []);
});

test('two unknown imp.ext keys → two question findings', () => {
  const req = { imp: [{ ext: { mystery1: 'a', mystery2: 42 } }] };
  const findings = plugin.validate(req, ctx(NO_MAPPINGS));
  assert.strictEqual(findings.length, 2);
  for (const f of findings) {
    assert.strictEqual(f.level, 'question');
    assert.strictEqual(f.id, 'dialects.question.unknown_ext_signal');
  }
});

test('unknown req.ext keys also emit questions', () => {
  const req = { imp: [], ext: { mystery_req: 'value' } };
  const findings = plugin.validate(req, ctx(NO_MAPPINGS));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].level, 'question');
  assert.strictEqual(findings[0].path, 'ext.mystery_req');
});

// ── suppression ─────────────────────────────────────────────────────

test('userDialect mapping suppresses the finding', () => {
  const req = { imp: [{ ext: { custom_signal: 'x' } }] };
  assert.deepStrictEqual(plugin.validate(req, ctx(ALWAYS_MAPPED)), []);
});

// ── cap ─────────────────────────────────────────────────────────────

test('cap at 20 findings even with 30 unknown ext keys', () => {
  const ext = {};
  for (let i = 0; i < 30; i += 1) ext[`unknown_${i}`] = i;
  const findings = plugin.validate({ imp: [{ ext }], ext: {} }, ctx(NO_MAPPINGS));
  assert.strictEqual(findings.length, 20);
});

// ── finding params contract ─────────────────────────────────────────

test('finding params include value, candidates, recommended, shape_signature', () => {
  const req = {
    imp: [
      {
        ext: {
          allowMT: true,
          allowLayer: true,
          allowShock: true,
          sizeID: [0],
          mystery: 'foo',
        },
      },
    ],
  };
  const findings = plugin.validate(req, ctx(NO_MAPPINGS));
  assert.ok(findings.length > 0);
  const f = findings[0];
  assert.ok('path' in f.params);
  assert.strictEqual(f.params.path, f.path);
  assert.ok('value' in f.params);
  assert.ok('candidates' in f.params);
  assert.ok(Array.isArray(f.params.candidates));
  assert.ok('recommended' in f.params);
  assert.ok('shape_signature' in f.params);
  assert.strictEqual(typeof f.params.shape_signature, 'string');
});

test('pop-family payload → recommended populated with high confidence', () => {
  const req = {
    imp: [
      {
        ext: {
          allowMT: true,
          allowLayer: true,
          allowShock: true,
          sizeID: [0],
          mystery: 'foo',
        },
      },
    ],
  };
  const findings = plugin.validate(req, ctx(NO_MAPPINGS));
  const mystery = findings.find((f) => f.path === 'imp[0].ext.mystery');
  assert.ok(mystery);
  assert.ok(mystery.params.recommended);
  assert.strictEqual(mystery.params.recommended.format, 'pop-family');
});

// ── end-to-end message resolution ───────────────────────────────────

test('unknown imp.ext with high-confidence recommendation resolves messages (en/uk/ru)', () => {
  const req = popFamilyImpRequest();
  const expectedPath = 'imp[0].ext.mystery';

  for (const locale of ['en', 'uk', 'ru']) {
    const result = core.validate(req, { locale, userDialect: NO_MAPPINGS });
    const f = dialectQuestionFinding(result, expectedPath);
    assert.ok(f, locale);
    assert.strictEqual(f.path, expectedPath, locale);
    assert.strictEqual(f.params.path, f.path, locale);
    assert.ok(f.params.recommended);
    assert.strictEqual(f.params.recommended.format, 'pop-family', locale);
    assert.ok(f.msg.includes(expectedPath), `${locale}: path in msg`);
    assert.ok(f.msg.includes('foo'), `${locale}: value in msg`);
    assertNoInterpolationArtifacts(f.msg, locale);
  }
});

test('unknown req.ext with recommended:null resolves messages (en/uk/ru)', () => {
  const req = reqExtUnknownRequest();
  const expectedPath = 'ext.mystery_req';

  for (const locale of ['en', 'uk', 'ru']) {
    const result = core.validate(req, { locale, userDialect: NO_MAPPINGS });
    const f = dialectQuestionFinding(result, expectedPath);
    assert.ok(f, locale);
    assert.strictEqual(f.path, expectedPath, locale);
    assert.strictEqual(f.params.path, f.path, locale);
    assert.strictEqual(f.params.recommended, null, locale);
    assert.ok(f.msg.includes(expectedPath), `${locale}: path in msg`);
    assert.ok(f.msg.includes('value'), `${locale}: value in msg`);
    assertNoInterpolationArtifacts(f.msg, locale);
  }
});

test('locale null/undefined falls back without raw placeholders', () => {
  const req = { imp: [{ ext: { mystery: 'foo' } }] };

  for (const locale of [null, undefined]) {
    const result = core.validate(req, { locale, userDialect: NO_MAPPINGS });
    const f = dialectQuestionFinding(result, 'imp[0].ext.mystery');
    assert.ok(f, String(locale));
    assert.ok(f.msg.includes('imp[0].ext.mystery'), `${locale}: path in msg`);
    assert.ok(f.msg.includes('foo'), `${locale}: value in msg`);
    assertNoInterpolationArtifacts(f.msg, String(locale));
  }
});

test('object/array vendor ext values serialize cleanly in messages (en/uk/ru)', () => {
  const cases = [
    { value: { foo: 'bar', n: 1 }, expected: '{"foo":"bar","n":1}' },
    { value: [1, 2], expected: '[1,2]' },
  ];

  for (const { value, expected } of cases) {
    for (const locale of ['en', 'uk', 'ru']) {
      const req = { imp: [{ ext: { mystery: value } }] };
      const result = core.validate(req, { locale, userDialect: NO_MAPPINGS });
      const f = dialectQuestionFinding(result, 'imp[0].ext.mystery');
      assert.ok(f, locale);
      assert.strictEqual(f.params.value, expected, locale);
      assert.ok(f.msg.includes(expected), `${locale}: serialized value in msg`);
      assertNoInterpolationArtifacts(f.msg, locale);
    }
  }
});
