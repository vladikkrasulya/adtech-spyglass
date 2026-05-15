/* ============================================================
   lang-switch.js — seamless language switch (DOM morph)

   Used by both the inspector (index.{en,uk,ru}.html) and the docs
   surface (about.{en,uk,ru}.html). Each locale is its own static HTML
   file (kept for SEO), but naive <a href> navigation reloads the page
   and dumps any in-progress state. This file:

     1. Intercepts clicks on .kt-lang-menu-list a
     2. Fetches the target locale's HTML
     3. Walks both DOMs in parallel and copies textContent / selected
        attributes (title, placeholder, aria-label, aria-current, href)
        of *parallel* elements WITHOUT replacing nodes — preserves all
        bound handlers and user state.
     4. Updates <html lang>, <title>, meta tags, canonical URL, and
        pushes new URL via History API.
     5. Fires kt:lang-change CustomEvent so subscribers (e.g. the
        inspector's runAnalysis re-run) can refresh their dynamic
        chrome.

   Theme-toggle tooltip is also re-applied here from i18n keys (the
   inline <head> IIFE bakes per-locale strings at parse-time).

   Loose dependencies (all optional):
     - window.t  (from i18n.js) — used to localise theme-toggle tooltip;
       no-ops on surfaces that don't load i18n.js (e.g. about pages).
     - window.closeModal — closed when present so modals re-render in
       the new locale; safe to omit on surfaces without modals.
   ============================================================ */
(function () {
  'use strict';

  // Selectors whose contents are dynamic / user-state — never morph these.
  // Most are inspector-specific; on surfaces that don't have them (e.g.
  // /about) the matches just return false and the morph proceeds normally.
  //
  // Synced with current spyglass.app.js DOM 2026-05-05. Previous list had
  // 11 stale IDs (#historyList, #libList, #partnersList, #savedSamplesList,
  // #partnerOptions, #tCrosscheck, #tSlots, #tSummary, #tRaw, #crosscheckBadge,
  // #slotsBadge) that no longer matched anything — meaning the morph was
  // walking through dynamic regions and aborting on child-count mismatch
  // (e.g. 50 history rows in current DOM vs 1 in fetched-locale doc),
  // which silently broke text translation for sibling subtrees.
  const LANG_PRESERVE = [
    // User-editable inputs (preserve their value/state across lang swaps)
    '#bidReq',
    '#bidRes',
    '#simPrice',
    '#bidReqChars',
    '#bidResChars',
    // Auth + status chrome (re-rendered via kt:lang-change handler in app)
    '#authWidget',
    '#stEntity',
    '#statusText',
    '#statusDot',
    // Tab badges (counts populated by analyze; .danger/.warn/.info classes
    // applied by setTabBadge — should not be reset by morph)
    '#inspectorBadge',
    '#validationBadge',
    '#categoriesBadge',
    '#behaviorBadge',
    '#crossBadge',
    // Format / status pills near the top of inspector
    '#formatBar',
    // Tab content panes — populated dynamically by analyze() / runAnalysis().
    // Empty-state hints inside them stay in the loaded-page locale until
    // analyze fires; that's an accepted tradeoff (fix would require a
    // kt:lang-change listener that re-renders empty state).
    '#tInspector',
    '#tValidation',
    '#tCross',
    '#tCategories',
    '#tBehavior',
    '#tRef',
    // Persisted lists driven by localStorage (history) and signed-in API
    // (saved samples). Counts diverge between sessions — must not morph.
    '#hList',
    '#savedList',
    // Modal + toast surfaces — rendered on the fly with locale at fire-time
    '#modalRoot',
    '.toast-container',
    '#toastRoot',
  ];
  const LANG_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'TEMPLATE']);
  const LANG_ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'aria-current', 'href'];

  function langShouldPreserve(el) {
    if (!el || !el.matches) return false;
    for (let i = 0; i < LANG_PRESERVE.length; i++) {
      if (el.matches(LANG_PRESERVE[i])) return true;
    }
    return false;
  }

  function langMorphAttrs(curEl, newEl) {
    for (let i = 0; i < LANG_ATTRS.length; i++) {
      const attr = LANG_ATTRS[i];
      const nw = newEl.getAttribute(attr);
      const cur = curEl.getAttribute(attr);
      if (nw !== null && cur !== nw) curEl.setAttribute(attr, nw);
      else if (nw === null && cur !== null) curEl.removeAttribute(attr);
    }
  }

  function langMorphTextSiblings(curEl, newEl) {
    const curText = [];
    const newText = [];
    curEl.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) curText.push(n);
    });
    newEl.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) newText.push(n);
    });
    if (curText.length !== newText.length) return;
    for (let i = 0; i < curText.length; i++) {
      if (curText[i].nodeValue !== newText[i].nodeValue) {
        curText[i].nodeValue = newText[i].nodeValue;
      }
    }
  }

  function langMorph(curEl, newEl) {
    if (!curEl || !newEl) return;
    if (curEl.tagName !== newEl.tagName) return;
    if (LANG_SKIP_TAGS.has(curEl.tagName)) return;
    if (langShouldPreserve(curEl)) return;

    langMorphAttrs(curEl, newEl);

    const curKids = curEl.childNodes;
    const newKids = newEl.childNodes;
    const allText = (nl) => {
      if (nl.length === 0) return false;
      for (let i = 0; i < nl.length; i++) {
        if (nl[i].nodeType !== Node.TEXT_NODE) return false;
      }
      return true;
    };
    if (allText(curKids) && allText(newKids)) {
      if (curEl.textContent !== newEl.textContent) {
        curEl.textContent = newEl.textContent;
      }
      return;
    }

    const curChildren = curEl.children;
    const newChildren = newEl.children;
    if (curChildren.length !== newChildren.length) return;
    for (let i = 0; i < curChildren.length; i++) {
      langMorph(curChildren[i], newChildren[i]);
    }
    langMorphTextSiblings(curEl, newEl);
  }

  function langMorphHead(newDoc) {
    document.title = newDoc.title;
    document.documentElement.lang = newDoc.documentElement.lang || '';

    const newMetas = newDoc.head.querySelectorAll('meta[name], meta[property]');
    newMetas.forEach((nm) => {
      const name = nm.getAttribute('name');
      const prop = nm.getAttribute('property');
      const sel = name ? 'meta[name="' + name + '"]' : 'meta[property="' + prop + '"]';
      const cur = document.head.querySelector(sel);
      if (cur && nm.getAttribute('content') !== null) {
        cur.setAttribute('content', nm.getAttribute('content'));
      }
    });

    const canon = newDoc.head.querySelector('link[rel="canonical"]');
    if (canon) {
      const cur = document.head.querySelector('link[rel="canonical"]');
      if (cur) cur.setAttribute('href', canon.getAttribute('href'));
    }
  }

  // Theme-toggle tooltip stays stale after lang swap because the inline
  // <head> IIFE bakes per-locale strings at parse-time and re-applies them
  // on every theme-button click. We override:
  //   - At init (after i18n.js loaded) we set a localized tooltip
  //   - On every click we re-apply in a microtask, so we run *after* the
  //     IIFE's sync click-handler has clobbered the title
  function applyThemeTooltipI18n() {
    if (typeof window.t !== 'function') return;
    const btn = document.querySelector('.kt-theme-toggle');
    if (!btn) return;
    let saved = null;
    try {
      saved = localStorage.getItem('kt-theme');
    } catch (_) {
      /* storage may be disabled */
    }
    btn.title =
      saved === null
        ? window.t('theme.tooltip.auto')
        : saved === 'light'
          ? window.t('theme.tooltip.light')
          : window.t('theme.tooltip.dark');
  }

  function bindThemeTooltipI18n() {
    const btn = document.querySelector('.kt-theme-toggle');
    if (!btn || btn.dataset.themeTooltipBound) return;
    btn.dataset.themeTooltipBound = '1';
    btn.addEventListener('click', () => {
      Promise.resolve().then(applyThemeTooltipI18n);
    });
    applyThemeTooltipI18n();
  }

  async function switchLang(targetUrl, opts) {
    const push = !(opts && opts.push === false);

    // Modals are constructed on-open via t() at fire-time; their already-
    // rendered text doesn't auto-update. Close any open modal so it
    // re-opens (if user re-triggers) in the new locale.
    try {
      const modalRoot = document.getElementById('modalRoot');
      if (modalRoot && modalRoot.children.length > 0 && typeof window.closeModal === 'function') {
        window.closeModal();
      }
    } catch (_) {
      /* don't block the swap on modal-close failure */
    }

    // Derive newLang from targetUrl (/, /uk, /uk/about, /ru/account, …)
    // so the cookie write that PRE-EMPTS the fetch carries the right value.
    // Pre-fix the fetch went out with the OLD cookie; server's
    // LOCALE_REDIRECT_TABLE then bounced /  → /uk for a UK-cookie user, and
    // the JS got UK content back, leaving the page Ukrainian regardless of
    // which lang the user clicked. Setting the cookie BEFORE the fetch
    // means the server reads the new locale and serves the correct file.
    const newLangFromUrl = (targetUrl.match(/^\/(uk|ru)(?:\/|$)/) || [])[1] || 'en';
    try {
      const isHttps = location.protocol === 'https:';
      document.cookie =
        'kt-lang=' +
        encodeURIComponent(newLangFromUrl) +
        '; Path=/; Max-Age=31536000; SameSite=Lax' +
        (isHttps ? '; Secure' : '');
    } catch (_) {
      /* cookie disabled — fetch may still bounce; we'll fall through */
    }

    // Inspector pages mount their template ASYNC (modules/inspector/index.js
    // injects markup AFTER the shell loads). The fetched server HTML carries
    // an EMPTY #app-root, while the live DOM has the fully-injected
    // workbench. langMorph aborts on child-count mismatch at the top level,
    // leaving the page Ukrainian after a UK→EN click. Cookie is set; just
    // do a full navigation — the new page boots its own module mount in
    // the right locale, no morph game required.
    //
    // Lightweight surfaces (/about, future static pages) don't have
    // #app-root.workbench and continue using the in-place morph.
    const hasMountedWorkbench = !!document.querySelector('#app-root.workbench');
    if (hasMountedWorkbench) {
      // Best-effort POST so cross-device preference updates before we leave.
      // .catch is needed even though we navigate — the request kicks off
      // before navigation tears down the page; if it fails it fails.
      try {
        fetch('/api/auth/preferences', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: newLangFromUrl }),
          keepalive: true,
        }).catch(() => {});
      } catch (_) {
        /* ignore */
      }
      try {
        localStorage.setItem('kt-lang', newLangFromUrl);
      } catch (_) {
        /* ignore */
      }
      // Snapshot textarea content so the new page can restore it after
      // kt:inspector-ready. The morph path preserves these in-place, but
      // the workbench branch does a full navigation — without this save the
      // user loses their in-progress bid request on every language switch.
      try {
        const reqEl = document.getElementById('bidReq');
        const resEl = document.getElementById('bidRes');
        if (reqEl && reqEl.value) sessionStorage.setItem('_sg_restore_bidReq', reqEl.value);
        else sessionStorage.removeItem('_sg_restore_bidReq');
        if (resEl && resEl.value) sessionStorage.setItem('_sg_restore_bidRes', resEl.value);
        else sessionStorage.removeItem('_sg_restore_bidRes');
      } catch (_) {
        /* storage disabled — content is lost, acceptable degradation */
      }
      location.assign(targetUrl);
      return;
    }

    try {
      const res = await fetch(targetUrl, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('fetch failed: ' + res.status);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const newLang =
        doc.documentElement.getAttribute('data-lang') || doc.documentElement.lang || 'en';

      langMorphHead(doc);
      langMorph(document.body, doc.body);

      document.documentElement.setAttribute('data-lang', newLang);
      try {
        localStorage.setItem('kt-lang', newLang);
      } catch (_) {
        /* ignore quota/disabled */
      }
      // Persist locale choice across reloads + tabs + bare URLs:
      //   1. Cookie kt-lang (server reads it for / → /uk/ redirects)
      //   2. /api/auth/preferences when logged in (cross-device)
      try {
        const isHttps = location.protocol === 'https:';
        document.cookie =
          'kt-lang=' +
          encodeURIComponent(newLang) +
          '; Path=/; Max-Age=31536000; SameSite=Lax' +
          (isHttps ? '; Secure' : '');
      } catch (_) {
        /* cookie disabled — anon browser stays on URL/localStorage */
      }
      // Best-effort POST. Auth-gated on the server (401 if anon) — we
      // don't block the lang swap on the result. Network failure is
      // also fine: cookie + localStorage already carried the choice.
      fetch('/api/auth/preferences', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: newLang }),
      }).catch(() => {
        /* non-fatal — anon or network blip */
      });

      if (push) history.pushState({ lang: newLang }, '', targetUrl);

      // Close lang dropdown (the <details> stays open after click otherwise)
      const menu = document.querySelector('.kt-lang-menu');
      if (menu) menu.removeAttribute('open');

      // Re-bind in case the menu got morphed (idempotent — guarded by dataset)
      bindLangLinks();

      // Re-apply theme-toggle tooltip in the new locale.
      applyThemeTooltipI18n();

      // Fires kt:lang-change for subscribers (inspector re-runs analysis,
      // re-renders history sidebar, refreshes textarea placeholders +
      // empty-state text inside preserved tab panes, etc.). The parsed
      // `doc` is passed so subscribers can read attributes/innerHTML from
      // the freshly-loaded locale without a duplicate fetch. No-ops on
      // surfaces without listeners.
      window.dispatchEvent(new CustomEvent('kt:lang-change', { detail: { lang: newLang, doc } }));
    } catch (e) {
      console.warn('Seamless lang switch failed, falling back to navigation:', e);
      window.location.href = targetUrl;
    }
  }

  // Map current pathname into the equivalent path under another locale.
  //   /                  + uk → /uk
  //   /about             + uk → /uk/about
  //   /uk/account        + ru → /ru/account
  //   /uk/about          + en → /about
  // Unknown deep paths fall back to the locale root (`/`, `/uk`, `/ru`)
  // so we don't link to a 404.
  const KNOWN_LANDINGS = ['/', '/about', '/account', '/stream'];
  function localizePath(currentPath, targetLang) {
    const cur = (currentPath || '/').replace(/\/$/, '') || '/';
    let canonical = cur;
    if (cur.startsWith('/uk')) canonical = cur.slice(3) || '/';
    else if (cur.startsWith('/ru')) canonical = cur.slice(3) || '/';
    if (!KNOWN_LANDINGS.includes(canonical)) {
      // Deep path under a section we don't know about → just go to the
      // locale root rather than guess at a translation.
      return targetLang === 'en' ? '/' : '/' + targetLang;
    }
    if (targetLang === 'en') return canonical;
    if (canonical === '/') return '/' + targetLang;
    return '/' + targetLang + canonical;
  }

  // Rewrite each lang menu <a href> to point at the equivalent of the
  // CURRENT page rather than the locale root. Pre-fix this was static
  // `/uk/` `/ru/` `/` regardless of where you were — clicking UK from
  // /about lost docs context. Now the menu links track location.
  function refreshLangLinkHrefs() {
    document.querySelectorAll('.kt-lang-menu-list a').forEach((a) => {
      const lang = (a.getAttribute('lang') || '').toLowerCase();
      if (!lang) return;
      const target = localizePath(location.pathname, lang);
      a.setAttribute('href', target);
    });
  }

  function bindLangLinks() {
    refreshLangLinkHrefs();
    document.querySelectorAll('.kt-lang-menu-list a').forEach((a) => {
      if (a.dataset.langSwapBound) return;
      a.dataset.langSwapBound = '1';
      a.addEventListener('click', (e) => {
        // Re-resolve at click-time too, in case pathname shifted via
        // pushState since the last refresh.
        const lang = (a.getAttribute('lang') || '').toLowerCase();
        const href = lang ? localizePath(location.pathname, lang) : a.getAttribute('href');
        if (!href || /^https?:/i.test(href)) return;
        e.preventDefault();
        switchLang(href);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindLangLinks();
      bindThemeTooltipI18n();
    });
  } else {
    bindLangLinks();
    bindThemeTooltipI18n();
  }

  // Phase C-2: inspector template loads ASYNC after DOMContentLoaded
  // (mountInspector fetches template.${lang}.html and injects). The lang
  // menu lives inside that template, so DOMContentLoaded fires BEFORE the
  // menu DOM exists. Pre-fix this left lang links unbound — the browser
  // followed the href directly, server redirected via kt-lang cookie,
  // and the page snapped back to the previous locale. Re-bind once the
  // inspector signals readiness.
  window.addEventListener(
    'kt:inspector-ready',
    () => {
      bindLangLinks();
      bindThemeTooltipI18n();
      // Restore textarea content saved before a lang-switch full navigation.
      try {
        const reqVal = sessionStorage.getItem('_sg_restore_bidReq');
        const resVal = sessionStorage.getItem('_sg_restore_bidRes');
        if (reqVal !== null) {
          const el = document.getElementById('bidReq');
          if (el) el.value = reqVal;
          sessionStorage.removeItem('_sg_restore_bidReq');
        }
        if (resVal !== null) {
          const el = document.getElementById('bidRes');
          if (el) el.value = resVal;
          sessionStorage.removeItem('_sg_restore_bidRes');
        }
      } catch (_) {
        /* storage disabled */
      }
    },
    { once: true },
  );

  // Browser back/forward — re-morph without pushing a new history entry.
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.lang) {
      switchLang(window.location.pathname, { push: false });
    }
  });
})();
