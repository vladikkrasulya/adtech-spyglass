/* ============================================================
   public/modules/topbar/index.js — thin global topbar.

   Stage 0 chrome (ROADMAP.md). Lives outside the section
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

function renderTopbar(authUser) {
  const l = lang();
  const searchPlaceholder = pick({
    en: '🔎 search the site',
    uk: '🔎 шукати по сайту',
    ru: '🔎 искать по сайту',
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
        autocomplete="off"
        spellcheck="false"
        aria-label="${escapeHtml(searchPlaceholder)}"
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
      ${authHtml}
    </div>
  `;
}

// Fetch /api/auth/me and return the user object, or null on 401/error.
// Used by updateAuthArea to drive the profile pill vs sign-in button.
async function fetchAuthUser() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.user ? j.user : null;
  } catch (_) {
    return null;
  }
}

export function mountTopbar(root, shellRoot) {
  // Tracked auth user for the current render cycle. Starts null (anon);
  // updateAuthArea() fetches /api/auth/me and re-renders the action area.
  let _authUser = null;

  // ── Nav toggle (declared early — doRender references it) ────────────
  const onToggle = (e) => {
    e.preventDefault();
    shellRoot.classList.toggle('is-nav-open');
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
    if (window.SpyglassShell && typeof window.SpyglassShell.navigateTo === 'function') {
      window.SpyglassShell.navigateTo(target);
    } else {
      window.location.assign(target);
    }
  };

  // ── Full topbar render (preserves _authUser across re-renders) ───────
  function doRender(user) {
    _authUser = user !== undefined ? user : _authUser;
    root.innerHTML = renderTopbar(_authUser);
    // Re-wire toggle (it's a fresh DOM node after innerHTML).
    const newToggle = root.querySelector('[data-action="toggle-nav"]');
    if (newToggle) newToggle.addEventListener('click', onToggle);
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
      user = await fetchAuthUser();
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

  // Wire the sign-in pill. The auth modal lives in /modules/auth/ but
  // depends on the inspector's closure-scoped SpyglassSession (DEK +
  // crypto state). Until that dependency is hoisted to the shell level
  // (backlog item: chrome-level auth), sign-in from any section
  // navigates to /inspector?auth=login — the inspector's bootAuth
  // reads the query and opens the modal once mounted.
  //
  // If the inspector is already the active section (modal can open
  // in place), call window.openAuthModal directly.
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
    shellRoot.classList.remove('is-nav-open');
  };
  shellRoot.addEventListener('click', onShellClick);

  // Auto-close drawer on route change.
  const onRoute = () => shellRoot.classList.remove('is-nav-open');
  window.addEventListener('popstate', onRoute);
  window.addEventListener('kt:pushstate', onRoute);

  // Re-check auth on SPA navigation (covers going from /inspector to
  // /library after sign-in — the profile pill must persist).
  const onPushState = () => {
    shellRoot.classList.remove('is-nav-open');
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
  // Listen to auth:changed dispatched by SpyglassSession.setUser and
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
    window.removeEventListener('popstate', onRoute);
    window.removeEventListener('kt:pushstate', onRoute);
    window.removeEventListener('kt:pushstate', onPushState);
    window.removeEventListener('kt:lang-change', onLang);
    window.removeEventListener('auth:changed', onAuthChanged);
    root.innerHTML = '';
  };
}
