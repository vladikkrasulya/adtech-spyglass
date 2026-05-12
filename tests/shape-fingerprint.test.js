'use strict';

/**
 * tests/shape-fingerprint.test.js — packages/core/dialects/shape-fingerprint.js
 *
 * Three exports: analyzeShape, recommendedFormat, shapeFingerprint.
 * No vendor names in this file — heuristics are generic oRTB shape
 * rules, tests assert behavior at that level.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeShape,
  recommendedFormat,
  shapeFingerprint,
} = require('../packages/core/dialects/shape-fingerprint');

// ── analyzeShape ─────────────────────────────────────────────────────

test('analyzeShape — empty object yields no candidates', () => {
  assert.deepStrictEqual(analyzeShape({}), []);
});

test('analyzeShape — banner with real dims scores >= 2', () => {
  const cs = analyzeShape({ banner: { w: 300, h: 250 } });
  const b = cs.find((c) => c.format === 'banner');
  assert.ok(b, 'banner candidate present');
  assert.ok(b.score >= 2, `banner score ${b.score} should be >= 2`);
  assert.strictEqual(b.iab_ref, true);
});

test('analyzeShape — banner with banner.format gets extra weight', () => {
  const cs = analyzeShape({ banner: { w: 300, h: 250, format: [{ w: 300, h: 250 }] } });
  const b = cs.find((c) => c.format === 'banner');
  assert.ok(b.score >= 3);
});

test('analyzeShape — pop-family fingerprint reaches high confidence', () => {
  const cs = analyzeShape({
    banner: { w: 0, h: 0 },
    ext: { allowMT: true, allowLayer: true, allowShock: true, sizeID: [0] },
  });
  const pop = cs.find((c) => c.format === 'pop-family');
  assert.ok(pop, 'pop-family candidate present');
  assert.ok(pop.score >= 4, `pop-family score ${pop.score} should be >= 4`);
  assert.strictEqual(pop.iab_ref, false);
});

test('analyzeShape — video with protocols + minduration', () => {
  const cs = analyzeShape({ video: { protocols: [2, 3], minduration: 5 } });
  const v = cs.find((c) => c.format === 'video');
  assert.ok(v);
  assert.ok(v.score >= 3);
});

test('analyzeShape — native presence yields native candidate', () => {
  const cs = analyzeShape({ native: { request: '{}' } });
  assert.ok(cs.find((c) => c.format === 'native'));
});

test('analyzeShape — audio presence yields audio candidate', () => {
  const cs = analyzeShape({ audio: { mimes: ['audio/mp4'] } });
  assert.ok(cs.find((c) => c.format === 'audio'));
});

// ── recommendedFormat ────────────────────────────────────────────────

test('recommendedFormat — empty array returns null', () => {
  assert.strictEqual(recommendedFormat([]), null);
});

test('recommendedFormat — score below 2 returns null', () => {
  const r = recommendedFormat([{ format: 'banner', score: 1.5, signals_matched: [] }]);
  assert.strictEqual(r, null);
});

test('recommendedFormat — sole candidate with score >= 2 → high', () => {
  const r = recommendedFormat([{ format: 'banner', score: 3, signals_matched: [] }]);
  assert.deepStrictEqual(r, { format: 'banner', confidence: 'high' });
});

test('recommendedFormat — runner-up too close → null', () => {
  const r = recommendedFormat([
    { format: 'a', score: 3, signals_matched: [] },
    { format: 'b', score: 2.5, signals_matched: [] },
  ]);
  assert.strictEqual(r, null);
});

test('recommendedFormat — dominant by 1.5× → returns', () => {
  const r = recommendedFormat([
    { format: 'a', score: 4, signals_matched: [] },
    { format: 'b', score: 2, signals_matched: [] },
  ]);
  assert.ok(r);
  assert.strictEqual(r.format, 'a');
});

// ── shapeFingerprint ─────────────────────────────────────────────────

test('shapeFingerprint — empty object returns empty string', () => {
  assert.strictEqual(shapeFingerprint({}), '');
});

test('shapeFingerprint — deterministic for same input', () => {
  const obj = { a: 1, b: 'x', c: [1, 2, 3] };
  assert.strictEqual(shapeFingerprint(obj), shapeFingerprint(obj));
});

test('shapeFingerprint — type-sensitive (num vs str)', () => {
  assert.notStrictEqual(shapeFingerprint({ a: 1 }), shapeFingerprint({ a: '1' }));
});

test('shapeFingerprint — value-INSENSITIVE (different numbers → same fp)', () => {
  assert.strictEqual(shapeFingerprint({ a: 1 }), shapeFingerprint({ a: 99 }));
});

test('shapeFingerprint — key order stable', () => {
  assert.strictEqual(shapeFingerprint({ a: 1, b: 2 }), shapeFingerprint({ b: 2, a: 1 }));
});
