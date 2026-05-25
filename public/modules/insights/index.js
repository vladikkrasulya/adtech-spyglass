/* ============================================================
   public/modules/insights/index.js — /insights section module.

   Stage 5 of ROADMAP. Analytics dashboard showing live statistics
   from analytics.validation_logs (ClickHouse).

   Three widgets:
     1. Stream Activity   — SVG area chart, 60-minute rolling window
     2. Validation Health — SVG donut (errors / warnings / info)
     3. Spec Mix          — horizontal bar tables for format + version

   Auto-refresh (default off): configurable interval 15s/30s that
   refetches /api/v1/analytics/summary and re-renders widgets.
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';

const L = {
  title: { en: 'Insights', uk: 'Інсайти', ru: 'Аналитика' },
  subtitle: {
    en: 'Real-time analytics from validation stream and inspector usage.',
    uk: 'Аналітика валідаційного стріму та інспектора в реальному часі.',
    ru: 'Аналитика потока валидации и использования инспектора в реальном времени.',
  },
  widget1Title: { en: 'Stream Activity', uk: 'Активність стріму', ru: 'Активность потока' },
  widget2Title: { en: 'Validation Health', uk: 'Якість валідацій', ru: 'Качество валидаций' },
  widget3Title: { en: 'Spec Mix', uk: 'Розподіл специфікацій', ru: 'Распределение спецификаций' },
  total: { en: 'total', uk: 'всього', ru: 'всего' },
  peak: { en: 'peak', uk: 'пік', ru: 'пик' },
  errors: { en: 'Errors', uk: 'Помилки', ru: 'Ошибки' },
  warnings: { en: 'Warnings', uk: 'Попередження', ru: 'Предупреждения' },
  info: { en: 'Info', uk: 'Інфо', ru: 'Инфо' },
  formats: { en: 'Formats', uk: 'Формати', ru: 'Форматы' },
  versions: { en: 'Versions', uk: 'Версії', ru: 'Версии' },
  autoRefresh: { en: 'Auto-refresh', uk: 'Авто-оновлення', ru: 'Авто-обновление' },
  refreshOff: { en: 'Off', uk: 'Вимк', ru: 'Выкл' },
  updatedAgo: { en: 'Updated {n}s ago', uk: 'Оновлено {n}с тому', ru: 'Обновлено {n}с назад' },
  updatedNow: { en: 'Just updated', uk: 'Щойно оновлено', ru: 'Только что обновлено' },
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

// Format + version colour maps
const FORMAT_COLORS = {
  banner: '#f59e0b',
  video: '#3b82f6',
  native: '#10b981',
  audio: '#8b5cf6',
  pop: '#ef4444',
  vast: '#06b6d4',
  multi: '#6b7280',
  unknown: '#9ca3af',
};
const VERSION_COLORS = {
  2.5: '#6b7280',
  2.6: '#f59e0b',
  '3.0': '#8b5cf6',
  unknown: '#9ca3af',
};

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

function fmtColor(fmt) {
  return FORMAT_COLORS[fmt] || FORMAT_COLORS.unknown;
}
function verColor(ver) {
  return VERSION_COLORS[ver] || VERSION_COLORS.unknown;
}

// ── Widget 1 — Stream Activity ──────────────────────────────────

function buildActivityPath(points, W, H, pad) {
  if (!points || points.length === 0) return '';
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const xFor = (i) => (W * i) / (points.length - 1 || 1);
  const yFor = (count) => H - pad - (H - pad * 2) * (count / maxCount);

  let d = 'M' + xFor(0) + ',' + yFor(points[0].count);
  for (let i = 1; i < points.length; i++) {
    // Simple smooth line using cubic bezier control points
    const x1 = xFor(i - 1);
    const x2 = xFor(i);
    const y1 = yFor(points[i - 1].count);
    const y2 = yFor(points[i].count);
    const cx = (x1 + x2) / 2;
    d += ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2;
  }
  // Close area
  const lastX = xFor(points.length - 1);
  d += ' L' + lastX + ',' + H + ' L0,' + H + ' Z';
  return d;
}

function buildLinePath(points, W, H, pad) {
  if (!points || points.length === 0) return '';
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const xFor = (i) => (W * i) / (points.length - 1 || 1);
  const yFor = (count) => H - pad - (H - pad * 2) * (count / maxCount);

  let d = 'M' + xFor(0) + ',' + yFor(points[0].count);
  for (let i = 1; i < points.length; i++) {
    const x1 = xFor(i - 1);
    const x2 = xFor(i);
    const y1 = yFor(points[i - 1].count);
    const y2 = yFor(points[i].count);
    const cx = (x1 + x2) / 2;
    d += ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2;
  }
  return d;
}

function renderWidget1(data, lang) {
  const points = data.stream_activity || [];
  const total = points.reduce((s, p) => s + p.count, 0);
  const peak = Math.max(...points.map((p) => p.count), 0);

  const W = 600,
    H = 180,
    PAD = 20;
  const areaPath = buildActivityPath(points, W, H, PAD);
  const linePath = buildLinePath(points, W, H, PAD);

  return `
    <div class="ins-widget" id="ins-w1">
      <div class="ins-widget__header">
        <h2 class="ins-widget__title">${escapeHtml(pick(L.widget1Title, lang))}</h2>
        <span class="ins-widget__meta">${escapeHtml(pick(L.total, lang))}: <strong>${total}</strong> &nbsp; ${escapeHtml(pick(L.peak, lang))}: <strong>${peak}</strong></span>
      </div>
      <svg class="ins-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stream activity">
        <defs>
          <linearGradient id="ins-sa-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--accent,#ffcc00)" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="var(--accent,#ffcc00)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line class="ins-chart-axis" x1="0" y1="${H}" x2="${W}" y2="${H}"/>
        ${areaPath ? `<path d="${escapeHtml(areaPath)}" fill="url(#ins-sa-grad)" class="ins-chart-area"/>` : ''}
        ${linePath ? `<path d="${escapeHtml(linePath)}" class="ins-chart-line"/>` : ''}
      </svg>
    </div>
  `;
}

// ── Widget 2 — Validation Health (donut) ───────────────────────

function polarToXY(cx, cy, r, angle) {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

function buildArcPath(cx, cy, r_inner, r_outer, startAngle, endAngle) {
  // Guard against full circle (SVG arc is ambiguous at 360°)
  const delta = endAngle - startAngle;
  const safe = Math.min(delta, Math.PI * 2 - 0.0001);
  const end = startAngle + safe;

  const p1 = polarToXY(cx, cy, r_outer, startAngle);
  const p2 = polarToXY(cx, cy, r_outer, end);
  const p3 = polarToXY(cx, cy, r_inner, end);
  const p4 = polarToXY(cx, cy, r_inner, startAngle);
  const large = safe > Math.PI ? 1 : 0;

  return (
    `M ${p1.x} ${p1.y} ` +
    `A ${r_outer} ${r_outer} 0 ${large} 1 ${p2.x} ${p2.y} ` +
    `L ${p3.x} ${p3.y} ` +
    `A ${r_inner} ${r_inner} 0 ${large} 0 ${p4.x} ${p4.y} Z`
  );
}

function renderWidget2(data, lang) {
  const t = data.validation_totals || { errors: 0, warnings: 0, info: 0 };
  const total = t.errors + t.warnings + t.info || 1;
  const errPct = ((t.errors / total) * 100).toFixed(1);

  const CX = 100,
    CY = 100,
    R_OUTER = 90,
    R_INNER = 54;
  // Start at top (−π/2)
  const START = -Math.PI / 2;
  let angle = START;

  const segments = [
    { count: t.errors, color: '#ef4444', label: pick(L.errors, lang) },
    { count: t.warnings, color: '#f59e0b', label: pick(L.warnings, lang) },
    { count: t.info, color: '#3b82f6', label: pick(L.info, lang) },
  ];

  let arcs = '';
  for (const seg of segments) {
    if (seg.count <= 0) {
      continue;
    }
    const sweep = (seg.count / total) * 2 * Math.PI;
    const pathD = buildArcPath(CX, CY, R_INNER, R_OUTER, angle, angle + sweep);
    arcs += `<path d="${escapeHtml(pathD)}" fill="${escapeHtml(seg.color)}" opacity="0.92"/>`;
    angle += sweep;
  }
  // If nothing, show a grey ring
  if (!arcs) {
    const pathD = buildArcPath(CX, CY, R_INNER, R_OUTER, START, START + 2 * Math.PI - 0.001);
    arcs = `<path d="${escapeHtml(pathD)}" fill="var(--bg-2,#f2ede3)"/>`;
  }

  const legendRows = segments
    .map(
      (s) => `
    <div class="ins-donut-legend-row">
      <span class="ins-donut-dot" style="background:${escapeHtml(s.color)}"></span>
      <span>${escapeHtml(s.label)}</span>
      <span class="ins-donut-legend-count">${s.count.toLocaleString()}</span>
    </div>
  `,
    )
    .join('');

  return `
    <div class="ins-widget" id="ins-w2">
      <div class="ins-widget__header">
        <h2 class="ins-widget__title">${escapeHtml(pick(L.widget2Title, lang))}</h2>
      </div>
      <div class="ins-donut-wrap">
        <svg class="ins-donut" viewBox="0 0 200 200" width="160" height="160" role="img" aria-label="Validation health donut">
          ${arcs}
          <text x="${CX}" y="${CY - 10}" class="ins-donut-label ins-donut-pct">${errPct}%</text>
          <text x="${CX}" y="${CY + 16}" class="ins-donut-label ins-donut-sub">ERRORS</text>
        </svg>
        <div class="ins-donut-legend">${legendRows}</div>
      </div>
    </div>
  `;
}

// ── Widget 3 — Spec Mix ─────────────────────────────────────────

function renderBars(rows, colorFn, lang) {
  if (!rows || rows.length === 0) return '<p style="font-size:13px;color:var(--text-muted)">—</p>';
  return rows
    .map(
      (r) => `
    <div class="ins-mix-row">
      <span class="ins-mix-label" title="${escapeHtml(r.format || r.version || '')}">${escapeHtml(r.format || r.version || '?')}</span>
      <div class="ins-mix-bar-wrap">
        <div class="ins-mix-bar-fill" style="width:${r.pct}%;background:${escapeHtml(colorFn(r.format || r.version || ''))}"></div>
      </div>
      <span class="ins-mix-pct">${r.pct}%</span>
    </div>
  `,
    )
    .join('');
}

function renderWidget3(data, lang) {
  const fmtBars = renderBars(data.format_mix, fmtColor, lang);
  const verBars = renderBars(data.version_mix, verColor, lang);

  return `
    <div class="ins-widget" id="ins-w3">
      <div class="ins-widget__header">
        <h2 class="ins-widget__title">${escapeHtml(pick(L.widget3Title, lang))}</h2>
      </div>
      <div class="ins-mix-table">
        <p class="ins-mix-subtitle">${escapeHtml(pick(L.formats, lang))}</p>
        ${fmtBars}
        <p class="ins-mix-subtitle">${escapeHtml(pick(L.versions, lang))}</p>
        ${verBars}
      </div>
    </div>
  `;
}

// ── Empty state ────────────────────────────────────────────────

function renderEmpty(lang) {
  return `
    <div class="ins-empty">
      <h2>${escapeHtml(pick(L.emptyTitle, lang))}</h2>
      <p>${escapeHtml(pick(L.emptyBody, lang))}</p>
      <div class="ins-skeleton-bar" style="width:60%"></div>
      <div class="ins-skeleton-bar" style="width:80%"></div>
      <div class="ins-skeleton-bar" style="width:45%"></div>
    </div>
  `;
}

// ── Section shell (header + controls) ─────────────────────────

function renderShell(lang) {
  return `
    <section class="ins-section">
      <header class="ins-section__head">
        <h1>${escapeHtml(pick(L.title, lang))}</h1>
        <p class="ins-section__sub">${escapeHtml(pick(L.subtitle, lang))}</p>
        <div class="ins-controls">
          <span class="ins-updated" id="ins-updated-label"></span>
          <label class="ins-toggle-label">
            <input type="checkbox" id="ins-refresh-toggle" autocomplete="off"/>
            ${escapeHtml(pick(L.autoRefresh, lang))}
          </label>
          <select class="ins-interval-select" id="ins-interval-select">
            <option value="15">15s</option>
            <option value="30" selected>30s</option>
            <option value="0">${escapeHtml(pick(L.refreshOff, lang))}</option>
          </select>
        </div>
      </header>
      <div id="ins-grid-root" class="ins-grid">
        <div style="padding:24px;color:var(--text-muted)">${escapeHtml(pick(L.loading, lang))}</div>
      </div>
    </section>
  `;
}

// ── Main module ────────────────────────────────────────────────

function getLang() {
  return document.documentElement.getAttribute('lang') || 'en';
}

async function fetchSummary() {
  const resp = await fetch('/api/v1/analytics/summary', { cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

function isEmptyData(data) {
  const total = (data.stream_activity || []).reduce((s, p) => s + p.count, 0);
  return total === 0;
}

function renderWidgets(data, lang) {
  return renderWidget1(data, lang) + renderWidget2(data, lang) + renderWidget3(data, lang);
}

export default {
  id: 'insights',
  css: '/modules/insights/insights.css',
  route: '/insights',

  async mount(container, ctx) {
    const lang = getLang();

    container.innerHTML = renderShell(lang);

    const gridRoot = container.querySelector('#ins-grid-root');
    const updatedLabel = container.querySelector('#ins-updated-label');
    const refreshToggle = container.querySelector('#ins-refresh-toggle');
    const intervalSelect = container.querySelector('#ins-interval-select');

    let lastFetch = null;
    let refreshTimer = null;
    let updateLabelTimer = null;

    function updateAgoLabel() {
      if (!updatedLabel) return;
      if (!lastFetch) {
        updatedLabel.textContent = '';
        return;
      }
      const secs = Math.floor((Date.now() - lastFetch) / 1000);
      if (secs < 5) {
        updatedLabel.textContent = pick(L.updatedNow, lang);
      } else {
        updatedLabel.textContent = pick(L.updatedAgo, lang).replace('{n}', secs);
      }
    }

    async function loadAndRender() {
      try {
        const data = await fetchSummary();
        lastFetch = Date.now();
        if (isEmptyData(data)) {
          gridRoot.innerHTML = renderEmpty(lang);
        } else {
          gridRoot.innerHTML = renderWidgets(data, lang);
        }
        updateAgoLabel();
      } catch (e) {
        if (gridRoot.children.length === 0 || gridRoot.firstElementChild.tagName !== 'DIV') {
          gridRoot.innerHTML = `<div class="ins-empty"><p>${escapeHtml(pick(L.errFetch, lang))}</p></div>`;
        }
      }
    }

    function scheduleRefresh() {
      clearInterval(refreshTimer);
      refreshTimer = null;
      if (!refreshToggle.checked) return;
      const intervalSec = Number(intervalSelect.value) || 30;
      if (intervalSec <= 0) return;
      refreshTimer = setInterval(() => {
        if (ctx && ctx.signal && ctx.signal.aborted) return;
        loadAndRender();
      }, intervalSec * 1000);
    }

    refreshToggle.addEventListener('change', scheduleRefresh);
    intervalSelect.addEventListener('change', scheduleRefresh);

    // Tick "updated N ago" label every 5s
    updateLabelTimer = setInterval(updateAgoLabel, 5000);

    // Cleanup
    if (ctx && ctx.addCleanup) {
      ctx.addCleanup(() => {
        clearInterval(refreshTimer);
        clearInterval(updateLabelTimer);
      });
    }

    // Initial load
    await loadAndRender();
  },

  unmount(container) {
    container.innerHTML = '';
  },
};
