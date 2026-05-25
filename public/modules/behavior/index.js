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
       via SpyglassShell.navigateTo — Stage 1 inspector handles
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
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  error: {
    en: 'Failed to load scenarios.',
    uk: 'Помилка завантаження сценаріїв.',
    ru: 'Ошибка загрузки сценариев.',
  },
  empty: {
    en: 'No scenarios match this filter.',
    uk: 'Немає сценаріїв за цим фільтром.',
    ru: 'Нет сценариев по этому фильтру.',
  },
  statsAll: { en: '{n} scenarios', uk: '{n} сценаріїв', ru: '{n} сценариев' },
  statsFiltered: {
    en: '{n} of {t} scenarios',
    uk: '{n} з {t} сценаріїв',
    ru: '{n} из {t} сценариев',
  },
};

// ── Helpers ───────────────────────────────────────────────────────

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

// ── Renderers ────────────────────────────────────────────────────

function renderShell(lang) {
  const chips = ['all', 'baseline', 'privacy', 'creative', 'crosscheck', 'malicious']
    .map((cat) => {
      const active = cat === 'all' ? ' is-active' : '';
      return `<button type="button" class="bhv-chip${active}" data-cat="${escapeHtml(cat)}">${escapeHtml(pick(CATEGORY_LABEL[cat], lang))}</button>`;
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
      <div class="bhv-chips" role="group" aria-label="category filter">
        ${chips}
      </div>
      <p class="bhv-stats" data-bhv-stats></p>
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

  const expChips = (item.expected.key_findings || [])
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
        <span class="bhv-card__exp-summary">${escapeHtml(item.expected.severity_summary)}</span>
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
      if (activeFilter === 'all') {
        statsEl.textContent = pick(L.statsAll, lang).replace('{n}', total);
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
        chip.classList.toggle('is-active', chip.dataset.cat === cat);
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

        // Run & Inspect — SPA navigation via SpyglassShell
        const runBtn = e.target.closest('[data-action="run-inspect"]');
        if (runBtn) {
          e.preventDefault();
          const href = runBtn.getAttribute('href');
          if (!href) return;
          if (window.SpyglassShell && typeof window.SpyglassShell.navigateTo === 'function') {
            window.SpyglassShell.navigateTo(href);
          } else {
            window.location.href = href;
          }
          return;
        }
      },
      { signal: ctx.signal },
    );

    // Fetch scenarios
    try {
      allItems = await fetchScenarios(ctx.signal);
      applyFilter('all');
    } catch (e) {
      if (e.name !== 'AbortError') {
        grid.innerHTML = `<p class="bhv-empty">${escapeHtml(pick(L.error, lang))}: ${escapeHtml(e.message)}</p>`;
      }
    }
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
