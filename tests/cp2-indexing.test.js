'use strict';

/**
 * CP2 indexing-policy contract:
 *   - isIndexable() default-deny quality gate;
 *   - post-API split (availability vs indexable) — availability returns ALL,
 *     indexable returns ONLY approved markdown;
 *   - getPost() tri-state (found / confirmed_absent / unavailable) incl. the
 *     "ClickHouse unavailable → never a false confirmed_absent" guarantee;
 *   - per-route robots (noindex sections + posts) and existing-only hreflang;
 *   - applySeoToHtml robots replacement (exactly one, idempotent);
 *   - RSS = indexable-only.
 *
 * CONTENT_DIR + a DISABLED ClickHouse are pinned BEFORE requiring the modules
 * (blog-service reads CONTENT_DIR at load; CH-disabled makes the tri-state
 * exercise the markdown + unavailable paths deterministically, no live CH).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.CLICKHOUSE_URL; // ClickHouse "disabled" → isEnabled() false
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cp2-content-'));
process.env.CONTENT_DIR = TMP;
for (const l of ['en', 'uk', 'ru']) fs.mkdirSync(path.join(TMP, l), { recursive: true });

const SUBSTANTIVE = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ');
function writeMd(lang, slug, { indexable, body, summary }) {
  const lines = ['---', `title: ${slug}`, 'category: guide'];
  if (summary) lines.push(`summary: ${summary}`);
  if (indexable) lines.push('indexable: true');
  lines.push('---', '', body, '');
  fs.writeFileSync(path.join(TMP, lang, `${slug}.md`), lines.join('\n'));
}
// welcome: NO opt-in → never indexable (mirrors the real welcome.md).
writeMd('en', 'welcome', {
  indexable: false,
  body: 'Welcome to the blog. Short.',
  summary: 'welcome summary',
});
// real-guide: opt-in + substantive + body != summary → indexable, in en + uk.
writeMd('en', 'real-guide', {
  indexable: true,
  body: SUBSTANTIVE,
  summary: 'a distinct english summary line',
});
writeMd('uk', 'real-guide', {
  indexable: true,
  body: SUBSTANTIVE,
  summary: 'окремий короткий опис',
});
// thin-optin: opt-in but below the word floor → not indexable.
writeMd('en', 'thin-optin', {
  indexable: true,
  body: 'too short to qualify',
  summary: 'diff summary',
});

const seo = require('../lib/seo');
const blog = require('../lib/blog-service');
const { createBlogModule } = require('../modules/blog/handler');

// ── isIndexable (pure) ───────────────────────────────────────────────────────
test('isIndexable: DB/firehose post is never indexable', () => {
  assert.equal(
    blog.isIndexable({ source: 'db', indexable: true, body: SUBSTANTIVE, summary: 'x' }),
    false,
  );
});
test('isIndexable: markdown without explicit opt-in is not indexable', () => {
  assert.equal(blog.isIndexable({ source: 'markdown', body: SUBSTANTIVE, summary: 'x' }), false);
});
test('isIndexable: opt-in but body == summary is not indexable', () => {
  assert.equal(
    blog.isIndexable({
      source: 'markdown',
      indexable: true,
      body: 'same text',
      summary: 'same text',
    }),
    false,
  );
});
test('isIndexable: opt-in but below the word floor is not indexable', () => {
  assert.equal(
    blog.isIndexable({
      source: 'markdown',
      indexable: true,
      body: 'short body here',
      summary: 'diff',
    }),
    false,
  );
});
test('isIndexable: opt-in + substantive distinct markdown is indexable', () => {
  assert.equal(
    blog.isIndexable({ source: 'markdown', indexable: true, body: SUBSTANTIVE, summary: 'diff' }),
    true,
  );
});

// ── post-API split ───────────────────────────────────────────────────────────
test('listAllPublishedRefs returns ALL markdown posts (availability — incl. non-indexable)', async () => {
  const refs = await blog.listAllPublishedRefs();
  const key = (r) => `${r.slug}:${r.lang}`;
  const set = new Set(refs.map(key));
  assert.ok(set.has('welcome:en'));
  assert.ok(set.has('real-guide:en'));
  assert.ok(set.has('real-guide:uk'));
  assert.ok(set.has('thin-optin:en'));
});
test('listIndexablePostRefs returns ONLY approved markdown', async () => {
  const refs = await blog.listIndexablePostRefs();
  const set = new Set(refs.map((r) => `${r.slug}:${r.lang}`));
  assert.deepEqual([...set].sort(), ['real-guide:en', 'real-guide:uk']);
  assert.ok(!set.has('welcome:en'));
  assert.ok(!set.has('thin-optin:en'));
});
test('langsForSlug returns ALL locales that exist (availability — NOT the hreflang source)', async () => {
  assert.deepEqual(await blog.langsForSlug('real-guide'), ['en', 'uk']);
  assert.deepEqual(await blog.langsForSlug('welcome'), ['en']); // exists but non-indexable
});
test('indexableLangsForSlug returns ONLY locales where the slug is itself indexable (hreflang source)', async () => {
  assert.deepEqual(await blog.indexableLangsForSlug('real-guide'), ['en', 'uk']);
  // welcome EXISTS (langsForSlug → ['en']) but is opt-out → never an hreflang alternate.
  assert.deepEqual(await blog.indexableLangsForSlug('welcome'), []);
  // thin-optin opts in but is below the word floor → not an alternate either.
  assert.deepEqual(await blog.indexableLangsForSlug('thin-optin'), []);
});

// ── getPost tri-state ────────────────────────────────────────────────────────
test('getPost: markdown present → found', async () => {
  const r = await blog.getPost('real-guide', 'en');
  assert.equal(r.status, 'found');
  assert.equal(r.post.source, 'markdown');
});
test('getPost: invalid slug shape → confirmed_absent (can never exist)', async () => {
  const r = await blog.getPost('Bad Slug!!', 'en');
  assert.equal(r.status, 'confirmed_absent');
});
test('getPost: valid nonexistent slug with ClickHouse DISABLED → unavailable, NEVER a false confirmed_absent', async () => {
  const r = await blog.getPost('does-not-exist-xyz', 'en');
  assert.equal(r.status, 'unavailable'); // a cache/markdown miss must not 404 when CH is down
});

// ── sectionSeo / postSeo robots + hreflang (pure) ───────────────────────────
test('sectionSeo: noindex sections emit noindex,follow; others index,follow', () => {
  for (const p of ['/blog', '/insights', '/live']) {
    assert.equal(seo.sectionSeo(p, 'en').robots, 'noindex,follow', `${p} noindex`);
  }
  for (const p of ['/inspector', '/docs', '/dialects', '/behavior', '/library', '/openrtb/2-6']) {
    assert.equal(seo.sectionSeo(p, 'en').robots, 'index,follow', `${p} index`);
  }
});
test('sectionSeo: /account is not a SEO section (its static shell noindex is untouched)', () => {
  assert.equal(seo.sectionSeo('/account', 'en'), null);
});
test('postSeo: non-indexable post → noindex,follow + NO alternate cluster', () => {
  const p = seo.postSeo('slug', 'en', { title: 't', summary: 's' });
  assert.equal(p.robots, 'noindex,follow');
  assert.equal(p.alternates.length, 0);
});
test('postSeo: indexable post → index,follow + existing-only hreflang (+ x-default when en exists)', () => {
  const p = seo.postSeo(
    'slug',
    'en',
    { title: 't', summary: 's' },
    { indexable: true, existingLangs: ['en', 'uk'] },
  );
  assert.equal(p.robots, 'index,follow');
  assert.deepEqual(p.alternates.map((a) => a.hreflang).sort(), ['en', 'uk', 'x-default']);
});
test('postSeo: indexable post without an en equivalent omits x-default', () => {
  const p = seo.postSeo(
    'slug',
    'uk',
    { title: 't', summary: 's' },
    { indexable: true, existingLangs: ['uk', 'ru'] },
  );
  assert.deepEqual(p.alternates.map((a) => a.hreflang).sort(), ['ru', 'uk']);
});

// ── applySeoToHtml robots replacement ───────────────────────────────────────
const ROBOTS_SHELL = `<head>
<link rel="canonical" href="https://ortbtools.com/" />
<meta name="robots" content="index,follow" />
<title>x</title>
<meta name="description" content="d" />
</head>`;
test('applySeoToHtml: replaces the robots meta (never appends) → exactly one, with the new value', () => {
  const out = seo.applySeoToHtml(ROBOTS_SHELL, seo.sectionSeo('/blog', 'en'));
  assert.equal((out.match(/<meta\s+name="robots"/gi) || []).length, 1);
  assert.match(out, /<meta name="robots" content="noindex,follow" \/>/);
});
test('applySeoToHtml: robots replacement is idempotent', () => {
  let out = seo.applySeoToHtml(ROBOTS_SHELL, seo.sectionSeo('/blog', 'en'));
  out = seo.applySeoToHtml(out, seo.sectionSeo('/blog', 'en'));
  assert.equal((out.match(/<meta\s+name="robots"/gi) || []).length, 1);
});

// ── RSS = indexable-only ─────────────────────────────────────────────────────
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
test('RSS advertises only indexable (approved) posts, never the firehose/non-approved corpus', async () => {
  const mod = createBlogModule({});
  const rss = mod.routes.find((x) => x.path === '/blog/rss.xml').handler;
  const res = mockRes();
  await rss({ url: '/blog/rss.xml', headers: {} }, res);
  const xml = Buffer.concat(res.chunks).toString('utf8');
  assert.equal(res.status, 200);
  assert.match(xml, /<rss version="2\.0">/);
  assert.match(xml, /<channel>/);
  assert.ok(xml.includes('/blog/en/real-guide'), 'approved post present');
  assert.ok(!xml.includes('/blog/en/welcome'), 'non-approved post absent');
  assert.ok(!xml.includes('thin-optin'), 'thin opt-in absent');
  // real-guide has no frontmatter date → its <pubDate> must be OMITTED, never
  // the literal "Invalid Date" (which would make the feed non-conformant).
  assert.ok(!xml.includes('Invalid Date'), 'no Invalid Date in feed');
  assert.ok(!/<pubDate>/.test(xml), 'date-less indexable post omits pubDate');
});
