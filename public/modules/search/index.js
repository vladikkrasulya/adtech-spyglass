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

   Accessibility (F-07): the dropdown implements the ARIA 1.2
   combobox-with-listbox-popup pattern — the INPUT keeps DOM focus at all
   times and owns role=combobox + aria-expanded/aria-controls/
   aria-activedescendant; the rows are role=option and stay out of the tab
   order. See the block comment above initSearch() for why that pattern was
   chosen over plain tab-focusable links.
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
  landing: { en: 'Reference guides', uk: 'Довідники', ru: 'Справочники' },
  sample: { en: 'Samples', uk: 'Зразки', ru: 'Образцы' },
  behavior: { en: 'Behavior scenarios', uk: 'Сценарії поведінки', ru: 'Поведенческие сценарии' },
  finding: { en: 'Finding catalog', uk: 'Документація помилок', ru: 'Каталог ошибок' },
  blog: { en: 'Blog', uk: 'Блог', ru: 'Блог' },
};

const HINT_LABELS = {
  typeToSearch: {
    en: 'Type to search',
    uk: 'Введіть запит для пошуку',
    ru: 'Введите запрос для поиска',
  },
  nothing: { en: 'Nothing found', uk: 'Нічого не знайдено', ru: 'Ничего не найдено' },
  loading: { en: 'Loading index…', uk: 'Завантаження…', ru: 'Загрузка…' },
};

// Starter queries offered in the empty state. They used to be rendered as
// "Try: gdpr" — a hardcoded English lead-in repeated four times, under a
// title that pickStr() had already localised, so /uk and /ru showed an
// English half-sentence inside a Ukrainian panel.
//
// The lead-in is gone rather than translated, because the two halves of
// "Try: gdpr" are different KINDS of string: "Try:" is prose and belongs in
// a locale map, while `gdpr` is a query token fed straight back into the
// index and must stay in Latin in every locale. Dropping the prose leaves
// only the token, which is the same in all three locales by definition —
// and the chips keep their pill shape, pointer cursor and hover, which is
// what says "clickable" here, not the word "Try".
const HINT_SUGGESTIONS = ['gdpr', 'vast', 'ortb', 'banner'];

const PLACEHOLDERS = {
  en: 'Jump to section, finding or doc',
  uk: 'Перейти до розділу, знахідки чи доки',
  ru: 'Перейти к разделу, находке или доке',
};

// F-07: the results container announced itself with the hardcoded English
// string 'Search results' even on /uk and /ru. Everything else user-visible
// in this module already goes through pickStr() + a per-string locale map —
// the accessible name had simply been left out of that mechanism.
const A11Y_LABELS = {
  results: { en: 'Search results', uk: 'Результати пошуку', ru: 'Результаты поиска' },
};

// F-06: the docs finding catalog renders one row per finding as
// <tr id="finding-${item.id}"> — see renderTable() in
// public/modules/docs/index.js. This module used to link to a bare
// `#${item.id}` ("#vast.version_missing"), which matches no element in that
// table at all, so a measured navigation left the intended row sitting at
// top:10477px with the viewport still at the top of the page. Kept as a
// named constant shared by buildUrl() and the post-navigation scroll so the
// two can never drift apart again.
const FINDING_ANCHOR_PREFIX = 'finding-';

// Instance counter — the ARIA wiring needs DOM ids that are unique per
// mounted search widget (topbar re-mounts on kt:lang-change).
let _instanceSeq = 0;

// ── Reference guides (server-rendered landing pages) ─────────────
// The six guides under lib/landings.js were reachable from sitemap.xml and
// nothing else: no rail entry, no footer link, and — until now — no search
// hit, so a user who did not already know the URL could not get to them from
// inside the app at all. They are static server content with no listing
// endpoint, hence a literal table; tests/site-chrome.test.js compares the
// routes here against lib/landings.js so a new guide cannot quietly go
// missing from search again. (The SSR cross-links that would also give them
// crawlable internal weight belong to lib/landings.js + the index.*.html
// shells — different owners, still open.)
const LANDING_PAGES = [
  {
    route: '/openrtb/2-6',
    title: {
      en: 'OpenRTB 2.6 Validator',
      uk: 'Валідатор OpenRTB 2.6',
      ru: 'Валидатор OpenRTB 2.6',
    },
    summary: {
      en: 'Ad pods, SupplyChain, DOOH — what 2.6 adds over 2.5, and a validator for it.',
      uk: 'Ad pods, SupplyChain, DOOH — що 2.6 додає до 2.5, і валідатор для цього.',
      ru: 'Ad pods, SupplyChain, DOOH — что 2.6 добавляет к 2.5, и валидатор для этого.',
    },
    keywords: 'openrtb 2.6 bidrequest bidresponse pod schain ctv',
  },
  {
    route: '/openrtb/2-5',
    title: {
      en: 'OpenRTB 2.5 Validator',
      uk: 'Валідатор OpenRTB 2.5',
      ru: 'Валидатор OpenRTB 2.5',
    },
    summary: {
      en: 'The version most exchanges still speak, and the fields that break it.',
      uk: 'Версія, якою досі говорить більшість бірж, і поля, що її ламають.',
      ru: 'Версия, на которой до сих пор говорит большинство бирж, и поля, что её ломают.',
    },
    keywords: 'openrtb 2.5 bidrequest bidresponse imp banner video',
  },
  {
    route: '/openrtb/3-0',
    title: {
      en: 'OpenRTB 3.0 Validator',
      uk: 'Валідатор OpenRTB 3.0',
      ru: 'Валидатор OpenRTB 3.0',
    },
    summary: {
      en: 'The layered rewrite: OpenRTB 3.0 envelope plus AdCOM objects.',
      uk: 'Шарова переробка: конверт OpenRTB 3.0 плюс обʼєкти AdCOM.',
      ru: 'Слоёная переработка: конверт OpenRTB 3.0 плюс объекты AdCOM.',
    },
    keywords: 'openrtb 3.0 adcom layered envelope item',
  },
  {
    route: '/vast',
    title: { en: 'VAST Validator', uk: 'Валідатор VAST', ru: 'Валидатор VAST' },
    summary: {
      en: 'Paste a VAST document and see what a player would refuse to play.',
      uk: 'Встав VAST-документ і побач, що саме плеєр відмовиться програти.',
      ru: 'Вставь VAST-документ и увидь, что именно плеер откажется проиграть.',
    },
    keywords: 'vast xml inline wrapper video creative mediafile',
  },
  {
    route: '/native',
    title: {
      en: 'OpenRTB Native Validator',
      uk: 'Валідатор OpenRTB Native',
      ru: 'Валидатор OpenRTB Native',
    },
    summary: {
      en: 'Native 1.2 request/response — assets, required flags, and the usual mismatches.',
      uk: 'Native 1.2 запит/відповідь — ассети, обовʼязкові прапорці й типові розбіжності.',
      ru: 'Native 1.2 запрос/ответ — ассеты, обязательные флаги и типичные расхождения.',
    },
    keywords: 'native 1.2 assets title img data eventtrackers',
  },
  {
    route: '/iab-categories',
    title: {
      en: 'IAB Content Taxonomy — Category Codes',
      uk: 'Контент-таксономія IAB — коди категорій',
      ru: 'Контент-таксономия IAB — коды категорий',
    },
    summary: {
      en: 'IAB category codes for cat / bcat / sectioncat, in one searchable table.',
      uk: 'Коди категорій IAB для cat / bcat / sectioncat — одна таблиця з пошуком.',
      ru: 'Коды категорий IAB для cat / bcat / sectioncat — одна таблица с поиском.',
    },
    keywords: 'iab category taxonomy cat bcat sectioncat iab1 content',
  },
];

// ── Data fetch + cache ───────────────────────────────────────────

let _index = null; // cached flat item array
let _indexPromise = null; // in-flight load promise
let _indexLang = null; // locale the cache was built for

/** Drop the cached index. Exported for the topbar/tests; called automatically
 *  by loadIndex() whenever the document locale no longer matches the cache. */
export function resetSearchIndex() {
  _index = null;
  _indexPromise = null;
  _indexLang = null;
}

// The cache is module-level, so it outlives every initSearch()/cleanup() cycle
// — which is the point (one fetch per page load, not one per topbar re-mount)
// but was also the bug: /api/v1/finding-catalog and /api/v1/blog/list are
// fetched WITH ?lang=, so the cache is locale-specific, and nothing invalidated
// it on kt:lang-change. After a language switch the panel came back half
// translated: group headers localised (they are picked at render time) on top
// of result titles still in the previous language. Keying the cache by the
// locale it was built for is what makes the two halves agree.
async function loadIndex() {
  const lang = getLang();
  if (_indexLang !== null && _indexLang !== lang) resetSearchIndex();
  _indexLang = lang;
  if (_index) return _index;
  if (_indexPromise) return _indexPromise;

  _indexPromise = (async () => {
    const results = await Promise.allSettled([
      fetch('/api/v1/sample/list').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch('/api/v1/behavior/scenarios').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(`/api/v1/finding-catalog?lang=${encodeURIComponent(lang)}`).then((r) =>
        r.ok ? r.json() : Promise.reject(r.status),
      ),
      fetch(`/api/v1/blog/list?lang=${encodeURIComponent(lang)}&limit=50`).then((r) =>
        r.ok ? r.json() : Promise.reject(r.status),
      ),
    ]);

    const items = [];

    // samples
    if (results[0].status === 'fulfilled') {
      const raw = results[0].value;
      const list = Array.isArray(raw) ? raw : raw.items || [];
      list.forEach((s) =>
        items.push({
          type: 'sample',
          slug: s.slug || '',
          label: s.label || s.slug || '',
          format: s.format || '',
          note: s.note || '',
        }),
      );
    } else {
      console.warn('[search] samples fetch failed:', results[0].reason);
    }

    // behavior scenarios
    if (results[1].status === 'fulfilled') {
      const raw = results[1].value;
      const list = Array.isArray(raw) ? raw : raw.scenarios || raw.items || [];
      list.forEach((s) =>
        items.push({
          type: 'behavior',
          id: s.id || '',
          name: pickStrFrom(s.name, lang),
          category: s.category || '',
          description: pickStrFrom(s.description, lang),
          demonstrates: pickStrFrom(s.demonstrates, lang),
          sample: s.sample || '',
        }),
      );
    } else {
      console.warn('[search] behavior fetch failed:', results[1].reason);
    }

    // findings
    if (results[2].status === 'fulfilled') {
      const raw = results[2].value;
      const list = Array.isArray(raw) ? raw : raw.findings || raw.items || [];
      list.forEach((f) =>
        items.push({
          type: 'finding',
          id: f.id || '',
          severity: f.severity || 'info',
          message: f.message || '',
          specRef: f.specRef || f.spec_ref || '',
        }),
      );
    } else {
      console.warn('[search] findings fetch failed:', results[2].reason);
    }

    // blog
    if (results[3].status === 'fulfilled') {
      const raw = results[3].value;
      const list = Array.isArray(raw) ? raw : raw.posts || raw.items || [];
      list.forEach((p) =>
        items.push({
          type: 'blog',
          slug: p.slug || '',
          lang: p.lang || lang,
          title: p.title || '',
          category: p.category || '',
          summary: p.summary || '',
        }),
      );
    } else {
      console.warn('[search] blog fetch failed:', results[3].reason);
    }

    // Reference guides are static content shipped by the server (see
    // lib/landings.js) — no endpoint lists them, so the routes and their H1s
    // live in LANDING_PAGES above and tests/site-chrome.test.js asserts the
    // two stay in step.
    LANDING_PAGES.forEach((p) =>
      items.push({
        type: 'landing',
        route: p.route,
        title: pickStrFrom(p.title, lang),
        summary: pickStrFrom(p.summary, lang),
        keywords: p.keywords,
      }),
    );

    // A locale switch during the fetch invalidated this result before it
    // arrived — publishing it now would re-poison the cache the switch just
    // cleared. The caller still gets the items it asked for.
    if (_indexLang === lang) _index = items;
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
    const desc = (
      item.description ||
      item.note ||
      item.summary ||
      item.message ||
      item.demonstrates ||
      ''
    ).toLowerCase();
    if (desc.includes(tok)) tokScore += 1.0;

    // ID / slug also searchable at 1.5 (precise match on ID is useful)
    const id = (item.id || item.slug || item.route || '').toLowerCase();
    if (id.includes(tok)) tokScore += 1.5;

    // Reference guides carry a hand-written keyword line (the words an
    // operator actually types — "schain", "bcat", "wrapper") which appears
    // in no other field. Weight 1.0: a synonym match, not a title match.
    const kw = (item.keywords || '').toLowerCase();
    if (kw.includes(tok)) tokScore += 1.0;

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
  const typeOrder = ['landing', 'sample', 'behavior', 'finding', 'blog'];
  const result = [];
  let total = 0;
  for (const type of typeOrder) {
    if (!groups[type]) continue;
    groups[type].sort((a, b) => b.score - a.score);
    const slice = groups[type].slice(0, 5);
    if (slice.length) {
      result.push({ type, items: slice.map((x) => x.item) });
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
    case 'landing':
      // Server-rendered page: a normal locale-prefixed path, no query.
      return `${prefix}${item.route}`;
    case 'sample':
      return `${prefix}/inspector?sample=${encodeURIComponent(item.slug)}`;
    case 'behavior':
      return `${prefix}/inspector?sample=${encodeURIComponent(item.sample)}`;
    case 'finding':
      // Anchor must match docs' row id EXACTLY, prefix included — see
      // FINDING_ANCHOR_PREFIX. encodeURIComponent is a no-op for the ids
      // that actually exist (dots/underscores are unreserved) but is kept
      // so a future id with a reserved character still yields a legal URL;
      // scrollToAnchor() decodes before looking the element up, so the two
      // sides stay symmetric.
      return `${prefix}/docs/findings#${FINDING_ANCHOR_PREFIX}${encodeURIComponent(item.id)}`;
    case 'blog':
      return `${prefix}/blog/${encodeURIComponent(item.lang)}/${encodeURIComponent(item.slug)}`;
    default:
      return '/';
  }
}

// ── Post-navigation anchor scroll ────────────────────────────────
// F-06, second half. Emitting the right anchor is necessary but NOT
// sufficient, for two reasons both confirmed by reading the code we
// navigate into:
//   1. shell-boot.js's navigateTo() moves the SPA with history.pushState().
//      pushState never performs the browser's own fragment scroll and never
//      fires hashchange, so a correct `#finding-…` in the URL still moved
//      nothing. Neither the docs module nor shell-boot reads location.hash.
//   2. /docs/findings renders its <table> only AFTER fetching
//      /api/v1/finding-catalog (mountCatalog in docs/index.js), so the row
//      does not exist on the frame the navigation completes — a one-shot
//      lookup would miss even with the anchor fixed.
// Hence: poll a bounded number of animation frames for the row, then scroll.
let _scrollToken = 0;

function scrollToAnchor(url) {
  const hashIdx = url.indexOf('#');
  if (hashIdx < 0) return;
  const raw = url.slice(hashIdx + 1);
  if (!raw) return;
  let id;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }
  // getElementById, NEVER querySelector('#' + id): finding ids contain dots
  // ("finding-vast.version_missing"), and a CSS selector parses that dot as
  // a class separator — querySelector would silently match nothing. This is
  // also why no CSS.escape() dance is needed here.
  const token = ++_scrollToken; // cancels any earlier in-flight poll
  // navigateTo() pushState()s synchronously before we get here, so this is
  // already the destination path. Re-checking it each frame is how a poll
  // that outlives the user's interest gets abandoned instead of yanking the
  // viewport on whatever page they moved on to.
  const startPath = window.location.pathname;
  let frames = 0;
  const MAX_FRAMES = 180; // ~3s at 60fps — covers a slow catalog fetch

  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);

  (function tick() {
    if (token !== _scrollToken) return; // superseded by a newer navigation
    if (window.location.pathname !== startPath) return;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      // Move focus to the row as well, so a keyboard/screen-reader user who
      // activated the result lands ON the finding instead of being told
      // nothing changed. tabindex=-1 keeps it out of the tab order.
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      if (typeof el.focus === 'function') el.focus({ preventScroll: true });
      return;
    }
    if (++frames < MAX_FRAMES) raf(tick);
  })();
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
  if (item.type === 'landing') return 'sg-badge--landing';
  if (item.type === 'sample') return 'sg-badge--sample';
  if (item.type === 'behavior') return 'sg-badge--behavior';
  if (item.type === 'blog') return 'sg-badge--blog';
  if (item.type === 'finding') {
    if (item.severity === 'error') return 'sg-badge--finding-error';
    if (item.severity === 'warning') return 'sg-badge--finding-warning';
    return 'sg-badge--finding-info';
  }
  return '';
}

function badgeText(item) {
  if (item.type === 'landing') return 'doc';
  if (item.type === 'sample') return item.format || 'smpl';
  if (item.type === 'behavior') return item.category || 'scn';
  if (item.type === 'finding') return item.severity || 'info';
  if (item.type === 'blog') return item.category || 'blog';
  return '?';
}

// ── Render dropdown ──────────────────────────────────────────────

// `idPrefix` namespaces the DOM ids the combobox wiring needs
// (aria-controls / aria-activedescendant / aria-labelledby).
//
// The loading / hint / empty states carry role="presentation": they render
// inside the role=listbox container, and a listbox whose children are
// arbitrary <div>s is invalid ARIA — presentation keeps them out of the
// accessibility tree so the popup reports an honest option count instead of
// exposing status text as if it were a selectable result.
function renderDropdown(state, query, groups, idPrefix) {
  const tokens = query ? query.toLowerCase().trim().split(/\s+/).filter(Boolean) : [];

  if (state === 'loading') {
    return `<div class="sg-search-loading" role="presentation">${escHtml(pickStr(HINT_LABELS.loading))}</div>`;
  }

  if (!query) {
    // Hint card
    const label = pickStr(HINT_LABELS.typeToSearch);
    return `
      <div class="sg-search-hint" role="presentation">
        <div class="sg-search-hint__title">${escHtml(label)}</div>
        <div class="sg-search-hint__chips">
          ${HINT_SUGGESTIONS.map(
            (term) =>
              `<span class="sg-search-hint__chip" data-suggest="${escHtml(term)}">${escHtml(term)}</span>`,
          ).join('')}
        </div>
      </div>
    `;
  }

  if (!groups || !groups.length) {
    const label = pickStr(HINT_LABELS.nothing);
    return `<div class="sg-search-empty" role="presentation">${escHtml(label)}</div>`;
  }

  let html = '';
  let optIndex = 0;
  for (const group of groups) {
    const groupLabel = pickStr(GROUP_LABELS[group.type] || { en: group.type });
    const headerId = `${idPrefix}-grp-${group.type}`;
    html += `
      <div class="sg-search-group" role="group" aria-labelledby="${escHtml(headerId)}" data-group-type="${escHtml(group.type)}">
        <div class="sg-search-group__header" id="${escHtml(headerId)}">
          <span class="sg-search-group__label">${escHtml(groupLabel)}</span>
          <span class="sg-search-group__count">${group.items.length}</span>
        </div>
    `;
    for (const item of group.items) {
      const url = buildUrl(item);
      const primaryText = item.label || item.name || item.title || item.id || '';
      const previewText = truncate(
        item.description || item.note || item.summary || item.message || item.demonstrates || '',
        80,
      );
      const bClass = badgeClass(item);
      const bText = badgeText(item);
      // tabindex="-1" was already here before F-07, but for the wrong
      // reason: nothing put the rows in reach any other way, so they were
      // simply unreachable. Under the combobox pattern it is now correct BY
      // DESIGN — options must not be tab stops; the input holds focus and
      // aria-activedescendant points at the row id below.
      html += `
        <a class="sg-search-row"
           id="${escHtml(idPrefix)}-opt-${optIndex++}"
           role="option"
           aria-selected="false"
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

// F-07 — chosen pattern: ARIA 1.2 combobox with a listbox popup, NOT plain
// tab-focusable links. Both were legitimate; this one won on three counts.
//   1. It is what the widget already half-was. The measured DOM already
//      claimed role=listbox and the JS already kept a virtual selection
//      (selectedIndex / setSelected / ↑↓ / Enter). The only thing missing
//      was the ARIA contract that makes that virtual selection perceivable:
//      role=combobox on the input plus aria-expanded / aria-controls /
//      aria-activedescendant / aria-autocomplete, and role=option +
//      aria-selected on the rows. "ArrowDown leaves focus in the input" was
//      never the bug — under this pattern that is the CORRECT behaviour;
//      the bug was that nothing told assistive tech where the selection had
//      moved to.
//   2. Plain links would put up to 20 tab stops between the search box and
//      the rest of the topbar, and every keystroke rebuilds the list — a
//      keyboard user mid-list would have focus destroyed underneath them on
//      the next debounce tick. The virtual cursor has no such problem.
//   3. It matches what a Cmd+K site-search is expected to be.
// Everything the pattern requires is implemented here: expanded state,
// controls/activedescendant wiring, ↑↓ wraparound, Enter to activate,
// Escape to close while KEEPING focus in the combobox, Tab to close and
// move on, and full teardown of the attributes in cleanup().
export function initSearch(inputEl, _shellRoot) {
  const lang = getLang();
  inputEl.placeholder = PLACEHOLDERS[lang] || PLACEHOLDERS.en;

  // Load CSS
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = '/modules/search/search.css';
  document.head.appendChild(cssLink);

  const idPrefix = `sg-search-${++_instanceSeq}`;
  const listboxId = `${idPrefix}-listbox`;

  // Create dropdown element (attached to inputEl's parent = .kt-topbar__search)
  const dropdownEl = document.createElement('div');
  dropdownEl.className = 'sg-search-dropdown';
  dropdownEl.id = listboxId;
  dropdownEl.setAttribute('role', 'listbox');
  dropdownEl.setAttribute('aria-label', pickStr(A11Y_LABELS.results));
  dropdownEl.hidden = true;

  const searchWrapper = inputEl.closest('.kt-topbar__search') || inputEl.parentElement;
  searchWrapper.appendChild(dropdownEl);

  // ── Combobox contract on the input (F-07) ────────────────────
  // Pre-fix measurement of the input: role=null, aria-expanded=null,
  // aria-controls=null, aria-activedescendant=null, aria-autocomplete=null
  // — i.e. the listbox above was announced but no element ever pointed at
  // it, so there was no way in.
  inputEl.setAttribute('role', 'combobox');
  inputEl.setAttribute('aria-expanded', 'false');
  inputEl.setAttribute('aria-controls', listboxId);
  inputEl.setAttribute('aria-haspopup', 'listbox');
  inputEl.setAttribute('aria-autocomplete', 'list');

  let indexLoaded = false;
  let selectedIndex = -1;
  let debounceTimer = null;

  function getAllRows() {
    return Array.from(dropdownEl.querySelectorAll('.sg-search-row'));
  }

  function setSelected(idx) {
    const rows = getAllRows();
    rows.forEach((r, i) => {
      const on = i === idx;
      r.classList.toggle('is-selected', on);
      // The visual .is-selected class alone told a sighted user where the
      // cursor was and told everyone else nothing; aria-selected +
      // aria-activedescendant are the half that was missing.
      r.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    selectedIndex = idx;
    if (idx >= 0 && rows[idx]) {
      inputEl.setAttribute('aria-activedescendant', rows[idx].id);
      rows[idx].scrollIntoView({ block: 'nearest' });
    } else {
      inputEl.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * Keep the open panel inside the viewport.
   *
   * The panel is anchored to the input's right edge in CSS, which is right
   * for a topbar search that lives at the right end of the bar. Should the
   * input ever sit close to the LEFT edge instead (a narrow shell, a
   * different surface), that same anchor would push the panel off the other
   * side — so measure once per open and nudge it back with a margin. The
   * common case measures, finds nothing to do, and clears the variable.
   */
  const VIEWPORT_GUTTER = 8;
  function keepOnScreen() {
    dropdownEl.style.removeProperty('--sg-dd-shift');
    const rect = dropdownEl.getBoundingClientRect();
    if (rect.width === 0) return;
    // Positive shift pulls the panel right (margin-right shrinks the offset
    // from the anchor), which is what a left overflow needs.
    const overflowLeft = VIEWPORT_GUTTER - rect.left;
    if (overflowLeft > 0) {
      const room = Math.max(0, document.documentElement.clientWidth - VIEWPORT_GUTTER - rect.right);
      const shift = Math.min(overflowLeft, room);
      if (shift > 0) dropdownEl.style.setProperty('--sg-dd-shift', `-${Math.round(shift)}px`);
    }
  }

  function openDropdown(content) {
    dropdownEl.innerHTML = content;
    dropdownEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
    selectedIndex = -1;
    inputEl.removeAttribute('aria-activedescendant');
    keepOnScreen();

    // Wire hint chip clicks
    dropdownEl.querySelectorAll('[data-suggest]').forEach((chip) => {
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
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.removeAttribute('aria-activedescendant');
  }

  function renderCurrent(query) {
    if (!indexLoaded) {
      openDropdown(renderDropdown('loading', query, null, idPrefix));
      return;
    }
    const groups = search(query);
    openDropdown(renderDropdown('ready', query, groups, idPrefix));
  }

  // ── Index load ───────────────────────────────────────────────
  async function ensureIndex(query) {
    if (indexLoaded) return;
    // Show loading state. Goes through openDropdown() rather than a raw
    // innerHTML write so the ARIA selection state is reset with it —
    // otherwise aria-activedescendant would keep pointing at a row id that
    // this write has just removed from the DOM.
    if (!dropdownEl.hidden) {
      openDropdown(renderDropdown('loading', query, null, idPrefix));
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
    } else if (e.key === 'Home' && selectedIndex >= 0) {
      // Only hijack Home/End while a virtual option is active — otherwise
      // they must keep their normal caret meaning inside the text field.
      e.preventDefault();
      if (rows.length) setSelected(0);
    } else if (e.key === 'End' && selectedIndex >= 0) {
      e.preventDefault();
      if (rows.length) setSelected(rows.length - 1);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && rows[selectedIndex]) {
        e.preventDefault();
        const url = rows[selectedIndex].dataset.searchUrl;
        if (url) navigate(url);
      }
      // With nothing selected, leave Enter alone — swallowing it here would
      // block any enclosing form's own submit for no benefit.
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      // Do NOT blur. Pre-fix this called inputEl.blur(), which dumped focus
      // on <body> and cost the keyboard user their place in the page — the
      // combobox pattern says Escape dismisses the popup and leaves focus
      // in the combobox, from where ArrowDown reopens it.
      inputEl.focus();
    } else if (e.key === 'Tab') {
      // No preventDefault: closing and letting focus move on to the next
      // topbar control is exactly the expected combobox behaviour.
      closeDropdown();
    }
  };

  function navigate(url) {
    closeDropdown();
    inputEl.value = '';
    if (window.OrtbtoolsShell && typeof window.OrtbtoolsShell.navigateTo === 'function') {
      window.OrtbtoolsShell.navigateTo(url);
    } else {
      window.location.assign(url);
    }
    // F-06: must run AFTER the navigation is kicked off — navigateTo() only
    // pushState()s, which never scrolls to a fragment on its own. Harmless
    // no-op for the hash-less URLs (samples/behavior/blog).
    scrollToAnchor(url);
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
  //
  // The chord is matched on TWO axes, because `e.key === 'k'` alone was
  // false in two situations a user reaches without doing anything unusual:
  //
  //   1. CASE. With Caps Lock on, or with Shift held, the browser reports
  //      'K'. Measured on /uk/inspector: Ctrl+k focused the input and opened
  //      the panel, Ctrl+Shift+K and a synthetic key:'K' (what Caps Lock
  //      produces) did neither — while the Ctrl+S handler two files over has
  //      always tested both cases. So this was an inconsistency, not a
  //      decision, and the only shortcut the topbar advertises was the one
  //      that could silently stop working.
  //   2. LAYOUT. On the Ukrainian and Russian layouts this product is built
  //      for, the same physical key reports 'к' — a Cyrillic letter that no
  //      `=== 'k'` test can ever match. `e.code` names the physical key
  //      regardless of the layout mapped onto it, which is what makes the
  //      chord survive a layout switch mid-session.
  //
  // Alt is excluded: Ctrl+Alt is AltGr on Windows/European layouts, and
  // swallowing a key the user pressed to TYPE a character would be a worse
  // bug than the one being fixed here.
  const isSearchChord = (e) =>
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    (String(e.key).toLowerCase() === 'k' || e.code === 'KeyK');

  const onGlobalKey = (e) => {
    if (isSearchChord(e)) {
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
    // The input is topbar-owned and outlives this widget on some re-mount
    // paths, so hand it back in the state we found it — a stale
    // aria-controls pointing at a removed listbox is its own a11y defect.
    [
      'role',
      'aria-expanded',
      'aria-controls',
      'aria-haspopup',
      'aria-autocomplete',
      'aria-activedescendant',
    ].forEach((a) => inputEl.removeAttribute(a));
    dropdownEl.remove();
    cssLink.remove();
    clearTimeout(debounceTimer);
    _scrollToken++; // abandon any in-flight anchor poll
  };
}
