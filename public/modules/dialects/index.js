/* ============================================================
   public/modules/dialects/index.js — /dialects section module.

   Stage 1 of ROADMAP. Single page:

     1. Intro card — 3-locale description of what dialects are.
     2. Built-in dialect catalog — cards for iab, ext-rtb, inpage-push.
        Each card shows rule count + severity distribution (fetched from
        /api/v1/finding-catalog) and a "Use this dialect" button that
        copies the slug to clipboard.
     3. User dialect builder — logged-in users get an "Open builder"
        card that navigates to /uk/inspector and triggers
        window.OrtbtoolsIntelBuilder.open() if available.
        Anonymous users see a sign-in CTA.

   Backend endpoints used:
     - GET /api/v1/finding-catalog
     - GET /api/auth/me
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

// ── Localised strings ─────────────────────────────────────────────

const L = {
  title: { en: 'Dialect catalog', uk: 'Каталог діалектів', ru: 'Каталог диалектов' },
  subtitle: {
    en: 'Built-in validation overlays and the user dialect builder — tune ortbtools to your traffic.',
    uk: 'Вбудовані overlay-валідатори та конструктор діалектів — налаштуй ortbtools під свій трафік.',
    ru: 'Встроенные overlay-валидаторы и конструктор диалектов — настрой ortbtools под свой трафик.',
  },

  introTitle: {
    en: 'What are dialects?',
    uk: 'Що таке діалекти?',
    ru: 'Что такое диалекты?',
  },
  introBody: {
    en: 'A dialect is a named validation overlay that extends or replaces the canonical IAB OpenRTB ruleset. The IAB baseline covers the public spec; dialect overlays add vendor-specific rules, suppress irrelevant warnings, or introduce new finding IDs that only make sense for a given traffic type. Select a dialect in the inspector footer — ortbtools activates the corresponding overlay alongside the base rules.',
    uk: 'Діалект — це іменований validation overlay, який розширює або замінює канонічний IAB OpenRTB ruleset. Базовий IAB охоплює публічну специфікацію; overlay діалекту додає вендор-специфічні правила, пригнічує нерелевантні попередження або вводить нові finding ID, що мають сенс лише для конкретного типу трафіку. Вибери діалект у підвалі інспектора — ortbtools активує відповідний overlay разом з базовими правилами.',
    ru: 'Диалект — это именованный validation overlay, который расширяет или заменяет канонический IAB OpenRTB ruleset. Базовый IAB покрывает публичную спецификацию; overlay диалекта добавляет вендор-специфичные правила, подавляет нерелевантные предупреждения или вводит новые finding ID, которые имеют смысл только для конкретного типа трафика. Выбери диалект в подвале инспектора — ortbtools активирует соответствующий overlay вместе с базовыми правилами.',
  },

  builtinHeading: {
    en: 'Built-in dialects',
    uk: 'Вбудовані діалекти',
    ru: 'Встроенные диалекты',
  },
  rulesLabel: {
    en: 'rules',
    uk: 'правила',
    ru: 'правила',
  },
  useDialect: {
    en: 'Copy slug',
    uk: 'Копіювати slug',
    ru: 'Копировать slug',
  },
  toastCopied: {
    en: 'Dialect copied — paste in inspector footer',
    uk: 'Діалект скопійовано — встав у підвал інспектора',
    ru: 'Диалект скопирован — вставь в подвал инспектора',
  },

  builderHeading: {
    en: 'Your custom dialects',
    uk: 'Твої власні діалекти',
    ru: 'Твои собственные диалекты',
  },
  builderDesc: {
    en: 'Derive overlays from observed *.ext.* fields in your samples. Built in-browser; stored as plaintext account metadata.',
    uk: 'Виводь overlay з *.ext.* полів у твоїх зразках. Будується в браузері; зберігається як відкриті метадані акаунта.',
    ru: 'Выводи overlay из *.ext.* полей в твоих образцах. Строится в браузере; хранится как открытые метаданные аккаунта.',
  },
  openBuilder: {
    en: 'Open builder',
    uk: 'Відкрити конструктор',
    ru: 'Открыть конструктор',
  },
  anonPrompt: {
    en: 'Sign in to create and manage custom dialects. Dialect names and mappings are readable by the server.',
    uk: 'Увійди, щоб створювати власні діалекти. Назви й мапінги діалектів читає сервер.',
    ru: 'Войди, чтобы создавать собственные диалекты. Названия и маппинги диалектов читает сервер.',
  },
  signIn: {
    en: 'Sign in',
    uk: 'Увійти',
    ru: 'Войти',
  },

  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  error: {
    en: 'Failed to load catalog.',
    uk: 'Помилка завантаження каталогу.',
    ru: 'Ошибка загрузки каталога.',
  },
};

// ── Severity vocabulary ───────────────────────────────────────────
//
// The severity bar on each card used to tally exactly three buckets —
// `severity === 'error' | 'warning' | 'info'` — and drop everything else on
// the floor without a word. Measured against the catalog on 2026-08-14 that
// silently omitted 58 of the 330 rows in the `iab` bucket: 34 crosscheck
// rows on a different scale (crit / warn / ok), 23 mirror notes that carry
// no level at all, and the single `question`. A count that leaves rows out
// without saying so is the same defect the severity registry was built to
// remove, so the bar now groups by `family` and covers every row.
//
// `unknown` (message text, no emitter) serves no rows today but is a family
// the registry can return, so it is ordered and labelled here rather than
// waiting for the next one to go missing.
//
// Nothing below is a closed list: a level added to findings.js tomorrow
// gets its own chip from the data. Only order and labels are declared, and
// both fall back to "last, shown verbatim".

const FAMILY_UNKNOWN = 'unknown';
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

/** family token → the bar's row label. Unnamed families show their token. */
const FAMILY_LABEL = {
  validator: { en: 'Validation', uk: 'Валідація', ru: 'Валидация' },
  crosscheck: { en: 'Crosscheck', uk: 'Крос-перевірка', ru: 'Кросс-проверка' },
  'mirror-note': { en: 'Mirror notes', uk: 'Нотатки mirror', ru: 'Заметки mirror' },
  [FAMILY_UNKNOWN]: { en: 'No emitter', uk: 'Без емітера', ru: 'Без эмитера' },
};

/** `${family}/${severity}` → the reading of that value on its own scale. */
const SEVERITY_MEANING = {
  'crosscheck/crit': { en: 'critical', uk: 'критично', ru: 'критично' },
  'crosscheck/warn': { en: 'warning', uk: 'попередження', ru: 'предупреждение' },
  'crosscheck/ok': { en: 'the check passed', uk: 'перевірку пройдено', ru: 'проверка пройдена' },
  'mirror-note/none': { en: 'no level', uk: 'без рівня', ru: 'без уровня' },
  'unknown/unknown': {
    en: 'no rule emits this ID',
    uk: 'жодне правило не видає цей ID',
    ru: 'ни одно правило не выдаёт этот ID',
  },
};

/**
 * dialects.css carries exactly three severity colours and they are the
 * validator's. Crosscheck `crit` is deliberately NOT painted with
 * `--error`: the two are separate enums, and giving them one colour would
 * assert in CSS the equivalence this change exists to stop asserting in
 * data. Unmapped pairs fall through to the neutral base `.dlc-sev-chip`,
 * which cannot contradict the word it carries — `ok` in particular must
 * never pick up a warning tint, it is the check passing.
 */
const SEVERITY_CLASS = {
  'validator/error': 'dlc-sev-chip--error',
  'validator/warning': 'dlc-sev-chip--warning',
  'validator/info': 'dlc-sev-chip--info',
};

function orderIndex(order, value) {
  const i = order.indexOf(value);
  return i < 0 ? order.length : i;
}

/**
 * A body cached before the severity registry landed has no `family`
 * (Cache-Control on the endpoint is 300s). 'unknown' is what the catalog
 * itself calls a row it cannot place — better than assuming the validator
 * scale.
 */
function familyOf(item) {
  return (item && item.family) || FAMILY_UNKNOWN;
}

// ── Built-in dialect definitions ──────────────────────────────────

const BUILTIN_DIALECTS = [
  {
    slug: 'iab',
    title: { en: 'IAB OpenRTB', uk: 'IAB OpenRTB', ru: 'IAB OpenRTB' },
    desc: {
      en: 'Canonical IAB OpenRTB 2.x / 3.0 baseline. Covers the full public specification — required fields, type constraints, enum validity, and payload integrity for banner, video, native, and audio impression objects.',
      uk: "Канонічний IAB OpenRTB 2.x / 3.0 baseline. Охоплює повну публічну специфікацію — обов'язкові поля, обмеження типів, валідність enum та цілісність payload для banner, video, native та audio impression об'єктів.",
      ru: 'Канонический IAB OpenRTB 2.x / 3.0 baseline. Покрывает полную публичную спецификацию — обязательные поля, ограничения типов, валидность enum и целостность payload для banner, video, native и audio impression объектов.',
    },
    prefix: null, // iab = everything not extrtb. / inpage-push.
  },
  {
    slug: 'ext-rtb',
    title: { en: 'Extended RTB', uk: 'Extended RTB', ru: 'Extended RTB' },
    desc: {
      en: 'Extended-RTB overlay — adds ext.bsection / ext.btags (vendor blocking taxonomy arrays), ext.subage* push-traffic detection, and restricts macros to AUCTION_PRICE / AUCTION_CURRENCY / AUCTION_LOSS. Use for traffic routed via extended-RTB-aware SSPs.',
      uk: 'Extended-RTB overlay — додає ext.bsection / ext.btags (масиви вендорної блокуючої таксономії), виявлення push-трафіку через ext.subage*, та обмежує макроси до AUCTION_PRICE / AUCTION_CURRENCY / AUCTION_LOSS. Для трафіку через Extended-RTB-сумісні SSP.',
      ru: 'Extended-RTB overlay — добавляет ext.bsection / ext.btags (массивы вендорной блокирующей таксономии), обнаружение push-трафика через ext.subage*, и ограничивает макросы до AUCTION_PRICE / AUCTION_CURRENCY / AUCTION_LOSS. Для трафика через Extended-RTB-совместимые SSP.',
    },
    prefix: 'extrtb.',
  },
  {
    slug: 'inpage-push',
    title: { en: 'In-Page Push', uk: 'In-Page Push', ru: 'In-Page Push' },
    desc: {
      en: 'In-page push creative format — validates bid.ext.title / image / url / icon / description / cta fields instead of adm/nurl. Suppresses the IAB payload_missing warning for push bids. Required, optional, and length rules for all creative fields.',
      uk: "Формат In-page push креативів — валідує поля bid.ext.title / image / url / icon / description / cta замість adm/nurl. Пригнічує IAB попередження payload_missing для push-бідів. Обов'язкові, необов'язкові та правила довжини для всіх creative-полів.",
      ru: 'Формат In-page push креативов — валидирует поля bid.ext.title / image / url / icon / description / cta вместо adm/nurl. Подавляет IAB предупреждение payload_missing для push-бидов. Обязательные, необязательные и правила длины для всех creative-полей.',
    },
    prefix: 'inpage-push.',
  },
];

// ── HTML renderers ────────────────────────────────────────────────

function renderShell(lang) {
  return `
    <section class="dlc-section">
      <header class="dlc-section__head">
        <h1>${escapeHtml(pick(L.title, lang))}</h1>
        <p class="dlc-section__sub">${escapeHtml(pick(L.subtitle, lang))}</p>
      </header>
      <div class="dlc-intro">
        <h2>${escapeHtml(pick(L.introTitle, lang))}</h2>
        <p>${escapeHtml(pick(L.introBody, lang))}</p>
      </div>
      <div id="dlc-catalog-root">
        <p class="dlc-loading">${escapeHtml(pick(L.loading, lang))}</p>
      </div>
      <div id="dlc-builder-root">
        <p class="dlc-loading">${escapeHtml(pick(L.loading, lang))}</p>
      </div>
    </section>
  `;
}

/**
 * One row per family, so the reader is never asked to tell crosscheck
 * `warn` from validator `warning` by the word alone. The chip text stays
 * the verbatim token the catalog published; its reading on its own scale is
 * in the title.
 */
function renderSevBar(lang, counts) {
  return (counts.groups || [])
    .map((group) => {
      const label = escapeHtml(
        FAMILY_LABEL[group.family] ? pick(FAMILY_LABEL[group.family], lang) : group.family,
      );
      const chips = group.facets
        .map((f) => {
          const cls = SEVERITY_CLASS[f.family + '/' + f.severity];
          const meaning = SEVERITY_MEANING[f.family + '/' + f.severity];
          const title = meaning ? ` title="${escapeHtml(pick(meaning, lang))}"` : '';
          return `<span class="dlc-sev-chip${cls ? ' ' + cls : ''}"${title}>${f.n} ${escapeHtml(f.severity)}</span>`;
        })
        .join('');
      return `
    <div class="dlc-sev-bar">
      <span class="dlc-sev-bar__label">${label}:</span>
      <div class="dlc-sev-bar__track">${chips}</div>
    </div>
  `;
    })
    .join('');
}

function renderDialectCard(dialect, lang, stats) {
  const counts = stats[dialect.slug] || { count: 0, groups: [] };
  const rulesLabel = escapeHtml(pick(L.rulesLabel, lang));
  const useLabel = escapeHtml(pick(L.useDialect, lang));
  return `
    <article class="dlc-card" data-dialect="${escapeHtml(dialect.slug)}">
      <header class="dlc-card__head">
        <h3 class="dlc-card__title">${escapeHtml(pick(dialect.title, lang))}</h3>
        <span class="dlc-card__slug">${escapeHtml(dialect.slug)}</span>
      </header>
      <p class="dlc-card__desc">${escapeHtml(pick(dialect.desc, lang))}</p>
      <div class="dlc-rule-count">
        <span class="dlc-rule-count__num">${counts.count}</span>
        <span>${rulesLabel}</span>
      </div>
      ${renderSevBar(lang, counts)}
      <footer class="dlc-card__actions">
        <button type="button" class="dlc-btn dlc-btn--primary" data-action="copy-dialect" data-slug="${escapeHtml(dialect.slug)}">
          ${useLabel}
        </button>
      </footer>
    </article>
  `;
}

function renderCatalog(lang, stats) {
  const heading = escapeHtml(pick(L.builtinHeading, lang));
  const total = BUILTIN_DIALECTS.length;
  const cards = BUILTIN_DIALECTS.map((d) => renderDialectCard(d, lang, stats)).join('');
  return `
    <div class="dlc-group">
      <h2 class="dlc-group__title">
        ${heading}
        <span class="dlc-group__count">${total}</span>
      </h2>
      <div class="dlc-grid">${cards}</div>
    </div>
  `;
}

function renderBuilderCard(lang, isLoggedIn) {
  const localeP = localePrefix(lang);
  if (!isLoggedIn) {
    const prompt = escapeHtml(pick(L.anonPrompt, lang));
    const signIn = escapeHtml(pick(L.signIn, lang));
    return `
      <div class="dlc-builder-card">
        <h2>${escapeHtml(pick(L.builderHeading, lang))}</h2>
        <p>${prompt}</p>
        <div class="dlc-builder-card__actions">
          <a class="dlc-btn dlc-btn--primary" href="${localeP || ''}/account">${signIn}</a>
        </div>
      </div>
    `;
  }
  const desc = escapeHtml(pick(L.builderDesc, lang));
  const openLabel = escapeHtml(pick(L.openBuilder, lang));
  return `
    <div class="dlc-builder-card">
      <h2>${escapeHtml(pick(L.builderHeading, lang))}</h2>
      <p>${desc}</p>
      <div class="dlc-builder-card__actions">
        <button type="button" class="dlc-btn dlc-btn--primary" data-action="open-builder">
          ${openLabel}
        </button>
      </div>
    </div>
  `;
}

// ── Data fetching ─────────────────────────────────────────────────

async function fetchCatalogStats(signal) {
  const r = await fetch('/api/v1/finding-catalog', { signal });
  if (!r.ok) throw new Error('catalog HTTP ' + r.status);
  const data = await r.json();
  const items = data.items || [];

  // Count per dialect by prefix
  const extrtb = items.filter((f) => f.id.startsWith('extrtb.'));
  const inpage = items.filter((f) => f.id.startsWith('inpage-push.'));
  const iab = items.filter((f) => !f.id.startsWith('extrtb.') && !f.id.startsWith('inpage-push.'));

  /**
   * Counts every row, keyed on family+severity.
   *
   * Each row is counted exactly ONCE, under its canonical `severity` — not
   * once per entry in `severities` — so the numbers on a card still add up
   * to the rule count printed above them. The four IDs that can be emitted
   * at either of two levels (payload.duplicate_key and friends) are counted
   * under the more severe one, which is what `severity` already means; the
   * /docs/findings table is where both levels are shown.
   */
  function tally(arr) {
    const byKey = new Map();
    for (const item of arr) {
      const family = familyOf(item);
      const severity = (item && item.severity) || FAMILY_UNKNOWN;
      const key = family + '/' + severity;
      const rec = byKey.get(key) || { key, family, severity, n: 0 };
      rec.n++;
      byKey.set(key, rec);
    }

    const facets = [...byKey.values()];
    const families = [];
    for (const f of facets) if (families.indexOf(f.family) < 0) families.push(f.family);
    families.sort((a, b) => orderIndex(FAMILY_ORDER, a) - orderIndex(FAMILY_ORDER, b));

    return {
      count: arr.length,
      groups: families.map((family) => ({
        family,
        facets: facets
          .filter((f) => f.family === family)
          .sort(
            (a, b) =>
              orderIndex(SEVERITY_ORDER, a.severity) - orderIndex(SEVERITY_ORDER, b.severity),
          ),
      })),
    };
  }

  return {
    iab: tally(iab),
    'ext-rtb': tally(extrtb),
    'inpage-push': tally(inpage),
  };
}

async function fetchAuthState(signal) {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin', signal });
    if (!r.ok) return false;
    const data = await r.json();
    return !!(data && data.user);
  } catch (_e) {
    return false;
  }
}

// ── Toast helper ─────────────────────────────────────────────────

function showToast(message, type, ctxToast) {
  if (ctxToast) {
    ctxToast(message, type || 'success');
    return;
  }
  // Fallback: inline transient element
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'background:#18181b',
    'color:#fff',
    'padding:10px 18px',
    'border-radius:10px',
    'font-size:13px',
    'z-index:9999',
    'box-shadow:0 4px 12px rgba(0,0,0,.3)',
    'pointer-events:none',
    'transition:opacity 300ms',
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, 2400);
}

// ── Module export ─────────────────────────────────────────────────

export default {
  id: 'dialects',
  css: '/modules/dialects/dialects.css',
  route: '/dialects',
  manifest: {
    title: { en: 'Dialect catalog', uk: 'Каталог діалектів', ru: 'Каталог диалектов' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;

    // Render shell immediately
    root.innerHTML = renderShell(lang);

    const catalogRoot = root.querySelector('#dlc-catalog-root');
    const builderRoot = root.querySelector('#dlc-builder-root');

    // Fetch catalog stats and auth state in parallel
    const [statsResult, isLoggedIn] = await Promise.allSettled([
      fetchCatalogStats(ctx.signal),
      fetchAuthState(ctx.signal),
    ]);

    // Hydrate catalog
    if (catalogRoot) {
      if (statsResult.status === 'fulfilled') {
        catalogRoot.innerHTML = renderCatalog(lang, statsResult.value);
      } else if (statsResult.reason && statsResult.reason.name !== 'AbortError') {
        catalogRoot.innerHTML = `<p class="dlc-error">${escapeHtml(pick(L.error, lang))}</p>`;
      }
    }

    // Hydrate builder card
    if (builderRoot) {
      const loggedIn = isLoggedIn.status === 'fulfilled' ? isLoggedIn.value : false;
      builderRoot.innerHTML = renderBuilderCard(lang, loggedIn);
    }

    // Click delegation
    root.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'copy-dialect') {
          e.preventDefault();
          const slug = btn.dataset.slug || '';
          navigator.clipboard
            .writeText(slug)
            .then(() => {
              showToast(pick(L.toastCopied, lang), 'success', ctx.toast);
            })
            .catch(() => {
              showToast(slug, 'info', ctx.toast);
            });
          return;
        }

        if (action === 'open-builder') {
          e.preventDefault();
          const localeP = localePrefix(lang);
          const inspectorPath = (localeP || '') + '/inspector';
          // Try OrtbtoolsIntelBuilder first (from ortbtools.app.js Phase 9).
          // If not available (SPA context), navigate to inspector.
          if (
            window.OrtbtoolsIntelBuilder &&
            typeof window.OrtbtoolsIntelBuilder.open === 'function'
          ) {
            window.OrtbtoolsIntelBuilder.open();
          } else if (
            window.OrtbtoolsShell &&
            typeof window.OrtbtoolsShell.navigateTo === 'function'
          ) {
            window.OrtbtoolsShell.navigateTo(inspectorPath);
            // Dispatch the custom event after navigation settles
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('kt:open-dialect-builder'));
            }, 200);
          } else {
            window.location.href = inspectorPath;
          }
          return;
        }
      },
      { signal: ctx.signal },
    );
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
