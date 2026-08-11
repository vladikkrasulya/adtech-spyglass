'use strict';

/**
 * Browser intel-cache cutover guard.
 *
 * v1.6 replaced model-generated suggestions with deterministic rules while
 * retaining the existing IndexedDB store. These tests prove that legacy
 * `k_*` rows cannot bypass the rules API and that only responses carrying
 * explicit `engine: "rules"` provenance enter the new namespace.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'modules', 'intel', 'index.js'),
  'utf8',
);

function makeHarness({ cached = null, response }) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://ortbtools.test/',
    runScripts: 'outside-only',
  });
  const reads = [];
  const writes = [];
  const fetches = [];

  dom.window.OrtbtoolsIntelStorage = {
    async getLlmCache(key) {
      reads.push(key);
      return typeof cached === 'function' ? cached(key) : cached;
    },
    async putLlmCache(key, value) {
      writes.push({ key, value });
    },
  };
  dom.window.fetch = async (url, options) => {
    fetches.push({ url, options });
    const body = typeof response === 'function' ? response(url) : response;
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
    };
  };
  dom.window.eval(SOURCE);

  return { dom, intel: dom.window.OrtbtoolsIntel, reads, writes, fetches };
}

test('suggestName ignores legacy cache namespace and stores rules provenance', async (t) => {
  const h = makeHarness({
    cached: (key) =>
      key.startsWith('k_')
        ? { kind: 'name', name: 'legacy_model_answer', cachedAt: Date.now() }
        : null,
    response: {
      success: true,
      suggestion: {
        name: 'deterministic_name',
        description: 'Derived from stable field signatures.',
        engine: 'rules',
      },
    },
  });
  t.after(() => h.dom.window.close());

  const result = await h.intel.suggestName('display', ['req.ext.foo'], 'banner');

  assert.equal(h.reads.length, 1);
  assert.match(h.reads[0], /^rules-v1:k_[0-9a-f]+$/);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.fetches[0].url, '/api/intel/suggest-name');
  assert.equal(result.name, 'deterministic_name');
  assert.equal(result.engine, 'rules');
  assert.deepEqual(h.writes, [{ key: h.reads[0], value: result }]);
});

test('fieldPurpose ignores legacy cache namespace and stores rules provenance', async (t) => {
  const h = makeHarness({
    cached: (key) =>
      key.startsWith('k_')
        ? { kind: 'purpose', purpose: 'legacy_model_answer', cachedAt: Date.now() }
        : null,
    response: {
      success: true,
      purpose: { purpose: 'click_url', confidence: 'high', engine: 'rules' },
    },
  });
  t.after(() => h.dom.window.close());

  const result = await h.intel.fieldPurpose('req.imp.ext.click_url', 'url', 'display');

  assert.equal(h.reads.length, 1);
  assert.match(h.reads[0], /^rules-v1:k_[0-9a-f]+$/);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.fetches[0].url, '/api/intel/field-purpose');
  assert.equal(result.purpose, 'click_url');
  assert.equal(result.engine, 'rules');
  assert.deepEqual(h.writes, [{ key: h.reads[0], value: result }]);
});

test('rules-v1 cache hit avoids a duplicate request', async (t) => {
  const cached = {
    kind: 'name',
    name: 'cached_rules_name',
    description: 'Cached deterministic result.',
    engine: 'rules',
    cachedAt: Date.now(),
  };
  const h = makeHarness({ cached, response: null });
  t.after(() => h.dom.window.close());

  const result = await h.intel.suggestName('display', ['req.ext.foo'], 'banner');

  assert.equal(result, cached);
  assert.equal(h.fetches.length, 0);
  assert.equal(h.writes.length, 0);
});

test('cache and fresh responses without rules provenance are rejected', async (t) => {
  const h = makeHarness({
    cached: { kind: 'name', name: 'unproven_cached_answer', cachedAt: Date.now() },
    response: {
      success: true,
      suggestion: {
        name: 'old_backend_answer',
        description: 'Response from a mixed-version backend.',
        engine: 'llm',
      },
    },
  });
  t.after(() => h.dom.window.close());

  const result = await h.intel.suggestName('display', ['req.ext.foo'], 'banner');

  assert.equal(result, null);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.writes.length, 0);
});
