'use strict';

/**
 * Landing-page unit tests — lib/landings.js is pure (static content + string
 * rendering), so SSR body, CTA deep-links, injection and the SECTION_SEO mirror
 * invariant are all testable without the HTTP server.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const landings = require('../lib/landings');
const seo = require('../lib/seo');

// The full set we expect to ship in Track B.
const EXPECTED = [
  '/openrtb/2-6',
  '/openrtb/2-5',
  '/openrtb/3-0',
  '/vast',
  '/native',
  '/iab-categories',
];

const SHELL = `<!doctype html><html><head>
<link rel="canonical" href="https://ortbtools.com/inspector" />
</head><body><main id="app-root">loading…</main></body></html>`;

// ── isLanding / landingPaths ────────────────────────────────────────────────
test('isLanding: known path true, unknown false', () => {
  assert.equal(landings.isLanding('/openrtb/2-6'), true);
  assert.equal(landings.isLanding('/totally-unknown'), false);
  assert.equal(landings.isLanding('/inspector'), false); // a section, not a landing
});

test('landingPaths: returns the configured set', () => {
  assert.ok(landings.landingPaths().includes('/openrtb/2-6'));
});

// ── SECTION_SEO mirror invariant ────────────────────────────────────────────
// Every landing MUST have a SECTION_SEO entry, or it falls out of the dynamic
// sitemap (renderSitemap iterates SECTION_SEO) and loses per-route canonical.
test('every landing path has a matching SECTION_SEO entry', () => {
  for (const p of landings.landingPaths()) {
    assert.ok(seo.SECTION_SEO[p], `SECTION_SEO missing entry for landing ${p}`);
    // and sectionSeo resolves a canonical at that path
    assert.equal(seo.sectionSeo(p, 'en').canonical, `https://ortbtools.com${p}`);
  }
});

test('renderSitemap includes every landing path', () => {
  const xml = seo.renderSitemap([]);
  for (const p of landings.landingPaths()) {
    assert.match(xml, new RegExp(`<loc>https://ortbtools\\.com${p.replace(/\//g, '\\/')}</loc>`));
  }
});

// ── renderLandingBody ───────────────────────────────────────────────────────
test('renderLandingBody: h1 + lede + sections present (en)', () => {
  const html = landings.renderLandingBody('/openrtb/2-6', 'en');
  assert.match(html, /<h1>OpenRTB 2\.6 Validator<\/h1>/);
  assert.match(html, /class="landing__lede"/);
  assert.match(html, /<h2>What OpenRTB 2\.6 changes<\/h2>/);
  assert.match(html, /<ul class="landing__list">/); // key-additions list
});

test('renderLandingBody: CTA deep-links to /inspector?sample=<slug> (locale-aware)', () => {
  const en = landings.renderLandingBody('/openrtb/2-6', 'en');
  assert.match(en, /href="\/inspector\?sample=iab-banner-valid"/);
  const uk = landings.renderLandingBody('/openrtb/2-6', 'uk');
  assert.match(uk, /href="\/uk\/inspector\?sample=iab-banner-valid"/);
});

test('renderLandingBody: localized copy (uk differs from en)', () => {
  const en = landings.renderLandingBody('/openrtb/2-6', 'en');
  const uk = landings.renderLandingBody('/openrtb/2-6', 'uk');
  assert.match(uk, /Валідатор OpenRTB 2\.6/);
  assert.notEqual(en, uk);
});

test('renderLandingBody: unknown path → empty string (caller guards with isLanding)', () => {
  assert.equal(landings.renderLandingBody('/nope', 'en'), '');
});

// ── injectLanding ───────────────────────────────────────────────────────────
test('injectLanding: replaces #app-root body + injects landing.css once', () => {
  const out = landings.injectLanding(SHELL, '/openrtb/2-6', 'en');
  assert.match(out, /<main id="app-root"><section class="landing">/);
  assert.doesNotMatch(out, /loading…/); // placeholder replaced
  assert.equal((out.match(/modules\/landing\/landing\.css/g) || []).length, 1);
});

test('injectLanding: no-op for non-landing path', () => {
  assert.equal(landings.injectLanding(SHELL, '/inspector', 'en'), SHELL);
});

test('injectLanding: idempotent css link (does not double-inject)', () => {
  let out = landings.injectLanding(SHELL, '/openrtb/2-6', 'en');
  out = landings.injectLanding(out, '/openrtb/2-6', 'en');
  assert.equal((out.match(/modules\/landing\/landing\.css/g) || []).length, 1);
});

// ── full landing set (Track B) ──────────────────────────────────────────────
test('all six Track-B landings are configured', () => {
  for (const p of EXPECTED) assert.ok(landings.isLanding(p), `missing landing ${p}`);
  assert.equal(landings.landingPaths().length, EXPECTED.length);
});

test('CTA deep-links resolve to the right sample slug per landing', () => {
  const expectCta = {
    '/openrtb/2-6': 'iab-banner-valid',
    '/openrtb/2-5': 'iab-banner-valid',
    '/openrtb/3-0': 'ortb30-clean',
    '/vast': 'vast-clean-inline',
    '/native': 'native-clean',
  };
  for (const [p, slug] of Object.entries(expectCta)) {
    const html = landings.renderLandingBody(p, 'en');
    assert.match(html, new RegExp(`href="/inspector\\?sample=${slug}"`), `${p} CTA → ${slug}`);
  }
});

test('every CTA sample slug has a backing samples/ fixture', () => {
  const dir = path.join(__dirname, '..', 'samples');
  const files = new Set(fs.readdirSync(dir));
  for (const p of landings.landingPaths()) {
    const cfg = landings.LANDINGS[p];
    if (!cfg.sample) continue;
    const ok = files.has(`${cfg.sample}.json`) || files.has(`synthetic-${cfg.sample}.json`);
    assert.ok(ok, `no samples/ fixture for ${p} sample "${cfg.sample}"`);
  }
});

test('native-clean fixture is valid JSON with a stringified native request', () => {
  const f = path.join(__dirname, '..', 'samples', 'synthetic-native-clean.json');
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(Array.isArray(d.imp) && d.imp[0].native, 'imp[].native present');
  const req = d.imp[0].native.request;
  assert.equal(typeof req, 'string', 'native.request is a string');
  const parsed = JSON.parse(req);
  // The validator (rules-request.js) expects the wrapped {native:{assets}} form.
  const assets = parsed.native ? parsed.native.assets : parsed.assets;
  assert.ok(Array.isArray(assets) && assets.length, 'native request has assets[]');
});

// ── /iab-categories table ────────────────────────────────────────────────────
test('iab-categories: renders a filterable tier-1 table, no CTA', () => {
  const html = landings.renderLandingBody('/iab-categories', 'en');
  assert.match(html, /data-landing-filter/); // filter input present
  assert.match(html, /<code>IAB1<\/code>/); // a tier-1 code
  assert.match(html, /Arts &amp; Entertainment/); // decoded + escaped label
  assert.equal((html.match(/data-landing-row/g) || []).length, 26); // 26 tier-1 codes
  assert.doesNotMatch(html, /landing__cta-btn/); // sample: null → no CTA
});

test('iab-categories: page localizes (uk differs from en)', () => {
  const en = landings.renderLandingBody('/iab-categories', 'en');
  const uk = landings.renderLandingBody('/iab-categories', 'uk');
  assert.notEqual(en, uk);
});
