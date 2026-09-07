/* ============================================================
   public/shell-boot.js — Stage 0 SPA shell orchestrator.

   Responsibilities:
     1. Register the section modules (lazy) with the existing
        core/registry.js.
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
// ortbtools.app.js no longer loads on /library, /blog, /docs, etc.
import { mountNav, canonicalize } from '/modules/nav/index.js';
import { mountTopbar } from '/modules/topbar/index.js';
// ROADMAP #18: session/auth + the modal host are chrome-level services, not
// Inspector-owned — installed once here, alongside nav/topbar, so they exist
// for the whole page lifecycle regardless of which section is mounted.
import { session, installSessionFacade } from '/core/session.js';
import { installModalHost } from '/core/modal-host.js';

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
  // (Legacy /stream.html + /stream are 301-redirected to /live server-side —
  // they never reach the client router. Stub sections retired at v1.0.0:
  // every nav section is a real module now.)
}

// Resource failures never replace a still-mounted editor. Recovery is an
// explicit action: refreshing can discard work, so no automatic reload runs.
function showActivationFailure(root, error) {
  if (error && error.name === 'AbortError') return;
  const lang = document.documentElement.lang || 'en';
  const messages = {
    en: [
      'This section could not load',
      'Your open work is still here. Retry the connection, or copy your work before refreshing for the latest version.',
      'Retry',
      'Refresh page',
    ],
    uk: [
      'Не вдалося завантажити розділ',
      'Твої відкриті дані залишилися тут. Спробуй підключитися ще раз або скопіюй їх перед оновленням сторінки до нової версії.',
      'Спробувати ще раз',
      'Оновити сторінку',
    ],
    ru: [
      'Не удалось загрузить раздел',
      'Твои открытые данные остались здесь. Попробуй подключиться ещё раз или скопируй их перед обновлением страницы до новой версии.',
      'Повторить',
      'Обновить страницу',
    ],
  };
  const [title, description, retryText, refreshText] = messages[lang] || messages.en;
  document.getElementById('section-load-recovery')?.remove();
  const notice = document.createElement('section');
  notice.id = 'section-load-recovery';
  notice.setAttribute('role', 'alert');
  notice.style.cssText =
    'padding:16px;margin:12px;border:1px solid var(--danger,#dc2626);border-radius:8px;';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const detail = document.createElement('p');
  detail.textContent = description;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = retryText;
  retry.addEventListener('click', () => activateFromUrl());
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = refreshText;
  refresh.addEventListener('click', () => location.reload());
  notice.append(heading, detail, retry, refresh);
  root.before(notice);
}

async function activateSection(id, root) {
  try {
    await registry.activate(id, root);
    document.getElementById('section-load-recovery')?.remove();
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    console.error('[shell-boot] section load failed:', error);
    showActivationFailure(root, error);
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

  // (ROADMAP #19, resolved) The inspector used to force a full page load when
  // SPA-navigating onto it (or /r/{hash}) while another section was mounted,
  // because mountInspector() wasn't re-entrant. mountInspector is now re-entrant
  // — every listener/timer is scoped to ctx.signal/ctx.addCleanup and the
  // globals sweep + watchdog stop run on deactivate() — so it mounts in place
  // like every other section. The reload mitigation is gone; /inspector routes
  // through registry.match() below and /r/{hash} through the hash branch.

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
    await activateSection('inspector', root);
    return;
  }

  // Blog post deep routes: /blog/{lang}/{slug} (canonicalized — locale prefix stripped)
  if (canonical.startsWith('/blog/')) {
    await activateSection('blog', root);
    return;
  }

  // Admin blog route
  if (canonical === '/admin/blog') {
    await activateSection('admin-blog', root);
    return;
  }

  const id = registry.match(canonical);

  if (!id) {
    // Unknown SPA route — show 404-ish content inline. Server should
    // have caught this and 404'd before we got here, but the SPA can
    // also reach unknown routes via pushState.
    const notFoundLang = document.documentElement.lang || 'en';
    const notFoundBodyByLang = {
      en: 'No section registered for',
      uk: 'Розділ не зареєстровано для',
      ru: 'Раздел не зарегистрирован для',
    };
    const notFoundBody = notFoundBodyByLang[notFoundLang] || notFoundBodyByLang.en;
    root.innerHTML = `
      <section style="padding:48px;text-align:center;color:var(--text-muted);">
        <h1 style="margin:0 0 8px;">404</h1>
        <p>${notFoundBody} <code>${canonical}</code>.</p>
      </section>
    `;
    return;
  }

  await activateSection(id, root);
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
  // Session/auth + modal host FIRST — nav/topbar and the (lazy) auth/unlock/
  // recovery modules all reach for window.OrtbtoolsSession / window.closeModal
  // / window.lazyOpenAuth, so these must exist before anything else mounts.
  // installSessionFacade() is synchronous (just wires the facade + the
  // window.signOut global); ensureBooted() is the actual /api/auth/me
  // request and is deliberately NOT awaited here — see boot() below.
  installSessionFacade();
  installModalHost();
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
// The registry prepares the requested locale before replacing the old mount;
// failed preparation preserves its editor and listeners.
function wireLangChange() {
  window.addEventListener('kt:lang-change', async () => {
    const current = registry.current();
    if (!current) return;
    const root = document.getElementById('app-root');
    if (!root) return;
    // The registry prepares the new locale before removing the old mount.
    // A rejected template must leave its previous inputs and listeners intact.
    await activateSection(current.id, root);
    updateSectionTitle();
  });
}

// ── Boot ─────────────────────────────────────────────────────────
async function boot() {
  // Load chrome stylesheets first so chrome renders without FOUC.
  try {
    await Promise.all([
      loadStylesheet('/modules/nav/nav.css'),
      loadStylesheet('/modules/topbar/topbar.css'),
    ]);
  } catch (e) {
    console.warn('[shell-boot] chrome CSS failed to load:', e.message);
  }

  registerSections();
  mountChrome();
  interceptClicks();
  wireLangChange();
  // Kick off the canonical session boot (one shared /api/auth/me — topbar's
  // own updateAuthArea() and Inspector's mount both call ensureBooted() too
  // and share this SAME in-flight promise, per the module's dedup contract).
  // Deliberately NOT awaited: a slow or unreachable auth endpoint must never
  // block the initial section from mounting. ensureBooted() already resolves
  // to an anonymous state on any failure, so this can't reject.
  session.ensureBooted();
  await activateFromUrl();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// Expose for debugging / lang-switch interop.
window.OrtbtoolsShell = { navigateTo, activateFromUrl };
