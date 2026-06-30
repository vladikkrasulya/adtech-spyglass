'use strict';

/**
 * RSS with ZERO approved posts must still be a valid, empty feed (separate file
 * so CONTENT_DIR points at an empty dir — CONTENT_DIR is read at module load).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.CLICKHOUSE_URL; // CH disabled → no DB posts either
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cp2-rss-empty-'));
process.env.CONTENT_DIR = TMP;
for (const l of ['en', 'uk', 'ru']) fs.mkdirSync(path.join(TMP, l), { recursive: true });

const { createBlogModule } = require('../modules/blog/handler');

function mockRes() {
  const r = { status: 0, headers: {}, chunks: [] };
  r.writeHead = (s, h) => {
    r.status = s;
    Object.assign(r.headers, h || {});
  };
  r.end = (b) => {
    if (b != null) r.chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
    r.ended = true;
  };
  return r;
}

test('RSS with no approved posts returns a valid EMPTY feed (200, well-formed, zero items)', async () => {
  const mod = createBlogModule({});
  const rss = mod.routes.find((x) => x.path === '/blog/rss.xml').handler;
  const res = mockRes();
  await rss({ url: '/blog/rss.xml', headers: {} }, res);
  const xml = Buffer.concat(res.chunks).toString('utf8');
  assert.equal(res.status, 200);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2\.0">/);
  assert.match(xml, /<channel>/);
  assert.match(xml, /<\/channel>\s*<\/rss>/);
  assert.equal((xml.match(/<item>/g) || []).length, 0);
});
