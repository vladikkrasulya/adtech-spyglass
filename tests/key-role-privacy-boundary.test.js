'use strict';

/**
 * The model prompt payload is FROZEN (016 FR-033, R-08): exactly the
 * ADR-012 §6 allowlist — signal path, signal value, the redacted impression
 * sketch, sibling extension key names — and nothing else. The role layer's
 * verdicts, provenance and the impression-shape assessment are surfaced
 * locally and never travel. docs/PRIVACY.md is deliberately unchanged by
 * feature 016, and this suite is what makes that a property instead of an
 * intention.
 *
 * Method: intercept fetch, drive the real classifySignal() prompt assembly
 * in lib/ollama.js, and assert the assembled request body field by field.
 */

const test = require('node:test');
const assert = require('node:assert');

const ollama = require('../lib/ollama');

/** Capture the body classifySignal() posts, without a live model. */
async function captureBody(input) {
  const original = global.fetch;
  /** @type {any} */
  let captured = null;
  global.fetch = /** @type {any} */ (
    async (/** @type {any} */ url, /** @type {any} */ opts) => {
      captured = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          response: JSON.stringify({ label: 'identifier', confidence: 0.7, reason: 'r' }),
          model: 'gemma4-prod',
        }),
      };
    }
  );
  try {
    await ollama.classifySignal(input);
  } finally {
    global.fetch = original;
  }
  return captured;
}

test('the prompt carries exactly the allowlist: path, value, sketch, sibling names', async () => {
  const body = await captureBody({
    signalPath: 'imp[0].ext.publisher_account_ref',
    signalValue: 42,
    impSketch: { banner: { w: 300, h: 250 }, secure: 1 },
    siblingKeys: ['ad_type', 'limit'],
    locale: 'en',
  });

  assert.ok(body, 'a request was assembled');
  // Top-level request fields are the fixed Ollama contract only.
  assert.deepEqual(
    Object.keys(body).sort(),
    ['format', 'model', 'options', 'prompt', 'stream', 'system', 'think'],
    'no new top-level field may appear in the model request',
  );

  const lines = body.prompt.split('\n');
  assert.equal(lines.length, 4, 'exactly four prompt lines: path, value, siblings, structure');
  assert.match(lines[0], /publisher_account_ref/);
  assert.match(lines[1], /42/);
  assert.match(lines[2], /ad_type, limit/);
  assert.match(lines[3], /banner/);

  // The role layer's vocabulary must NOT leak into the prompt: no role
  // verdicts, no provenance, no shape recommendation, no confidence talk.
  for (const forbidden of [
    'format-declaration',
    'roleConfidence',
    'valueStatus',
    'evidence',
    'corpus',
    'adjudication',
    'recommended',
    'candidates',
  ]) {
    assert.ok(
      !body.prompt.includes(forbidden),
      `prompt must not carry "${forbidden}" — the allowlist did not expand`,
    );
  }
});

test('a request-level signal sends the no-impression sentence, not a sketch', async () => {
  const body = await captureBody({
    signalPath: 'ext.publisher_account_ref',
    signalValue: 'acct-42',
    impSketch: null,
    siblingKeys: [],
    locale: 'en',
  });
  assert.equal(body.prompt.split('\n').length, 3, 'path, value, no-impression line');
  assert.doesNotMatch(body.prompt, /Impression structure/i);
});

test('the model answer identifier @ 0.70 for a numeric value passes through unclamped (FR-008)', async () => {
  const original = global.fetch;
  global.fetch = /** @type {any} */ (
    async () => ({
      ok: true,
      json: async () => ({
        response: JSON.stringify({ label: 'identifier', confidence: 0.7, reason: 'role only' }),
        model: 'gemma4-prod',
      }),
    })
  );
  try {
    const out = await ollama.classifySignal({
      signalPath: 'imp[0].ext.publisher_account_ref',
      signalValue: 42,
      impSketch: null,
      siblingKeys: [],
      locale: 'en',
    });
    assert.equal(out.label, 'identifier');
    assert.equal(out.confidence, 0.7, 'no numeric clamp anywhere in the chain');
  } finally {
    global.fetch = original;
  }
});
