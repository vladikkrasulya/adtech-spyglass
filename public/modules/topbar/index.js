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
  const l = lang();
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
  const collapseLabel = pick({
    en: 'Toggle sidebar',
    uk: 'Згорнути меню',
    ru: 'Свернуть меню',
  });
  const themeLabel = pick({
    en: 'Toggle theme',
    uk: 'Перемкнути тему',
    ru: 'Переключить тему',
  });
  const signInLabel = pick({
    en: 'sign in',
    uk: 'увійти',
    ru: 'войти',
  });
  const langTitle = pick({
    en: 'Language: English',
    uk: 'Мова: українська',
    ru: 'Язык: русский',
  });
  const langCurrent = l.toUpperCase();

  // Lang menu mirrors the markup the existing lang-switch.js binds to
  // (querySelectorAll('.kt-lang-menu-list a') + .kt-lang-menu details).
  // The IIFE in HTML head also re-binds .kt-theme-toggle on
  // kt:inspector-ready, so the topbar copy gets wired automatically.
  return `
    <button type="button" class="kt-topbar__nav-toggle" data-action="toggle-nav" aria-label="${escapeHtml(navToggleLabel)}">
      <span aria-hidden="true">☰</span>
    </button>
    <button type="button" class="kt-topbar__nav-collapse" data-action="collapse-nav" aria-label="${escapeHtml(collapseLabel)}" title="${escapeHtml(collapseLabel)}">
      <span aria-hidden="true" data-icon>⮜</span>
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
      <details class="kt-lang-menu">
        <summary class="kt-lang-toggle" title="${escapeHtml(langTitle)}">
          <span class="kt-lang-current">${escapeHtml(langCurrent)}</span><span class="kt-lang-caret">▾</span>
        </summary>
        <div class="kt-lang-menu-list" role="menu">
          <a href="/" role="menuitem" lang="en"${l === 'en' ? ' aria-current="true"' : ''}>EN · English</a>
          <a href="/uk/" role="menuitem" lang="uk"${l === 'uk' ? ' aria-current="true"' : ''}>UK · Українська</a>
          <a href="/ru/" role="menuitem" lang="ru"${l === 'ru' ? ' aria-current="true"' : ''}>RU · Русский</a>
        </div>
      </details>
      <button class="kt-theme-toggle" type="button" aria-label="${escapeHtml(themeLabel)}" title="${escapeHtml(themeLabel)}">◐</button>
      <button type="button" class="kt-topbar__signin" data-action="open-auth" data-mode="login">${escapeHtml(signInLabel)}</button>
    </div>
  `;
}

export function mountTopbar(root, shellRoot) {
  root.innerHTML = renderTopbar();

  // Wire the sign-in pill to the existing auth modal. The modal lives in
  // spyglass.app.js and is exposed via window.openAuthModal; in dev modes
  // where it is unavailable, fall back to navigating /account.
  const signInBtn = root.querySelector('[data-action="open-auth"]');
  const onSignIn = (e) => {
    e.preventDefault();
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal({ mode: 'login' });
    } else {
      window.location.assign('/account');
    }
  };
  if (signInBtn) signInBtn.addEventListener('click', onSignIn);

  // Hook up the nav drawer toggle. Adds/removes is-nav-open on the shell root.
  const toggleBtn = root.querySelector('[data-action="toggle-nav"]');
  const onToggle = (e) => {
    e.preventDefault();
    shellRoot.classList.toggle('is-nav-open');
  };
  toggleBtn.addEventListener('click', onToggle);

  // Desktop sidebar collapse (≥1024px). Persists in localStorage so the
  // choice sticks across reloads.
  const COLLAPSE_KEY = 'kt-nav-collapsed';
  try {
    if (localStorage.getItem(COLLAPSE_KEY) === '1') {
      shellRoot.classList.add('is-nav-collapsed');
    }
  } catch (_) { /* storage disabled */ }
  const collapseBtn = root.querySelector('[data-action="collapse-nav"]');
  const onCollapse = (e) => {
    e.preventDefault();
    const collapsed = shellRoot.classList.toggle('is-nav-collapsed');
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
    const icon = collapseBtn.querySelector('[data-icon]');
    if (icon) icon.textContent = collapsed ? '⮞' : '⮜';
  };
  if (collapseBtn) {
    collapseBtn.addEventListener('click', onCollapse);
    // Set initial icon based on persisted state.
    if (shellRoot.classList.contains('is-nav-collapsed')) {
      const icon = collapseBtn.querySelector('[data-icon]');
      if (icon) icon.textContent = '⮞';
    }
  }

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
    if (signInBtn) signInBtn.removeEventListener('click', onSignIn);
    toggleBtn.removeEventListener('click', onToggle);
    if (collapseBtn) collapseBtn.removeEventListener('click', onCollapse);
    shellRoot.removeEventListener('click', onShellClick);
    window.removeEventListener('popstate', onRoute);
    window.removeEventListener('kt:pushstate', onRoute);
    window.removeEventListener('kt:lang-change', onLang);
    root.innerHTML = '';
  };
}
