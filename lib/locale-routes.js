'use strict';

/**
 * lib/locale-routes.js — SPA locale + section route resolution (pure, no I/O).
 *
 * server.js calls resolveLocaleRoute() for static HTML shells. Extracted here so
 * canonical redirects, incomplete blog paths, and the SPA sub-route allowlist
 * are unit-testable without booting the HTTP server.
 */

const landings = require('./landings');

// Stage 0 multi-section site: all SPA sections share one per-locale shell HTML.
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

// Explicit allowlist of registered SPA sub-routes (section → sub segments).
// Mirrors public/modules mount() pathname checks — only listed paths get a
// shell for /<section>/<sub>. Today: docs → findings only.
const SPA_SUBROUTES = {
  docs: new Set(['findings']),
};

const BLOG_POST_LANG = 'en|uk|ru';
const BLOG_SLUG = '[a-z0-9][a-z0-9-]{0,120}';

/** Lowercase + strip trailing slashes in one step. Root `/` is unchanged. */
function canonicalPath(pathOnly) {
  if (!pathOnly || pathOnly === '/') return '/';
  return pathOnly.replace(/\/+$/, '').toLowerCase();
}

function incompleteBlogRedirect(path) {
  if (/^\/blog\/(en|uk|ru)$/i.test(path)) return '/blog';
  if (/^\/uk\/blog\/(en|uk|ru)$/i.test(path)) return '/uk/blog';
  if (/^\/ru\/blog\/(en|uk|ru)$/i.test(path)) return '/ru/blog';
  return null;
}

function resolveLocaleRoute(reqUrl) {
  const rawPath = (reqUrl || '').split('?')[0] || '/';
  const normalized = canonicalPath(rawPath);
  const blogRedirect = incompleteBlogRedirect(normalized);
  const pathRedirect = blogRedirect || (normalized !== rawPath ? normalized : null);
  if (pathRedirect) {
    return { redirect: pathRedirect };
  }

  // Existing downstream logic treats '' as root (302 → /inspector).
  const u = normalized === '/' ? '' : normalized;

  // Canonical redirects default to 301 (permanent) in the handler below.
  // Exception: / and /index.html return status:302 (temporary) on purpose —
  // / stays free for a future marketing/dashboard landing, and a 301 here
  // would get cached by browsers and pin returning visitors to /inspector
  // even after that landing ships (ROADMAP Decisions log, 2026-05-23).
  if (u === '' || u === '/index.html') {
    return { redirect: '/inspector', status: 302 };
  }

  // Locale roots redirect to the locale's inspector. /uk → /uk/inspector etc.
  if (u === '/en') return { redirect: '/inspector' };
  if (u === '/uk') return { redirect: '/uk/inspector' };
  if (u === '/ru') return { redirect: '/ru/inspector' };

  // SPA sections (en) — all share index.en.html, client router picks module
  const enMatch = u.match(/^\/([a-z][a-z0-9-]*)$/);
  if (enMatch && SPA_SECTIONS.has(enMatch[1])) return { file: '/index.en.html' };

  // SPA sections (uk) — all share index.uk.html
  const ukMatch = u.match(/^\/uk\/([a-z][a-z0-9-]*)$/);
  if (ukMatch && SPA_SECTIONS.has(ukMatch[1])) return { file: '/index.uk.html' };

  // SPA sections (ru) — all share index.ru.html
  const ruMatch = u.match(/^\/ru\/([a-z][a-z0-9-]*)$/);
  if (ruMatch && SPA_SECTIONS.has(ruMatch[1])) return { file: '/index.ru.html' };

  // Incomplete blog paths — /blog/{lang} without a slug (handled above via
  // incompleteBlogRedirect() so /blog/EN/ canonicalizes to /blog in one hop).

  // Blog deep routes: /blog/<lang>/<slug>. postLang is en|uk|ru regardless of
  // UI locale — cross-locale posts (/uk/blog/ru/<slug>) stay valid.
  const blogDeep = u.match(new RegExp(`^\\/blog\\/(${BLOG_POST_LANG})\\/(${BLOG_SLUG})$`, 'i'));
  if (blogDeep) return { file: '/index.en.html' };
  const ukBlogDeep = u.match(
    new RegExp(`^\\/uk\\/blog\\/(${BLOG_POST_LANG})\\/(${BLOG_SLUG})$`, 'i'),
  );
  if (ukBlogDeep) return { file: '/index.uk.html' };
  const ruBlogDeep = u.match(
    new RegExp(`^\\/ru\\/blog\\/(${BLOG_POST_LANG})\\/(${BLOG_SLUG})$`, 'i'),
  );
  if (ruBlogDeep) return { file: '/index.ru.html' };

  // SPA sub-routes — explicit allowlist only (e.g. /docs/findings). Unknown
  // /<section>/<sub> paths fall through to a real 404 — no client-side noindex.
  const enSub = u.match(/^\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/);
  if (enSub && SPA_SECTIONS.has(enSub[1])) {
    const allowed = SPA_SUBROUTES[enSub[1]];
    if (allowed && allowed.has(enSub[2])) return { file: '/index.en.html' };
    return null;
  }
  const ukSub = u.match(/^\/uk\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/);
  if (ukSub && SPA_SECTIONS.has(ukSub[1])) {
    const allowed = SPA_SUBROUTES[ukSub[1]];
    if (allowed && allowed.has(ukSub[2])) return { file: '/index.uk.html' };
    return null;
  }
  const ruSub = u.match(/^\/ru\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/);
  if (ruSub && SPA_SECTIONS.has(ruSub[1])) {
    const allowed = SPA_SUBROUTES[ruSub[1]];
    if (allowed && allowed.has(ruSub[2])) return { file: '/index.ru.html' };
    return null;
  }

  // Admin blog: /admin/blog → serve en shell (no locale prefix for admin)
  if (u === '/admin/blog') return { file: '/index.en.html' };

  // Legacy /en/<section> → drop /en prefix (en is canonical no-prefix locale)
  if (enMatch === null) {
    const enLegacy = u.match(/^\/en\/([a-z][a-z0-9-]*)$/);
    if (enLegacy && SPA_SECTIONS.has(enLegacy[1])) {
      return { redirect: '/' + enLegacy[1] };
    }
  }

  // /r/:hash specimen permalink — serve SPA shell (inspector hydrates from hash).
  const enHash = u.match(/^\/r\/([0-9a-f]{8,12})$/i);
  if (enHash) return { file: '/index.en.html' };
  const ukHash = u.match(/^\/uk\/r\/([0-9a-f]{8,12})$/i);
  if (ukHash) return { file: '/index.uk.html' };
  const ruHash = u.match(/^\/ru\/r\/([0-9a-f]{8,12})$/i);
  if (ruHash) return { file: '/index.ru.html' };

  // Legacy standalone stream page retired (Decision A 2026-06-11): /live is
  // the only stream surface. 301 keeps old share-links working.
  if (u === '/stream') return { redirect: '/live' };
  if (u === '/stream.html') return { redirect: '/live' };
  if (u === '/playground' || u === '/playground.html') return { redirect: '/inspector' };
  if (u === '/app/dialects') return { redirect: '/dialects' };
  if (u === '/about') return { file: '/about.en.html' };
  if (u === '/about.html') return { redirect: '/about' };
  if (u === '/account') return { file: '/account.en.html' };
  if (u === '/account.html') return { redirect: '/account' };
  if (u === '/en/about') return { redirect: '/about' };
  if (u === '/en/account') return { redirect: '/account' };
  if (u === '/uk/about') return { file: '/about.uk.html' };
  if (u === '/uk/account') return { file: '/account.uk.html' };
  if (u === '/ru/about') return { file: '/about.ru.html' };
  if (u === '/ru/account') return { file: '/account.ru.html' };

  // Programmatic-SEO landing pages (/openrtb/2-6, /vast, /native, …).
  if (landings.isLanding(u)) return { file: '/index.en.html' };
  const ukLanding = u.match(/^\/uk(\/.+)$/);
  if (ukLanding && landings.isLanding(ukLanding[1])) return { file: '/index.uk.html' };
  const ruLanding = u.match(/^\/ru(\/.+)$/);
  if (ruLanding && landings.isLanding(ruLanding[1])) return { file: '/index.ru.html' };
  return null;
}

module.exports = {
  resolveLocaleRoute,
  canonicalPath,
  incompleteBlogRedirect,
  SPA_SECTIONS,
  SPA_SUBROUTES,
};
