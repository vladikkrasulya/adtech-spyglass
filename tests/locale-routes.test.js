'use strict';

/**
 * tests/locale-routes.test.js — resolveLocaleRoute() canonical redirects,
 * incomplete blog paths, SPA sub-route allowlist, and blog deep routes.
 *
 * lib/locale-routes.js is pure (no HTTP server boot) — complements seo.test.js
 * (lib/seo.js parseRoute/sectionSeo) and seo-html.test.js (static shell tags).
 *
 * The final section pairs it with public/core/routes.js, the browser-side
 * builder for the same routes. Both files describe one route table; the only
 * way to know they still agree is to feed every URL the client mints back
 * through the server resolver, which is what those tests do.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  resolveLocaleRoute,
  SAME_ORIGIN_REDIRECT_RE,
  ASCII_REDIRECT_RE,
} = require('../lib/locale-routes');

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
  assert.doesNotMatch(r.redirect, /%/, `${path}: redirect must not contain %`);
  assert.match(r.redirect, ASCII_REDIRECT_RE, `${path}: redirect must be ASCII`);
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

// ── same-origin redirect invariant (open-redirect hardening) ────────────────

const MALFORMED_PATHS = [
  '//evil.com/',
  '//evil.com',
  '///evil.com',
  'http://evil.com/',
  'https://evil.com/',
  '/\\evil.com',
  '/\\evil.com/',
  '/%2Fevil.com',
  '/%2fevil.com',
  '/%252Fevil.com',
  '/docs%2F%2Fevil.com',
];

test('malformed/absolute-form paths → null (real 404, no external Location)', () => {
  for (const path of MALFORMED_PATHS) {
    expect404(path);
  }
});

test('empty path resolves as root (302 → /inspector, explicit sentinel)', () => {
  expectRedirect('', '/inspector', 302);
});

test('query in input preserves safe redirect target only', () => {
  const r = resolveLocaleRoute('/DOCS/?foo=bar');
  assert.ok(r);
  assert.equal(r.redirect, '/docs');
  assert.match(r.redirect, SAME_ORIGIN_REDIRECT_RE);
});

test('every redirect in matrix satisfies /^\\/(?!\\/)/', () => {
  const matrix = [
    '/',
    '/DOCS',
    '/UK/DOCS/FINDINGS',
    '/Blog/EN/Welcome',
    '/docs/',
    '/uk/docs/findings/',
    '/inspector///',
    '/uk/blog///',
    '/BLOG/EN/',
    '/UK/BLOG/RU/',
    '/blog/en',
    '/uk/blog/ru',
    '/ru/blog/uk',
    '/en/docs',
    '/stream.html',
    '/playground',
    '/about.html',
    '/account.html',
    '/en/about',
    '',
  ];
  for (const path of matrix) {
    const r = resolveLocaleRoute(path);
    assert.ok(r && r.redirect, `${path}: expected redirect`);
    assert.match(
      r.redirect,
      SAME_ORIGIN_REDIRECT_RE,
      `${path} → ${r.redirect}: must be same-origin relative`,
    );
    assert.doesNotMatch(r.redirect, /%/, `${path}: redirect must not contain %`);
    assert.match(r.redirect, ASCII_REDIRECT_RE, `${path}: redirect must be ASCII`);
  }
});

// ── encoded-path alias hardening (raw ASCII routing only) ───────────────────

const ENCODED_ALIAS_PATHS = [
  '/docs%2Ffindings',
  '/docs%252Ffindings',
  '/%64ocs',
  '/docs/%E2%98%83',
  '/%68ttp://evil.com',
  '/%5Cevil.com',
  '/%5cevil.com',
  '/uk/%64ocs/findings',
];

test('percent-encoded path aliases → null (real 404, no decoded routing)', () => {
  for (const path of ENCODED_ALIAS_PATHS) {
    expect404(path);
  }
});

test('canonical ASCII routes still work after encoded-alias hardening', () => {
  expectFile('/docs/findings', '/index.en.html');
  expectRedirect('/DOCS', '/docs');
  expectRedirect('/docs/', '/docs');
  expectRedirect('/UK/DOCS/FINDINGS/', '/uk/docs/findings');
});

test('query string ignored for pathname validation (encoded alias in path only)', () => {
  expect404('/docs%2Ffindings?foo=bar');
  const r = resolveLocaleRoute('/DOCS/?foo=bar');
  assert.ok(r);
  assert.equal(r.redirect, '/docs');
  assert.doesNotMatch(r.redirect, /%/);
});

// ── client route builder ↔ server resolver parity ───────────────────────────
//
// public/core/routes.js is the browser's copy of the rules above. It exists
// because every module used to hand-roll its own locale-prefixed URLs —
// `localePrefix()` was copy-pasted verbatim into six modules, search inlined
// the same expression, lang-switch had a private allowlist, and stream
// hardcoded '/' + lang + '/r/' + hash. Four user-visible defects fell out of
// the drift (F-08, F-09, F-12, F-15), all regression-tested below.
//
// It's an ES module with no dependencies and no DOM access, so it loads here
// with a plain dynamic import — no jsdom harness needed.

const ROUTES_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'core', 'routes.js')).href;
let routesModule = null;
async function routes() {
  if (!routesModule) routesModule = await import(ROUTES_URL);
  return routesModule;
}

/** The server must serve this exact path — no redirect, no 404. */
function expectServedAsIs(builtPath, label) {
  const r = resolveLocaleRoute(builtPath);
  assert.ok(r, `${label}: ${builtPath} → 404 (client built a route the server doesn't have)`);
  assert.equal(r.redirect, undefined, `${label}: ${builtPath} → redirect ${r.redirect}`);
  assert.ok(r.file, `${label}: ${builtPath} → no shell`);
}

test('localePrefix: en is the no-prefix canonical locale', async () => {
  const { localePrefix, localeRoot, normalizeLocale } = await routes();
  assert.equal(localePrefix('en'), '');
  assert.equal(localePrefix('uk'), '/uk');
  assert.equal(localePrefix('ru'), '/ru');
  // Unknown/missing locales must never become a bogus '/de' prefix.
  assert.equal(localePrefix('de'), '');
  assert.equal(localePrefix(undefined), '');
  assert.equal(normalizeLocale('UK'), 'uk');
  assert.equal(localeRoot('en'), '/');
  assert.equal(localeRoot('uk'), '/uk');
});

test('stripLocale: prefix removal respects segment boundaries', async () => {
  const { stripLocale } = await routes();
  assert.deepEqual(stripLocale('/uk/docs/findings'), { lang: 'uk', path: '/docs/findings' });
  assert.deepEqual(stripLocale('/ru/r/aabbccdd11'), { lang: 'ru', path: '/r/aabbccdd11' });
  assert.deepEqual(stripLocale('/inspector'), { lang: 'en', path: '/inspector' });
  assert.deepEqual(stripLocale('/uk'), { lang: 'uk', path: '/' });
  assert.deepEqual(stripLocale('/'), { lang: 'en', path: '/' });
  // The naive `startsWith('/uk')` this replaced ate three chars off any path
  // that merely began with those letters.
  assert.deepEqual(stripLocale('/ukraine'), { lang: 'en', path: '/ukraine' });
  assert.deepEqual(stripLocale('/rules'), { lang: 'en', path: '/rules' });
  // Trailing slashes are dropped — the server 301s them away anyway.
  assert.deepEqual(stripLocale('/uk/docs/'), { lang: 'uk', path: '/docs' });
});

// ── F-08: `${lp || '/'}/docs` produced the protocol-relative `//docs` ───────

test('F-08: localePath never emits a protocol-relative // path', async () => {
  const { localePath } = await routes();
  assert.equal(localePath('/docs', 'en'), '/docs');
  assert.equal(localePath('/docs', 'uk'), '/uk/docs');
  assert.equal(localePath('/docs', 'ru'), '/ru/docs');
  assert.equal(localePath('/', 'en'), '/');
  assert.equal(localePath('/', 'uk'), '/uk');
  for (const lang of ['en', 'uk', 'ru']) {
    for (const p of ['/', '/docs', '/docs/findings', '/about', '/r/aabbccdd11']) {
      const built = localePath(p, lang);
      assert.match(built, SAME_ORIGIN_REDIRECT_RE, `${p}+${lang} → ${built} must not start //`);
    }
  }
});

test('localePath is idempotent — re-prefixing an already-localized path', async () => {
  const { localePath } = await routes();
  assert.equal(localePath('/uk/docs', 'ru'), '/ru/docs');
  assert.equal(localePath('/uk/docs', 'en'), '/docs');
  assert.equal(localePath('/ru/docs/findings', 'uk'), '/uk/docs/findings');
});

// ── F-12: stream built /en/r/<hash>, a route the server has never had ──────

test('F-12: specimenPath builds a permalink the server actually routes', async () => {
  const { specimenPath } = await routes();
  const hash = 'aabbccdd11';
  assert.equal(specimenPath(hash, 'en'), '/r/' + hash);
  assert.equal(specimenPath(hash, 'uk'), '/uk/r/' + hash);
  assert.equal(specimenPath(hash, 'ru'), '/ru/r/' + hash);
  for (const lang of ['en', 'uk', 'ru']) {
    expectServedAsIs(specimenPath(hash, lang), `specimenPath(${lang})`);
  }
  // The shape the buggy code produced is a hard 404 — there is no /en/r/ and
  // the legacy /en/<section> redirect is single-segment, so it can't rescue it.
  expect404('/en/r/' + hash);
});

// ── F-15: blog cards dropped the UI-locale prefix ──────────────────────────

test('F-15: blogPostPath keeps the UI locale and the post language separate', async () => {
  const { blogPostPath } = await routes();
  assert.equal(blogPostPath('uk', 'welcome', 'uk'), '/uk/blog/uk/welcome');
  assert.equal(blogPostPath('uk', 'welcome', 'en'), '/blog/uk/welcome');
  assert.equal(blogPostPath('en', 'welcome', 'uk'), '/uk/blog/en/welcome');
  assert.equal(blogPostPath('ru', 'welcome', 'uk'), '/uk/blog/ru/welcome');
  for (const uiLang of ['en', 'uk', 'ru']) {
    for (const postLang of ['en', 'uk', 'ru']) {
      expectServedAsIs(
        blogPostPath(postLang, 'welcome', uiLang),
        `blogPostPath(${postLang}→${uiLang})`,
      );
    }
  }
});

// ── F-09: the lang switch discarded deep path, query and hash ──────────────

test('F-09: relocalize preserves the deep route instead of falling to the root', async () => {
  const { relocalize } = await routes();
  const cases = [
    ['/docs/findings', 'uk', '/uk/docs/findings'],
    ['/r/aabbccdd11', 'uk', '/uk/r/aabbccdd11'],
    ['/blog/en/some-post', 'uk', '/uk/blog/en/some-post'],
    ['/uk/blog/ru/some-post', 'en', '/blog/ru/some-post'],
    ['/inspector', 'uk', '/uk/inspector'],
    ['/uk/docs/findings', 'en', '/docs/findings'],
    ['/openrtb/2-6', 'uk', '/uk/openrtb/2-6'],
    ['/about', 'uk', '/uk/about'],
    ['/', 'uk', '/uk'],
    ['/uk', 'en', '/'],
    // /admin/blog exists ONLY unprefixed (/uk/admin/blog is a 404), so the
    // right answer is to stay put. Pre-fix it went to /uk, which the SPA
    // router answered with "No section registered for /."
    ['/admin/blog', 'uk', '/admin/blog'],
  ];
  for (const [from, lang, expected] of cases) {
    assert.equal(relocalize(from, lang), expected, `${from} + ${lang}`);
  }
});

test('F-09: relocalize carries query string and fragment', async () => {
  const { relocalize } = await routes();
  assert.equal(
    relocalize('/inspector?sample=x&dialect=y', 'uk'),
    '/uk/inspector?sample=x&dialect=y',
  );
  assert.equal(relocalize('/ru/account#security', 'en'), '/account#security');
  assert.equal(
    relocalize('/docs/findings?sev=error#ORTB-042', 'uk'),
    '/uk/docs/findings?sev=error#ORTB-042',
  );
  // Location-like objects (what lang-switch actually hands it) work too.
  assert.equal(
    relocalize({ pathname: '/uk/inspector', search: '?sample=x', hash: '#tab' }, 'ru'),
    '/ru/inspector?sample=x#tab',
  );
});

test('F-09: untranslatable paths still fall back to the locale root', async () => {
  const { relocalize } = await routes();
  // The fallback survives — it's just the exception now, not the default.
  // Query/hash are dropped on purpose: they described a page you left.
  assert.equal(relocalize('/docs/unknown', 'uk'), '/uk');
  assert.equal(relocalize('/inspector/nope?keep=me', 'uk'), '/uk');
  assert.equal(relocalize('/totally-unknown', 'en'), '/');
});

test('F-09: relocalize round-trips through every locale', async () => {
  const { relocalize } = await routes();
  const paths = [
    '/inspector',
    '/docs/findings',
    '/r/aabbccdd11',
    '/blog/en/welcome',
    '/openrtb/2-6',
    '/about',
    '/admin/blog',
  ];
  for (const p of paths) {
    for (const lang of ['uk', 'ru']) {
      const there = relocalize(p, lang);
      assert.equal(relocalize(there, 'en'), p, `${p} → ${lang} → en`);
    }
  }
});

// ── whole-table parity sweep ────────────────────────────────────────────────

test('every path the client builder emits resolves on the server', async () => {
  const { localePath } = await routes();
  const canonical = [
    '/inspector',
    '/live',
    '/behavior',
    '/library',
    '/dialects',
    '/blog',
    '/docs',
    '/insights',
    '/docs/findings',
    '/blog/en/welcome',
    '/blog/uk/welcome',
    '/r/aabbccdd11',
    '/about',
    '/account',
    '/admin/blog',
    '/openrtb/2-6',
    '/openrtb/2-5',
    '/openrtb/3-0',
    '/vast',
    '/native',
    '/iab-categories',
  ];
  for (const p of canonical) {
    for (const lang of ['en', 'uk', 'ru']) {
      expectServedAsIs(localePath(p, lang), `localePath(${p}, ${lang})`);
    }
  }
});

test('locale roots resolve to that locale inspector (redirect, never 404)', async () => {
  const { localeRoot } = await routes();
  expectRedirect(localeRoot('en'), '/inspector', 302);
  expectRedirect(localeRoot('uk'), '/uk/inspector');
  expectRedirect(localeRoot('ru'), '/ru/inspector');
});

test('isLocalizableRoute agrees with the server on what has a locale variant', async () => {
  const { isLocalizableRoute, localePath } = await routes();
  // Anything the client calls localizable must resolve in uk (the prefixed
  // case is the one that 404s when the client guesses wrong).
  for (const p of ['/docs', '/docs/findings', '/r/aabbccdd11', '/blog/en/welcome', '/vast']) {
    assert.equal(isLocalizableRoute(p), true, `${p} should be localizable`);
    expectServedAsIs(localePath(p, 'uk'), `localePath(${p}, uk)`);
  }
  // And anything it refuses must genuinely 404 when prefixed.
  for (const p of ['/docs/unknown', '/inspector/nope', '/not-a-section']) {
    assert.equal(isLocalizableRoute(p), false, `${p} should not be localizable`);
    expect404('/uk' + p);
  }
});

test('isLandingRoute matches server-rendered landings in every locale form', async () => {
  const { isLandingRoute } = await routes();
  assert.equal(isLandingRoute('/openrtb/2-6'), true);
  assert.equal(isLandingRoute('/uk/openrtb/2-6'), true);
  assert.equal(isLandingRoute('/ru/vast'), true);
  assert.equal(isLandingRoute('/inspector'), false);
  assert.equal(isLandingRoute('/uk/docs/findings'), false);
});
