/* ============================================================
   public/modules/behavior/index.js — /behavior section module.

   Stage 4 of ROADMAP. Interactive hub of behavioral scenarios
   for AdTech testing.

   Architecture:
     - Fetches /api/v1/behavior/scenarios (metadata catalog)
     - Renders category-filter chips + scenario card grid
     - Each card: title, category badge, description, expected
       findings strip, "Run & Inspect" button, "Details" toggle
     - "Run & Inspect" navigates to /<lang>/inspector?sample=SLUG
       via OrtbtoolsShell.navigateTo — Stage 1 inspector handles
       ?sample= pre-fill automatically.

   Patterns copied from:
     - /library  — card layout, grid, CSS class conventions
     - /dialects — category chips + filter
     - /docs     — welcome card + section header
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';

const CATEGORY_LABEL = {
  all: { en: 'All', uk: 'Всі', ru: 'Все' },
  baseline: { en: 'Baseline', uk: 'Baseline', ru: 'Baseline' },
  privacy: { en: 'Privacy', uk: 'Privacy', ru: 'Privacy' },
  creative: { en: 'Creative', uk: 'Creative', ru: 'Creative' },
  crosscheck: { en: 'Crosscheck', uk: 'Crosscheck', ru: 'Crosscheck' },
  malicious: { en: 'Malicious', uk: 'Malicious', ru: 'Malicious' },
};

const L = {
  title: { en: 'Behavior Scenarios', uk: 'Behavior-сценарії', ru: 'Behavior-сценарии' },
  subtitle: {
    en: 'Curated AdTech test scenarios — pick one, see what it demonstrates, and run it in the inspector.',
    uk: 'Куровані AdTech тест-сценарії — обери один, дізнайся що він демонструє, та запусти в інспекторі.',
    ru: 'Курируемые AdTech тест-сценарии — выбери один, узнай что он демонстрирует, и запусти в инспекторе.',
  },
  welcomeTitle: {
    en: 'How to use this hub',
    uk: 'Як користуватись цим хабом',
    ru: 'Как пользоваться этим хабом',
  },
  welcomeBody: {
    en: 'Each scenario card below represents a curated OpenRTB test case that highlights a specific validation behavior. Click "Run & Inspect" to load it into the inspector — the request and response editors will be pre-filled. Use "Details" to read the pedagogical note about what the scenario teaches.',
    uk: 'Кожна картка сценарію нижче представляє курований OpenRTB тест-кейс що підкреслює конкретну поведінку валідації. Натисни "Запустити" щоб завантажити його в інспектор — редактори запиту та відповіді будуть попередньо заповнені. Використовуй "Деталі" щоб прочитати нотатку про що вчить сценарій.',
    ru: 'Каждая карточка сценария ниже представляет курируемый OpenRTB тест-кейс подчёркивающий конкретное поведение валидации. Нажми "Запустить" чтобы загрузить его в инспектор — редакторы запроса и ответа будут предзаполнены. Используй "Детали" чтобы прочитать заметку о том чему учит сценарий.',
  },
  runInspect: {
    en: 'Run & Inspect',
    uk: 'Запустити',
    ru: 'Запустить',
  },
  details: {
    en: 'Details',
    uk: 'Деталі',
    ru: 'Детали',
  },
  hideDetails: {
    en: 'Hide',
    uk: 'Сховати',
    ru: 'Скрыть',
  },
  expectedLabel: {
    en: 'Expected:',
    uk: 'Очікується:',
    ru: 'Ожидается:',
  },
  filterLabel: {
    en: 'Category filter',
    uk: 'Фільтр за категорією',
    ru: 'Фильтр по категории',
  },
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  error: {
    en: 'Failed to load scenarios.',
    uk: 'Не вдалось завантажити сценарії.',
    ru: 'Не удалось загрузить сценарии.',
  },
  retry: { en: 'Try again', uk: 'Спробувати ще раз', ru: 'Попробовать снова' },
  empty: {
    en: 'No scenarios match this filter.',
    uk: 'Немає сценаріїв за цим фільтром.',
    ru: 'Нет сценариев по этому фильтру.',
  },
  /* Counted noun: one / 2-4 / 5+. The catalog is eleven scenarios today, so
     the stored "{n} сценаріїв" happened to be right — it would have read
     "1 сценаріїв" / "3 сценаріїв" the moment the catalog changed size.
     statsFiltered needs no triple: "{n} з {t} …" governs the genitive
     plural whatever {t} is. */
  statsAll: {
    en: ['{n} scenario', '{n} scenarios', '{n} scenarios'],
    uk: ['{n} сценарій', '{n} сценарії', '{n} сценаріїв'],
    ru: ['{n} сценарий', '{n} сценария', '{n} сценариев'],
  },
  statsFiltered: {
    en: '{n} of {t} scenarios',
    uk: '{n} з {t} сценаріїв',
    ru: '{n} из {t} сценариев',
  },
};

/* ── Expected-findings summary ──────────────────────────────────────
   samples/behavior-scenarios.json localizes name/description/demonstrates
   as per-locale maps but stores expected.severity_summary as one plain
   string — "0 errors, ~9 info", "2+ errors, 3+ warnings". So the uk and ru
   hubs printed English under a "Очікується:" / "Ожидается:" label.

   The catalog is not this module's file to edit, so the sentence is
   rebuilt at render time from the numbers it already contains. Anything
   the grammar below does not recognise is passed through untouched: a
   summary shape nobody anticipated must still reach the reader verbatim
   rather than being silently dropped. English is returned as stored —
   the catalog is already written in it. */

const SEV_UNIT = {
  // one / 2-4 / 5+ — same order as pluralForm()'s return value.
  error: {
    uk: ['помилка', 'помилки', 'помилок'],
    ru: ['ошибка', 'ошибки', 'ошибок'],
  },
  warning: {
    uk: ['попередження', 'попередження', 'попереджень'],
    ru: ['предупреждение', 'предупреждения', 'предупреждений'],
  },
  // "info" is the engine's third severity; /insights names it Нотатки/Заметки.
  info: {
    uk: ['нотатка', 'нотатки', 'нотаток'],
    ru: ['заметка', 'заметки', 'заметок'],
  },
};

const L_AT_LEAST = { uk: 'від', ru: 'от' };
const L_IF = { uk: 'якщо', ru: 'если' };

const SUMMARY_TOKEN = /^(~)?(\d+)(\+)?\s+(errors?|warnings?|infos?|notices?)$/i;

/** Slavic one / 2-4 / 5+ → 0 / 1 / 2. Mirrors pluralKey() in
 *  public/ortbtools.app.js, pinned by tests/plural-forms.test.js: 11 takes
 *  the 5+ form, 21 the singular, 111 the 5+ form again. */
function pluralForm(n, lang) {
  if (lang !== 'uk' && lang !== 'ru') return n === 1 ? 0 : 1;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

function severityKey(word) {
  const w = word.toLowerCase();
  if (w.startsWith('error')) return 'error';
  if (w.startsWith('warning')) return 'warning';
  return 'info';
}

function localizeSummary(raw, lang) {
  const src = String(raw == null ? '' : raw).trim();
  if (!src || (lang !== 'uk' && lang !== 'ru')) return src;

  // Split off a trailing condition — "1 error if bid.price < imp.bidfloor".
  // The condition itself is a code expression and stays verbatim.
  let head = src;
  let cond = '';
  const ifAt = src.search(/\s+if\s+/i);
  if (ifAt !== -1) {
    head = src.slice(0, ifAt);
    cond = src.slice(ifAt).replace(/^\s+if\s+/i, '');
  }

  const parts = [];
  for (const chunk of head.split(',')) {
    const piece = chunk.trim();
    if (!piece) continue;
    const m = SUMMARY_TOKEN.exec(piece);
    if (!m) return src; // unknown shape — hand back the catalog's own words
    const [, approx, digits, atLeast, unit] = m;
    const n = Number(digits);
    const forms = SEV_UNIT[severityKey(unit)][lang];
    if (atLeast) {
      // "2+ errors" → "від 2 помилок": the genitive plural the preposition wants.
      parts.push(`${L_AT_LEAST[lang]} ${n} ${forms[2]}`);
    } else {
      parts.push(`${approx || ''}${n} ${forms[pluralForm(n, lang)]}`);
    }
  }
  if (!parts.length) return src;

  const sentence = parts.join(', ');
  return cond ? `${sentence}, ${L_IF[lang]} ${cond}` : sentence;
}

// ── Helpers ───────────────────────────────────────────────────────

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

/** Same lookup for a [one, few, many] triple, inflected for `n`. */
function pickPlural(map, lang, n) {
  const forms = (map && (map[lang] || map[FALLBACK_LANG])) || [];
  return forms[pluralForm(n, lang)] || forms[forms.length - 1] || '';
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

// ── Renderers ────────────────────────────────────────────────────

function renderShell(lang) {
  const chips = ['all', 'baseline', 'privacy', 'creative', 'crosscheck', 'malicious']
    .map((cat) => {
      const on = cat === 'all';
      // aria-pressed, because .is-active is a colour and a screen reader
      // cannot see colour: without it every chip reads identically and the
      // filter in force is unknowable.
      return `<button type="button" class="bhv-chip${on ? ' is-active' : ''}" aria-pressed="${on}" data-cat="${escapeHtml(cat)}">${escapeHtml(pick(CATEGORY_LABEL[cat], lang))}</button>`;
    })
    .join('');

  return `
    <section class="bhv-section">
      <header class="bhv-section__head">
        <h1>${escapeHtml(pick(L.title, lang))}</h1>
        <p class="bhv-section__sub">${escapeHtml(pick(L.subtitle, lang))}</p>
      </header>
      <div class="bhv-welcome">
        <h2>${escapeHtml(pick(L.welcomeTitle, lang))}</h2>
        <p>${escapeHtml(pick(L.welcomeBody, lang))}</p>
      </div>
      <div class="bhv-chips" role="group" aria-label="${escapeHtml(pick(L.filterLabel, lang))}">
        ${chips}
      </div>
      <p class="bhv-stats" data-bhv-stats hidden></p>
      <div class="bhv-grid" data-bhv-grid>
        <p class="bhv-loading">${escapeHtml(pick(L.loading, lang))}</p>
      </div>
    </section>
  `;
}

function renderCard(item, lang, localeP) {
  const title = escapeHtml(pick(item.name, lang));
  const desc = escapeHtml(pick(item.description, lang));
  const demonstrates = escapeHtml(pick(item.demonstrates, lang));
  const cat = item.category || 'baseline';
  const badgeCls = 'bhv-card__badge--' + escapeHtml(cat);
  const badgeLabel = escapeHtml(pick(CATEGORY_LABEL[cat] || CATEGORY_LABEL.baseline, lang));

  const expected = item.expected || {};
  const expChips = (expected.key_findings || [])
    .slice(0, 2)
    .map((f) => `<span class="bhv-card__exp-chip">${escapeHtml(f)}</span>`)
    .join('');

  const inspectorHref = `${localeP}/inspector?sample=${encodeURIComponent(item.sample)}`;
  const runLabel = escapeHtml(pick(L.runInspect, lang));
  const detailsLabel = escapeHtml(pick(L.details, lang));

  return `
    <article class="bhv-card" data-cat="${escapeHtml(cat)}" data-id="${escapeHtml(item.id)}">
      <header class="bhv-card__head">
        <h3 class="bhv-card__title">${title}</h3>
        <span class="bhv-card__badge ${badgeCls}">${badgeLabel}</span>
      </header>
      <p class="bhv-card__desc">${desc}</p>
      <div class="bhv-card__expected">
        <span class="bhv-card__exp-label">${escapeHtml(pick(L.expectedLabel, lang))}</span>
        <span class="bhv-card__exp-summary">${escapeHtml(localizeSummary(expected.severity_summary, lang))}</span>
        ${expChips}
      </div>
      <div class="bhv-card__demonstrates">${demonstrates}</div>
      <footer class="bhv-card__actions">
        <a class="bhv-btn bhv-btn--primary" href="${escapeHtml(inspectorHref)}" data-action="run-inspect" data-sample="${escapeHtml(item.sample)}">
          ${runLabel} &rarr;
        </a>
        <button type="button" class="bhv-btn" data-action="toggle-details">
          ${detailsLabel}
        </button>
      </footer>
    </article>
  `;
}

function renderGrid(items, lang, activeFilter) {
  const localeP = localePrefix(lang);
  const filtered =
    activeFilter === 'all' ? items : items.filter((i) => i.category === activeFilter);
  if (!filtered.length) {
    return `<p class="bhv-empty">${escapeHtml(pick(L.empty, lang))}</p>`;
  }
  return filtered.map((item) => renderCard(item, lang, localeP)).join('');
}

// ── Data fetching ────────────────────────────────────────────────

async function fetchScenarios(signal) {
  const r = await fetch('/api/v1/behavior/scenarios', { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).items || [];
}

// ── Module export ────────────────────────────────────────────────

export default {
  id: 'behavior',
  css: '/modules/behavior/behavior.css',
  route: '/behavior',
  manifest: {
    title: { en: 'Behavior Scenarios', uk: 'Behavior-сценарії', ru: 'Behavior-сценарии' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;

    // Render shell immediately (chips + loading grid)
    root.innerHTML = renderShell(lang);

    const grid = root.querySelector('[data-bhv-grid]');
    const statsEl = root.querySelector('[data-bhv-stats]');
    let allItems = [];
    let activeFilter = 'all';

    function updateStats(count) {
      if (!statsEl) return;
      const total = allItems.length;
      statsEl.hidden = false;
      if (activeFilter === 'all') {
        statsEl.textContent = pickPlural(L.statsAll, lang, total).replace('{n}', total);
      } else {
        statsEl.textContent = pick(L.statsFiltered, lang)
          .replace('{n}', count)
          .replace('{t}', total);
      }
    }

    function applyFilter(cat) {
      activeFilter = cat;

      // Update chip active states
      root.querySelectorAll('.bhv-chip').forEach((chip) => {
        const on = chip.dataset.cat === cat;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-pressed', String(on));
      });

      // Re-render grid
      grid.innerHTML = renderGrid(allItems, lang, cat);

      // Update stats
      const visibleCount =
        cat === 'all' ? allItems.length : allItems.filter((i) => i.category === cat).length;
      updateStats(visibleCount);
    }

    // Chip click delegation
    root.querySelectorAll('.bhv-chip').forEach((chip) => {
      chip.addEventListener('click', () => applyFilter(chip.dataset.cat), { signal: ctx.signal });
    });

    // Card action delegation
    root.addEventListener(
      'click',
      (e) => {
        // Details toggle
        const detailsBtn = e.target.closest('[data-action="toggle-details"]');
        if (detailsBtn) {
          e.preventDefault();
          const card = detailsBtn.closest('.bhv-card');
          if (!card) return;
          const expanded = card.classList.toggle('is-expanded');
          detailsBtn.textContent = expanded ? pick(L.hideDetails, lang) : pick(L.details, lang);
          return;
        }

        // Retry after a failed catalog load
        if (e.target.closest('[data-bhv-retry]')) {
          e.preventDefault();
          load();
          return;
        }

        // Run & Inspect — SPA navigation via OrtbtoolsShell
        const runBtn = e.target.closest('[data-action="run-inspect"]');
        if (runBtn) {
          e.preventDefault();
          const href = runBtn.getAttribute('href');
          if (!href) return;
          if (window.OrtbtoolsShell && typeof window.OrtbtoolsShell.navigateTo === 'function') {
            window.OrtbtoolsShell.navigateTo(href);
          } else {
            window.location.href = href;
          }
          return;
        }
      },
      { signal: ctx.signal },
    );

    /* Fetch (and re-fetch) the catalog.
     *
     * The failure branch used to print `pick(L.error) + ': ' + e.message`,
     * which glued a full stop straight onto a colon — "Помилка завантаження
     * сценаріїв.: Failed to fetch" — and then showed the reader the
     * browser's own English string, in every locale, as the explanation.
     * It was also a dead end: no way back but a page reload. The message
     * that helps a developer goes to the console; the reader gets one
     * localized sentence and a button. */
    async function load() {
      grid.innerHTML = `<p class="bhv-loading">${escapeHtml(pick(L.loading, lang))}</p>`;
      try {
        allItems = await fetchScenarios(ctx.signal);
        applyFilter('all');
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('[behavior] scenario catalog failed to load:', e);
        // No catalog means no count — an empty <p> still occupies its margin.
        if (statsEl) {
          statsEl.textContent = '';
          statsEl.hidden = true;
        }
        grid.innerHTML =
          `<div class="bhv-error" role="alert">` +
          `<p class="bhv-error__text">${escapeHtml(pick(L.error, lang))}</p>` +
          `<button type="button" class="bhv-btn" data-bhv-retry>${escapeHtml(pick(L.retry, lang))}</button>` +
          `</div>`;
      }
    }

    await load();
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
