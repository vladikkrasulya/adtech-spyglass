'use strict';

/**
 * Regression: GET /api/v1/blog/list interpolated `lang` and `category` into a
 * ClickHouse query after only stripping single quotes. ClickHouse also honours
 * a backslash escape, so `lang=\` consumed the template's closing quote and the
 * next parameter became raw SQL (unauthenticated SQL injection, 2026-10-29).
 *
 * ClickHouse is a deterministic fetch stub: the assertions read the SQL that
 * would have been sent, so the suite needs no network and no production data.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { after, afterEach, test } = require('node:test');

const ORIGINAL_CONTENT_DIR = process.env.CONTENT_DIR;
const ORIGINAL_FETCH = global.fetch;
const CONTENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-blog-sqli-'));
for (const lang of ['en', 'uk', 'ru']) fs.mkdirSync(path.join(CONTENT_DIR, lang));
process.env.CONTENT_DIR = CONTENT_DIR;

const { createBlogModule } = require('../modules/blog/handler');
const listRoute = createBlogModule({}).routes.find((r) => r.path === '/api/v1/blog/list');
const postRoute = createBlogModule({}).routes.find((r) => r.path === '/api/v1/blog/post');

after(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_CONTENT_DIR === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = ORIGINAL_CONTENT_DIR;
  fs.rmSync(CONTENT_DIR, { recursive: true, force: true });
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function response() {
  const res = { status: 0, chunks: [] };
  res.writeHead = (status) => {
    res.status = status;
  };
  res.end = (chunk) => {
    if (chunk !== undefined) res.chunks.push(Buffer.from(String(chunk)));
  };
  return res;
}

/** Run the handler with a stubbed ClickHouse and return the SQL texts it was sent. */
async function sqlSentFor(route, query) {
  const sent = [];
  global.fetch = async (url) => {
    sent.push(new URL(String(url)).searchParams.get('query'));
    return new Response('', { status: 200 });
  };
  const parsed = new URL(
    `/api/v1/blog/${route === listRoute ? 'list' : 'post'}?${query}`,
    'https://ortbtools.com',
  );
  const res = response();
  await route.handler({ url: parsed.pathname + parsed.search, headers: {} }, res, parsed);
  return { sent, res };
}

// Each payload either contains a backslash (the escape that broke out of the
// literal), a quote, or SQL text that is not a category slug at all.
const HOSTILE = [
  ['lang', '\\'],
  ['lang', "\\' OR 1=1 -- "],
  ['lang', "en' OR '1'='1"],
  ['lang', 'en\\'],
  ['category', '\\'],
  ['category', "x' OR 1=1 -- "],
  ['category', ' UNION ALL SELECT name FROM system.users -- '],
  ['category', 'news\\'],
  ['category', 'news OR 1=1'],
  ['category', 'a'.repeat(65)],
];

for (const [param, value] of HOSTILE) {
  test(`blog list refuses ${param}=${JSON.stringify(value).slice(0, 40)} before it reaches SQL`, async () => {
    const q = new URLSearchParams({ [param]: value });
    if (param === 'category') q.set('lang', 'en');
    const { sent, res } = await sqlSentFor(listRoute, q.toString());
    assert.equal(res.status, 200, 'the handler still answers (editorial-only result)');
    assert.deepEqual(sent, [], 'no ClickHouse query may be built from an invalid filter');
  });
}

test('blog list still queries ClickHouse for a valid lang + category, with both values quoted', async () => {
  const { sent, res } = await sqlSentFor(listRoute, 'lang=en&category=news-and_more');
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /AND lang = 'en' AND category = 'news-and_more'\s+ORDER BY/);
});

test('blog list without filters is unchanged', async () => {
  const { sent } = await sqlSentFor(listRoute, 'limit=5');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /WHERE 1=1\s+ORDER BY published_at DESC/);
});

test('blog post only ever sends slug/lang built from the safe alphabet', async () => {
  const { sent } = await sqlSentFor(
    postRoute,
    new URLSearchParams({ slug: "a'b\\c", lang: "e'n\\" }).toString(),
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0], /WHERE slug = 'abc' AND lang = 'en'/);
});

test('blog list cache stays bounded under a stream of unique query strings', async () => {
  global.fetch = async () => new Response('', { status: 200 });
  const heapBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1500; i++) {
    const parsed = new URL(
      `/api/v1/blog/list?limit=${(i % 100) + 1}&offset=${i}`,
      'https://ortbtools.com',
    );
    await listRoute.handler(
      { url: parsed.pathname + parsed.search, headers: {} },
      response(),
      parsed,
    );
  }
  // The cache is module-private; the bound is asserted through behaviour: the
  // earliest key was evicted, so asking for it again must hit ClickHouse again.
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return new Response('', { status: 200 });
  };
  const first = new URL('/api/v1/blog/list?limit=1&offset=0', 'https://ortbtools.com');
  await listRoute.handler({ url: first.pathname + first.search, headers: {} }, response(), first);
  assert.equal(calls, 1, 'the oldest entry must have been evicted');
  assert.ok(process.memoryUsage().heapUsed - heapBefore < 200 * 1024 * 1024);
});
