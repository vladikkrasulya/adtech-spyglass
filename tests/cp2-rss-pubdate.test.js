'use strict';

/**
 * RSS <pubDate> contract: a valid RFC-822 date when the post has one, OMITTED
 * when it doesn't — never the literal "Invalid Date". isIndexable() does not
 * require a frontmatter date, so a date-less indexable post must still yield a
 * conformant feed. Separate file because CONTENT_DIR is read at module load.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.CLICKHOUSE_URL; // markdown-only; no DB posts
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cp2-rss-pubdate-'));
process.env.CONTENT_DIR = TMP;
for (const l of ['en', 'uk', 'ru']) fs.mkdirSync(path.join(TMP, l), { recursive: true });

const BODY = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' '); // ≥ floor
function writeMd(lang, slug, date) {
  const lines = [
    '---',
    `title: ${slug}`,
    'category: guide',
    'summary: a distinct summary line',
    'indexable: true',
  ];
  if (date) lines.push(`date: ${date}`);
  lines.push('---', '', BODY, '');
  fs.writeFileSync(path.join(TMP, lang, `${slug}.md`), lines.join('\n'));
}
// Both indexable; one has a date, one does not.
writeMd('en', 'dated-post', '2026-03-15');
writeMd('en', 'undated-post');

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

test('RSS pubDate: dated post emits a valid RFC-822 pubDate; undated omits it; never "Invalid Date"', async () => {
  const mod = createBlogModule({});
  const rss = mod.routes.find((x) => x.path === '/blog/rss.xml').handler;
  const res = mockRes();
  await rss({ url: '/blog/rss.xml', headers: {} }, res);
  const xml = Buffer.concat(res.chunks).toString('utf8');

  assert.equal(res.status, 200);
  assert.ok(!xml.includes('Invalid Date'), 'feed never contains "Invalid Date"');

  // Both posts are indexable → two <item>s.
  assert.equal((xml.match(/<item>/g) || []).length, 2, 'both indexable posts present');
  assert.ok(xml.includes('/blog/en/dated-post'));
  assert.ok(xml.includes('/blog/en/undated-post'));

  // Exactly one <pubDate> — the dated post — and it parses as a real date.
  const pubDates = xml.match(/<pubDate>([^<]+)<\/pubDate>/g) || [];
  assert.equal(pubDates.length, 1, 'only the dated post emits pubDate');
  const val = pubDates[0].replace(/<\/?pubDate>/g, '');
  assert.ok(!Number.isNaN(new Date(val).getTime()), `pubDate parses as a date: ${val}`);
});
