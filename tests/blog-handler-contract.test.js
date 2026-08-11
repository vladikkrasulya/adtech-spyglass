'use strict';

/**
 * Public Blog handler contract.
 *
 * This deliberately exercises the exported route factory rather than private
 * helpers. Filesystem content is synthetic and temporary; ClickHouse is a
 * deterministic fetch stub, so the suite has no network or production-data
 * dependency.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { after, afterEach, test } = require('node:test');

const ORIGINAL_CONTENT_DIR = process.env.CONTENT_DIR;
const ORIGINAL_CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
const ORIGINAL_FETCH = global.fetch;
const CONTENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-blog-contract-'));

for (const lang of ['en', 'uk', 'ru']) {
  fs.mkdirSync(path.join(CONTENT_DIR, lang), { recursive: true });
}

const SUBSTANTIVE_BODY = Array.from({ length: 180 }, (_, index) => `word${index}`).join(' ');
fs.writeFileSync(
  path.join(CONTENT_DIR, 'en', 'contract-editorial.md'),
  [
    '---',
    'slug: contract-editorial',
    'title: Contract editorial',
    'category: guide',
    'summary: Synthetic contract summary',
    'date: 2026-08-11',
    'tags: [contract, editorial]',
    'indexable: true',
    '---',
    '',
    SUBSTANTIVE_BODY,
    '',
  ].join('\n'),
);

process.env.CONTENT_DIR = CONTENT_DIR;
delete process.env.CLICKHOUSE_URL;

const { createBlogModule } = require('../modules/blog/handler');
const blogModule = createBlogModule({});

function routeHandler(routePath) {
  const route = blogModule.routes.find((candidate) => candidate.path === routePath);
  assert.ok(route, `expected public Blog route ${routePath}`);
  return route.handler;
}

const listHandler = routeHandler('/api/v1/blog/list');
const postHandler = routeHandler('/api/v1/blog/post');
const rssHandler = routeHandler('/blog/rss.xml');

after(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_CONTENT_DIR === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = ORIGINAL_CONTENT_DIR;
  if (ORIGINAL_CLICKHOUSE_URL === undefined) delete process.env.CLICKHOUSE_URL;
  else process.env.CLICKHOUSE_URL = ORIGINAL_CLICKHOUSE_URL;
  fs.rmSync(CONTENT_DIR, { recursive: true, force: true });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function response() {
  const res = { status: 0, headers: {}, chunks: [] };
  res.writeHead = (status, headers = {}) => {
    res.status = status;
    Object.assign(res.headers, headers);
  };
  res.end = (chunk) => {
    if (chunk !== undefined) {
      res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    res.ended = true;
  };
  return res;
}

function bodyOf(res) {
  return Buffer.concat(res.chunks).toString('utf8');
}

function jsonOf(res) {
  return JSON.parse(bodyOf(res));
}

function requestUrl(pathname) {
  return new URL(pathname, 'https://ortbtools.com');
}

test('Blog list keeps its JSON shape, source classification, ordering inputs, and body omission', async () => {
  const fetchCalls = [];
  global.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    return new Response(
      `${JSON.stringify({
        slug: 'contract-db',
        lang: 'en',
        title: 'Contract DB',
        category: 'news',
        summary: 'Database summary',
        published_at: '2026-08-12 00:00:00',
        tags: ['contract'],
        url: 'https://example.invalid/source',
      })}\n`,
      { status: 200 },
    );
  };

  const parsed = requestUrl('/api/v1/blog/list?lang=en&limit=50');
  const res = response();
  await listHandler({ url: parsed.pathname + parsed.search, headers: {} }, res, parsed);

  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.deepEqual(jsonOf(res), {
    ok: true,
    count: 2,
    items: [
      {
        slug: 'contract-db',
        lang: 'en',
        title: 'Contract DB',
        category: 'news',
        summary: 'Database summary',
        published_at: '2026-08-12 00:00:00',
        tags: ['contract'],
        source: 'db',
        url: 'https://example.invalid/source',
      },
      {
        slug: 'contract-editorial',
        lang: 'en',
        title: 'Contract editorial',
        category: 'guide',
        summary: SUBSTANTIVE_BODY,
        published_at: '2026-08-11',
        tags: ['contract', 'editorial'],
        source: 'markdown',
      },
    ],
  });
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /^http:\/\/clickhouse:8123\/\?query=/);
  assert.equal(fetchCalls[0].options.headers['Content-Type'], 'application/json');
  assert.ok(fetchCalls[0].options.signal instanceof AbortSignal);
});

test('Blog post returns the complete editorial body with a server-owned markdown source', async () => {
  global.fetch = async () => {
    throw new Error('ClickHouse must not be queried for an existing editorial post');
  };
  const parsed = requestUrl('/api/v1/blog/post?slug=contract-editorial&lang=en');
  const res = response();
  await postHandler({ url: parsed.pathname + parsed.search, headers: {} }, res, parsed);

  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.deepEqual(jsonOf(res), {
    ok: true,
    post: {
      slug: 'contract-editorial',
      lang: 'en',
      title: 'Contract editorial',
      category: 'guide',
      summary: SUBSTANTIVE_BODY,
      published_at: '2026-08-11',
      tags: ['contract', 'editorial'],
      body: `\n${SUBSTANTIVE_BODY}\n`,
      source: 'markdown',
      url: null,
    },
  });
});

test('Blog post preserves the ClickHouse-backed db source contract', async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        slug: 'contract-db-post',
        lang: 'uk',
        title: 'DB post',
        category: 'news',
        summary: 'DB summary',
        body: 'DB body',
        published_at: '2026-08-11 12:00:00',
        tags: [],
        url: 'https://example.invalid/db-post',
      }),
      { status: 200 },
    );

  const parsed = requestUrl('/api/v1/blog/post?slug=contract-db-post&lang=uk');
  const res = response();
  await postHandler({ url: parsed.pathname + parsed.search, headers: {} }, res, parsed);

  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.deepEqual(jsonOf(res), {
    ok: true,
    post: {
      slug: 'contract-db-post',
      lang: 'uk',
      title: 'DB post',
      category: 'news',
      summary: 'DB summary',
      published_at: '2026-08-11 12:00:00',
      tags: [],
      body: 'DB body',
      source: 'db',
      url: 'https://example.invalid/db-post',
    },
  });
});

test('Blog post keeps missing-slug, confirmed not-found, and backend-error outcomes distinct', async () => {
  const missingParsed = requestUrl('/api/v1/blog/post?lang=en');
  const missing = response();
  await postHandler(
    { url: missingParsed.pathname + missingParsed.search, headers: {} },
    missing,
    missingParsed,
  );
  assert.equal(missing.status, 400);
  assert.equal(missing.headers['Content-Type'], 'application/json');
  assert.deepEqual(jsonOf(missing), {
    success: false,
    error: 'slug is required',
    code: 'missing_slug',
  });

  global.fetch = async () => new Response('', { status: 200 });
  const absentParsed = requestUrl('/api/v1/blog/post?slug=contract-absent&lang=en');
  const absent = response();
  await postHandler(
    { url: absentParsed.pathname + absentParsed.search, headers: {} },
    absent,
    absentParsed,
  );
  assert.equal(absent.status, 404);
  assert.equal(absent.headers['Content-Type'], 'application/json');
  assert.deepEqual(jsonOf(absent), {
    success: false,
    error: 'Post not found',
    code: 'post_not_found',
  });

  global.fetch = async () => {
    throw new Error('synthetic ClickHouse outage');
  };
  const failedParsed = requestUrl('/api/v1/blog/post?slug=contract-backend-error&lang=en');
  const failed = response();
  await postHandler(
    { url: failedParsed.pathname + failedParsed.search, headers: {} },
    failed,
    failedParsed,
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers['Content-Type'], 'application/json');
  assert.deepEqual(jsonOf(failed), {
    success: false,
    error: 'synthetic ClickHouse outage',
    code: 'blog_post_failed',
  });
});

test('RSS stays indexable-editorial-only and never exposes a Blog body', async () => {
  global.fetch = async () => {
    throw new Error('RSS must not read the ClickHouse firehose when it is disabled');
  };
  const res = response();
  await rssHandler({ url: '/blog/rss.xml', headers: {} }, res);
  const xml = bodyOf(res);

  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/rss+xml; charset=utf-8');
  assert.match(xml, /<rss version="2\.0">/);
  assert.match(xml, /\/blog\/en\/contract-editorial/);
  assert.equal((xml.match(/<item>/g) || []).length, 1);
  assert.match(xml, /<title>Contract editorial<\/title>/);
  assert.match(xml, /<description>Synthetic contract summary<\/description>/);
  assert.match(xml, /<pubDate>Tue, 11 Aug 2026 00:00:00 GMT<\/pubDate>/);
  assert.doesNotMatch(xml, /contract-db/);
  assert.doesNotMatch(xml, new RegExp(SUBSTANTIVE_BODY.slice(0, 80)));
});
