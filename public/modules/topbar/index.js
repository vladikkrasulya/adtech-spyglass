/* ============================================================
   public/modules/topbar/index.js — thin global topbar.

   Stage 0 chrome (ROADMAP.md). Lives outside the section
   registry; mounted once at boot into <header id="kt-topbar-root">.

   Slots, left to right:
     - hamburger (visible only below 1024px, toggles sidebar drawer)
     - compact brand (visible only below 1024px — full brand lives
       inside the sidebar at desktop widths)
     - global search input (disabled in Stage 0; real search Stage 5+)
     - language picker container (the legacy /lang-switch.js script
       injects its own button + menu into .kt-lang-slot; we just
       provide the slot)
     - theme toggle container (legacy /design-system.css IIFE
       injects .kt-theme-toggle into <body> — we hide that and
       re-anchor it into the topbar in Stage 1; for Stage 0 the
       legacy floating button keeps working as-is)
     - profile avatar (placeholder; real auth surface Stage 1)
   ============================================================ */
'use strict';

function lang() {
  return document.documentElement.getAttribute('lang') || 'en';
}

function pick(map) {
  const l = lang();
  return map[l] || map.en || '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTopbar() {
  const searchPlaceholder = pick({
    en: '🔎 search — coming soon',
    uk: '🔎 пошук — скоро',
    ru: '🔎 поиск — скоро',
  });
  const navToggleLabel = pick({
    en: 'Toggle navigation',
    uk: 'Меню',
    ru: 'Меню',
  });
  const accountLabel = pick({
    en: 'Account',
    uk: 'Кабінет',
    ru: 'Кабинет',
  });

  return `
    <button type="button" class="kt-topbar__nav-toggle" data-action="toggle-nav" aria-label="${escapeHtml(navToggleLabel)}">
      <span aria-hidden="true">☰</span>
    </button>
    <a class="kt-topbar__brand-mini" href="/inspector" data-internal>
      <span class="kt-topbar__brand-icon" aria-hidden="true">◆</span>
      <span class="kt-topbar__brand-text">ortbtools</span>
    </a>
    <div class="kt-topbar__search">
      <input
        type="text"
        class="kt-topbar__search-input"
        placeholder="${escapeHtml(searchPlaceholder)}"
        disabled
        aria-disabled="true"
      />
    </div>
    <div class="kt-topbar__actions">
      <div class="kt-topbar__slot kt-lang-slot"></div>
      <div class="kt-topbar__slot kt-theme-slot"></div>
      <a class="kt-topbar__profile" href="/account" aria-label="${escapeHtml(accountLabel)}">
        <span class="kt-topbar__avatar" aria-hidden="true">👤</span>
      </a>
    </div>
  `;
}

export function mountTopbar(root, shellRoot) {
  root.innerHTML = renderTopbar();

  // Hook up the nav drawer toggle. Adds/removes is-nav-open on the shell root.
  const toggleBtn = root.querySelector('[data-action="toggle-nav"]');
  const onToggle = (e) => {
    e.preventDefault();
    shellRoot.classList.toggle('is-nav-open');
  };
  toggleBtn.addEventListener('click', onToggle);

  // Close drawer when clicking outside the sidebar (on the backdrop pseudo-el
  // we set in nav.css). The backdrop is created via ::before on .kt-shell so
  // we can't bind directly; instead, intercept clicks on the shell that
  // happen below 1024px when drawer is open and the click target is not
  // inside the nav.
  const onShellClick = (e) => {
    if (!shellRoot.classList.contains('is-nav-open')) return;
    if (window.innerWidth >= 1024) return;
    const nav = document.getElementById('kt-nav-root');
    if (nav && nav.contains(e.target)) return;
    if (toggleBtn.contains(e.target)) return;
    shellRoot.classList.remove('is-nav-open');
  };
  shellRoot.addEventListener('click', onShellClick);

  // Auto-close drawer on route change.
  const onRoute = () => shellRoot.classList.remove('is-nav-open');
  window.addEventListener('popstate', onRoute);
  window.addEventListener('kt:pushstate', onRoute);

  // Re-render labels on language change.
  const onLang = () => {
    root.innerHTML = renderTopbar();
    const newToggle = root.querySelector('[data-action="toggle-nav"]');
    newToggle.addEventListener('click', onToggle);
  };
  window.addEventListener('kt:lang-change', onLang);

  return function unmountTopbar() {
    toggleBtn.removeEventListener('click', onToggle);
    shellRoot.removeEventListener('click', onShellClick);
    window.removeEventListener('popstate', onRoute);
    window.removeEventListener('kt:pushstate', onRoute);
    window.removeEventListener('kt:lang-change', onLang);
    root.innerHTML = '';
  };
}
