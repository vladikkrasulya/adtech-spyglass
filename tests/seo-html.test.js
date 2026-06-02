'use strict';

/**
 * Static-asset SEO guard — complements seo.test.js (which covers the pure
 * lib/seo.js rewriter). These read the REAL index.{en,uk,ru}.html shells and
 * assert none of their baked-in SEO signals point at the bare root
 * `https://ortbtools.com/`, which 302-redirects → /inspector.
 *
 * Why it matters: fall-through routes (/docs/findings, /r/:hash, /admin/blog)
 * serve these shells WITHOUT lib/seo.js rewriting (sectionSeo returns null), so
 * whatever canonical/og:url/hreflang/JSON-LD the file carries is what Google
 * sees. A redirecting canonical there re-creates the GSC "Page with redirect".
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const BARE_ROOT = 'https://ortbtools.com/"'; // the slash-then-quote = bare root

// file → the canonical/og inspector path this locale shell must self-describe as
const SHELLS = {
  'index.en.html': 'https://ortbtools.com/inspector',
  'index.uk.html': 'https://ortbtools.com/uk/inspector',
  'index.ru.html': 'https://ortbtools.com/ru/inspector',
};

for (const [file, inspectorUrl] of Object.entries(SHELLS)) {
  const html = fs.readFileSync(path.join(PUB, file), 'utf8');

  test(`${file}: no SEO signal points at the redirecting bare root`, () => {
    // canonical / og:url / hreflang / JSON-LD url must never be the bare root.
    assert.equal(
      html.includes(BARE_ROOT),
      false,
      `${file} still carries a bare-root https://ortbtools.com/" SEO reference`,
    );
  });

  test(`${file}: canonical + og:url self-describe as this locale's /inspector`, () => {
    assert.match(
      html,
      new RegExp(`<link rel="canonical" href="${inspectorUrl.replace(/\//g, '\\/')}" \\/>`),
    );
    assert.match(
      html,
      new RegExp(`<meta property="og:url" content="${inspectorUrl.replace(/\//g, '\\/')}" \\/>`),
    );
  });

  test(`${file}: JSON-LD WebApplication.url is /inspector (not redirecting root)`, () => {
    // JSON-LD is the language-neutral app descriptor → en canonical /inspector.
    assert.match(html, /"url":\s*"https:\/\/ortbtools\.com\/inspector"/);
    assert.doesNotMatch(html, /"url":\s*"https:\/\/ortbtools\.com\/"/);
  });
}
