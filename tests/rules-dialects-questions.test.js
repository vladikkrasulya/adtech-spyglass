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

const plugin = require('../packages/core/rules/dialects-questions');

// ── helpers ──────────────────────────────────────────────────────────

const NO_MAPPINGS = { lookupMapping: () => null };
const ALWAYS_MAPPED = { lookupMapping: () => ({ semantic_label: 'pop' }) };

function ctx(userDialect) {
  return { dialect: null, version: null, userDialect: userDialect || null };
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
