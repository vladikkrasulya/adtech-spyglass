/* ============================================================
   public/modules/insights/index.js — /insights section module.

   Analytics dashboard over analytics.validation_logs (ClickHouse),
   laid out to the redesign mockup's Insights screen:

     page-header band (title + right-aligned control, pinned)
     ├─ KPI strip        — four hairline-divided tiles, mono figures
     ├─ main column      — "Findings by severity" ranked bars
     │                     + "Stream activity" area chart
     ├─ side column      — "Formats" / "Versions detected" lists
     └─ status bar       — engine + scope + freshness, pinned bottom

   WHERE WE DIVERGE FROM THE MOCKUP, AND WHY
   -----------------------------------------
   The mockup was drawn against a product that stores per-rule
   counters over a 30-day window. /api/v1/analytics/summary returns
   a fixed 1-hour window with four things only: a per-minute event
   series, the error/warning/info totals, the format mix and the
   version mix. So:

   · KPI tiles     — the mockup's CLEAN PAYLOADS and UNMAPPED FIELDS
                     are not in the payload (the `has_errors` column
                     is logged but the summary endpoint does not
                     expose it, and that endpoint is out of scope
                     here). The strip carries the four figures we
                     genuinely have. The blocking-issues tile is the
                     mockup's red, and turns green at zero — which is
                     where the mockup's green belongs semantically.
   · findings card — no per-rule frequency exists, so the mockup's
                     ranked rule list is built from the severity
                     mix instead. Same construction: mono share,
                     label, severity-coloured bar, mono count.
   · scope select  — the window is fixed at one hour server-side, so
                     the header's right-aligned control carries the
                     refresh cadence instead of a period. The fixed
                     scope is restated in the breadcrumb and footer,
                     as the mockup restates its own.

   The Stream Activity chart has no mockup counterpart but is real
   product data; it keeps the main column under the findings card
   rather than being dropped.
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';

const L = {
  title: { en: 'Insights', uk: 'Інсайти', ru: 'Аналитика' },
  subtitle: {
    en: 'What the last hour of payloads keeps getting wrong. Derived counts only — no bodies are stored.',
    uk: 'Що остання година payload’ів робить не так. Лише похідні лічильники — тіла не зберігаються.',
    ru: 'Что последний час payload’ов делает не так. Только производные счётчики — тела не хранятся.',
  },
  scope: { en: 'last hour', uk: 'остання година', ru: 'последний час' },

  // KPI strip
  kpiAnalyses: { en: 'Analyses', uk: 'Аналізи', ru: 'Анализы' },
  kpiWarnings: { en: 'Warnings', uk: 'Попередження', ru: 'Предупреждения' },
  kpiBlocking: { en: 'Blocking issues', uk: 'Блокуючі проблеми', ru: 'Блокирующие проблемы' },
  kpiPeak: { en: 'Peak per minute', uk: 'Пік за хвилину', ru: 'Пик за минуту' },

  // Cards
  findingsTitle: { en: 'Findings by severity', uk: 'Знахідки за рівнем', ru: 'Находки по уровню' },
  activityTitle: { en: 'Stream activity', uk: 'Активність стріму', ru: 'Активность потока' },
  formatsTitle: { en: 'Formats', uk: 'Формати', ru: 'Форматы' },
  versionsTitle: { en: 'Versions detected', uk: 'Виявлені версії', ru: 'Обнаруженные версии' },

  total: { en: 'total', uk: 'всього', ru: 'всего' },
  peak: { en: 'peak', uk: 'пік', ru: 'пик' },
  errors: { en: 'Errors', uk: 'Помилки', ru: 'Ошибки' },
  warnings: { en: 'Warnings', uk: 'Попередження', ru: 'Предупреждения' },
  info: { en: 'Notices', uk: 'Нотатки', ru: 'Заметки' },
  unknown: { en: 'unknown', uk: 'невідомо', ru: 'неизвестно' },
  multi: { en: 'multi', uk: 'кілька', ru: 'несколько' },
  noData: { en: 'no data yet', uk: 'ще немає даних', ru: 'данных пока нет' },

  // Header control (refresh cadence — see the divergence note above)
  refreshLabel: { en: 'Auto-refresh', uk: 'Авто-оновлення', ru: 'Авто-обновление' },
  refreshOff: { en: 'Refresh: off', uk: 'Оновлення: вимк.', ru: 'Обновление: выкл.' },
  refresh15: { en: 'Refresh: 15s', uk: 'Оновлення: 15 с', ru: 'Обновление: 15 с' },
  refresh30: { en: 'Refresh: 30s', uk: 'Оновлення: 30 с', ru: 'Обновление: 30 с' },

  // Status bar
  stReady: { en: 'ready', uk: 'готово', ru: 'готово' },
  stLoading: { en: 'loading', uk: 'завантаження', ru: 'загрузка' },
  stOffline: { en: 'unavailable', uk: 'недоступно', ru: 'недоступно' },
  stEngine: { en: 'engine', uk: 'рушій', ru: 'движок' },
  stWindow: { en: 'window', uk: 'вікно', ru: 'окно' },

  updatedAgo: { en: 'updated {n}s ago', uk: 'оновлено {n} с тому', ru: 'обновлено {n} с назад' },
  updatedNow: { en: 'just updated', uk: 'щойно оновлено', ru: 'только что обновлено' },

  emptyTitle: {
    en: 'Stream is warming up',
    uk: 'Стрім запускається',
    ru: 'Поток запускается',
  },
  emptyBody: {
    en: 'Data will appear here in about a minute once the validation stream emits events.',
    uk: "Дані з'являться тут приблизно за хвилину, коли валідаційний стрім почне надсилати події.",
    ru: 'Данные появятся здесь примерно через минуту после начала эмиссии событий потоком.',
  },
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  errFetch: {
    en: 'Failed to load analytics.',
    uk: 'Не вдалось завантажити аналітику.',
    ru: 'Не удалось загрузить аналитику.',
  },
};

/* The spec surface the engine validates. Technical identifiers — the
   same string in every locale, like the mockup's footer. */
const SPEC_SUPPORT = 'oRTB 2.5/2.6/3.0 · native 1.x · vast 4.x';

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

/* Thousands grouped with a no-break space rather than toLocaleString():
   the mockup groups with a space in every locale, and a mono column of
   figures only lines up if the separator is the same width everywhere
   (a comma is not). NBSP, so "1 482" never breaks across two lines. */
const NBSP = '\u00A0';
function fmtNum(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

// ── Cards ───────────────────────────────────────────────────────

function card(title, bodyHtml, extraClass) {
  return `
    <div class="ins-card${extraClass ? ' ' + extraClass : ''}">
      <h2 class="ins-card__title">${escapeHtml(title)}</h2>
      ${bodyHtml}
    </div>`;
}

// ── KPI strip ───────────────────────────────────────────────────

function kpiTile(label, value, tone) {
  return `
    <div class="ins-kpi">
      <div class="ins-kpi__label">${escapeHtml(label)}</div>
      <div class="ins-kpi__value"${tone ? ` data-tone="${tone}"` : ''}>${escapeHtml(value)}</div>
    </div>`;
}

function renderKpis(m, lang) {
  return `
    <div class="ins-kpis">
      ${kpiTile(pick(L.kpiAnalyses, lang), fmtNum(m.analyses))}
      ${kpiTile(pick(L.kpiWarnings, lang), fmtNum(m.warnings), m.warnings > 0 ? 'warn' : '')}
      ${kpiTile(pick(L.kpiBlocking, lang), fmtNum(m.errors), m.errors > 0 ? 'bad' : 'ok')}
      ${kpiTile(pick(L.kpiPeak, lang), fmtNum(m.peak))}
    </div>`;
}

// ── Findings by severity (the mockup's ranked-bar card) ─────────

function renderFindings(m, lang) {
  const rows = [
    { key: 'error', label: pick(L.errors, lang), count: m.errors },
    { key: 'warning', label: pick(L.warnings, lang), count: m.warnings },
    { key: 'info', label: pick(L.info, lang), count: m.info },
  ].sort((a, b) => b.count - a.count);

  const findingTotal = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(...rows.map((r) => r.count), 1);

  const body = rows
    .map((r) => {
      const width = Math.max(0, Math.min(100, (r.count / max) * 100));
      const share = findingTotal ? ((r.count / findingTotal) * 100).toFixed(1) + '%' : '—';
      return `
      <div class="ins-find-row">
        <div class="ins-find-main">
          <div class="ins-find-head">
            <span class="ins-find-share">${escapeHtml(share)}</span>
            <span class="ins-find-label">${escapeHtml(r.label)}</span>
          </div>
          <div class="ins-find-track">
            <span class="ins-find-fill" data-sev="${r.key}" style="width:${width.toFixed(1)}%"></span>
          </div>
        </div>
        <span class="ins-find-count">${escapeHtml(fmtNum(r.count))}</span>
      </div>`;
    })
    .join('');

  return card(pick(L.findingsTitle, lang), `<div class="ins-find-list">${body}</div>`);
}

// ── Stream activity (area chart) ────────────────────────────────

function chartPaths(points, W, H, pad) {
  if (!points || points.length === 0) return { area: '', line: '' };
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const xFor = (i) => (W * i) / (points.length - 1 || 1);
  const yFor = (count) => H - pad - (H - pad * 2) * (count / maxCount);

  let line = 'M' + xFor(0) + ',' + yFor(points[0].count);
  for (let i = 1; i < points.length; i++) {
    const x1 = xFor(i - 1);
    const x2 = xFor(i);
    const y1 = yFor(points[i - 1].count);
    const y2 = yFor(points[i].count);
    const cx = (x1 + x2) / 2;
    line += ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2;
  }
  const area = line + ' L' + xFor(points.length - 1) + ',' + H + ' L0,' + H + ' Z';
  return { area, line };
}

function renderActivity(data, m, lang) {
  const points = data.stream_activity || [];
  const W = 600,
    H = 150,
    PAD = 16;
  const { area, line } = chartPaths(points, W, H, PAD);

  const meta = `
    <span class="ins-card__meta">
      ${escapeHtml(pick(L.total, lang))} <b>${escapeHtml(fmtNum(m.analyses))}</b>
      <span class="ins-card__meta-sep" aria-hidden="true">·</span>
      ${escapeHtml(pick(L.peak, lang))} <b>${escapeHtml(fmtNum(m.peak))}</b>
    </span>`;

  const body = `
    <svg class="ins-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="${escapeHtml(pick(L.activityTitle, lang))}">
      <defs>
        <linearGradient id="ins-sa-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--accent,#0284c7)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="var(--accent,#0284c7)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line class="ins-chart-axis" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>
      ${area ? `<path d="${escapeHtml(area)}" fill="url(#ins-sa-grad)" class="ins-chart-area"/>` : ''}
      ${line ? `<path d="${escapeHtml(line)}" class="ins-chart-line"/>` : ''}
    </svg>`;

  return `
    <div class="ins-card">
      <div class="ins-card__head">
        <h2 class="ins-card__title">${escapeHtml(pick(L.activityTitle, lang))}</h2>
        ${meta}
      </div>
      ${body}
    </div>`;
}

// ── Side lists (Formats / Versions detected) ────────────────────

function listCard(title, rows, lang) {
  const body = rows.length
    ? rows
        .map(
          (r) => `
        <div class="ins-list-row">
          <span class="ins-list-label">${escapeHtml(r.label)}</span>
          <span class="ins-list-pct">${escapeHtml(r.pct)}</span>
        </div>`,
        )
        .join('')
    : `<div class="ins-list-row ins-list-row--empty">${escapeHtml(pick(L.noData, lang))}</div>`;
  return card(title, `<div class="ins-list">${body}</div>`, 'ins-card--list');
}

function formatLabel(raw, lang) {
  const v = String(raw || 'unknown');
  if (v === 'unknown') return pick(L.unknown, lang);
  if (v === 'multi') return pick(L.multi, lang);
  return v;
}

function versionLabel(raw, lang) {
  const v = String(raw || 'unknown');
  if (v === 'unknown') return pick(L.unknown, lang);
  // 2.5 / 2.6 / 3.0 are oRTB spec revisions; the mockup names them so.
  return /^\d/.test(v) ? 'oRTB ' + v : v;
}

function renderSide(data, lang) {
  const formats = (data.format_mix || []).map((r) => ({
    label: formatLabel(r.format, lang),
    pct: r.pct + '%',
  }));
  const versions = (data.version_mix || []).map((r) => ({
    label: versionLabel(r.version, lang),
    pct: r.pct + '%',
  }));
  return (
    listCard(pick(L.formatsTitle, lang), formats, lang) +
    listCard(pick(L.versionsTitle, lang), versions, lang)
  );
}

// ── Body ────────────────────────────────────────────────────────

function metricsOf(data) {
  const points = data.stream_activity || [];
  const t = data.validation_totals || { errors: 0, warnings: 0, info: 0 };
  return {
    analyses: points.reduce((s, p) => s + (Number(p.count) || 0), 0),
    peak: Math.max(...points.map((p) => Number(p.count) || 0), 0),
    errors: Number(t.errors) || 0,
    warnings: Number(t.warnings) || 0,
    info: Number(t.info) || 0,
  };
}

function renderEmpty(lang) {
  return `
    <div class="ins-card ins-empty">
      <h2 class="ins-card__title">${escapeHtml(pick(L.emptyTitle, lang))}</h2>
      <p class="ins-empty__body">${escapeHtml(pick(L.emptyBody, lang))}</p>
      <div class="ins-skeleton-bar" style="width:60%"></div>
      <div class="ins-skeleton-bar" style="width:80%"></div>
      <div class="ins-skeleton-bar" style="width:45%"></div>
    </div>`;
}

function renderBody(data, lang) {
  const m = metricsOf(data);
  const empty = m.analyses === 0 && m.errors + m.warnings + m.info === 0;

  if (empty) {
    return renderKpis(m, lang) + renderEmpty(lang);
  }

  return (
    renderKpis(m, lang) +
    `<div class="ins-grid">
       <div class="ins-col ins-col--main">
         ${renderFindings(m, lang)}
         ${renderActivity(data, m, lang)}
       </div>
       <div class="ins-col ins-col--side">
         ${renderSide(data, lang)}
       </div>
     </div>`
  );
}

// ── Section shell ───────────────────────────────────────────────

function renderShell(lang) {
  const scope = pick(L.scope, lang);
  const engine = (typeof window !== 'undefined' && window.OrtbtoolsVersion) || '';

  return `
    <section class="ins-section">
      <header class="ins-section__head">
        <div class="ins-head__text">
          <h1 class="ins-head__title">${escapeHtml(pick(L.title, lang))}</h1>
          <p class="ins-head__sub">${escapeHtml(pick(L.subtitle, lang))}</p>
        </div>
        <select class="ins-head__select" id="ins-refresh-select"
                aria-label="${escapeHtml(pick(L.refreshLabel, lang))}" autocomplete="off">
          <option value="0" selected>${escapeHtml(pick(L.refreshOff, lang))}</option>
          <option value="15">${escapeHtml(pick(L.refresh15, lang))}</option>
          <option value="30">${escapeHtml(pick(L.refresh30, lang))}</option>
        </select>
      </header>

      <div class="ins-body" id="ins-body-root">
        <p class="ins-loading">${escapeHtml(pick(L.loading, lang))}</p>
      </div>

      <footer class="ins-statusbar" id="ins-statusbar">
        <div class="ins-statusbar__left">
          <span class="ins-status-state" id="ins-status-state">${escapeHtml(pick(L.stLoading, lang))}</span>
          ${engine ? `<span>${escapeHtml(pick(L.stEngine, lang))} ${escapeHtml(engine)}</span>` : ''}
          <span class="ins-status-spec">${escapeHtml(SPEC_SUPPORT)}</span>
          <span>${escapeHtml(pick(L.stWindow, lang))}: ${escapeHtml(scope)}</span>
        </div>
        <div class="ins-statusbar__right">
          <span class="ins-status-dot" id="ins-status-dot" aria-hidden="true"></span>
          <span id="ins-updated-label"></span>
        </div>
      </footer>
    </section>
  `;
}

// ── Topbar breadcrumb ───────────────────────────────────────────
/* The topbar owns these nodes and only the Inspector ever painted
   them, so /insights rendered a bare "/" in the topbar's left half.
   Painted defensively (the topbar module is not ours to change) and
   restored on unmount so a later section does not inherit our label. */
function paintCrumbs(sectionText, scopeText) {
  // The section half moved to the topbar in v1.14: it derives the name from
  // the route, so every page has one whether or not its module remembers to
  // paint it — which is exactly what four pages did not. This now supplies
  // only the detail, and passes nothing on unmount so the next section does
  // not inherit our window label.
  void sectionText;
  if (typeof window.ktSetCrumbDetail === 'function') window.ktSetCrumbDetail(scopeText || '');
}

// ── Main module ─────────────────────────────────────────────────

function getLang() {
  return document.documentElement.getAttribute('lang') || 'en';
}

async function fetchSummary() {
  const resp = await fetch('/api/v1/analytics/summary', { cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

export default {
  id: 'insights',
  css: '/modules/insights/insights.css',
  route: '/insights',

  async mount(container, ctx) {
    const lang = getLang();

    container.innerHTML = renderShell(lang);

    const bodyRoot = container.querySelector('#ins-body-root');
    const updatedLabel = container.querySelector('#ins-updated-label');
    const stateLabel = container.querySelector('#ins-status-state');
    const statusDot = container.querySelector('#ins-status-dot');
    const refreshSelect = container.querySelector('#ins-refresh-select');

    paintCrumbs(pick(L.title, lang), pick(L.scope, lang));

    let lastFetch = null;
    let refreshTimer = null;
    let updateLabelTimer = null;

    function setState(kind) {
      if (stateLabel) {
        stateLabel.textContent = pick(
          kind === 'ok' ? L.stReady : kind === 'error' ? L.stOffline : L.stLoading,
          lang,
        );
      }
      if (statusDot) statusDot.setAttribute('data-state', kind);
    }

    function updateAgoLabel() {
      if (!updatedLabel) return;
      if (!lastFetch) {
        updatedLabel.textContent = '';
        return;
      }
      const secs = Math.floor((Date.now() - lastFetch) / 1000);
      updatedLabel.textContent =
        secs < 5 ? pick(L.updatedNow, lang) : pick(L.updatedAgo, lang).replace('{n}', secs);
    }

    async function loadAndRender() {
      try {
        const data = await fetchSummary();
        lastFetch = Date.now();
        bodyRoot.innerHTML = renderBody(data, lang);
        setState('ok');
        updateAgoLabel();
      } catch (_e) {
        setState('error');
        if (!bodyRoot.querySelector('.ins-kpis')) {
          bodyRoot.innerHTML =
            `<div class="ins-card ins-empty"><p class="ins-empty__body">` +
            escapeHtml(pick(L.errFetch, lang)) +
            `</p></div>`;
        }
      }
    }

    function scheduleRefresh() {
      clearInterval(refreshTimer);
      refreshTimer = null;
      // 0 is a legitimate value here — it is the "Refresh: off" option.
      // The pre-fix `Number(value) || 30` pushed that 0 through the falsy
      // branch and replaced it with 30, which made the `<= 0` guard below
      // unreachable: picking Off still armed a 30s timer. Only a genuinely
      // unparseable value may fall back to the default.
      const parsed = Number(refreshSelect.value);
      const intervalSec = Number.isFinite(parsed) ? parsed : 30;
      if (intervalSec <= 0) return;
      refreshTimer = setInterval(() => {
        if (ctx && ctx.signal && ctx.signal.aborted) return;
        loadAndRender();
      }, intervalSec * 1000);
    }

    refreshSelect.addEventListener('change', scheduleRefresh);

    // Tick the "updated N ago" footer string every 5s
    updateLabelTimer = setInterval(updateAgoLabel, 5000);

    if (ctx && ctx.addCleanup) {
      ctx.addCleanup(() => {
        clearInterval(refreshTimer);
        clearInterval(updateLabelTimer);
        paintCrumbs('', '');
      });
    }

    setState('loading');
    await loadAndRender();
  },

  unmount(container) {
    paintCrumbs('', '');
    container.innerHTML = '';
  },
};
