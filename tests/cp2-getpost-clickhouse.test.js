'use strict';

/**
 * getPost() tri-state — the ClickHouse-backed branches, exercised deterministically.
 *
 * cp2-indexing.test.js covers the CH-DISABLED + markdown + invalid-slug paths.
 * Here ClickHouse is ENABLED but the client is a fake injected into require.cache
 * BEFORE blog-service loads (blog-service destructures the CH client at module
 * load, so the seam must be in place first). A mutable `chState` lets each test
 * pick the query outcome — a returned row, zero rows, or a thrown error — with no
 * real fetch and no live ClickHouse:
 *
 *   - fresh CH row            → found (and cached)
 *   - fresh CH success 0 rows → confirmed_absent (the ONLY path to absence)
 *   - CH error, no cache      → unavailable (never a false 404)
 *   - CH error, STALE cache   → unavailable, NEVER a stale 'found'
 *
 * CONTENT_DIR points at an empty dir so every lookup misses markdown and falls
 * through to the (faked) ClickHouse path. node's test runner isolates each file
 * in its own process, so the require.cache surgery here cannot leak into the
 * other suites.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Empty content dir → markdown always misses → getPost reaches the CH branch.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cp2-getpost-ch-'));
process.env.CONTENT_DIR = TMP;
for (const l of ['en', 'uk', 'ru']) fs.mkdirSync(path.join(TMP, l), { recursive: true });

// ── fake ClickHouse client (injected before blog-service requires it) ────────
/** @type {{ enabled: boolean, query: (sql?: string, opts?: object) => Promise<object[]> }} */
const chState = {
  enabled: true,
  // Per-test query behavior. Default: a successful empty result.
  query: async () => [],
};
const fakeCh = {
  isEnabled: () => chState.enabled,
  chQuery: (sql, opts) => chState.query(sql, opts),
  // chEsc must stay faithful — getPost interpolates the slug/lang through it.
  chEsc: (v) =>
    String(v == null ? '' : v)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''"),
  chInsert: async () => {},
  chExec: async () => {},
  chHeaders: () => ({}),
  CH_URL: 'http://fake-clickhouse',
};
const chPath = require.resolve('../lib/clickhouse');
// Cast: a stub module object only needs `exports` to satisfy require(); the rest
// of NodeModule (children/parent/path/…) is irrelevant here.
require.cache[chPath] = /** @type {any} */ ({
  id: chPath,
  filename: chPath,
  loaded: true,
  exports: fakeCh,
});

const blog = require('../lib/blog-service');

function rowFor(slug, lang) {
  return {
    slug,
    lang,
    title: `Title ${slug}`,
    category: 'news',
    summary: 'summary line',
    body: 'body text',
    url: null,
    published_at: '2026-01-02 03:04:05',
  };
}

// ── fresh CH row → found ──────────────────────────────────────────────────────
test('getPost: fresh ClickHouse row → found (source db)', async () => {
  chState.enabled = true;
  chState.query = async () => [rowFor('db-fresh-row', 'en')];
  const r = await blog.getPost('db-fresh-row', 'en');
  assert.equal(r.status, 'found');
  assert.equal(r.post.source, 'db');
  assert.equal(r.post.slug, 'db-fresh-row');
  assert.equal(r.post.published_at, '2026-01-02 03:04:05');
});

// ── fresh CH success + 0 rows → confirmed_absent ─────────────────────────────
test('getPost: fresh ClickHouse query returning 0 rows → confirmed_absent', async () => {
  chState.enabled = true;
  chState.query = async () => [];
  const r = await blog.getPost('db-zero-rows', 'en');
  assert.equal(r.status, 'confirmed_absent');
});

// ── CH error, nothing cached → unavailable ───────────────────────────────────
test('getPost: ClickHouse error with no cache → unavailable (never a false 404)', async () => {
  chState.enabled = true;
  chState.query = async () => {
    throw new Error('ClickHouse 503: down');
  };
  const r = await blog.getPost('db-error-nocache', 'en');
  assert.equal(r.status, 'unavailable');
});

// ── STALE cache + CH error → unavailable, NEVER a stale found ─────────────────
test('getPost: stale cache + ClickHouse error → unavailable, never serves the stale body as found', async (t) => {
  // Control Date.now() so the cached entry can be aged past POST_TTL_MS (5 min)
  // without real waiting. Only Date is mocked — no timers in the (faked) path.
  t.mock.timers.enable({ apis: ['Date'] });

  // 1) prime: a successful fresh query caches the post → found.
  chState.enabled = true;
  chState.query = async () => [rowFor('db-stale', 'en')];
  let r = await blog.getPost('db-stale', 'en');
  assert.equal(r.status, 'found', 'precondition: post is cached');

  // 2) age the cache entry past the 5-minute TTL.
  t.mock.timers.tick(6 * 60_000);

  // 3) ClickHouse now errors. The stale entry must NOT be served as found.
  chState.query = async () => {
    throw new Error('ClickHouse timeout');
  };
  r = await blog.getPost('db-stale', 'en');
  assert.equal(r.status, 'unavailable');
  assert.notEqual(r.status, 'found');
});
