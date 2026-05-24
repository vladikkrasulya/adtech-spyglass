/* ============================================================
   public/modules/docs/index.js — /docs section module.

   Stage 1 of ROADMAP. Two sub-pages:

     1. Overview (default /docs) — welcome card + grid of doc topic
        cards linking to sub-pages and legacy about pages.
     2. Finding catalog (/docs/findings) — auto-generated table of
        every finding ID with severity badge, message template, and
        spec-ref link.

   Both are served from this single registry module. The shell-boot
   registers both routes (/docs and /docs/findings) pointing at
   module id 'docs'. mount() checks location.pathname to pick view.

   Backend used:
     - GET /api/v1/finding-catalog?lang=<lang>
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function localePrefix(lang) {
  return lang === 'en' ? '' : '/' + lang;
}

// ── Localised strings ────────────────────────────────────────────

const L = {
  title: { en: 'Docs', uk: 'Документація', ru: 'Документация' },
  subtitle: {
    en: 'Spec coverage, finding reference, API guide, and architecture overview.',
    uk: 'Покриття специфікацій, референс finding-ID, API-гайд та архітектурний огляд.',
    ru: 'Покрытие спецификаций, референс finding-ID, API-гайд и архитектурный обзор.',
  },
  welcomeTitle: {
    en: 'Welcome to Spyglass Docs',
    uk: 'Ласкаво просимо до документації Spyglass',
    ru: 'Добро пожаловать в документацию Spyglass',
  },
  welcomeBody: {
    en: 'Spyglass is an OpenRTB 2.x / 3.0 inspector and validator. Use the cards below to navigate documentation topics.',
    uk: 'Spyglass — інспектор і валідатор OpenRTB 2.x / 3.0. Використовуй картки нижче для навігації темами документації.',
    ru: 'Spyglass — инспектор и валидатор OpenRTB 2.x / 3.0. Используй карточки ниже для навигации по темам документации.',
  },
  topicsHeading: { en: 'Topics', uk: 'Теми', ru: 'Темы' },

  // Topic cards
  cardAboutTitle: { en: 'About', uk: 'Про проєкт', ru: 'О проекте' },
  cardAboutDesc: {
    en: 'Full introduction: what Spyglass is, which spec versions it covers, and how it fits your stack.',
    uk: 'Повне введення: що таке Spyglass, які версії специфікацій підтримуються і як вписується у твій стек.',
    ru: 'Полное введение: что такое Spyglass, какие версии спецификаций поддерживаются и как вписывается в твой стек.',
  },
  cardAboutAction: {
    en: 'Open full docs →',
    uk: 'Відкрити повну документацію →',
    ru: 'Открыть полную документацию →',
  },

  cardSpecTitle: { en: 'Spec coverage', uk: 'Покриття специфікацій', ru: 'Покрытие спецификаций' },
  cardSpecDesc: {
    en: 'Tables mapping every oRTB 2.6 / 3.0 field to its validation rule status (covered, partial, planned).',
    uk: 'Таблиці відповідності кожного поля oRTB 2.6 / 3.0 до стану валідаційного правила (покрито, частково, в планах).',
    ru: 'Таблицы соответствия каждого поля oRTB 2.6 / 3.0 к статусу валидационного правила (покрыто, частично, в планах).',
  },
  cardSpecAction: {
    en: 'Open full docs →',
    uk: 'Відкрити повну документацію →',
    ru: 'Открыть полную документацию →',
  },

  cardFindingsTitle: { en: 'Finding catalog', uk: 'Каталог findings', ru: 'Каталог findings' },
  cardFindingsDesc: {
    en: 'Every finding ID with severity badge, message template, and IAB spec cross-reference link.',
    uk: 'Кожен finding-ID з бейджем серйозності, шаблоном повідомлення та посиланням на специфікацію IAB.',
    ru: 'Каждый finding-ID с бейджем серьёзности, шаблоном сообщения и ссылкой на спецификацию IAB.',
  },
  cardFindingsAction: {
    en: 'Browse catalog →',
    uk: 'Переглянути каталог →',
    ru: 'Просмотреть каталог →',
  },

  cardArchTitle: { en: 'Architecture', uk: 'Архітектура', ru: 'Архитектура' },
  cardArchDesc: {
    en: 'How the validator pipeline, dialect overlays, and event log fit together under the hood.',
    uk: 'Як валідаційний пайплайн, overlay діалектів та event log поєднуються під капотом.',
    ru: 'Как валидационный пайплайн, overlay диалектов и event log соединяются под капотом.',
  },
  cardArchAction: {
    en: 'Open full docs →',
    uk: 'Відкрити повну документацію →',
    ru: 'Открыть полную документацию →',
  },

  cardIntegTitle: { en: 'Integration', uk: 'Інтеграція', ru: 'Интеграция' },
  cardIntegDesc: {
    en: 'REST API reference, authentication, batch analysis, and embed / stream endpoints.',
    uk: 'REST API референс, автентифікація, пакетний аналіз та embed / stream ендпоінти.',
    ru: 'REST API референс, аутентификация, пакетный анализ и embed / stream эндпоинты.',
  },
  cardIntegAction: {
    en: 'Open full docs →',
    uk: 'Відкрити повну документацію →',
    ru: 'Открыть полную документацию →',
  },

  // Finding catalog page
  catalogTitle: { en: 'Finding catalog', uk: 'Каталог findings', ru: 'Каталог findings' },
  catalogSub: {
    en: 'Auto-generated from finding message files. Each ID maps to a severity, human-readable message, and IAB spec section.',
    uk: 'Автоматично згенеровано з файлів повідомлень. Кожен ID → серйозність, читабельне повідомлення, розділ специфікації IAB.',
    ru: 'Автоматически сгенерировано из файлов сообщений. Каждый ID → серьёзность, читаемое сообщение, раздел спецификации IAB.',
  },
  chipAll: { en: 'All', uk: 'Всі', ru: 'Все' },
  chipError: { en: 'Error', uk: 'Помилки', ru: 'Ошибки' },
  chipWarn: { en: 'Warning', uk: 'Попередження', ru: 'Предупреждения' },
  chipInfo: { en: 'Info', uk: 'Інфо', ru: 'Инфо' },
  colId: { en: 'Finding ID', uk: 'Finding ID', ru: 'Finding ID' },
  colSev: { en: 'Severity', uk: 'Серйозність', ru: 'Серьёзность' },
  colMsg: { en: 'Message', uk: 'Повідомлення', ru: 'Сообщение' },
  colSpec: { en: 'Spec ref', uk: 'Специфікація', ru: 'Спецификация' },
  specLink: { en: 'IAB spec ↗', uk: 'IAB spec ↗', ru: 'IAB spec ↗' },
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  errorLoad: {
    en: 'Failed to load catalog:',
    uk: 'Не вдалося завантажити каталог:',
    ru: 'Не удалось загрузить каталог:',
  },
  backDocs: { en: 'Docs', uk: 'Документація', ru: 'Документация' },
  findingsCount: { en: '{n} findings', uk: '{n} findings', ru: '{n} findings' },
};

// ── Overview view ────────────────────────────────────────────────

function renderOverview(lang) {
  const lp = localePrefix(lang);

  const topicCards = [
    {
      icon: '📖',
      titleKey: 'cardAboutTitle',
      descKey: 'cardAboutDesc',
      actionKey: 'cardAboutAction',
      href: lp + '/about',
      external: true,
    },
    {
      icon: '📋',
      titleKey: 'cardSpecTitle',
      descKey: 'cardSpecDesc',
      actionKey: 'cardSpecAction',
      href: lp + '/about',
      external: true,
    },
    {
      icon: '🔍',
      titleKey: 'cardFindingsTitle',
      descKey: 'cardFindingsDesc',
      actionKey: 'cardFindingsAction',
      href: lp + '/docs/findings',
      external: false,
    },
    {
      icon: '🏗',
      titleKey: 'cardArchTitle',
      descKey: 'cardArchDesc',
      actionKey: 'cardArchAction',
      href: lp + '/about',
      external: true,
    },
    {
      icon: '🔌',
      titleKey: 'cardIntegTitle',
      descKey: 'cardIntegDesc',
      actionKey: 'cardIntegAction',
      href: lp + '/about',
      external: true,
    },
  ];

  const cardsHtml = topicCards
    .map((c) => {
      const extClass = c.external ? ' docs-card--external' : '';
      return `
      <a class="docs-card${extClass}" href="${escapeHtml(c.href)}"${c.external ? ' data-external' : ''}>
        <span class="docs-card__icon">${c.icon}</span>
        <h3 class="docs-card__title">${escapeHtml(pick(L[c.titleKey], lang))}</h3>
        <p class="docs-card__desc">${escapeHtml(pick(L[c.descKey], lang))}</p>
        <span class="docs-card__action">${escapeHtml(pick(L[c.actionKey], lang))}</span>
      </a>
    `;
    })
    .join('');

  return `
    <section class="docs-section">
      <header class="docs-section__head">
        <h1>${escapeHtml(pick(L.title, lang))}</h1>
        <p class="docs-section__sub">${escapeHtml(pick(L.subtitle, lang))}</p>
      </header>
      <div class="docs-welcome">
        <h2>${escapeHtml(pick(L.welcomeTitle, lang))}</h2>
        <p>${escapeHtml(pick(L.welcomeBody, lang))}</p>
      </div>
      <div class="docs-grid">${cardsHtml}</div>
    </section>
  `;
}

// ── Finding catalog view ─────────────────────────────────────────

function severityBadge(sev) {
  const cls = sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : 'info';
  return `<span class="docs-badge docs-badge--${cls}">${escapeHtml(sev)}</span>`;
}

function renderCatalogShell(lang) {
  const lp = localePrefix(lang);
  return `
    <section class="docs-section docs-catalog">
      <div class="docs-breadcrumb">
        <a href="${lp || '/'}/docs">${escapeHtml(pick(L.backDocs, lang))}</a>
        <span class="docs-breadcrumb__sep">/</span>
        <span class="docs-breadcrumb__current">${escapeHtml(pick(L.catalogTitle, lang))}</span>
      </div>
      <header class="docs-section__head">
        <h1>${escapeHtml(pick(L.catalogTitle, lang))}</h1>
        <p class="docs-section__sub">${escapeHtml(pick(L.catalogSub, lang))}</p>
      </header>
      <div class="docs-chips" role="group" aria-label="severity filter">
        <button type="button" class="docs-chip is-active" data-sev="all">${escapeHtml(pick(L.chipAll, lang))}</button>
        <button type="button" class="docs-chip" data-sev="error">${escapeHtml(pick(L.chipError, lang))}</button>
        <button type="button" class="docs-chip" data-sev="warning">${escapeHtml(pick(L.chipWarn, lang))}</button>
        <button type="button" class="docs-chip" data-sev="info">${escapeHtml(pick(L.chipInfo, lang))}</button>
      </div>
      <p class="docs-stats" data-stats></p>
      <div class="docs-loading">${escapeHtml(pick(L.loading, lang))}</div>
    </section>
  `;
}

function renderTable(items, lang) {
  const rows = items
    .map((item) => {
      const specCell = item.specRef
        ? `<a href="${escapeHtml(item.specRef)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick(L.specLink, lang))}</a>`
        : '—';
      return `
      <tr id="finding-${escapeHtml(item.id)}">
        <td class="col-id">${escapeHtml(item.id)}</td>
        <td>${severityBadge(item.severity)}</td>
        <td class="col-msg">${escapeHtml(item.message)}</td>
        <td class="col-spec">${specCell}</td>
      </tr>
    `;
    })
    .join('');

  if (!rows) {
    return `<p class="docs-empty">—</p>`;
  }

  return `
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead>
          <tr>
            <th>${escapeHtml(pick(L.colId, lang))}</th>
            <th>${escapeHtml(pick(L.colSev, lang))}</th>
            <th>${escapeHtml(pick(L.colMsg, lang))}</th>
            <th>${escapeHtml(pick(L.colSpec, lang))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function fetchCatalog(lang, signal) {
  const r = await fetch(`/api/v1/finding-catalog?lang=${encodeURIComponent(lang)}`, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).items || [];
}

async function mountCatalog(root, lang, signal) {
  root.innerHTML = renderCatalogShell(lang);

  let allItems = [];
  let activeFilter = 'all';

  const statsEl = root.querySelector('[data-stats]');
  const contentArea = root.querySelector('.docs-loading');

  // Container for the table — replaces loading spinner once
  const contentWrap = document.createElement('div');
  contentWrap.className = 'docs-content-wrap';
  const loadingEl = root.querySelector('.docs-loading');
  if (loadingEl) loadingEl.replaceWith(contentWrap);

  function applyFilter(filter) {
    activeFilter = filter;
    const filtered = filter === 'all' ? allItems : allItems.filter((i) => i.severity === filter);

    // Update chip active states
    root.querySelectorAll('.docs-chip').forEach((chip) => {
      chip.classList.toggle('is-active', chip.dataset.sev === filter);
    });

    // Update stats
    const countLabel = pick(L.findingsCount, lang).replace('{n}', filtered.length);
    if (statsEl) statsEl.textContent = countLabel;

    // Render table into stable content container
    contentWrap.innerHTML = renderTable(filtered, lang);
  }

  // Chip click delegation
  root.querySelectorAll('.docs-chip').forEach((chip) => {
    chip.addEventListener('click', () => applyFilter(chip.dataset.sev), { signal });
  });

  // Fetch data
  try {
    allItems = await fetchCatalog(lang, signal);
    const loading = root.querySelector('.docs-loading');
    if (loading) loading.outerHTML = '<div class="docs-table-placeholder"></div>';
    applyFilter(activeFilter);
  } catch (e) {
    if (e.name === 'AbortError') return;
    const loading = root.querySelector('.docs-loading');
    if (loading) loading.textContent = pick(L.errorLoad, lang) + ' ' + e.message;
  }
}

// ── Module export ────────────────────────────────────────────────

export default {
  id: 'docs',
  route: '/docs',
  manifest: {
    title: { en: 'Docs', uk: 'Документація', ru: 'Документация' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;

    // Load section CSS (deferred to first mount; cleaned on unmount).
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = '/modules/docs/docs.css';
    document.head.appendChild(cssLink);
    ctx.addCleanup(() => cssLink.remove());

    // Determine which sub-page to render by pathname.
    const pathname = location.pathname;
    // Strip locale prefix for comparison
    const canonical = pathname.replace(/^\/(uk|ru)/, '');
    const isFindingsCatalog = canonical === '/docs/findings';

    if (isFindingsCatalog) {
      await mountCatalog(root, lang, ctx.signal);
    } else {
      root.innerHTML = renderOverview(lang);
    }
  },

  async unmount(_root) {
    /* registry sweeps DOM; cleanup queue handles cssLink */
  },
};
