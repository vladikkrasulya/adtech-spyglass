'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const { assertInertBlogBody } = require('./blog-dom-assertions');
const { createBlogMountHarness } = require('./browser-esm-loader');

function mockResponse() {
  return {
    chunks: [],
    headers: {},
    status: 0,
    end(chunk) {
      if (chunk != null) this.chunks.push(Buffer.from(String(chunk)));
      this.ended = true;
    },
    json() {
      return JSON.parse(Buffer.concat(this.chunks).toString('utf8'));
    },
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers || {});
    },
  };
}

function jsonRequest(url, token, payload) {
  const req =
    /** @type {Readable & { method: string, url: string, headers: Record<string, string> }} */ (
      Readable.from([JSON.stringify(payload)])
    );
  req.method = 'POST';
  req.url = url;
  req.headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return req;
}

test('encoded RSS → authorized promotion → public handler → actual Blog mount stays inert', async (t) => {
  const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-feature003-promotion-'));
  const oldContentDir = process.env.CONTENT_DIR;
  const oldAdminToken = process.env.ADMIN_STATS_TOKEN;
  const oldClickhouseUrl = process.env.CLICKHOUSE_URL;
  const syntheticToken = 'feature003-local-admin-token';
  process.env.CONTENT_DIR = contentDir;
  process.env.ADMIN_STATS_TOKEN = syntheticToken;
  delete process.env.CLICKHOUSE_URL;

  const modulePaths = [
    '../lib/blog-service',
    '../lib/news-crawler',
    '../modules/admin/blog',
    '../modules/blog/handler',
  ].map((request) => require.resolve(request));
  for (const modulePath of modulePaths) delete require.cache[modulePath];

  const clickhouse = require('../lib/clickhouse');
  const originalClickhouse = {
    chExec: clickhouse.chExec,
    chInsert: clickhouse.chInsert,
    chQuery: clickhouse.chQuery,
    isEnabled: clickhouse.isEnabled,
  };
  const mutations = [];

  const xml = `<?xml version="1.0"?>
    <rss><channel><item>
      <title>Feature 003 promoted draft</title>
      <link>https://feed.invalid/feature003</link>
      <description>&lt;script&gt;feature003 promoted marker&lt;/script&gt;</description>
      <pubDate>Tue, 11 Aug 2026 00:00:00 GMT</pubDate>
    </item></channel></rss>`;

  try {
    const { parseRss } = require('../lib/news-crawler');
    const [normalized] = parseRss(xml);
    assert.equal(normalized.summary, '<script>feature003 promoted marker</script>');

    const draft = {
      category: 'news',
      created_at: '2026-08-11T00:00:00',
      id: 'feature003-draft-001',
      lang: 'en',
      source_event_id: 0,
      summary: normalized.summary,
      title: normalized.title,
      url: normalized.link,
    };
    clickhouse.chQuery = async () => [draft];
    clickhouse.chExec = async (sql) => {
      mutations.push(sql);
    };
    clickhouse.chInsert = async () => {};
    clickhouse.isEnabled = () => false;

    for (const modulePath of modulePaths.slice(0, 1).concat(modulePaths.slice(2))) {
      delete require.cache[modulePath];
    }
    const { createAdminBlogModule } = require('../modules/admin/blog');
    const admin = createAdminBlogModule();
    const promote = admin.routes.find(
      (route) => route.method === 'POST' && route.path === '/api/admin/blog/approve',
    ).handler;
    const promoteRes = mockResponse();
    await promote(
      jsonRequest('/api/admin/blog/approve', syntheticToken, {
        action: 'promote',
        id: draft.id,
        slug: 'feature003-promoted-post',
      }),
      promoteRes,
    );
    assert.equal(promoteRes.status, 200);
    assert.equal(promoteRes.json().action, 'promoted');
    assert.equal(mutations.length, 1);

    const promotedPath = path.join(contentDir, 'en', 'feature003-promoted-post.md');
    assert.equal(fs.existsSync(promotedPath), true);
    assert.match(fs.readFileSync(promotedPath, 'utf8'), /feature003 promoted marker/u);

    delete require.cache[require.resolve('../modules/blog/handler')];
    const { createBlogModule } = require('../modules/blog/handler');
    const publicPost = createBlogModule({}).routes.find(
      (route) => route.method === 'GET' && route.path === '/api/v1/blog/post',
    ).handler;
    const publicRes = mockResponse();
    const publicUrl = new URL(
      'https://ortbtools.test/api/v1/blog/post?slug=feature003-promoted-post&lang=en',
    );
    await publicPost(
      { headers: {}, method: 'GET', url: publicUrl.pathname + publicUrl.search },
      publicRes,
      publicUrl,
    );
    assert.equal(publicRes.status, 200);
    const publicPayload = publicRes.json();
    assert.equal(publicPayload.ok, true);
    assert.equal(publicPayload.post.source, 'markdown');
    assert.match(publicPayload.post.body, /feature003 promoted marker/u);

    const harness = await createBlogMountHarness({
      post: publicPayload.post,
      realmSalt: 'promotion-chain-001',
      url: 'https://ortbtools.test/blog/en/feature003-promoted-post',
    });
    t.after(async () => harness.close());
    await harness.mount();
    await harness.settle();
    assertInertBlogBody(harness.body(), {
      expectedText: 'feature003 promoted marker',
      resourceAttempts: harness.resourceObserver.attempts,
    });
  } finally {
    Object.assign(clickhouse, originalClickhouse);
    for (const modulePath of modulePaths) delete require.cache[modulePath];
    if (oldContentDir === undefined) delete process.env.CONTENT_DIR;
    else process.env.CONTENT_DIR = oldContentDir;
    if (oldAdminToken === undefined) delete process.env.ADMIN_STATS_TOKEN;
    else process.env.ADMIN_STATS_TOKEN = oldAdminToken;
    if (oldClickhouseUrl === undefined) delete process.env.CLICKHOUSE_URL;
    else process.env.CLICKHOUSE_URL = oldClickhouseUrl;
    fs.rmSync(contentDir, { force: true, recursive: true });
  }
});
