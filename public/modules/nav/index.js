/* ============================================================
   public/modules/nav/index.js — multi-section side navigation.

   Persistent shell chrome. Lives OUTSIDE the registry section
   lifecycle: mounted once at boot into <aside id="kt-nav-root">,
   stays for the life of the page, updates its `active` highlight
   in response to popstate / pushState navigation.

   Grouping (WORKBENCH / CONFIGURE / LEARN) — v2 groups by what the
   operator is DOING, not by what the thing is:
     WORKBENCH: Inspector / Streams / Samples   — handling a payload
     CONFIGURE: Dialects / Insights             — tuning what handling means
     LEARN:     Docs / Blog                     — reading about it

   Behavior left the rail in v2: it is a tab inside the Inspector's
   results, not a destination. Its route (/behavior, registered in
   lib/locale-routes.js + shell-boot.js) still resolves, so existing
   links and bookmarks keep working — only the nav entry is gone.

   Mobile: below 1024px the sidebar collapses to a drawer (off-canvas),
   togglable by a hamburger button injected into the topbar.
   ============================================================ */
'use strict';

// Section catalog — single source of truth for nav, used by topbar/boot too.
// `route` is the canonical EN path; locale-prefixed variants (/uk/inspector)
// are computed by prefixLocale() based on the current document lang.
/* Line icons, 24x24, 1.5 stroke, currentColor — replacing the emoji set
   (⚡📡🧪📚🎛📊📰📖). Emoji render in a different font on every OS, carry
   their own colour, and sat 1-2px off the text baseline, which is what
   made the rail look ragged. These inherit weight, colour and alignment
   from the item, so a hover or an active state moves the icon with the
   label instead of leaving a coloured glyph behind. */
const ICONS = {
  inspector: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  live:
    '<path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2' +
    'M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><circle cx="12" cy="12" r="1.5"/>',
  library:
    '<path d="M4 4v16"/><path d="M8 4v16"/><rect x="12" y="4" width="8" height="16" rx="1"/>',
  dialects:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/>' +
    '<circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/>',
  insights: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  docs: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"/><path d="M8 7h8M8 11h6"/>',
  blog: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>',
};

function icon(id) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[id] || '') +
    '</svg>'
  );
}

export const SECTIONS = [
  // group key, route, icon id, label keys, optional badge
  {
    group: 'workbench',
    id: 'inspector',
    route: '/inspector',
    label: { en: 'Inspector', uk: 'Інспектор', ru: 'Инспектор' },
  },
  {
    group: 'workbench',
    id: 'live',
    route: '/live',
    // Decision A (ROADMAP 2026-06-11): inspector-first; the stream is an
    // explicitly-labeled preview on synthetic traffic, not the headline.
    // v2 renames the label to Streams but the "preview" qualifier is a
    // LIMITATION DISCLOSURE, not decoration — contracts/locales-versioning.md
    // forbids a locale or a redesign from removing one. It moves into the
    // badge slot so it survives the shorter label and the collapsed rail.
    label: { en: 'Streams', uk: 'Стріми', ru: 'Стримы' },
    badge: { en: 'preview', uk: 'прев’ю', ru: 'превью' },
  },
  {
    group: 'workbench',
    id: 'library',
    route: '/library',
    // Renamed in the rail only. The route stays /library: renaming a live
    // URL costs redirects, sitemap churn and weeks of search re-indexing,
    // and buys nothing the label does not already buy.
    label: { en: 'Samples', uk: 'Зразки', ru: 'Образцы' },
  },
  {
    group: 'configure',
    id: 'dialects',
    route: '/dialects',
    label: { en: 'Dialects', uk: 'Діалекти', ru: 'Диалекты' },
  },
  {
    group: 'configure',
    id: 'insights',
    route: '/insights',
    label: { en: 'Insights', uk: 'Інсайти', ru: 'Аналитика' },
  },
  {
    group: 'learn',
    id: 'docs',
    route: '/docs',
    label: { en: 'Docs', uk: 'Доки', ru: 'Доки' },
  },
  {
    group: 'learn',
    id: 'blog',
    route: '/blog',
    label: { en: 'Blog', uk: 'Блог', ru: 'Блог' },
  },
];

const GROUP_LABELS = {
  workbench: { en: 'WORKBENCH', uk: 'РОБОТА', ru: 'РАБОТА' },
  configure: { en: 'CONFIGURE', uk: 'НАЛАШТУВАННЯ', ru: 'НАСТРОЙКИ' },
  learn: { en: 'LEARN', uk: 'ДОВІДКА', ru: 'СПРАВКА' },
};
const GROUP_ORDER = ['workbench', 'configure', 'learn'];

function lang() {
  return document.documentElement.getAttribute('lang') || 'en';
}

function localePrefix() {
  const l = lang();
  return l === 'en' ? '' : '/' + l;
}

export function prefixLocale(route) {
  return localePrefix() + route;
}

/** Strip /uk or /ru locale prefix from a pathname, returning the canonical
 *  EN route. Used to match the current URL against SECTIONS[].route. */
export function canonicalize(pathname) {
  if (pathname.startsWith('/uk/')) return pathname.slice(3);
  if (pathname.startsWith('/ru/')) return pathname.slice(3);
  if (pathname === '/uk' || pathname === '/ru') return '/';
  return pathname;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNav() {
  const l = lang();
  const groups = GROUP_ORDER.map((g) => {
    const items = SECTIONS.filter((s) => s.group === g)
      .map((s) => {
        const label = escapeHtml(s.label[l] || s.label.en);
        // The badge carries a qualifier the short label dropped. It is part
        // of the accessible name, not a decoration beside it — a screen
        // reader must hear "Streams, preview", the same thing the eye reads.
        const badgeText = s.badge ? s.badge[l] || s.badge.en : '';
        const badge = badgeText
          ? `<span class="kt-nav__badge">${escapeHtml(badgeText)}</span>`
          : '';
        const title = badgeText ? `${label} — ${badgeText}` : label;
        return `
          <li>
            <a class="kt-nav__item" href="${escapeHtml(prefixLocale(s.route))}" data-route="${escapeHtml(s.route)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
              <span class="kt-nav__icon">${icon(s.id)}</span>
              <span class="kt-nav__label">${label}</span>
              ${badge}
            </a>
          </li>`;
      })
      .join('');
    return `
      <div class="kt-nav__group">
        <div class="kt-nav__group-label">${escapeHtml(GROUP_LABELS[g][l] || GROUP_LABELS[g].en)}</div>
        <ul class="kt-nav__list">${items}</ul>
      </div>
    `;
  }).join('');

  const collapseLabel = collapseTabLabel();
  return `
    <a href="${escapeHtml(prefixLocale('/inspector'))}" class="kt-nav__brand">
      <span class="kt-nav__brand-icon" aria-hidden="true">◆</span>
      <span class="kt-nav__brand-text">ortbtools</span>
    </a>
    <button type="button" class="kt-nav__collapse-tab" data-action="collapse-nav" aria-label="${escapeHtml(collapseLabel)}" title="${escapeHtml(collapseLabel)}"></button>
    <nav class="kt-nav__nav" aria-label="Sections">
      ${groups}
    </nav>
    <div class="kt-nav__footer">
      <span class="kt-nav__status" aria-hidden="true">● online</span>
    </div>
  `;
}

function pick(map) {
  const l = lang();
  return map[l] || map.en || '';
}

/** True when the shell is currently in the collapsed-sidebar state. */
function isNavCollapsed() {
  const shell = document.querySelector('.kt-shell');
  return !!(shell && shell.classList.contains('is-nav-collapsed'));
}

/** Accessible name for the collapse tab. The button is a toggle: its label
 *  must describe what the NEXT activation does, and it must agree with the
 *  ‹ / › arrow nav.css swaps on .is-nav-collapsed. Pre-fix the label was
 *  computed once, always as "collapse", so in the collapsed state the control
 *  announced the opposite of the action it performs (F-10). */
function collapseTabLabel() {
  return isNavCollapsed()
    ? pick({ en: 'Expand sidebar', uk: 'Розгорнути меню', ru: 'Развернуть меню' })
    : pick({ en: 'Collapse sidebar', uk: 'Згорнути меню', ru: 'Свернуть меню' });
}

/** Re-derive the collapse tab's label from the live shell state. Called after
 *  every toggle and after every re-render (locale change rebuilds the node). */
function syncCollapseTab(root) {
  const btn = root.querySelector('[data-action="collapse-nav"]');
  if (!btn) return;
  const label = collapseTabLabel();
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
}

function highlight(root) {
  const current = canonicalize(location.pathname);
  root.querySelectorAll('.kt-nav__item').forEach((a) => {
    const route = a.getAttribute('data-route');
    a.classList.toggle('is-active', route === current);
    if (route === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function refreshLocalisedHrefs(root) {
  root.querySelectorAll('.kt-nav__item').forEach((a) => {
    const route = a.getAttribute('data-route');
    if (route) a.setAttribute('href', prefixLocale(route));
  });
  const brand = root.querySelector('.kt-nav__brand');
  if (brand) brand.setAttribute('href', prefixLocale('/inspector'));
}

/** Mount the nav into the given root element. Idempotent: re-mounts replace
 *  the existing chrome. Returns an unmount() function for cleanup. */
export function mountNav(root) {
  // Sidebar collapse-tab — toggles .is-nav-collapsed on .kt-shell,
  // persists in localStorage. Mirrors the previous topbar handler but
  // anchored to the sidebar itself per user feedback.
  const COLLAPSE_KEY = 'kt-nav-collapsed';
  const shellRoot = document.querySelector('.kt-shell');
  // Restore persisted state BEFORE the first render. Single
  // .kt-nav__collapse-tab button serves both roles — it rides the sidebar's
  // right edge when expanded, slides to the viewport left edge when
  // collapsed. CSS handles the animation + arrow swap; the button's label is
  // derived from the same .is-nav-collapsed class, so the class has to be
  // settled before renderNav() reads it.
  try {
    if (shellRoot && localStorage.getItem(COLLAPSE_KEY) === '1') {
      shellRoot.classList.add('is-nav-collapsed');
    }
  } catch (_) {
    /* storage disabled */
  }

  root.innerHTML = renderNav();
  highlight(root);

  // Clean up any pre-existing reopen-tab from earlier shell versions.
  const stale = document.querySelector('.kt-shell__reopen-tab');
  if (stale) stale.remove();

  const onCollapse = (e) => {
    e.preventDefault();
    if (!shellRoot) return;
    const collapsed = shellRoot.classList.toggle('is-nav-collapsed');
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (_) {}
    syncCollapseTab(root);
  };

  // F-10: the collapse tab is destroyed and rebuilt from scratch every time
  // kt:lang-change re-renders the nav, so the handler must be bound to
  // whatever node is in the DOM RIGHT NOW — never to one captured at mount.
  // Pre-fix `collapseBtn` was a mount-time const; after the first language
  // switch the live button carried no click listener at all and the sidebar
  // was stuck in whichever state it happened to be in until a full reload.
  let boundCollapseBtn = null;
  function bindCollapse() {
    if (boundCollapseBtn) boundCollapseBtn.removeEventListener('click', onCollapse);
    boundCollapseBtn = root.querySelector('[data-action="collapse-nav"]');
    if (boundCollapseBtn) boundCollapseBtn.addEventListener('click', onCollapse);
    syncCollapseTab(root);
  }
  bindCollapse();

  // Sync active state on every URL change (initial pushState + popstate).
  const onLocationChange = () => {
    refreshLocalisedHrefs(root);
    highlight(root);
  };
  window.addEventListener('popstate', onLocationChange);
  window.addEventListener('kt:pushstate', onLocationChange);
  // Lang change → re-render labels in new locale + refresh hrefs.
  const onLang = () => {
    root.innerHTML = renderNav();
    highlight(root);
    // Re-bind: renderNav() just replaced the collapse tab node.
    bindCollapse();
  };
  window.addEventListener('kt:lang-change', onLang);

  return function unmountNav() {
    if (boundCollapseBtn) boundCollapseBtn.removeEventListener('click', onCollapse);
    window.removeEventListener('popstate', onLocationChange);
    window.removeEventListener('kt:pushstate', onLocationChange);
    window.removeEventListener('kt:lang-change', onLang);
    root.innerHTML = '';
  };
}
