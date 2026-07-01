'use strict';

/**
 * tests/locale-routes.test.js — resolveLocaleRoute() canonical redirects,
 * incomplete blog paths, SPA sub-route allowlist, and blog deep routes.
 *
 * lib/locale-routes.js is pure (no HTTP server boot) — complements seo.test.js
 * (lib/seo.js parseRoute/sectionSeo) and seo-html.test.js (static shell tags).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocaleRoute } = require('../lib/locale-routes');

function expectFile(path, shell) {
  const r = resolveLocaleRoute(path);
  assert.ok(r, `${path}: expected a route`);
  assert.equal(r.file, shell, `${path}: shell`);
  assert.equal(r.redirect, undefined, `${path}: no redirect`);
}

function expectRedirect(path, location, status) {
  const r = resolveLocaleRoute(path);
  assert.ok(r, `${path}: expected a route`);
  assert.equal(r.redirect, location, `${path}: Location`);
  if (status !== undefined) assert.equal(r.status, status, `${path}: status`);
  else assert.equal(r.status, undefined, `${path}: default 301`);
  assert.equal(r.file, undefined, `${path}: no file`);
}

function expect404(path) {
  assert.equal(resolveLocaleRoute(path), null, `${path}: 404`);
}

// ── valid 200 shells ────────────────────────────────────────────────────────

test('valid SPA sections serve locale shells (200 contract)', () => {
  expectFile('/docs', '/index.en.html');
  expectFile('/uk/docs', '/index.uk.html');
  expectFile('/ru/docs', '/index.ru.html');
  expectFile('/inspector', '/index.en.html');
  expectFile('/uk/blog', '/index.uk.html');
});

test('/docs/findings and localized variants → 200 shell', () => {
  expectFile('/docs/findings', '/index.en.html');
  expectFile('/uk/docs/findings', '/index.uk.html');
  expectFile('/ru/docs/findings', '/index.ru.html');
});

test('valid cross-locale blog deep routes → 200 shell', () => {
  expectFile('/blog/en/welcome', '/index.en.html');
  expectFile('/uk/blog/ru/welcome', '/index.uk.html');
  expectFile('/ru/blog/uk/welcome', '/index.ru.html');
  expectFile('/blog/uk/welcome', '/index.en.html');
});

// ── uppercase canonicalization ──────────────────────────────────────────────

test('uppercase path → 301 lowercase (single hop)', () => {
  expectRedirect('/DOCS', '/docs');
  expectRedirect('/UK/DOCS/FINDINGS', '/uk/docs/findings');
  expectRedirect('/Blog/EN/Welcome', '/blog/en/welcome');
});

// ── trailing slash canonicalization ─────────────────────────────────────────

test('single trailing slash → 301 without slash', () => {
  expectRedirect('/docs/', '/docs');
  expectRedirect('/uk/docs/findings/', '/uk/docs/findings');
});

test('multiple trailing slashes → 301 without slash', () => {
  expectRedirect('/inspector///', '/inspector');
  expectRedirect('/uk/blog///', '/uk/blog');
});

test('root / is unchanged (302 to /inspector, not a trailing-slash 301)', () => {
  expectRedirect('/', '/inspector', 302);
});

// ── incomplete blog redirects ───────────────────────────────────────────────

for (const lang of ['en', 'uk', 'ru']) {
  test(`/blog/${lang} → 301 /blog`, () => {
    expectRedirect(`/blog/${lang}`, '/blog');
  });
  test(`/uk/blog/${lang} → 301 /uk/blog`, () => {
    expectRedirect(`/uk/blog/${lang}`, '/uk/blog');
  });
  test(`/ru/blog/${lang} → 301 /ru/blog`, () => {
    expectRedirect(`/ru/blog/${lang}`, '/ru/blog');
  });
}

test('incomplete blog + uppercase/trailing slash → one 301 to list (no chain)', () => {
  expectRedirect('/BLOG/EN/', '/blog');
  expectRedirect('/UK/BLOG/RU/', '/uk/blog');
});

// ── unknown docs subroute → real 404 ────────────────────────────────────────

test('unknown docs subroute → null (real 404, not shell)', () => {
  expect404('/docs/unknown');
  expect404('/uk/docs/unknown');
  expect404('/ru/docs/unknown');
});

test('unknown subroute on other SPA sections → null (real 404)', () => {
  expect404('/inspector/unknown');
  expect404('/uk/live/unknown');
  expect404('/ru/library/unknown');
});

// ── query string passthrough contract (path-only resolution) ────────────────

test('query string in input does not affect path resolution (no redirect loop)', () => {
  // resolveLocaleRoute receives pathname only from server.js; when given a
  // path with ?query the split keeps resolution stable.
  expectRedirect('/DOCS/?foo=bar'.split('?')[0] + '?foo=bar', '/docs');
  expectFile('/docs/findings', '/index.en.html');
  // Re-resolving the canonical target must not redirect again.
  expectFile('/docs', '/index.en.html');
});

test('canonical redirect target is stable under re-resolution (no loop)', () => {
  const first = resolveLocaleRoute('/INSPECTOR/');
  assert.equal(first.redirect, '/inspector');
  const second = resolveLocaleRoute(first.redirect);
  assert.equal(second.file, '/index.en.html');
  assert.equal(second.redirect, undefined);
});

// ── redirect status contract ────────────────────────────────────────────────

test('canonical redirects default to 301; root stays 302', () => {
  expectRedirect('/DOCS', '/docs');
  assert.equal(resolveLocaleRoute('/DOCS').status, undefined);
  expectRedirect('/', '/inspector', 302);
});
