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

// ── relevance scoring ──────────────────────────────────────────────────────
// extractScore (the LLM-reply parser) left with the Ollama path (2026-07-22):
// scoring is deterministic now — see tests/intel-rules.test.js for the full
// scoreRelevance golden corpus. Here we only pin the moderator's contract:
// the threshold constant still gates publication.

test('relevance: rules scorer clears the threshold on core AdTech', () => {
  const { scoreRelevance } = require('../lib/intel-rules');
  const { score } = scoreRelevance({
    title: 'OpenRTB 2.6 ships in Prebid',
    summary: 'Programmatic SSP adapters gain header bidding support.',
  });
  assert.ok(score >= mod.RELEVANCE_THRESHOLD, `score ${score} must clear threshold`);
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
