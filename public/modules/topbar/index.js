/* ============================================================
   public/modules/topbar/index.js — thin global topbar.

   Persistent shell chrome. Lives outside the section
   registry; mounted once at boot into <header id="kt-topbar-root">.

   Slots, left to right:
     - hamburger (visible only below 1024px, toggles sidebar drawer)
     - compact brand (visible only below 1024px — full brand lives
       inside the sidebar at desktop widths)
     - global search input (active — /modules/search/ wired on mount)
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

// ROADMAP #18: session boot is now canonical + shared (public/core/session.js)
// — topbar no longer runs its own separate /api/auth/me; it awaits the SAME
// in-flight/cached request shell-boot.js and Inspector's mount also share, so
// there's exactly one boot fetch per page load regardless of how many
// consumers ask for it.
import { session } from '/core/session.js';

function lang() {
  return document.documentElement.getAttribute('lang') || 'en';
}

function pick(map) {
  const l = lang();
  return map[l] || map.en || '';
}

/** '' on EN, '/uk' or '/ru' otherwise. Every internal href the topbar prints
 *  must carry it — the compact brand (visible below 1024px, i.e. on every
 *  phone and most tablets) shipped a hardcoded "/inspector", so tapping the
 *  logo on /uk/* or /ru/* silently dropped the user's language: the address
 *  bar said EN while the page still rendered UK, and the next reload made the
 *  switch permanent. The rail's brand has always used the prefixed form. */
function localePrefix() {
  const l = lang();
  return l === 'en' ? '' : '/' + l;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTopbar(authUser) {
  const l = lang();
  const searchPlaceholder = pick({
    en: 'Jump to section, finding or doc',
    uk: 'Перейти до розділу, знахідки чи доки',
    ru: 'Перейти к разделу, находке или доке',
  });
  const navToggleLabel = pick({
    en: 'Toggle navigation',
    uk: 'Меню',
    ru: 'Меню',
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
  const searchLabel = pick({
    en: 'Search',
    uk: 'Пошук',
    ru: 'Поиск',
  });
  const langTitle = pick({
    en: 'Language: English',
    uk: 'Мова: українська',
    ru: 'Язык: русский',
  });
  const langCurrent = l.toUpperCase();

  // Right-side auth area: profile pill when logged in, sign-in button otherwise.
  let authHtml;
  if (authUser && authUser.email) {
    const initial = authUser.email.charAt(0).toUpperCase();
    const emailPrefix = authUser.email.split('@')[0];
    const langAttr = l === 'en' ? '' : '/' + l;
    authHtml = `<a class="kt-topbar__profile" href="${escapeHtml(langAttr + '/account')}" data-internal title="${escapeHtml(authUser.email)}" aria-label="${escapeHtml(authUser.email)}">
      <span class="kt-topbar__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <span class="kt-topbar__email-prefix">${escapeHtml(emailPrefix)}</span>
    </a>`;
  } else {
    authHtml = `<button type="button" class="kt-topbar__signin" data-action="open-auth" data-mode="login">${escapeHtml(signInLabel)}</button>`;
  }

  // Lang menu mirrors the markup the existing lang-switch.js binds to
  // (querySelectorAll('.kt-lang-menu-list a') + .kt-lang-menu details).
  // The IIFE in HTML head also re-binds .kt-theme-toggle on
  // kt:inspector-ready, so the topbar copy gets wired automatically.
  return `
    <button type="button" class="kt-topbar__nav-toggle" data-action="toggle-nav" aria-controls="kt-nav-root" aria-expanded="false" aria-label="${escapeHtml(navToggleLabel)}">
      <span aria-hidden="true">☰</span>
    </button>
    <a class="kt-topbar__brand-mini" href="${escapeHtml(localePrefix() + '/inspector')}" data-internal>
      <span class="kt-topbar__brand-icon" aria-hidden="true">◆</span>
      <span class="kt-topbar__brand-text">ortbtools</span>
    </a>
    <!-- Breadcrumb: which section you are in, and which payload you are
         looking at. The mockup puts it where a browser puts a title, and it
         is the only place the payload's id is visible at all — until now it
         lived in a 0x0 span inside the editor card. Filled at runtime by
         kt:inspector-ready / analyze; hidden while empty. -->
    <div class="kt-topbar__crumbs" id="ktCrumbs" hidden>
      <span class="kt-topbar__crumb-section" id="ktCrumbSection"></span>
      <span class="kt-topbar__crumb-sep" aria-hidden="true">/</span>
      <span class="kt-topbar__crumb-id" id="ktCrumbId"></span>
    </div>
    <div class="kt-topbar__search" id="ktTopbarSearch">
      <svg class="kt-topbar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
      </svg>
      <input
        type="text"
        class="kt-topbar__search-input"
        placeholder="${escapeHtml(searchPlaceholder)}"
        autocomplete="off"
        spellcheck="false"
        aria-label="${escapeHtml(searchPlaceholder)}"
      />
      <span class="kt-topbar__search-kbd" aria-hidden="true">⌘K</span>
    </div>
    <div class="kt-topbar__actions">
      <button type="button" class="kt-topbar__search-btn" data-action="toggle-search" aria-controls="ktTopbarSearch" aria-expanded="false" aria-label="${escapeHtml(searchLabel)}" title="${escapeHtml(searchLabel)}">🔎</button>
      <details class="kt-lang-menu">
        <summary class="kt-lang-toggle" title="${escapeHtml(langTitle)}">
          <span class="kt-lang-current">${escapeHtml(langCurrent)}</span><span class="kt-lang-caret">▾</span>
        </summary>
        <div class="kt-lang-menu-list">
          <a href="/" lang="en"${l === 'en' ? ' aria-current="true"' : ''}>EN · English</a>
          <a href="/uk/" lang="uk"${l === 'uk' ? ' aria-current="true"' : ''}>UK · Українська</a>
          <a href="/ru/" lang="ru"${l === 'ru' ? ' aria-current="true"' : ''}>RU · Русский</a>
        </div>
      </details>
      <button class="kt-theme-toggle" type="button" aria-label="${escapeHtml(themeLabel)}" title="${escapeHtml(themeLabel)}">◐</button>
      ${authHtml}
    </div>
  `;
}

export function mountTopbar(root, shellRoot) {
  // Tracked auth user for the current render cycle. Starts null (anon);
  // updateAuthArea() fetches /api/auth/me and re-renders the action area.
  let _authUser = null;

  // ── Nav toggle (declared early — doRender references it) ────────────
  const setNavOpen = (expanded) => {
    shellRoot.classList.toggle('is-nav-open', expanded);
    const opener = root.querySelector('[data-action="toggle-nav"]');
    if (opener) opener.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    window.dispatchEvent(
      new CustomEvent('kt:nav-drawer-state', {
        detail: { expanded },
      }),
    );
  };
  const onToggle = (e) => {
    e.preventDefault();
    setNavOpen(!shellRoot.classList.contains('is-nav-open'));
  };

  // ── Mobile search toggle (≤600px): expand the inline input into a
  // full-width overlay (CSS .is-search-open on .kt-topbar) and focus it,
  // which opens the existing search dropdown. Declared early — doRender
  // references it. ───────────────────────────────────────────────────────
  const closeSearch = ({ restoreFocus = false } = {}) => {
    const wasOpen = root.classList.contains('is-search-open');
    root.classList.remove('is-search-open');
    const trigger = root.querySelector('[data-action="toggle-search"]');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && wasOpen && trigger) setTimeout(() => trigger.focus(), 0);
  };
  const onToggleSearch = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const opening = !root.classList.contains('is-search-open');
    root.classList.toggle('is-search-open', opening);
    e.currentTarget.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) {
      const inp = root.querySelector('.kt-topbar__search-input');
      if (inp) setTimeout(() => inp.focus(), 0);
    } else {
      e.currentTarget.focus();
    }
  };

  // ── Helpers to wire/unwire the sign-in click on a fresh DOM render ──
  function wireSignIn() {
    const signInBtn = root.querySelector('[data-action="open-auth"]');
    if (!signInBtn) return;
    signInBtn.addEventListener('click', onSignIn);
  }

  const onSignIn = (e) => {
    e.preventDefault();
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('login');
      return;
    }
    if (typeof window.lazyOpenAuth === 'function') {
      window.lazyOpenAuth('login');
      return;
    }
    const langAttr = document.documentElement.getAttribute('lang') || 'en';
    const prefix = langAttr === 'en' ? '' : '/' + langAttr;
    const target = prefix + '/inspector?auth=login';
    if (window.OrtbtoolsShell && typeof window.OrtbtoolsShell.navigateTo === 'function') {
      window.OrtbtoolsShell.navigateTo(target);
    } else {
      window.location.assign(target);
    }
  };

  // ── Full topbar render (preserves _authUser across re-renders) ───────
  function doRender(user) {
    _authUser = user !== undefined ? user : _authUser;
    // A locale render replaces both the mobile search trigger and the field;
    // never leave the persistent root claiming an overlay whose nodes are gone.
    closeSearch();
    root.innerHTML = renderTopbar(_authUser);
    // Re-wire toggle (it's a fresh DOM node after innerHTML).
    const newToggle = root.querySelector('[data-action="toggle-nav"]');
    if (newToggle) {
      newToggle.setAttribute(
        'aria-expanded',
        shellRoot.classList.contains('is-nav-open') ? 'true' : 'false',
      );
      newToggle.addEventListener('click', onToggle);
    }
    const newSearchToggle = root.querySelector('[data-action="toggle-search"]');
    if (newSearchToggle) newSearchToggle.addEventListener('click', onToggleSearch);
    wireSignIn();
  }

  // ── Fetch auth state + patch ONLY the auth button (sign-in / profile pill) ─
  // Deliberately does NOT re-render the lang menu or theme toggle so that
  // lang-switch.js's data-langSwapBound markers and href rewrites survive.
  // Full re-render (doRender) is reserved for kt:lang-change.
  async function updateAuthArea(userOverride) {
    let user;
    if (userOverride !== undefined) {
      // Caller already knows the new user (from auth:changed event detail).
      user = userOverride;
    } else {
      // Shares the ONE canonical boot request (session.ensureBooted() is
      // idempotent — concurrent/repeat callers get the same promise/result).
      const result = await session.ensureBooted();
      user = result.user;
    }
    _authUser = user;

    const l = lang();
    const signInLabel = l === 'uk' ? 'увійти' : l === 'ru' ? 'войти' : 'sign in';

    // Build just the auth node (profile pill or sign-in button).
    let newNode;
    if (user && user.email) {
      const initial = user.email.charAt(0).toUpperCase();
      const emailPrefix = user.email.split('@')[0];
      const langAttr = l === 'en' ? '' : '/' + l;
      newNode = document.createElement('a');
      newNode.className = 'kt-topbar__profile';
      newNode.href = langAttr + '/account';
      newNode.setAttribute('data-internal', '');
      newNode.title = user.email;
      newNode.setAttribute('aria-label', user.email);
      newNode.innerHTML = `<span class="kt-topbar__avatar" aria-hidden="true">${escapeHtml(initial)}</span><span class="kt-topbar__email-prefix">${escapeHtml(emailPrefix)}</span>`;
    } else {
      newNode = document.createElement('button');
      newNode.type = 'button';
      newNode.className = 'kt-topbar__signin';
      newNode.setAttribute('data-action', 'open-auth');
      newNode.setAttribute('data-mode', 'login');
      newNode.textContent = signInLabel;
    }

    // Swap: remove the existing auth element (sign-in btn or profile pill),
    // append the new one. This leaves lang menu + theme toggle untouched.
    const actions = root.querySelector('.kt-topbar__actions');
    if (!actions) {
      // Fallback: full re-render only if .kt-topbar__actions is missing.
      doRender(user);
      return;
    }
    const existingAuth = actions.querySelector('.kt-topbar__signin, .kt-topbar__profile');
    if (existingAuth) {
      actions.replaceChild(newNode, existingAuth);
    } else {
      actions.appendChild(newNode);
    }
    wireSignIn();
  }

  // ── Initial render (anon — auth check follows async) ─────────────────
  doRender(null);

  // Wire global search on the first render.
  let searchCleanup = null;
  const searchInput = root.querySelector('.kt-topbar__search-input');
  if (searchInput) {
    import('/modules/search/index.js')
      .then(({ initSearch }) => {
        searchCleanup = initSearch(searchInput, shellRoot);
      })
      .catch((e) => console.warn('[topbar] search module load failed:', e));
  }

  // Wire the sign-in pill. ROADMAP #18: session/DEK is now a shell-level
  // service (public/core/session.js) and window.lazyOpenAuth is installed at
  // shell boot (public/core/modal-host.js) — independent of Inspector, so the
  // modal opens IN PLACE on whichever section is active. onSignIn's
  // /inspector?auth=login branch is now unreachable in practice (kept only as
  // a defensive fallback if the shell globals somehow aren't installed yet).
  wireSignIn();

  // Hook up the nav drawer toggle. Adds/removes is-nav-open on the shell root.
  const toggleBtn = root.querySelector('[data-action="toggle-nav"]');
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
    const tb = root.querySelector('[data-action="toggle-nav"]');
    if (tb && tb.contains(e.target)) return;
    setNavOpen(false);
  };
  shellRoot.addEventListener('click', onShellClick);

  // ── Breadcrumb ─────────────────────────────────────────────────────────
  // The section half belongs to the topbar, not to whichever module happens
  // to be mounted: every route has a name, and a module that forgets to
  // paint one leaves the bar reading a bare "/" — which is what /live,
  // /library, /dialects and /docs did, each having been built by someone
  // who could only see their own page.
  //
  // A module may still add the DETAIL half (the Inspector prints the payload
  // id, Insights the window) through window.ktSetCrumbDetail(). The section
  // is derived here from the route, so it cannot go missing.
  const SECTION_NAMES = {
    '/inspector': { en: 'Inspector', uk: 'Інспектор', ru: 'Инспектор' },
    '/live': { en: 'Streams', uk: 'Стріми', ru: 'Стримы' },
    '/library': { en: 'Samples', uk: 'Зразки', ru: 'Образцы' },
    '/dialects': { en: 'Dialects', uk: 'Діалекти', ru: 'Диалекты' },
    '/insights': { en: 'Insights', uk: 'Інсайти', ru: 'Аналитика' },
    '/docs': { en: 'Docs', uk: 'Доки', ru: 'Доки' },
    '/blog': { en: 'Blog', uk: 'Блог', ru: 'Блог' },
    '/behavior': { en: 'Behavior', uk: 'Behavior', ru: 'Behavior' },
    '/account': { en: 'Account', uk: 'Кабінет', ru: 'Кабинет' },
  };

  function currentSectionName() {
    let path = location.pathname.replace(/\/$/, '') || '/';
    if (/^\/(uk|ru)(\/|$)/.test(path)) path = path.slice(3) || '/';
    const entry = SECTION_NAMES[path] || SECTION_NAMES['/' + path.split('/')[1]];
    if (!entry) return '';
    const l = document.documentElement.getAttribute('lang') || 'en';
    return entry[l] || entry.en;
  }

  let crumbDetail = '';
  function paintCrumbs() {
    const box = document.getElementById('ktCrumbs');
    if (!box) return;
    const section = currentSectionName();
    const secEl = document.getElementById('ktCrumbSection');
    const idEl = document.getElementById('ktCrumbId');
    const sep = box.querySelector('.kt-topbar__crumb-sep');
    if (secEl) secEl.textContent = section;
    if (idEl) {
      idEl.textContent = crumbDetail;
      idEl.hidden = !crumbDetail;
    }
    if (sep) sep.hidden = !crumbDetail;
    box.hidden = !section;
  }
  // A route change invalidates whatever detail the previous page set.
  window.ktSetCrumbDetail = (text) => {
    crumbDetail = text ? String(text) : '';
    paintCrumbs();
  };
  paintCrumbs();

  // Auto-close drawer (and the mobile search overlay) on route change.
  const onRoute = () => {
    setNavOpen(false);
    closeSearch();
    crumbDetail = '';
    paintCrumbs();
  };
  window.addEventListener('popstate', onRoute);
  window.addEventListener('kt:pushstate', onRoute);
  // NOTE: kt:lang-change is deliberately NOT wired to paintCrumbs here.
  // Listeners run in registration order, and onLang (registered further down)
  // replaces the whole topbar DOM via doRender(). A paintCrumbs bound here
  // would run FIRST — painting the outgoing #ktCrumbs node, which doRender
  // then throws away and replaces with a fresh one carrying the `hidden`
  // attribute from the template. That is why the breadcrumb vanished on every
  // language switch and only came back on the next route change. onLang calls
  // paintCrumbs itself, after the re-render, where it can actually stick.

  // Collapse the mobile search overlay on click-outside or Esc.
  const onDocClickSearch = (e) => {
    if (!root.classList.contains('is-search-open')) return;
    if (e.target.closest('.kt-topbar__search')) return; // input + dropdown
    if (e.target.closest('[data-action="toggle-search"]')) return; // the toggle itself
    closeSearch();
  };
  const onKeySearch = (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-search-open')) {
      e.preventDefault();
      closeSearch({ restoreFocus: true });
    }
  };
  const onFocusOutSearch = () => {
    setTimeout(() => {
      if (!root.classList.contains('is-search-open')) return;
      const search = root.querySelector('.kt-topbar__search');
      if (!search || !search.contains(document.activeElement)) closeSearch();
    }, 0);
  };
  document.addEventListener('click', onDocClickSearch);
  document.addEventListener('keydown', onKeySearch);
  root.addEventListener('focusout', onFocusOutSearch);

  // Re-check auth on SPA navigation (covers going from /inspector to
  // /library after sign-in — the profile pill must persist).
  const onPushState = () => {
    updateAuthArea(); // best-effort; anon fallback on network failure
  };
  window.addEventListener('kt:pushstate', onPushState);

  // Re-render labels on language change; preserve auth state.
  const onLang = () => {
    // Cleanup existing search before re-render
    if (searchCleanup) {
      searchCleanup();
      searchCleanup = null;
    }
    doRender(); // keeps _authUser
    // The crumb nodes are part of what doRender() just replaced, so repaint
    // them here — after the new DOM exists. crumbDetail lives in this closure
    // and survives the re-render, so both halves come back in the new locale.
    paintCrumbs();
    const newToggle = root.querySelector('[data-action="toggle-nav"]');
    if (newToggle) newToggle.addEventListener('click', onToggle);
    // Re-init search on new input
    const newSearchInput = root.querySelector('.kt-topbar__search-input');
    if (newSearchInput) {
      import('/modules/search/index.js')
        .then(({ initSearch }) => {
          searchCleanup = initSearch(newSearchInput, shellRoot);
        })
        .catch((e) => console.warn('[topbar] search module reload failed:', e));
    }
  };
  window.addEventListener('kt:lang-change', onLang);

  // ── Auth state sync ────────────────────────────────────────────────────
  // Listen to auth:changed dispatched by OrtbtoolsSession.setUser and
  // window.signOut. Detail carries {user} (null on logout).
  const onAuthChanged = (e) => {
    const user = e && e.detail && e.detail.user ? e.detail.user : null;
    updateAuthArea(user);
  };
  window.addEventListener('auth:changed', onAuthChanged);

  // Best-effort initial auth check (covers page-reload while session
  // is still active — session cookie exists but _authUser starts null).
  updateAuthArea();

  return function unmountTopbar() {
    if (searchCleanup) {
      searchCleanup();
      searchCleanup = null;
    }
    toggleBtn.removeEventListener('click', onToggle);
    shellRoot.removeEventListener('click', onShellClick);
    document.removeEventListener('click', onDocClickSearch);
    document.removeEventListener('keydown', onKeySearch);
    root.removeEventListener('focusout', onFocusOutSearch);
    window.removeEventListener('popstate', onRoute);
    window.removeEventListener('kt:pushstate', onRoute);
    window.removeEventListener('kt:pushstate', onPushState);
    window.removeEventListener('kt:lang-change', onLang);
    window.removeEventListener('auth:changed', onAuthChanged);
    root.innerHTML = '';
  };
}
