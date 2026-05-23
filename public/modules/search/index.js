/* ============================================================
   public/modules/search/index.js — Global Search chrome utility.

   Usage (from topbar):
     import { initSearch } from '/modules/search/index.js';
     const cleanup = initSearch(inputEl, shellRoot);
     // call cleanup() on topbar unmount

   Features:
   - Cmd+K / Ctrl+K hotkey focuses the input
   - On first focus: fetches all 4 data sources in parallel and caches
   - Tokenised, scored, grouped results in a glassmorphism dropdown
   - Full keyboard navigation (↑↓ Enter Esc Tab)
   - Click-outside to close
   ============================================================ */
'use strict';

// ── Locale helpers ───────────────────────────────────────────────

function getLang() {
  return document.documentElement.getAttribute('lang') || 'en';
}

function pickStr(map) {
  if (!map) return '';
  if (typeof map === 'string') return map;
  const l = getLang();
  return map[l] || map.en || Object.values(map)[0] || '';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const GROUP_LABELS = {
  sample:   { en: 'Samples',            uk: 'Зразки',                   ru: 'Образцы' },
  behavior: { en: 'Behavior scenarios', uk: 'Сценарії поведінки',        ru: 'Поведенческие сценарии' },
  finding:  { en: 'Finding catalog',    uk: 'Документація помилок',      ru: 'Каталог ошибок' },
  blog:     { en: 'Blog',               uk: 'Блог',                      ru: 'Блог' },
};

const HINT_LABELS = {
  typeToSearch: { en: 'Type to search', uk: 'Введіть запит для пошуку', ru: 'Введите запрос для поиска' },
  nothing:      { en: 'Nothing found',  uk: 'Нічого не знайдено',       ru: 'Ничего не найдено' },
  loading:      { en: 'Loading index…', uk: 'Завантаження…',             ru: 'Загрузка…' },
};

const PLACEHOLDERS = {
  en: '🔎 search the site',
  uk: '🔎 шукати по сайту',
  ru: '🔎 искать по сайту',
};

// ── Data fetch + cache ───────────────────────────────────────────

let _index = null;          // cached flat item array
let _indexPromise = null;   // in-flight load promise

async function loadIndex() {
  if (_index) return _index;
  if (_indexPromise) return _indexPromise;

  _indexPromise = (async () => {
    const lang = getLang();
    const results = await Promise.allSettled([
      fetch('/api/v1/sample/list').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch('/api/v1/behavior/scenarios').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(`/api/v1/finding-catalog?lang=${encodeURIComponent(lang)}`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(`/api/v1/blog/list?lang=${encodeURIComponent(lang)}&limit=50`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ]);

    const items = [];

    // samples
    if (results[0].status === 'fulfilled') {
      const raw = results[0].value;
      const list = Array.isArray(raw) ? raw : (raw.items || []);
      list.forEach(s => items.push({
        type: 'sample',
        slug: s.slug || '',
        label: s.label || s.slug || '',
        format: s.format || '',
        note: s.note || '',
      }));
    } else {
      console.warn('[search] samples fetch failed:', results[0].reason);
    }

    // behavior scenarios
    if (results[1].status === 'fulfilled') {
      const raw = results[1].value;
      const list = Array.isArray(raw) ? raw : (raw.scenarios || raw.items || []);
      list.forEach(s => items.push({
        type: 'behavior',
        id: s.id || '',
        name: pickStrFrom(s.name, lang),
        category: s.category || '',
        description: pickStrFrom(s.description, lang),
        demonstrates: pickStrFrom(s.demonstrates, lang),
        sample: s.sample || '',
      }));
    } else {
      console.warn('[search] behavior fetch failed:', results[1].reason);
    }

    // findings
    if (results[2].status === 'fulfilled') {
      const raw = results[2].value;
      const list = Array.isArray(raw) ? raw : (raw.findings || raw.items || []);
      list.forEach(f => items.push({
        type: 'finding',
        id: f.id || '',
        severity: f.severity || 'info',
        message: f.message || '',
        specRef: f.specRef || f.spec_ref || '',
      }));
    } else {
      console.warn('[search] findings fetch failed:', results[2].reason);
    }

    // blog
    if (results[3].status === 'fulfilled') {
      const raw = results[3].value;
      const list = Array.isArray(raw) ? raw : (raw.posts || raw.items || []);
      list.forEach(p => items.push({
        type: 'blog',
        slug: p.slug || '',
        lang: p.lang || lang,
        title: p.title || '',
        category: p.category || '',
        summary: p.summary || '',
      }));
    } else {
      console.warn('[search] blog fetch failed:', results[3].reason);
    }

    _index = items;
    return items;
  })();

  return _indexPromise;
}

function pickStrFrom(val, lang) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  return val[lang] || val.en || Object.values(val)[0] || '';
}

// ── Search algorithm ─────────────────────────────────────────────

function scoreItem(item, tokens) {
  let score = 0;
  for (const tok of tokens) {
    let tokScore = 0;

    // Primary field weight = 3.0
    const primary = (item.label || item.name || item.title || '').toLowerCase();
    if (primary.includes(tok)) tokScore += 3.0;

    // Category weight = 1.5
    const cat = (item.category || item.format || '').toLowerCase();
    if (cat.includes(tok)) tokScore += 1.5;

    // Description / note / summary / message weight = 1.0
    const desc = (item.description || item.note || item.summary || item.message || item.demonstrates || '').toLowerCase();
    if (desc.includes(tok)) tokScore += 1.0;

    // ID / slug also searchable at 1.5 (precise match on ID is useful)
    const id = (item.id || item.slug || '').toLowerCase();
    if (id.includes(tok)) tokScore += 1.5;

    if (tokScore === 0) return 0; // token not matched — filter out
    score += tokScore;
  }
  return score;
}

function search(query) {
  if (!_index || !query) return [];
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  const scored = [];
  for (const item of _index) {
    const s = scoreItem(item, tokens);
    if (s > 0) scored.push({ item, score: s });
  }

  // Group by type
  const groups = {};
  for (const { item, score } of scored) {
    if (!groups[item.type]) groups[item.type] = [];
    groups[item.type].push({ item, score });
  }

  // Sort each group, take top 5
  const typeOrder = ['sample', 'behavior', 'finding', 'blog'];
  const result = [];
  let total = 0;
  for (const type of typeOrder) {
    if (!groups[type]) continue;
    groups[type].sort((a, b) => b.score - a.score);
    const slice = groups[type].slice(0, 5);
    if (slice.length) {
      result.push({ type, items: slice.map(x => x.item) });
      total += slice.length;
    }
    if (total >= 20) break;
  }
  return result;
}

// ── URL builder ──────────────────────────────────────────────────

function buildUrl(item) {
  const lang = getLang();
  const prefix = lang === 'en' ? '' : '/' + lang;
  switch (item.type) {
    case 'sample':   return `${prefix}/inspector?sample=${encodeURIComponent(item.slug)}`;
    case 'behavior': return `${prefix}/inspector?sample=${encodeURIComponent(item.sample)}`;
    case 'finding':  return `${prefix}/docs/findings#${encodeURIComponent(item.id)}`;
    case 'blog':     return `${prefix}/blog/${encodeURIComponent(item.lang)}/${encodeURIComponent(item.slug)}`;
    default:         return '/';
  }
}

// ── Highlight ────────────────────────────────────────────────────

function highlight(text, tokens) {
  if (!tokens || !tokens.length || !text) return escHtml(text);
  let escaped = escHtml(text);
  for (const tok of tokens) {
    if (!tok) continue;
    // Case-insensitive replace, safe on already-escaped text since tokens won't contain html entities
    const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    escaped = escaped.replace(re, '<mark class="search-hit">$&</mark>');
  }
  return escaped;
}

function truncate(text, len) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '…' : text;
}

// ── Badge ────────────────────────────────────────────────────────

function badgeClass(item) {
  if (item.type === 'sample')   return 'sg-badge--sample';
  if (item.type === 'behavior') return 'sg-badge--behavior';
  if (item.type === 'blog')     return 'sg-badge--blog';
  if (item.type === 'finding') {
    if (item.severity === 'error')   return 'sg-badge--finding-error';
    if (item.severity === 'warning') return 'sg-badge--finding-warning';
    return 'sg-badge--finding-info';
  }
  return '';
}

function badgeText(item) {
  if (item.type === 'sample')   return item.format || 'smpl';
  if (item.type === 'behavior') return item.category || 'scn';
  if (item.type === 'finding')  return item.severity || 'info';
  if (item.type === 'blog')     return item.category || 'blog';
  return '?';
}

// ── Render dropdown ──────────────────────────────────────────────

function renderDropdown(state, query, groups) {
  const lang = getLang();
  const tokens = query ? query.toLowerCase().trim().split(/\s+/).filter(Boolean) : [];

  if (state === 'loading') {
    return `<div class="sg-search-loading">${escHtml(pickStr(HINT_LABELS.loading))}</div>`;
  }

  if (!query) {
    // Hint card
    const label = pickStr(HINT_LABELS.typeToSearch);
    return `
      <div class="sg-search-hint">
        <div class="sg-search-hint__title">${escHtml(label)}</div>
        <div class="sg-search-hint__chips">
          <span class="sg-search-hint__chip" data-suggest="gdpr">Try: gdpr</span>
          <span class="sg-search-hint__chip" data-suggest="vast">Try: vast</span>
          <span class="sg-search-hint__chip" data-suggest="ortb">Try: ortb</span>
          <span class="sg-search-hint__chip" data-suggest="banner">Try: banner</span>
        </div>
      </div>
    `;
  }

  if (!groups || !groups.length) {
    const label = pickStr(HINT_LABELS.nothing);
    return `<div class="sg-search-empty">${escHtml(label)}</div>`;
  }

  let html = '';
  for (const group of groups) {
    const groupLabel = pickStr(GROUP_LABELS[group.type] || { en: group.type });
    html += `
      <div class="sg-search-group" data-group-type="${escHtml(group.type)}">
        <div class="sg-search-group__header">
          <span class="sg-search-group__label">${escHtml(groupLabel)}</span>
          <span class="sg-search-group__count">${group.items.length}</span>
        </div>
    `;
    for (const item of group.items) {
      const url = buildUrl(item);
      const primaryText = item.label || item.name || item.title || item.id || '';
      const previewText = truncate(item.description || item.note || item.summary || item.message || item.demonstrates || '', 80);
      const bClass = badgeClass(item);
      const bText = badgeText(item);
      html += `
        <a class="sg-search-row"
           href="${escHtml(url)}"
           data-search-url="${escHtml(url)}"
           tabindex="-1">
          <span class="sg-badge ${escHtml(bClass)}" aria-hidden="true">${escHtml(bText.slice(0, 4))}</span>
          <span class="sg-search-row__body">
            <span class="sg-search-row__title">${highlight(primaryText, tokens)}</span>
            ${previewText ? `<span class="sg-search-row__preview">${highlight(previewText, tokens)}</span>` : ''}
          </span>
        </a>
      `;
    }
    html += '</div>';
  }
  return html;
}

// ── Main initSearch ──────────────────────────────────────────────

export function initSearch(inputEl, shellRoot) {
  const lang = getLang();
  inputEl.placeholder = PLACEHOLDERS[lang] || PLACEHOLDERS.en;

  // Load CSS
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = '/modules/search/search.css';
  document.head.appendChild(cssLink);

  // Create dropdown element (attached to inputEl's parent = .kt-topbar__search)
  const dropdownEl = document.createElement('div');
  dropdownEl.className = 'sg-search-dropdown';
  dropdownEl.setAttribute('role', 'listbox');
  dropdownEl.setAttribute('aria-label', 'Search results');
  dropdownEl.hidden = true;

  const searchWrapper = inputEl.closest('.kt-topbar__search') || inputEl.parentElement;
  searchWrapper.appendChild(dropdownEl);

  let indexLoaded = false;
  let selectedIndex = -1;
  let currentGroups = [];
  let debounceTimer = null;

  function getAllRows() {
    return Array.from(dropdownEl.querySelectorAll('.sg-search-row'));
  }

  function setSelected(idx) {
    const rows = getAllRows();
    rows.forEach((r, i) => r.classList.toggle('is-selected', i === idx));
    selectedIndex = idx;
    if (idx >= 0 && rows[idx]) {
      rows[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  function openDropdown(content) {
    dropdownEl.innerHTML = content;
    dropdownEl.hidden = false;
    selectedIndex = -1;

    // Wire hint chip clicks
    dropdownEl.querySelectorAll('[data-suggest]').forEach(chip => {
      chip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        inputEl.value = chip.dataset.suggest;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  function closeDropdown() {
    dropdownEl.hidden = true;
    dropdownEl.innerHTML = '';
    selectedIndex = -1;
    currentGroups = [];
  }

  function renderCurrent(query) {
    if (!indexLoaded) {
      openDropdown(renderDropdown('loading', query, null));
      return;
    }
    const groups = search(query);
    currentGroups = groups;
    openDropdown(renderDropdown('ready', query, groups));
  }

  // ── Index load ───────────────────────────────────────────────
  async function ensureIndex(query) {
    if (indexLoaded) return;
    // Show loading state
    if (!dropdownEl.hidden) {
      dropdownEl.innerHTML = `<div class="sg-search-loading">${escHtml(pickStr(HINT_LABELS.loading))}</div>`;
    }
    try {
      await loadIndex();
    } catch (e) {
      console.error('[search] index load error:', e);
    }
    indexLoaded = true;
    // Re-render now that index is ready
    const q = inputEl.value.trim();
    renderCurrent(q);
  }

  // ── Focus ────────────────────────────────────────────────────
  const onFocus = () => {
    const q = inputEl.value.trim();
    renderCurrent(q);
    if (!indexLoaded) {
      ensureIndex(q);
    }
  };

  // ── Input ─────────────────────────────────────────────────── 
  const onInput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = inputEl.value.trim();
      if (!indexLoaded) {
        ensureIndex(q);
      } else {
        renderCurrent(q);
      }
    }, 80);
  };

  // ── Keyboard ─────────────────────────────────────────────────
  const onKeydown = (e) => {
    if (dropdownEl.hidden) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onFocus();
        return;
      }
      return;
    }

    const rows = getAllRows();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = selectedIndex + 1 >= rows.length ? 0 : selectedIndex + 1;
      setSelected(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = selectedIndex - 1 < 0 ? rows.length - 1 : selectedIndex - 1;
      setSelected(prev);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && rows[selectedIndex]) {
        const url = rows[selectedIndex].dataset.searchUrl;
        if (url) navigate(url);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      inputEl.blur();
    } else if (e.key === 'Tab') {
      closeDropdown();
    }
  };

  function navigate(url) {
    closeDropdown();
    inputEl.value = '';
    if (window.SpyglassShell && typeof window.SpyglassShell.navigateTo === 'function') {
      window.SpyglassShell.navigateTo(url);
    } else {
      window.location.assign(url);
    }
  }

  // Click on a result row
  const onDropdownClick = (e) => {
    const row = e.target.closest('.sg-search-row');
    if (row) {
      e.preventDefault();
      navigate(row.dataset.searchUrl);
    }
  };

  // Click outside → close
  const onDocClick = (e) => {
    if (!searchWrapper.contains(e.target)) {
      closeDropdown();
    }
  };

  // ── Cmd+K / Ctrl+K global hotkey ────────────────────────────
  const onGlobalKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      inputEl.focus();
      inputEl.select();
      if (dropdownEl.hidden) {
        onFocus();
      }
    }
  };

  // ── Wire events ──────────────────────────────────────────────
  inputEl.addEventListener('focus', onFocus);
  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKeydown);
  dropdownEl.addEventListener('click', onDropdownClick);
  document.addEventListener('keydown', onGlobalKey);
  document.addEventListener('click', onDocClick);

  // ── Cleanup ──────────────────────────────────────────────────
  return function cleanup() {
    inputEl.removeEventListener('focus', onFocus);
    inputEl.removeEventListener('input', onInput);
    inputEl.removeEventListener('keydown', onKeydown);
    dropdownEl.removeEventListener('click', onDropdownClick);
    document.removeEventListener('keydown', onGlobalKey);
    document.removeEventListener('click', onDocClick);
    closeDropdown();
    dropdownEl.remove();
    cssLink.remove();
    clearTimeout(debounceTimer);
  };
}
