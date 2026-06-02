'use strict';

/**
 * SEO unit tests — lib/seo.js is pure (no I/O), so route resolution, meta
 * rewriting, blog-post SSR, escaping and sitemap generation are all testable
 * without booting the HTTP server or ClickHouse.
 *
 * Guards the regression that motivated this module: every SPA route served the
 * homepage's `canonical = https://ortbtools.com/`, so Google consolidated all
 * sections + posts into the homepage and indexed nothing else.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const seo = require('../lib/seo');

// A minimal stand-in for the static shell <head> — same tag shapes the real
// index.{en,uk,ru}.html carry (some multi-line, as prettier formats them).
const SHELL = `<!doctype html>
<html lang="en"><head>
<title>Free OpenRTB Validator (2.5, 2.6, 3.0) — Runs Locally</title>
<meta
  name="description"
  content="Validate OpenRTB JSON in your browser."
/>
<link rel="canonical" href="https://ortbtools.com/" />
<link rel="alternate" hreflang="uk" href="https://ortbtools.com/uk/" />
<link rel="alternate" hreflang="ru" href="https://ortbtools.com/ru/" />
<link rel="alternate" hreflang="en" href="https://ortbtools.com/" />
<link rel="alternate" hreflang="x-default" href="https://ortbtools.com/" />
<meta property="og:type" content="website" />
<meta property="og:title" content="Spyglass — Free OpenRTB Validator" />
<meta
  property="og:description"
  content="Free browser-based OpenRTB validator."
/>
<meta property="og:url" content="https://ortbtools.com/" />
<meta property="og:locale" content="en_US" />
<meta name="twitter:title" content="Spyglass — Free OpenRTB Validator" />
<meta
  name="twitter:description"
  content="Free browser-based OpenRTB validator."
/>
</head><body><main id="app-root">loading…</main></body></html>`;

// ── parseRoute ────────────────────────────────────────────────────────────
test('parseRoute: bare section → en UI', () => {
  const r = seo.parseRoute('/blog');
  assert.equal(r.uiLang, 'en');
  assert.equal(r.isPost, false);
  assert.equal(r.sectionPath, '/blog');
});

test('parseRoute: localized section → uk UI, base sectionPath', () => {
  const r = seo.parseRoute('/uk/docs');
  assert.equal(r.uiLang, 'uk');
  assert.equal(r.sectionPath, '/docs');
});

test('parseRoute: trailing slash + query are stripped', () => {
  const r = seo.parseRoute('/ru/live/?foo=bar');
  assert.equal(r.uiLang, 'ru');
  assert.equal(r.sectionPath, '/live');
});

test('parseRoute: blog post → post lang + slug', () => {
  const r = seo.parseRoute('/blog/en/welcome');
  assert.equal(r.isPost, true);
  assert.equal(r.postLang, 'en');
  assert.equal(r.slug, 'welcome');
  assert.equal(r.sectionPath, '/blog');
});

test('parseRoute: UI-prefixed post keeps post-lang from path', () => {
  const r = seo.parseRoute('/uk/blog/en/welcome');
  assert.equal(r.uiLang, 'uk');
  assert.equal(r.isPost, true);
  assert.equal(r.postLang, 'en');
  assert.equal(r.slug, 'welcome');
});

// ── sectionSeo ──────────────────────────────────────────────────────────────
test('sectionSeo: canonical/alternates per UI lang', () => {
  const s = seo.sectionSeo('/blog', 'uk');
  assert.equal(s.canonical, 'https://ortbtools.com/uk/blog');
  const en = s.alternates.find((a) => a.hreflang === 'en');
  const ru = s.alternates.find((a) => a.hreflang === 'ru');
  const xd = s.alternates.find((a) => a.hreflang === 'x-default');
  assert.equal(en.href, 'https://ortbtools.com/blog');
  assert.equal(ru.href, 'https://ortbtools.com/ru/blog');
  assert.equal(xd.href, 'https://ortbtools.com/blog');
  assert.match(s.title, /Блог/); // uk title is localized
  assert.match(s.title, /ortbtools/);
});

test('sectionSeo: unknown path → null (leave shell untouched)', () => {
  assert.equal(seo.sectionSeo('/totally-unknown', 'en'), null);
});

// ── applySeoToHtml ──────────────────────────────────────────────────────────
test('applySeoToHtml: rewrites canonical + collapses to one set of alternates', () => {
  const out = seo.applySeoToHtml(SHELL, seo.sectionSeo('/docs', 'en'));
  assert.match(out, /<link rel="canonical" href="https:\/\/ortbtools\.com\/docs" \/>/);
  // homepage canonical must be gone
  assert.doesNotMatch(out, /rel="canonical" href="https:\/\/ortbtools\.com\/"/);
  // exactly one canonical, and 4 alternates (en/uk/ru/x-default), no dupes
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((out.match(/rel="alternate"/g) || []).length, 4);
});

test('applySeoToHtml: rewrites title/description/OG/Twitter (incl. multiline meta)', () => {
  const out = seo.applySeoToHtml(SHELL, seo.sectionSeo('/live', 'en'));
  const s = seo.sectionSeo('/live', 'en');
  assert.ok(out.includes(`<title>${s.title}</title>`));
  assert.ok(out.includes(`<meta name="description" content="${s.description}" />`));
  assert.ok(out.includes(`<meta property="og:url" content="${s.ogUrl}" />`));
  assert.ok(out.includes(`<meta property="og:title" content="${s.title}" />`));
  assert.ok(out.includes(`<meta name="twitter:title" content="${s.title}" />`));
  // old homepage description must be replaced
  assert.doesNotMatch(out, /Validate OpenRTB JSON in your browser\./);
});

test('applySeoToHtml: null seo is a no-op', () => {
  assert.equal(seo.applySeoToHtml(SHELL, null), SHELL);
});

// ── postSeo ─────────────────────────────────────────────────────────────────
test('postSeo: canonical is the post URL even when post is null (no homepage dupe)', () => {
  const p = seo.postSeo('welcome', 'en', null);
  assert.equal(p.canonical, 'https://ortbtools.com/blog/en/welcome');
  assert.equal(p.ogType, 'article');
});

test('postSeo: title/description from the post', () => {
  const p = seo.postSeo('welcome', 'uk', { title: 'Привіт', summary: 'Опис' });
  assert.match(p.title, /Привіт/);
  assert.equal(p.description, 'Опис');
  assert.equal(p.canonical, 'https://ortbtools.com/blog/uk/welcome');
});

// ── SSR + escaping (XSS) ─────────────────────────────────────────────────────
test('injectPostSsr: article body lands in #app-root + blog.css injected', () => {
  const post = {
    title: 'Hello',
    summary: 'A summary',
    category: 'guide',
    body: '## Heading\n\nBody text.',
  };
  const out = seo.injectPostSsr(SHELL, post);
  assert.match(out, /<main id="app-root"><section class="blog-section">/);
  assert.match(out, /<h1>Hello<\/h1>/);
  assert.match(out, /<h3>Heading<\/h3>/); // ## → h3
  assert.match(out, /<link rel="stylesheet" href="\/modules\/blog\/blog\.css" \/>/);
  assert.doesNotMatch(out, /loading…/); // shell placeholder replaced
});

test('renderBodyHtml: escapes HTML in the body (no raw <script> injection)', () => {
  const html = seo.renderBodyHtml('Hello <script>alert(1)</script> **bold**');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test('renderPostArticle: escapes a malicious title', () => {
  const html = seo.renderPostArticle({
    title: '<img src=x onerror=alert(1)>',
    summary: '',
    body: '',
  });
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img/);
});

test('escapeHtml: covers the five entities', () => {
  assert.equal(seo.escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

// ── renderSitemap ────────────────────────────────────────────────────────────
test('renderSitemap: valid XML with home, sections and posts', () => {
  const xml = seo.renderSitemap([
    { slug: 'welcome', lang: 'en' },
    { slug: 'welcome', lang: 'uk' },
    { slug: 'welcome', lang: 'ru' },
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  // bare '/' is intentionally NOT listed: it 302-redirects → /inspector, and a
  // redirecting sitemap entry triggers GSC "Page with redirect". /inspector is
  // the real home.
  assert.doesNotMatch(xml, /<loc>https:\/\/ortbtools\.com\/<\/loc>/); // no redirecting root
  assert.match(xml, /<loc>https:\/\/ortbtools\.com\/inspector<\/loc>/); // /inspector is home
  assert.match(xml, /<loc>https:\/\/ortbtools\.com\/blog<\/loc>/); // section
  assert.match(xml, /<loc>https:\/\/ortbtools\.com\/blog\/en\/welcome<\/loc>/); // post
  assert.match(xml, /<loc>https:\/\/ortbtools\.com\/blog\/uk\/welcome<\/loc>/);
  // post langs cross-link via xhtml alternates
  assert.match(
    xml,
    /<xhtml:link rel="alternate" hreflang="ru" href="https:\/\/ortbtools\.com\/blog\/ru\/welcome"\/>/,
  );
  // balanced url tags
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
});

test('renderSitemap: ignores malformed post rows', () => {
  const xml = seo.renderSitemap([{ slug: '', lang: 'en' }, { slug: 'x', lang: 'de' }, null]);
  assert.doesNotMatch(xml, /\/blog\/[a-z]+\/x/);
  assert.doesNotMatch(xml, /hreflang="de"/);
});
