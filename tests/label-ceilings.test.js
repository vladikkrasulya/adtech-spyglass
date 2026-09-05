'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { applyCeilings, GENERIC_KEYS, CEILING } = require('../lib/label-ceilings');

test('ceilings: a generic key caps at the persona 0.5 whatever the model said (005 T024)', () => {
  const r = applyCeilings({
    signalPath: 'imp[0].ext.enabled',
    signalValue: true,
    label: 'ignore',
    confidence: 0.6,
  });
  assert.equal(r.confidence, 0.5);
  assert.deepEqual(r.ceilings, ['generic-key']);
});

test('ceilings: a descriptive key is left alone below the absolute ceiling', () => {
  const r = applyCeilings({
    signalPath: 'imp[0].ext.render',
    signalValue: 'inpage_push',
    label: 'in-page-push',
    confidence: 0.85,
  });
  assert.equal(r.confidence, 0.85);
  assert.deepEqual(r.ceilings, []);
});

test('ceilings: an empty, null or blank value caps at 0.3 regardless of label', () => {
  for (const value of ['', '   ', null, undefined, []]) {
    const r = applyCeilings({
      signalPath: 'imp[0].ext.placement',
      signalValue: value,
      label: 'banner',
      confidence: 0.9,
    });
    assert.equal(r.confidence, CEILING.emptyValue, `value ${JSON.stringify(value)}`);
    assert.ok(r.ceilings.includes('empty-value'));
  }
});

test('ceilings: a numeric code caps at 0.3 only when the label claims a specific format', () => {
  const formatClaim = applyCeilings({
    signalPath: 'imp[0].ext.ad_type',
    signalValue: 3,
    label: 'banner',
    confidence: 0.8,
  });
  assert.equal(formatClaim.confidence, 0.3);
  assert.deepEqual(formatClaim.ceilings, ['numeric-code']);

  const roleClaim = applyCeilings({
    signalPath: 'imp[0].ext.ad_type',
    signalValue: '3',
    label: 'informational',
    confidence: 0.8,
  });
  assert.equal(roleClaim.confidence, 0.8);
  assert.deepEqual(roleClaim.ceilings, []);
});

test('ceilings: absolute certainty is never returned', () => {
  const r = applyCeilings({
    signalPath: 'imp[0].ext.format',
    signalValue: 'video',
    label: 'video',
    confidence: 1,
  });
  assert.equal(r.confidence, CEILING.neverAbsolute);
  assert.deepEqual(r.ceilings, ['never-absolute']);
});

test('ceilings: ceilings compose — the lowest applicable one wins and each is named', () => {
  const r = applyCeilings({
    signalPath: 'imp[0].ext.type',
    signalValue: '',
    label: 'pop',
    confidence: 1,
  });
  assert.equal(r.confidence, 0.3);
  assert.deepEqual(r.ceilings, ['empty-value']);
});

test('ceilings: a broken number becomes 0, not NaN', () => {
  const r = applyCeilings({
    signalPath: 'imp[0].ext.x',
    signalValue: 'y',
    label: 'custom',
    confidence: Number.NaN,
  });
  assert.equal(r.confidence, 0);
});

test('ceilings: the generic-key list is the persona list, verbatim', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'lib', 'label-persona.js'), 'utf8');
  const m = persona.match(/Коротка чи загальна назва ключа \(([^)]+)\)/);
  assert.ok(m, 'persona must still state the generic-key ceiling with its key list');
  const listed = m[1].split(',').map((s) => s.trim());
  assert.deepEqual(new Set(listed), GENERIC_KEYS);
});

test('ceilings: the model client enforces limits on real returned suggestions in every locale', async (t) => {
  const ollama = require('../lib/ollama');
  let modelAnswer;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ response: JSON.stringify(modelAnswer), model: 'gemma4-prod' })),
  );
  const cases = [
    { key: 'enabled', value: true, label: 'ignore', raw: 0.6, expected: 0.5 },
    { key: 'placement', value: null, label: 'banner', raw: 0.9, expected: 0.3 },
    { key: 'ad_type', value: 3, label: 'video', raw: 0.8, expected: 0.3 },
    { key: 'ad_type', value: 3, label: 'informational', raw: 0.8, expected: 0.8 },
    { key: 'render', value: 'inpage_push', label: 'in-page-push', raw: 0.85, expected: 0.85 },
    { key: 'render', value: 'video', label: 'video', raw: 1, expected: 0.95 },
  ];
  for (const locale of ['en', 'uk', 'ru']) {
    for (const c of cases) {
      modelAnswer = { label: c.label, confidence: c.raw, reason: 'Model explanation' };
      const result = await ollama.classifySignal({
        signalPath: `imp[0].ext.${c.key}`,
        signalValue: c.value,
        impSketch: { banner: { w: 320, h: 50 } },
        siblingKeys: [],
        locale,
      });
      assert.equal(result.confidence, c.expected, `${locale}/${c.key}/${c.label}`);
      assert.equal(result.label, c.label);
      assert.equal(result.reason, 'Model explanation');
      assert.equal(result.source, 'model');
    }
  }
});
