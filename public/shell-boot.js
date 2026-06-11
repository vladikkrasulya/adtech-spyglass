/* ============================================================
   public/shell-boot.js — Stage 0 SPA shell orchestrator.

   Responsibilities:
     1. Register inspector + 6 stub section modules with the
        existing core/registry.js.
     2. Mount nav (sidebar) and topbar chrome — once, outside the
        section lifecycle.
     3. Intercept clicks on internal <a> tags: pushState + activate
        matching section module instead of full navigation.
     4. Listen for popstate (back/forward) and re-activate the
        right module.
     5. On initial page load, read location.pathname and activate
        the matching module into <main id="app-root">.

   Locale handling:
     - Each per-locale shell file (index.{en,uk,ru}.html) declares
       <html lang="..."> in <head>. Boot reads this; nav/topbar
       use it for label localisation; router strips /uk or /ru
       prefix before calling registry.match() (which only knows
       canonical EN routes).
   ============================================================ */
'use strict';

import * as registry from '/core/registry.js';
// Section modules are NOT imported statically — they are lazy-loaded on first
// activation via registry.registerLazy() in registerSections(). This keeps the
// boot payload to chrome + the one active section; the inspector's ~65 KB gz
// spyglass.app.js no longer loads on /library, /blog, /docs, etc.
import { createStubModule } from '/modules/stub/index.js';
import { mountNav, canonicalize } from '/modules/nav/index.js';
import { mountTopbar } from '/modules/topbar/index.js';

// ── Stub section content (one-paragraph "what will be here" copy) ──
// Locked to ROADMAP.md stage descriptions. Keep these short — the user
// should immediately see WHAT and WHEN, not read a novel.
const STUB_SECTIONS = [];

// ── Initial dependency loading ───────────────────────────────────
async function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.addEventListener('load', () => resolve(link), { once: true });
    link.addEventListener('error', () => reject(new Error('failed to load ' + href)), {
      once: true,
    });
    document.head.appendChild(link);
  });
}

// ── Module registration ──────────────────────────────────────────
function registerSections() {
  // Lazy section registration: route → id + an import() loader. The module
  // (and its transitive imports) is fetched only when the section is first
  // activated. Routes mirror each module's own `route` field exactly.
  registry.registerLazy('inspector', '/inspector', () => import('/modules/inspector/index.js'));
  registry.registerLazy('library', '/library', () => import('/modules/library/index.js'));
  registry.registerLazy('docs', '/docs', () => import('/modules/docs/index.js'));
  registry.registerLazy('dialects', '/dialects', () => import('/modules/dialects/index.js'));
  registry.registerLazy('stream', '/live', () => import('/modules/stream/index.js'));
  registry.registerLazy('blog', '/blog', () => import('/modules/blog/index.js'));
  registry.registerLazy('admin-blog', '/admin/blog', () => import('/modules/admin-blog/index.js'));
  registry.registerLazy('behavior', '/behavior', () => import('/modules/behavior/index.js'));
  registry.registerLazy('insights', '/insights', () => import('/modules/insights/index.js'));

  // Programmatic-SEO landings — one lightweight module, server-rendered body.
  // It leaves the SSR #app-root content in place; additional landing routes are
  // added via registerRoute() below as they ship.
  registry.registerLazy('landing', '/openrtb/2-6', () => import('/modules/landing/index.js'));
  registry.registerRoute('/openrtb/2-5', 'landing');
  registry.registerRoute('/openrtb/3-0', 'landing');
  registry.registerRoute('/vast', 'landing');
  registry.registerRoute('/native', 'landing');
  registry.registerRoute('/iab-categories', 'landing');

  // Additional routes pointing at already-registered module ids.
  registry.registerRoute('/docs/findings', 'docs');
  // Legacy /stream.html URL alias → keep existing share-links working.
  registry.registerRoute('/stream.html', 'stream');

  // Stub sections (yet to be built — see ROADMAP).
  for (const cfg of STUB_SECTIONS) {
    registry.register(createStubModule(cfg));
  }
}

// ── Activation by URL ────────────────────────────────────────────
async function activateFromUrl() {
  const root = document.getElementById('app-root');
  if (!root) {
    console.error('[shell-boot] #app-root not found');
    return;
  }

  // Canonical route strips /uk or /ru locale prefix.
  const canonical = canonicalize(location.pathname);

  // Inspector's legacy mount (mountInspector in spyglass.app.js) is NOT
  // re-entrant — its classic scripts boot once per page. SPA-remounting it
  // from another section (e.g. Live → Inspector, or back/forward onto it)
  // leaves a corrupted layout and can freeze the renderer. So: if a section
  // is already mounted and we're navigating to the inspector, do a full page
  // load — it always boots cleanly that way. Initial boot (no active section
  // yet) still mounts via SPA, which is the normal, working first-load path.
  const goesToInspector = canonical === '/inspector' || /^\/r\/[0-9a-f]{8,12}$/i.test(canonical);
  if (goesToInspector && registry.current()) {
    location.assign(location.href);
    return;
  }

  // Landings are server-rendered content pages — their body lives only in the
  // SSR HTML, so never SPA-remount them. On client-nav onto a landing, hard-load
  // so the server renders it fresh. First load (no active section yet) proceeds
  // to activate('landing'), whose mount() leaves the SSR content untouched.
  if (registry.match(canonical) === 'landing' && registry.current()) {
    location.assign(location.href);
    return;
  }

  // /r/:hash specimen permalink — route to inspector with pending hash hint.
  const hashMatch = canonical.match(/^\/r\/([0-9a-f]{8,12})$/i);
  if (hashMatch) {
    window.__pendingSpecimenHash = hashMatch[1];
    try {
      await registry.activate('inspector', root);
    } catch (err) {
      console.error('[shell-boot] /r/:hash activate failed:', err);
    }
    return;
  }

  // Blog post deep routes: /blog/{lang}/{slug} (canonicalized — locale prefix stripped)
  if (canonical.startsWith('/blog/')) {
    try {
      await registry.activate('blog', root);
    } catch (err) {
      console.error('[shell-boot] blog post activate failed:', err);
    }
    return;
  }

  // Admin blog route
  if (canonical === '/admin/blog') {
    try {
      await registry.activate('admin-blog', root);
    } catch (err) {
      console.error('[shell-boot] admin-blog activate failed:', err);
    }
    return;
  }

  const id = registry.match(canonical);

  if (!id) {
    // Unknown SPA route — show 404-ish content inline. Server should
    // have caught this and 404'd before we got here, but the SPA can
    // also reach unknown routes via pushState.
    root.innerHTML = `
      <section style="padding:48px;text-align:center;color:var(--text-muted);">
        <h1 style="margin:0 0 8px;">404</h1>
        <p>No section registered for <code>${canonical}</code>.</p>
      </section>
    `;
    return;
  }

  try {
    await registry.activate(id, root);
  } catch (err) {
    console.error('[shell-boot] activate failed:', err);
    root.innerHTML = `
      <section style="padding:48px;text-align:center;color:var(--danger,#dc2626);">
        <h1 style="margin:0 0 8px;">Module activation failed</h1>
        <p>${err.message}</p>
      </section>
    `;
  }
}

// ── Section title ────────────────────────────────────────────────
// Reflect the active section in document.title from its manifest, in the
// active locale. Used after SPA navigation + lang-change. Initial page load
// deliberately keeps the server-rendered (more descriptive) <title> — this
// only runs on client-side section swaps, which otherwise leave the previous
// section's title stuck in the tab (e.g. "OpenRTB Inspector" on /library).
function updateSectionTitle() {
  const cur = registry.current();
  if (!cur) return;
  const mod = registry.get(cur.id);
  const tmap = mod && mod.manifest && mod.manifest.title;
  if (!tmap) return;
  const lang = document.documentElement.lang || 'en';
  const title = tmap[lang] || tmap.en;
  if (title) document.title = title + ' | ortbtools';
}

// ── pushState navigation ─────────────────────────────────────────
async function navigateTo(path) {
  if (path === location.pathname + location.search) return;
  history.pushState({ path }, '', path);
  window.dispatchEvent(new CustomEvent('kt:pushstate', { detail: { path } }));
  await activateFromUrl();
  updateSectionTitle();
}

function isInternalLink(a) {
  if (!a || !a.href) return false;
  // Skip explicit external links.
  if (a.hasAttribute('download')) return false;
  if (a.target && a.target !== '' && a.target !== '_self') return false;
  if (a.hasAttribute('data-external')) return false;
  // Skip lang-menu links — lang-switch.js owns these and calls switchLang()
  // which handles locale updates, cookie, sessionStorage snapshot, and
  // kt:lang-change dispatch. Letting interceptClicks capture them would
  // bypass all of that and land on a bare navigateTo(/) with no lang update.
  if (a.closest('.kt-lang-menu-list')) return false;
  // Require same origin and same protocol.
  let url;
  try {
    url = new URL(a.href, location.href);
  } catch {
    return false;
  }
  if (url.origin !== location.origin) return false;
  // Skip /api/, file downloads, mailto, etc.
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.includes('.')) return false; // crude: real assets have extensions
  // Skip SSR landings that aren't SPA sections.
  const SSR_PATHS = new Set([
    '/stream',
    '/about',
    '/account',
    '/uk/about',
    '/uk/account',
    '/ru/about',
    '/ru/account',
  ]);
  if (SSR_PATHS.has(url.pathname)) return false;
  return true;
}

function interceptClicks() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return; // left-click only
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // modifier → let browser handle
    const a = e.target.closest('a');
    if (!isInternalLink(a)) return;
    e.preventDefault();
    const url = new URL(a.href, location.href);
    navigateTo(url.pathname + url.search);
  });

  window.addEventListener('popstate', async () => {
    await activateFromUrl();
    updateSectionTitle();
  });
}

// ── Chrome mounting (nav + topbar) ───────────────────────────────
function mountChrome() {
  const shellRoot = document.querySelector('.kt-shell');
  if (!shellRoot) {
    console.error('[shell-boot] .kt-shell root not found');
    return;
  }
  const navRoot = document.getElementById('kt-nav-root');
  const topbarRoot = document.getElementById('kt-topbar-root');
  if (navRoot) mountNav(navRoot);
  if (topbarRoot) mountTopbar(topbarRoot, shellRoot);
  // Signal classic scripts (lang-switch.js) that the chrome DOM is ready.
  // lang-switch.js bindLangLinks() needs the .kt-lang-menu-list elements
  // that topbar injects — DOMContentLoaded fires too early for this.
  window.dispatchEvent(new CustomEvent('kt:chrome-ready'));
}

// ── Lang-change: re-activate the current section ─────────────────
// When lang-switch.js fires kt:lang-change in SPA mode, the nav and
// topbar re-render themselves (they have their own kt:lang-change
// listeners). The currently-active section module also needs to be
// re-mounted so its localised copy (sidebar group labels, empty-state
// strings, section-specific placeholders) reflects the new locale.
// We deactivate the current section and re-activate it into the same
// root — registry.activate() tears down the old mount first.
function wireLangChange() {
  window.addEventListener('kt:lang-change', async () => {
    const id = registry.current();
    if (!id) return; // no section active — nothing to re-mount
    const root = document.getElementById('app-root');
    if (!root) return;
    try {
      // Deactivate (registry unmounts the section, clears root.innerHTML).
      await registry.deactivate();
      // Re-activate the same section — it reads the now-updated
      // document.documentElement.lang so all ctx.lang-derived strings
      // are in the new locale.
      await registry.activate(id, root);
      // Title follows the new locale too (e.g. Library → Бібліотека).
      updateSectionTitle();
    } catch (err) {
      console.warn('[shell-boot] kt:lang-change section remount failed:', err);
      // Best-effort fallback: re-activate from URL so the shell
      // doesn't get stuck on a blank #app-root.
      try {
        await activateFromUrl();
      } catch (_) {
        /* ignore */
      }
    }
  });
}

// ── Boot ─────────────────────────────────────────────────────────
async function boot() {
  // Load chrome stylesheets first so chrome renders without FOUC.
  try {
    await Promise.all([
      loadStylesheet('/modules/nav/nav.css'),
      loadStylesheet('/modules/topbar/topbar.css'),
      loadStylesheet('/modules/stub/stub.css'),
    ]);
  } catch (e) {
    console.warn('[shell-boot] chrome CSS failed to load:', e.message);
  }

  registerSections();
  mountChrome();
  interceptClicks();
  wireLangChange();
  await activateFromUrl();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// Expose for debugging / lang-switch interop.
window.SpyglassShell = { navigateTo, activateFromUrl };
