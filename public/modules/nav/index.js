/* ============================================================
   public/modules/nav/index.js — multi-section side navigation.

   Stage 0 chrome (ROADMAP.md). Lives OUTSIDE the registry section
   lifecycle: mounted once at boot into <aside id="kt-nav-root">,
   stays for the life of the page, updates its `active` highlight
   in response to popstate / pushState navigation.

   Grouping (РОБОТА / ДАНІ / ЗНАННЯ — locked in ROADMAP):
     РОБОТА: Інспектор / Стрім / Behavior
     ДАНІ:   Зразки / Діалекти
     ЗНАННЯ: Блог / Доки

   Mobile: below 1024px the sidebar collapses to a drawer (off-canvas),
   togglable by a hamburger button injected into the topbar.
   ============================================================ */
'use strict';

// Section catalog — single source of truth for nav, used by topbar/boot too.
// `route` is the canonical EN path; locale-prefixed variants (/uk/inspector)
// are computed by prefixLocale() based on the current document lang.
export const SECTIONS = [
  // group key, route, icon, label keys
  {
    group: 'work',
    id: 'inspector',
    route: '/inspector',
    icon: '⚡',
    label: { en: 'Inspector', uk: 'Інспектор', ru: 'Инспектор' },
  },
  {
    group: 'work',
    id: 'live',
    route: '/live',
    icon: '📡',
    label: { en: 'Live', uk: 'Стрім', ru: 'Стрим' },
  },
  {
    group: 'work',
    id: 'behavior',
    route: '/behavior',
    icon: '🧪',
    label: { en: 'Behavior', uk: 'Behavior', ru: 'Behavior' },
  },
  {
    group: 'data',
    id: 'library',
    route: '/library',
    icon: '📚',
    label: { en: 'Library', uk: 'Зразки', ru: 'Образцы' },
  },
  {
    group: 'data',
    id: 'dialects',
    route: '/dialects',
    icon: '🎛',
    label: { en: 'Dialects', uk: 'Діалекти', ru: 'Диалекты' },
  },
  {
    group: 'data',
    id: 'insights',
    route: '/insights',
    icon: '📊',
    label: { en: 'Insights', uk: 'Інсайти', ru: 'Аналитика' },
  },
  {
    group: 'know',
    id: 'blog',
    route: '/blog',
    icon: '📰',
    label: { en: 'Blog', uk: 'Блог', ru: 'Блог' },
  },
  {
    group: 'know',
    id: 'docs',
    route: '/docs',
    icon: '📖',
    label: { en: 'Docs', uk: 'Доки', ru: 'Доки' },
  },
];

const GROUP_LABELS = {
  work: { en: 'WORK', uk: 'РОБОТА', ru: 'РАБОТА' },
  data: { en: 'DATA', uk: 'ДАНІ', ru: 'ДАННЫЕ' },
  know: { en: 'KNOWLEDGE', uk: 'ЗНАННЯ', ru: 'ЗНАНИЯ' },
};
const GROUP_ORDER = ['work', 'data', 'know'];

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
      .map(
        (s) => `
          <li>
            <a class="kt-nav__item" href="${escapeHtml(prefixLocale(s.route))}" data-route="${escapeHtml(s.route)}">
              <span class="kt-nav__icon" aria-hidden="true">${escapeHtml(s.icon)}</span>
              <span class="kt-nav__label">${escapeHtml(s.label[l] || s.label.en)}</span>
            </a>
          </li>`,
      )
      .join('');
    return `
      <div class="kt-nav__group">
        <div class="kt-nav__group-label">${escapeHtml(GROUP_LABELS[g][l] || GROUP_LABELS[g].en)}</div>
        <ul class="kt-nav__list">${items}</ul>
      </div>
    `;
  }).join('');

  const collapseLabel = pick({
    en: 'Collapse sidebar',
    uk: 'Згорнути меню',
    ru: 'Свернуть меню',
  });
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
  root.innerHTML = renderNav();
  highlight(root);

  // Sidebar collapse-tab — toggles .is-nav-collapsed on .kt-shell,
  // persists in localStorage. Mirrors the previous topbar handler but
  // anchored to the sidebar itself per user feedback.
  const COLLAPSE_KEY = 'kt-nav-collapsed';
  const shellRoot = document.querySelector('.kt-shell');
  // Restore persisted state. Single .kt-nav__collapse-tab button serves
  // both roles — it rides the sidebar's right edge when expanded, slides
  // to viewport left edge (half visible) when collapsed. CSS handles the
  // animation + arrow swap.
  try {
    if (shellRoot && localStorage.getItem(COLLAPSE_KEY) === '1') {
      shellRoot.classList.add('is-nav-collapsed');
    }
  } catch (_) {
    /* storage disabled */
  }

  // Clean up any pre-existing reopen-tab from earlier shell versions.
  const stale = document.querySelector('.kt-shell__reopen-tab');
  if (stale) stale.remove();

  const collapseBtn = root.querySelector('[data-action="collapse-nav"]');
  const onCollapse = (e) => {
    e.preventDefault();
    if (!shellRoot) return;
    const collapsed = shellRoot.classList.toggle('is-nav-collapsed');
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (_) {}
  };
  if (collapseBtn) collapseBtn.addEventListener('click', onCollapse);

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
  };
  window.addEventListener('kt:lang-change', onLang);

  return function unmountNav() {
    if (collapseBtn) collapseBtn.removeEventListener('click', onCollapse);
    window.removeEventListener('popstate', onLocationChange);
    window.removeEventListener('kt:pushstate', onLocationChange);
    window.removeEventListener('kt:lang-change', onLang);
    root.innerHTML = '';
  };
}
