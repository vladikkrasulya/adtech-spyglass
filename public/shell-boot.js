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
import inspectorModule from '/modules/inspector/index.js';
import libraryModule from '/modules/library/index.js';
import docsModule from '/modules/docs/index.js';
import dialectsModule from '/modules/dialects/index.js';
import { createStubModule } from '/modules/stub/index.js';
import { mountNav, canonicalize } from '/modules/nav/index.js';
import { mountTopbar } from '/modules/topbar/index.js';

// ── Stub section content (one-paragraph "what will be here" copy) ──
// Locked to ROADMAP.md stage descriptions. Keep these short — the user
// should immediately see WHAT and WHEN, not read a novel.
const STUB_SECTIONS = [
  {
    id: 'live',
    route: '/live',
    icon: '📡',
    stage: 2,
    title: { en: 'Live RTB feed', uk: 'Live RTB-стрім', ru: 'Live RTB-стрим' },
    copy: {
      en: 'Synthetic OpenRTB specimens streamed at 60–120 req/min. Filter by format and version, click any specimen to inspect.',
      uk: 'Синтетичні OpenRTB-зразки потоком 60–120 запитів/хв. Фільтри за форматом і версією, клік на будь-який — відкрити в інспекторі.',
      ru: 'Синтетические OpenRTB-образцы потоком 60–120 запросов/мин. Фильтры по формату и версии, клик на любой — открыть в инспекторе.',
    },
  },
  {
    id: 'behavior',
    route: '/behavior',
    icon: '🧪',
    stage: 4,
    title: { en: 'Behavior corpus', uk: 'Behavior-корпус', ru: 'Behavior-корпус' },
    copy: {
      en: 'Labelling tool for the behavior probe capture pipeline. Tag false positives and negatives per pattern; weekly confusion matrix export.',
      uk: 'Інструмент для розмітки зразків з behavior-пробера. Тегаєш false positive/negative по кожному паттерну, щотижневий confusion matrix експорт.',
      ru: 'Инструмент для разметки образцов из behavior-пробера. Тегаешь false positive/negative по каждому паттерну, еженедельный confusion matrix экспорт.',
    },
  },
  {
    id: 'blog',
    route: '/blog',
    icon: '📰',
    stage: 3,
    title: { en: 'Blog', uk: 'Блог', ru: 'Блог' },
    copy: {
      en: 'Editorial posts on OpenRTB internals plus curated news from the firehose. Three categories: news, deep-dives, guides.',
      uk: 'Редакційні пости про внутрішню кухню OpenRTB плюс curated-новини з firehose. Три категорії: новини, розбори, гайди.',
      ru: 'Редакционные посты о внутренней кухне OpenRTB плюс curated-новости из firehose. Три категории: новости, разборы, гайды.',
    },
  },

];

// ── Initial dependency loading ───────────────────────────────────
async function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.addEventListener('load', () => resolve(link), { once: true });
    link.addEventListener('error', () => reject(new Error('failed to load ' + href)), { once: true });
    document.head.appendChild(link);
  });
}

// ── Module registration ──────────────────────────────────────────
function registerSections() {
  // Real modules (built across stages).
  registry.register(inspectorModule);
  registry.register(libraryModule);
  registry.register(docsModule);
  registry.register(dialectsModule);
  // Register /docs/findings as an additional route pointing to the same 'docs' module id.
  // registry.register() already mapped /docs → 'docs'; we add /docs/findings here.
  registry.registerRoute('/docs/findings', 'docs');

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

// ── pushState navigation ─────────────────────────────────────────
function navigateTo(path) {
  if (path === location.pathname + location.search) return;
  history.pushState({ path }, '', path);
  window.dispatchEvent(new CustomEvent('kt:pushstate', { detail: { path } }));
  activateFromUrl();
}

function isInternalLink(a) {
  if (!a || !a.href) return false;
  // Skip explicit external links.
  if (a.hasAttribute('download')) return false;
  if (a.target && a.target !== '' && a.target !== '_self') return false;
  if (a.hasAttribute('data-external')) return false;
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
  const SSR_PATHS = new Set(['/stream', '/about', '/account', '/uk/about', '/uk/account', '/ru/about', '/ru/account']);
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

  window.addEventListener('popstate', () => {
    activateFromUrl();
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
  await activateFromUrl();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// Expose for debugging / lang-switch interop.
window.SpyglassShell = { navigateTo, activateFromUrl };
