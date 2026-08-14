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

import { localePath, stripLocale } from '/core/routes.js';

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

// localePrefix() used to live here as one of six verbatim copies across
// modules. Route construction now goes through /core/routes.js so the docs
// links agree with the server's own route table (lib/locale-routes.js).

// ── Localised strings ────────────────────────────────────────────

const L = {
  title: { en: 'Docs', uk: 'Документація', ru: 'Документация' },
  subtitle: {
    en: 'Spec coverage, finding reference, API guide, and architecture overview.',
    uk: 'Покриття специфікацій, референс finding-ID, API-гайд та архітектурний огляд.',
    ru: 'Покрытие спецификаций, референс finding-ID, API-гайд и архитектурный обзор.',
  },
  welcomeTitle: {
    en: 'Welcome to ortbtools Docs',
    uk: 'Ласкаво просимо до документації ortbtools',
    ru: 'Добро пожаловать в документацию ortbtools',
  },
  welcomeBody: {
    en: 'ortbtools is an OpenRTB 2.x / 3.0 inspector and validator. Use the cards below to navigate documentation topics.',
    uk: 'ortbtools — інспектор і валідатор OpenRTB 2.x / 3.0. Використовуй картки нижче для навігації темами документації.',
    ru: 'ortbtools — инспектор и валидатор OpenRTB 2.x / 3.0. Используй карточки ниже для навигации по темам документации.',
  },
  topicsHeading: { en: 'Topics', uk: 'Теми', ru: 'Темы' },

  // Topic cards
  cardAboutTitle: { en: 'About', uk: 'Про проєкт', ru: 'О проекте' },
  cardAboutDesc: {
    en: 'Full introduction: what ortbtools is, which spec versions it covers, and how it fits your stack.',
    uk: 'Повне введення: що таке ortbtools, які версії специфікацій підтримуються і як вписується у твій стек.',
    ru: 'Полное введение: что такое ortbtools, какие версии спецификаций поддерживаются и как вписывается в твой стек.',
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
  filterLabel: {
    en: 'Filter by scale and severity',
    uk: 'Фільтр за шкалою та рівнем',
    ru: 'Фильтр по шкале и уровню',
  },
  dualNote: {
    en: '{n} IDs are emitted at either of two levels and are listed under both.',
    uk: '{n} ID видаються на одному з двох рівнів і показані під обома.',
    ru: '{n} ID выдаются на одном из двух уровней и показаны под обоими.',
  },
  sevOr: { en: 'or', uk: 'або', ru: 'или' },
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
  findingsCountOf: {
    en: '{n} of {total} findings',
    uk: '{n} з {total} findings',
    ru: '{n} из {total} findings',
  },
};

// ── Severity vocabulary ──────────────────────────────────────────
//
// /api/v1/finding-catalog publishes `severity` on the scale named by the
// row's own `family`, and the two scales that carry levels overlap in
// spelling: validator `warning` and crosscheck `warn` are members of two
// different enums, and crosscheck `ok` is the check PASSING, not a mild
// problem.
//
// This page used to ignore `family` completely, and both halves of it were
// wrong against the served data:
//
//   - the filter chips were a hardcoded all / error / warning / info, so on
//     the 2026-08-14 catalog 58 of the 344 served rows (34 crosscheck, 23
//     mirror notes, 1 `question`) matched no chip and were reachable only
//     under "All" — a reference table you cannot filter to the row you want;
//   - severityBadge() collapsed every severity it did not recognise to the
//     `info` CSS class, so a crosscheck row rendered an info-blue badge
//     whose text read "crit" — the colour and the word contradicting each
//     other on screen.
//
// Everything below is keyed on family+severity for that reason. None of it
// is a closed list of what the catalog may contain: the chips are built
// from the rows actually served, so a level added to findings.js tomorrow
// gets its own chip without this file being touched. Only ORDER and LABELS
// are declared here, and both degrade rather than drop: a pair nobody has
// named sorts last, shows its verbatim token, and lands on the neutral base
// badge — which cannot contradict the word it carries.

const FAMILY_UNKNOWN = 'unknown';

/**
 * Preferred display order. Anything not listed sorts after, never away.
 * `unknown` serves no rows today — the two ids that had no emitter were
 * deleted from messages/*.json — but it is a family severity-registry.js
 * still returns, so it stays ordered, labelled and styled here.
 */
const FAMILY_ORDER = ['validator', 'crosscheck', 'mirror-note', FAMILY_UNKNOWN];
const SEVERITY_ORDER = [
  'error',
  'crit',
  'warning',
  'warn',
  'question',
  'info',
  'ok',
  'none',
  FAMILY_UNKNOWN,
];

/**
 * family token → heading, plus one line saying what that scale means. The
 * note is what makes `ok` and `none` readable: `ok` is a pass, and a mirror
 * note has no level at all rather than a quiet `info` (which is what the
 * old suffix-guessing catalog invented for all 23 of them).
 */
const FAMILY_TEXT = {
  validator: {
    label: { en: 'Validator', uk: 'Валідатор', ru: 'Валидатор' },
    note: {
      en: 'the level the validator puts on a finding',
      uk: 'рівень, який валідатор ставить на finding',
      ru: 'уровень, который валидатор ставит на finding',
    },
  },
  crosscheck: {
    label: { en: 'Crosscheck', uk: 'Крос-перевірка', ru: 'Кросс-проверка' },
    note: {
      en: 'a separate scale: crit ≈ error, warn ≈ warning, and ok means the check passed',
      uk: 'окрема шкала: crit ≈ error, warn ≈ warning, а ok означає, що перевірку пройдено',
      ru: 'отдельная шкала: crit ≈ error, warn ≈ warning, а ok означает, что проверка пройдена',
    },
  },
  'mirror-note': {
    label: { en: 'Mirror notes', uk: 'Нотатки mirror', ru: 'Заметки mirror' },
    note: {
      en: 'notes the mirror emits with no level attached at all',
      uk: 'нотатки, які mirror видає взагалі без рівня',
      ru: 'заметки, которые mirror выдаёт вообще без уровня',
    },
  },
  [FAMILY_UNKNOWN]: {
    label: { en: 'No emitter', uk: 'Без емітера', ru: 'Без эмитера' },
    note: {
      en: 'message text and a spec reference exist, but no rule emits this ID',
      uk: 'текст повідомлення і посилання на специфікацію є, але жодне правило не видає цей ID',
      ru: 'текст сообщения и ссылка на спецификацию есть, но ни одно правило не выдаёт этот ID',
    },
  },
};

/** `${family}/${severity}` → chip label. Unnamed pairs fall back to the token. */
const SEVERITY_TEXT = {
  'validator/error': { en: 'Error', uk: 'Помилки', ru: 'Ошибки' },
  'validator/warning': { en: 'Warning', uk: 'Попередження', ru: 'Предупреждения' },
  'validator/info': { en: 'Info', uk: 'Інфо', ru: 'Инфо' },
  'validator/question': { en: 'Question', uk: 'Питання', ru: 'Вопросы' },
  'crosscheck/crit': { en: 'Critical', uk: 'Критичні', ru: 'Критичные' },
  'crosscheck/warn': { en: 'Warning', uk: 'Попередження', ru: 'Предупреждения' },
  'crosscheck/ok': { en: 'Passed', uk: 'Пройдено', ru: 'Пройдено' },
  'mirror-note/none': { en: 'No level', uk: 'Без рівня', ru: 'Без уровня' },
  'unknown/unknown': { en: 'Unknown', uk: 'Невідомо', ru: 'Неизвестно' },
};

/**
 * A response without `family` is a body cached before the registry landed
 * (Cache-Control on the endpoint is 300s). 'unknown' is what the catalog
 * itself calls a row it cannot place — safer than assuming the validator
 * scale, which is the assumption this whole change removes.
 */
function familyOf(item) {
  return (item && item.family) || FAMILY_UNKNOWN;
}

/** Every level an ID can be emitted at; `severity` alone is the fallback. */
function severitiesOf(item) {
  const list = item && Array.isArray(item.severities) ? item.severities.filter(Boolean) : [];
  if (list.length) return list;
  return [(item && item.severity) || FAMILY_UNKNOWN];
}

/** Position in a preference list; values it does not name sort last. */
function orderIndex(order, value) {
  const i = order.indexOf(value);
  return i < 0 ? order.length : i;
}

function familyLabel(family, lang) {
  const t = FAMILY_TEXT[family];
  return t ? pick(t.label, lang) : family;
}

function familyNote(family, lang) {
  const t = FAMILY_TEXT[family];
  return t ? pick(t.note, lang) : '';
}

function severityLabel(family, sev, lang) {
  const t = SEVERITY_TEXT[family + '/' + sev];
  return t ? pick(t, lang) : sev;
}

/** CSS-safe fragment of a class name. */
function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

/**
 * Group the served rows into (family, severity) facets — one chip each.
 *
 * A row is counted once per level it can be emitted at, not once per row,
 * which is the same rule matchesFilter() uses. So `payload.duplicate_key`
 * (error on a consequential path, warning elsewhere) is counted under both
 * chips and shows under both, and every chip's number is exactly the number
 * of rows that chip reveals.
 */
function buildFacets(items) {
  const byKey = new Map();
  for (const item of items) {
    const family = familyOf(item);
    for (const sev of severitiesOf(item)) {
      const key = family + '/' + sev;
      const rec = byKey.get(key) || { key, family, severity: sev, n: 0 };
      rec.n++;
      byKey.set(key, rec);
    }
  }

  const facets = [...byKey.values()];
  const families = [];
  for (const f of facets) if (families.indexOf(f.family) < 0) families.push(f.family);
  families.sort((a, b) => orderIndex(FAMILY_ORDER, a) - orderIndex(FAMILY_ORDER, b));

  return families.map((family) => ({
    family,
    facets: facets
      .filter((f) => f.family === family)
      .sort(
        (a, b) => orderIndex(SEVERITY_ORDER, a.severity) - orderIndex(SEVERITY_ORDER, b.severity),
      ),
  }));
}

/** `all`, or a `${family}/${severity}` facet key. */
function matchesFilter(item, filter) {
  if (filter === 'all') return true;
  const cut = filter.indexOf('/');
  if (cut < 0) return false;
  return (
    familyOf(item) === filter.slice(0, cut) &&
    severitiesOf(item).indexOf(filter.slice(cut + 1)) >= 0
  );
}

// ── Overview view ────────────────────────────────────────────────

function renderOverview(lang) {
  const aboutHref = localePath('/about', lang);

  const topicCards = [
    {
      icon: '📖',
      titleKey: 'cardAboutTitle',
      descKey: 'cardAboutDesc',
      actionKey: 'cardAboutAction',
      href: aboutHref,
      external: true,
    },
    {
      icon: '📋',
      titleKey: 'cardSpecTitle',
      descKey: 'cardSpecDesc',
      actionKey: 'cardSpecAction',
      href: aboutHref,
      external: true,
    },
    {
      icon: '🔍',
      titleKey: 'cardFindingsTitle',
      descKey: 'cardFindingsDesc',
      actionKey: 'cardFindingsAction',
      href: localePath('/docs/findings', lang),
      external: false,
    },
    {
      icon: '🏗',
      titleKey: 'cardArchTitle',
      descKey: 'cardArchDesc',
      actionKey: 'cardArchAction',
      href: aboutHref,
      external: true,
    },
    {
      icon: '🔌',
      titleKey: 'cardIntegTitle',
      descKey: 'cardIntegDesc',
      actionKey: 'cardIntegAction',
      href: aboutHref,
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

/**
 * The class carries BOTH halves of the pair. It used to be picked from the
 * severity string alone with `info` as the catch-all, so a crosscheck row
 * rendered `<span class="docs-badge docs-badge--info">crit</span>` — an
 * info-blue pill reading "crit". A pair the stylesheet has no rule for now
 * falls through to the neutral base `.docs-badge`, which asserts nothing.
 *
 * The badge text stays the verbatim token the API published: this table is
 * the reference for what `severity` can hold, so it has to show the value,
 * not a translation of it. The localised reading is in the title and in the
 * chip that filters by it.
 */
function severityBadge(family, sev, lang) {
  const cls = 'docs-badge--' + slug(family) + '-' + slug(sev);
  const title = familyLabel(family, lang) + ' · ' + severityLabel(family, sev, lang);
  return `<span class="docs-badge ${cls}" title="${escapeHtml(title)}">${escapeHtml(sev)}</span>`;
}

/**
 * Every level the ID can carry, plus the scale they are on. Showing only
 * `severity` would hide the second level of the four IDs that have one
 * (`payload.duplicate_key`, `payload.unsafe_number` and the two
 * `behavior.malicious.*`) with nothing on screen to say so.
 */
function severityCell(item, lang) {
  const family = familyOf(item);
  const badges = severitiesOf(item)
    .map((s) => severityBadge(family, s, lang))
    .join(`<span class="docs-sev__or">${escapeHtml(pick(L.sevOr, lang))}</span>`);
  return (
    badges +
    `<span class="docs-sev__family" title="${escapeHtml(familyLabel(family, lang))}">` +
    escapeHtml(family) +
    `</span>`
  );
}

function renderCatalogShell(lang) {
  // F-08: this used to be `${lp || '/'}/docs`. For en, localePrefix('en') is
  // '' and `'' || '/'` collapses to '/', so the href rendered as `//docs` —
  // a protocol-relative URL the browser resolves to https://docs/ and fails
  // with ERR_NAME_NOT_RESOLVED. UK/RU never noticed because their prefix is
  // truthy. localePath() has no empty-string hole to fall through.
  const docsHref = localePath('/docs', lang);
  return `
    <section class="docs-section docs-catalog">
      <div class="docs-breadcrumb">
        <a href="${escapeHtml(docsHref)}">${escapeHtml(pick(L.backDocs, lang))}</a>
        <span class="docs-breadcrumb__sep">/</span>
        <span class="docs-breadcrumb__current">${escapeHtml(pick(L.catalogTitle, lang))}</span>
      </div>
      <header class="docs-section__head">
        <h1>${escapeHtml(pick(L.catalogTitle, lang))}</h1>
        <p class="docs-section__sub">${escapeHtml(pick(L.catalogSub, lang))}</p>
      </header>
      <!-- Chips are built from the response, not hardcoded: a hardcoded
           all/error/warning/info left 60 of the 346 served rows matching no
           chip at all. Empty until the fetch lands. -->
      <div class="docs-facets" data-facets role="group" aria-label="${escapeHtml(pick(L.filterLabel, lang))}"></div>
      <p class="docs-stats" data-stats></p>
      <div class="docs-loading">${escapeHtml(pick(L.loading, lang))}</div>
    </section>
  `;
}

/** Chip row per family, so `warn` is never read on the `warning` scale. */
function renderFacets(groups, total, dualCount, lang) {
  const chip = (filter, label, n, title) =>
    `<button type="button" class="docs-chip" data-filter="${escapeHtml(filter)}" aria-pressed="false" title="${escapeHtml(title)}">` +
    `${escapeHtml(label)} <span class="docs-chip__n">${n}</span></button>`;

  const groupsHtml = groups
    .map((g) => {
      const note = familyNote(g.family, lang);
      const chips = g.facets
        .map((f) => chip(f.key, severityLabel(f.family, f.severity, lang), f.n, f.key))
        .join('');
      return `
      <div class="docs-chip-group">
        <p class="docs-chip-group__label">
          <span class="docs-chip-group__name">${escapeHtml(familyLabel(g.family, lang))}</span>
          ${note ? `<span class="docs-chip-group__note">${escapeHtml(note)}</span>` : ''}
        </p>
        <div class="docs-chips">${chips}</div>
      </div>`;
    })
    .join('');

  // Chip counts add up to more than the row count when an ID carries two
  // levels. Saying so beats a table whose numbers quietly do not sum.
  const dual = dualCount
    ? `<p class="docs-facets__note">${escapeHtml(pick(L.dualNote, lang).replace('{n}', dualCount))}</p>`
    : '';

  return (
    `<div class="docs-chips docs-chips--all">${chip('all', pick(L.chipAll, lang), total, 'all')}</div>` +
    `<div class="docs-chip-groups">${groupsHtml}</div>` +
    dual
  );
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
        <td class="col-sev">${severityCell(item, lang)}</td>
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
  const facetsEl = root.querySelector('[data-facets]');

  // Container for the table — replaces loading spinner once
  const contentWrap = document.createElement('div');
  contentWrap.className = 'docs-content-wrap';
  const loadingEl = root.querySelector('.docs-loading');
  if (loadingEl) loadingEl.replaceWith(contentWrap);

  function applyFilter(filter) {
    activeFilter = filter;
    const filtered = filter === 'all' ? allItems : allItems.filter((i) => matchesFilter(i, filter));

    // Update chip active states
    root.querySelectorAll('.docs-chip').forEach((chip) => {
      const on = chip.dataset.filter === filter;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // Update stats. Under a facet the denominator matters — "11 findings"
    // out of context reads as the whole catalog.
    if (statsEl) {
      statsEl.textContent = pick(filter === 'all' ? L.findingsCount : L.findingsCountOf, lang)
        .replace('{n}', filtered.length)
        .replace('{total}', allItems.length);
    }

    // Render table into stable content container
    contentWrap.innerHTML = renderTable(filtered, lang);
  }

  // Delegated, because the chips do not exist until the response lands and
  // are re-rendered wholesale when it does — per-chip listeners bound in the
  // shell would have nothing to bind to.
  if (facetsEl) {
    facetsEl.addEventListener(
      'click',
      (e) => {
        const chip = e.target.closest('.docs-chip');
        if (chip) applyFilter(chip.dataset.filter);
      },
      { signal },
    );
  }

  // Fetch data
  try {
    allItems = await fetchCatalog(lang, signal);
    const dualCount = allItems.filter((i) => severitiesOf(i).length > 1).length;
    if (facetsEl) {
      facetsEl.innerHTML = renderFacets(buildFacets(allItems), allItems.length, dualCount, lang);
    }
    applyFilter(activeFilter);
  } catch (e) {
    if (e.name === 'AbortError') return;
    // Written into contentWrap, not `.docs-loading`: that element was
    // replaced by contentWrap above before the fetch ever started, so the
    // old `root.querySelector('.docs-loading')` here always found null and
    // a failed catalog load left the page silently blank.
    contentWrap.innerHTML =
      '<p class="docs-empty">' + escapeHtml(pick(L.errorLoad, lang) + ' ' + e.message) + '</p>';
  }
}

// ── Module export ────────────────────────────────────────────────

export default {
  id: 'docs',
  css: '/modules/docs/docs.css',
  route: '/docs',
  manifest: {
    title: { en: 'Docs', uk: 'Документація', ru: 'Документация' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;

    // Determine which sub-page to render by pathname. stripLocale() is the
    // same prefix-removal the server and nav use — the inline regex this
    // replaced also ate the prefix of any path merely *starting* with those
    // two letters (/ukraine → /raine).
    const { path: canonical } = stripLocale(location.pathname);
    const isFindingsCatalog = canonical === '/docs/findings';

    if (isFindingsCatalog) {
      await mountCatalog(root, lang, ctx.signal);
    } else {
      root.innerHTML = renderOverview(lang);
    }
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
