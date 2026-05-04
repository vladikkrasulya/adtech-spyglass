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
  const LANG_PRESERVE = [
    '#bidReq',
    '#bidRes',
    '#simPrice',
    '#authWidget',
    '#stEntity',
    '#statusText',
    '#statusDot',
    '#inspectorBadge',
    '#crosscheckBadge',
    '#slotsBadge',
    '#formatBar',
    '#tInspector',
    '#tCrosscheck',
    '#tSlots',
    '#tSummary',
    '#tRaw',
    '#historyList',
    '#libList',
    '#partnersList',
    '#savedSamplesList',
    '#partnerOptions',
    '#bidReqChars',
    '#bidResChars',
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

      if (push) history.pushState({ lang: newLang }, '', targetUrl);

      // Close lang dropdown (the <details> stays open after click otherwise)
      const menu = document.querySelector('.kt-lang-menu');
      if (menu) menu.removeAttribute('open');

      // Re-bind in case the menu got morphed (idempotent — guarded by dataset)
      bindLangLinks();

      // Re-apply theme-toggle tooltip in the new locale.
      applyThemeTooltipI18n();

      // Fires kt:lang-change for subscribers (inspector re-runs analysis,
      // re-renders history sidebar, etc.). No-ops on surfaces without
      // listeners.
      window.dispatchEvent(new CustomEvent('kt:lang-change', { detail: { lang: newLang } }));
    } catch (e) {
      console.warn('Seamless lang switch failed, falling back to navigation:', e);
      window.location.href = targetUrl;
    }
  }

  function bindLangLinks() {
    document.querySelectorAll('.kt-lang-menu-list a').forEach((a) => {
      if (a.dataset.langSwapBound) return;
      a.dataset.langSwapBound = '1';
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
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

  // Browser back/forward — re-morph without pushing a new history entry.
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.lang) {
      switchLang(window.location.pathname, { push: false });
    }
  });
})();
