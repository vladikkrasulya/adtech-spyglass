/* ============================================================
   public/core/routes.js — canonical locale-aware route builder (ES module).

   ONE place that knows how a URL is spelled in each locale. Before this
   file existed, `localePrefix()` was copy-pasted verbatim into six
   modules (nav, blog, dialects, library, behavior, docs), search inlined
   the same expression, lang-switch carried its own `localizePath()` with
   a hardcoded single-segment allowlist, and stream hardcoded
   `'/' + lang + '/r/' + hash`. Eight independent spellings of the same
   rule drifted apart, and four user-visible defects fell out of the drift:

     F-08  docs breadcrumb rendered `${lp || '/'}/docs` — for en, lp is ''
           so the fallback produced `//docs`, a protocol-relative URL that
           the browser resolves to https://docs/ and fails to look up.
     F-09  the language switch mapped only single-segment paths and read
           only location.pathname, so /docs/findings, /r/<hash> and blog
           articles all collapsed to the bare locale root and ?query#hash
           were dropped on the floor.
     F-12  stream built /en/r/<hash>, which the server does not route at
           all (there is no /en/r/ — en is the no-prefix canonical locale),
           so both the permalink and "Open in Inspector" 404'd for EN users.
     F-15  blog cards built /blog/<postLang>/<slug> with no UI-locale
           prefix, so from /uk/blog the card pointed at a route the SPA
           router does not match.

   The route shapes below MIRROR lib/locale-routes.js (server side). That
   file is the truth; this one is the client's copy of the same rules so a
   link we render is a link the server will actually serve. Keep them in
   sync — tests/locale-routes.test.js asserts the two agree by feeding
   every URL this module builds back through resolveLocaleRoute().

   Deliberately dependency-free and DOM-free: any module can import it,
   and Node can unit-test it without jsdom.
   ============================================================ */
'use strict';

/* en is the CANONICAL NO-PREFIX locale. /inspector is the English route;
   /en/inspector only exists as a legacy single-segment 301 and /en/r/<hash>
   does not exist at all. Everything here treats '' as en's prefix — never
   '/en' — which is what F-12 got wrong. */
export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['en', 'uk', 'ru'];

/* Locales that actually carry a URL prefix. Kept separate from LOCALES so
   the "en has no prefix" asymmetry is stated once, not re-derived. */
const PREFIXED_LOCALES = new Set(['uk', 'ru']);

/* Mirrors SPA_SECTIONS in lib/locale-routes.js. */
const SPA_SECTIONS = new Set([
  'inspector',
  'live',
  'behavior',
  'library',
  'dialects',
  'blog',
  'docs',
  'insights',
]);

/* Mirrors SPA_SUBROUTES in lib/locale-routes.js — an explicit allowlist,
   because /<section>/<sub> outside it is a real server 404, not a shell.
   Today: docs → findings only. */
const SPA_SUBROUTES = { docs: new Set(['findings']) };

/* Programmatic-SEO landings. Server-rendered bodies, but they DO have a
   per-locale URL (/uk/openrtb/2-6 is a real 200), so a lang switch must
   build the localized landing rather than bail to the locale root. */
const LANDING_ROUTES = new Set([
  '/openrtb/2-6',
  '/openrtb/2-5',
  '/openrtb/3-0',
  '/vast',
  '/native',
  '/iab-categories',
]);

/* Static per-locale HTML pages outside the SPA shell (about.uk.html …). */
const STATIC_PAGES = new Set(['/about', '/account']);

/* Routes that exist ONLY unprefixed. /admin/blog is served from the en
   shell by design and /uk/admin/blog is a 404 — so localizing it means
   leaving it exactly where it is. Pre-fix, lang-switch sent it to /uk,
   which the SPA router answered with "No section registered for /." */
const UNPREFIXED_ROUTES = new Set(['/admin/blog']);

/* /r/<hash> specimen permalinks. Hash grammar copied from the server
   matcher so we never mint a link the server would reject. */
const SPECIMEN_RE = /^\/r\/([0-9a-f]{8,12})$/i;

/* Blog deep routes: /blog/<postLang>/<slug>. postLang is independent of
   the UI locale on purpose — /uk/blog/ru/<slug> is a valid cross-locale
   article and must stay valid through a lang switch. */
const BLOG_POST_RE = /^\/blog\/(en|uk|ru)\/([a-z0-9][a-z0-9-]{0,120})$/i;

const SECTION_RE = /^\/([a-z][a-z0-9-]*)$/;
const SECTION_SUB_RE = /^\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/;

/* Any unrecognised locale (missing, 'EN', 'de', undefined) resolves to the
   default rather than becoming a bogus '/de' prefix. */
export function normalizeLocale(lang) {
  const l = String(lang || '').toLowerCase();
  return LOCALES.includes(l) ? l : DEFAULT_LOCALE;
}

/* The URL prefix for a locale: '' for en, '/uk', '/ru'.
   NEVER combine this with `|| '/'` — `'' || '/'` is '/', and '/' + '/docs'
   is the protocol-relative '//docs' that caused F-08. Use localePath()
   instead, which handles the empty-prefix case correctly. */
export function localePrefix(lang) {
  const l = normalizeLocale(lang);
  return PREFIXED_LOCALES.has(l) ? '/' + l : '';
}

/* The locale's home URL: '/' for en, '/uk', '/ru'. Both server-redirect to
   that locale's inspector. */
export function localeRoot(lang) {
  return localePrefix(lang) || '/';
}

/* Split a pathname into its locale and its canonical (locale-free) path.

     /uk/docs/findings → { lang: 'uk', path: '/docs/findings' }
     /inspector        → { lang: 'en', path: '/inspector' }
     /uk               → { lang: 'uk', path: '/' }
     /ukraine          → { lang: 'en', path: '/ukraine' }   ← boundary check

   The boundary check matters: a naive startsWith('/uk') would eat the
   first three characters of any path that merely begins with those
   letters. Trailing slashes are dropped because the server 301s them
   away anyway (canonicalPath() in lib/locale-routes.js). */
export function stripLocale(pathname) {
  let p = String(pathname == null ? '/' : pathname);
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+$/, '') || '/';
  const m = p.match(/^\/(uk|ru)(?=\/|$)/);
  if (!m) return { lang: DEFAULT_LOCALE, path: p };
  return { lang: m[1], path: p.slice(m[0].length) || '/' };
}

/* Is there a real URL for this canonical path in every locale?

   Used by relocalize() to decide between "translate the URL" and "give up
   and go to the locale root". Pre-fix, lang-switch answered this with a
   hardcoded list of single-segment paths, so EVERY two-segment route —
   docs subroutes, specimen permalinks, blog articles — answered "no" and
   the user lost their page. */
export function isLocalizableRoute(path) {
  const { path: canonical } = stripLocale(path);
  if (canonical === '/') return true;
  if (STATIC_PAGES.has(canonical)) return true;
  if (LANDING_ROUTES.has(canonical)) return true;
  if (UNPREFIXED_ROUTES.has(canonical)) return true;
  if (SPECIMEN_RE.test(canonical)) return true;
  if (BLOG_POST_RE.test(canonical)) return true;
  const section = canonical.match(SECTION_RE);
  if (section && SPA_SECTIONS.has(section[1])) return true;
  const sub = canonical.match(SECTION_SUB_RE);
  if (sub && SPA_SECTIONS.has(sub[1])) {
    const allowed = SPA_SUBROUTES[sub[1]];
    return !!(allowed && allowed.has(sub[2]));
  }
  return false;
}

/* True when `path` (in any locale form) is a programmatic-SEO landing.
   Those are server-rendered only — an in-place SPA swap blanks them — so
   callers hard-navigate instead of routing client-side. */
export function isLandingRoute(path) {
  return LANDING_ROUTES.has(stripLocale(path).path);
}

/* THE primitive: build the locale-prefixed URL for a path.

   Accepts an already-prefixed path and re-prefixes it, so it is idempotent
   and safe to call on location.pathname:
     localePath('/docs', 'uk')      → '/uk/docs'
     localePath('/uk/docs', 'ru')   → '/ru/docs'
     localePath('/docs', 'en')      → '/docs'      (not '//docs', F-08)
     localePath('/', 'uk')          → '/uk'        (not '/uk/')
     localePath('/admin/blog', 'uk')→ '/admin/blog' (no /uk variant exists)

   Query and hash do NOT belong here — pass a bare path. relocalize()
   is the entry point that carries them. */
export function localePath(path, lang) {
  const { path: canonical } = stripLocale(path);
  if (UNPREFIXED_ROUTES.has(canonical)) return canonical;
  const prefix = localePrefix(lang);
  if (canonical === '/') return prefix || '/';
  return prefix + canonical;
}

/* /r/<hash> specimen permalink in the given locale.
   en → /r/<hash>. There is NO /en/r/<hash> route on the server (F-12). */
export function specimenPath(hash, lang) {
  return localePath('/r/' + String(hash), lang);
}

/* /blog/<postLang>/<slug> under the UI locale's prefix.
   postLang is the ARTICLE's language and is independent of the UI locale;
   dropping the UI prefix (F-15) produced a card href the SPA router never
   matched, and following it directly reset the shell to EN. */
export function blogPostPath(postLang, slug, lang) {
  const pl = normalizeLocale(postLang);
  return localePath('/blog/' + pl + '/' + encodeURIComponent(String(slug)), lang);
}

/* Split a string path or a Location-like object into its three parts.
   Accepting both means callers can hand us `location` directly (which is
   how the search/hash used to get dropped — the old code read only
   location.pathname and forgot the rest existed). */
function urlParts(input) {
  if (input && typeof input === 'object') {
    return {
      pathname: String(input.pathname || '/'),
      search: String(input.search || ''),
      hash: String(input.hash || ''),
    };
  }
  const raw = String(input == null ? '/' : input);
  const hashAt = raw.indexOf('#');
  const hash = hashAt === -1 ? '' : raw.slice(hashAt);
  const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const search = queryAt === -1 ? '' : beforeHash.slice(queryAt);
  const pathname = (queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)) || '/';
  return { pathname, search, hash };
}

/* Re-localize a WHOLE current URL — path, query and fragment — into
   another locale. This is what a language switch actually needs.

     /docs/findings           + uk → /uk/docs/findings
     /r/aabbccdd11            + uk → /uk/r/aabbccdd11
     /blog/en/some-post       + uk → /uk/blog/en/some-post
     /inspector?sample=x#tab  + uk → /uk/inspector?sample=x#tab
     /uk/account#security     + en → /account#security
     /admin/blog              + uk → /admin/blog

   Search and hash ride along because they are page state the user chose:
   pre-fix, /inspector?sample=x&dialect=y lost both params and
   /ru/account#security lost the fragment on every lang switch.

   Only a genuinely untranslatable path falls back to the locale root, and
   that fallback deliberately drops search/hash — they described a page the
   user is no longer on, so carrying them forward would be misleading. */
export function relocalize(input, lang) {
  const { pathname, search, hash } = urlParts(input);
  if (!isLocalizableRoute(pathname)) return localeRoot(lang);
  return localePath(pathname, lang) + search + hash;
}
