'use strict';

/**
 * tests/news-moderator.test.js — pure-logic coverage for the AI blog
 * moderator and the shared CH/blog helpers. Network-touching paths (Ollama
 * scoring, OpenRouter translation, ClickHouse I/O) are intentionally out of
 * scope here — only deterministic helpers are asserted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const mod = require('../lib/news-moderator');
const { chEsc } = require('../lib/clickhouse');
const { slugify } = require('../lib/blog-service');

// ── parseJsonLoose ─────────────────────────────────────────────────────────

test('parseJsonLoose: plain JSON object', () => {
  assert.deepEqual(mod.parseJsonLoose('{"a":1}'), { a: 1 });
});

test('parseJsonLoose: strips ```json fences', () => {
  assert.deepEqual(mod.parseJsonLoose('```json\n{"a":2}\n```'), { a: 2 });
});

test('parseJsonLoose: ignores prose around the object', () => {
  assert.deepEqual(mod.parseJsonLoose('Sure! {"a":3} hope that helps'), { a: 3 });
});

test('parseJsonLoose: returns null on garbage', () => {
  assert.equal(mod.parseJsonLoose('not json at all'), null);
  assert.equal(mod.parseJsonLoose('{broken'), null);
  assert.equal(mod.parseJsonLoose(42), null);
});

// ── extractScore ───────────────────────────────────────────────────────────

test('extractScore: from strict JSON', () => {
  assert.equal(mod.extractScore('{"relevance_score": 9}'), 9);
});

test('extractScore: low-relevance shape', () => {
  assert.equal(mod.extractScore('{"relevance_score": 4}'), 4);
});

test('extractScore: clamps above 10', () => {
  assert.equal(mod.extractScore('{"relevance_score": 99}'), 10);
});

test('extractScore: regex fallback when not valid JSON', () => {
  assert.equal(mod.extractScore('relevance_score: 7 (it is adtech)'), 7);
});

test('extractScore: null when no number present', () => {
  assert.equal(mod.extractScore('no score here'), null);
});

// ── sanitizeCategory / sanitizeTags ─────────────────────────────────────────

test('sanitizeCategory: passes valid, defaults invalid to news', () => {
  assert.equal(mod.sanitizeCategory('analysis'), 'analysis');
  assert.equal(mod.sanitizeCategory('guide'), 'guide');
  assert.equal(mod.sanitizeCategory('clickbait'), 'news');
  assert.equal(mod.sanitizeCategory(undefined), 'news');
});

test('sanitizeTags: lowercases, trims, caps at 5', () => {
  assert.deepEqual(mod.sanitizeTags([' OpenRTB ', 'SSP', 'dsp', 'a', 'b', 'c', 'd']), [
    'openrtb',
    'ssp',
    'dsp',
    'a',
    'b',
  ]);
});

test('sanitizeTags: non-array → []', () => {
  assert.deepEqual(mod.sanitizeTags('openrtb,ssp'), []);
  assert.deepEqual(mod.sanitizeTags(null), []);
});

// ── shared helpers ───────────────────────────────────────────────────────────

test('chEsc: doubles single quotes and escapes backslash', () => {
  assert.equal(chEsc("O'Brien"), "O''Brien");
  assert.equal(chEsc('a\\b'), 'a\\\\b');
  assert.equal(chEsc(null), '');
});

test('slugify: url-friendly, trimmed, capped', () => {
  assert.equal(slugify('Hello, World! — oRTB 2.6'), 'hello-world-ortb-2-6');
  assert.equal(slugify('  leading/trailing  '), 'leading-trailing');
});

test('moderator exposes guardrail constants', () => {
  assert.equal(mod.MAX_ARTICLES_PER_DAY, 3);
  assert.equal(mod.RELEVANCE_THRESHOLD, 8);
});
