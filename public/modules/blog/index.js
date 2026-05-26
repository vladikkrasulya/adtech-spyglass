/* ============================================================
   public/modules/blog/index.js — /blog section module (Stage 3).

   Routes handled:
     /blog or /{locale}/blog             — listing view
     /blog/{lang}/{slug}                 — single post view
     /{locale}/blog/{lang}/{slug}        — single post view (locale-prefixed)

   Views:
     - Listing: header with category chips + grid of cards.
       Each card: title, summary, category badge, date, source pill.
     - Post: title + meta + body rendered via vendored marked.
   ============================================================ */
'use strict';

import { escapeHtml } from '/core/utils.js';

const FALLBACK_LANG = 'en';

const CATEGORY_LABELS = {
  news: { en: 'News', uk: 'Новини', ru: 'Новости' },
  analysis: { en: 'Deep-dives', uk: 'Розбори', ru: 'Разборы' },
  guide: { en: 'Guides', uk: 'Гайди', ru: 'Гайды' },
};

const L = {
  title: { en: 'Blog', uk: 'Блог', ru: 'Блог' },
  subtitle: {
    en: 'OpenRTB internals, adtech news, and integration guides.',
    uk: 'Внутрішня кухня OpenRTB, adtech-новини та гайди з інтеграції.',
    ru: 'Внутренняя кухня OpenRTB, adtech-новости и гайды по интеграции.',
  },
  allLangs: { en: 'All languages', uk: 'Всі мови', ru: 'Все языки' },
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  noItems: { en: 'No posts yet.', uk: 'Поки немає постів.', ru: 'Постов пока нет.' },
  readMore: { en: 'Read more →', uk: 'Читати далі →', ru: 'Читать далее →' },
  backToList: { en: '← Back to blog', uk: '← До блогу', ru: '← К блогу' },
  editorial: { en: 'editorial', uk: 'редакційне', ru: 'редакционное' },
  firehose: { en: 'firehose', uk: 'firehose', ru: 'firehose' },
  notFound: { en: 'Post not found.', uk: 'Пост не знайдено.', ru: 'Пост не найден.' },
};

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

function localePrefix(lang) {
  return lang === 'en' ? '' : '/' + lang;
}

function formatDate(isoStr, lang) {
  try {
    return new Date(isoStr).toLocaleDateString(
      lang === 'uk' ? 'uk-UA' : lang === 'ru' ? 'ru-RU' : 'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' },
    );
  } catch {
    return isoStr ? isoStr.slice(0, 10) : '';
  }
}

/** Parse /blog/{lang}/{slug} or /{locale}/blog/{lang}/{slug} from pathname */
function parsePostRoute(pathname) {
  // Strip locale prefix: /uk/blog/uk/welcome -> /blog/uk/welcome
  const stripped = pathname.replace(/^\/(uk|ru)\//, '/');
  const m = stripped.match(/^\/blog\/([a-z]{2})\/([a-z0-9][a-z0-9-]*)$/);
  if (m) return { lang: m[1], slug: m[2] };
  return null;
}

function isBlogListRoute(pathname) {
  // /blog or /uk/blog or /ru/blog
  return /^(\/(uk|ru))?\/blog$/.test(pathname);
}

export default {
  id: 'blog',
  css: '/modules/blog/blog.css',
  route: '/blog',
  manifest: {
    title: { en: 'Blog', uk: 'Блог', ru: 'Блог' },
    description: {
      en: 'OpenRTB internals and adtech news',
      uk: 'Внутрішня кухня OpenRTB та adtech-новини',
      ru: 'Внутренняя кухня OpenRTB и adtech-новости',
    },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;
    // CSS is loaded + awaited by the registry (mod.css) before mount — no FOUC.

    const postMatch = parsePostRoute(location.pathname);

    if (postMatch) {
      await mountPost(root, ctx, lang, postMatch.lang, postMatch.slug);
    } else {
      await mountListing(root, ctx, lang);
    }
  },
};

// ── Listing View ───────────────────────────────────────────────────────────

async function mountListing(root, ctx, lang) {
  const cats = [
    { id: '', label: pick({ en: 'All', uk: 'Всі', ru: 'Все' }, lang) },
    { id: 'news', label: pick(CATEGORY_LABELS.news, lang) },
    { id: 'analysis', label: pick(CATEGORY_LABELS.analysis, lang) },
    { id: 'guide', label: pick(CATEGORY_LABELS.guide, lang) },
  ];
  const langFilters = [
    { id: '', label: pick(L.allLangs, lang) },
    { id: 'uk', label: 'UA' },
    { id: 'en', label: 'EN' },
    { id: 'ru', label: 'RU' },
  ];

  let activeCat = '';
  // Default to the current UI locale so the listing shows only the active
  // language's posts — not all three at once. The user can still widen the
  // view to "All languages" or pick another via the lang chips below.
  let activeLang = lang;

  root.innerHTML = `
    <section class="blog-section">
      <header class="blog-head">
        <h1>${escapeHtml(pick(L.title, lang))}</h1>
        <p class="blog-sub">${escapeHtml(pick(L.subtitle, lang))}</p>
        <div class="blog-filters">
          <div class="blog-chips" id="catChips">
            ${cats.map((c) => `<button type="button" class="blog-chip${c.id === '' ? ' is-active' : ''}" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join('')}
          </div>
          <div class="blog-chips blog-chips--lang" id="langChips">
            ${langFilters.map((l) => `<button type="button" class="blog-chip${l.id === activeLang ? ' is-active' : ''}" data-lang="${escapeHtml(l.id)}">${escapeHtml(l.label)}</button>`).join('')}
          </div>
        </div>
      </header>
      <div class="blog-grid" id="blogGrid">
        <div class="blog-loading">${escapeHtml(pick(L.loading, lang))}</div>
      </div>
    </section>
  `;

  async function loadAndRender() {
    const grid = root.querySelector('#blogGrid');
    if (!grid) return;
    grid.innerHTML = `<div class="blog-loading">${escapeHtml(pick(L.loading, lang))}</div>`;

    try {
      const params = new URLSearchParams({ limit: '50' });
      if (activeCat) params.set('category', activeCat);
      if (activeLang) params.set('lang', activeLang);
      const resp = await fetch(`/api/v1/blog/list?${params}`, { signal: ctx.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (!data.ok || !data.items.length) {
        grid.innerHTML = `<p class="blog-empty">${escapeHtml(pick(L.noItems, lang))}</p>`;
        return;
      }
      grid.innerHTML = data.items.map((post) => renderCard(post, lang)).join('');
    } catch (e) {
      if (e.name === 'AbortError') return;
      grid.innerHTML = `<p class="blog-empty">Error: ${escapeHtml(e.message)}</p>`;
    }
  }

  // Category chips
  root.querySelector('#catChips').addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      activeCat = btn.dataset.cat;
      root
        .querySelectorAll('#catChips .blog-chip')
        .forEach((b) => b.classList.toggle('is-active', b.dataset.cat === activeCat));
      loadAndRender();
    },
    { signal: ctx.signal },
  );

  // Lang chips
  root.querySelector('#langChips').addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('[data-lang]');
      if (!btn) return;
      activeLang = btn.dataset.lang;
      root
        .querySelectorAll('#langChips .blog-chip')
        .forEach((b) => b.classList.toggle('is-active', b.dataset.lang === activeLang));
      loadAndRender();
    },
    { signal: ctx.signal },
  );

  loadAndRender();
}

function renderCard(post, uiLang) {
  const catKey = post.category || 'guide';
  const catLabel = pick(CATEGORY_LABELS[catKey] || { en: catKey }, uiLang);
  const dateStr = formatDate(post.published_at, post.lang || uiLang);
  const sourceLabel =
    post.source === 'markdown' ? pick(L.editorial, uiLang) : pick(L.firehose, uiLang);
  const sourceIcon = post.source === 'markdown' ? '📝' : '📰';
  const postUrl = `/blog/${post.lang}/${post.slug}`;
  return `
    <article class="blog-card" data-href="${escapeHtml(postUrl)}">
      <div class="blog-card__head">
        <span class="blog-badge blog-badge--${escapeHtml(catKey)}">${escapeHtml(catLabel)}</span>
        <span class="blog-source" title="${escapeHtml(sourceLabel)}">${sourceIcon}</span>
      </div>
      <h2 class="blog-card__title">
        <a href="${escapeHtml(postUrl)}">${escapeHtml(post.title)}</a>
      </h2>
      <p class="blog-card__summary">${escapeHtml(post.summary)}</p>
      <footer class="blog-card__foot">
        <time class="blog-card__date">${escapeHtml(dateStr)}</time>
        <span class="blog-card__lang">${escapeHtml((post.lang || '').toUpperCase())}</span>
      </footer>
    </article>
  `;
}

// ── Single Post View ───────────────────────────────────────────────────────

async function mountPost(root, ctx, uiLang, postLang, slug) {
  root.innerHTML = `
    <section class="blog-section blog-post-section">
      <div class="blog-loading">${escapeHtml(pick(L.loading, uiLang))}</div>
    </section>
  `;

  try {
    const resp = await fetch(
      `/api/v1/blog/post?slug=${encodeURIComponent(slug)}&lang=${encodeURIComponent(postLang)}`,
      { signal: ctx.signal },
    );
    if (!resp.ok) {
      if (resp.status === 404) {
        root.innerHTML = `
          <section class="blog-section blog-post-section">
            <a class="blog-back" href="${escapeHtml(localePrefix(uiLang) + '/blog')}">${escapeHtml(pick(L.backToList, uiLang))}</a>
            <p class="blog-empty">${escapeHtml(pick(L.notFound, uiLang))}</p>
          </section>`;
        return;
      }
      throw new Error('HTTP ' + resp.status);
    }
    const data = await resp.json();
    if (!data.ok || !data.post) throw new Error('bad response');

    const post = data.post;
    const catKey = post.category || 'guide';
    const catLabel = pick(CATEGORY_LABELS[catKey] || { en: catKey }, uiLang);
    const dateStr = formatDate(post.published_at, postLang);

    // Lazy-load marked for markdown rendering
    let bodyHtml = '';
    try {
      const markedMod = await import('/vendor/marked.esm.min.js');
      const marked = markedMod.marked || markedMod.default;
      bodyHtml = marked(post.body || '');
    } catch {
      // Fallback: plain text paragraphs
      bodyHtml = (post.body || '')
        .split('\n\n')
        .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
        .join('');
    }

    root.innerHTML = `
      <section class="blog-section blog-post-section">
        <a class="blog-back" href="${escapeHtml(localePrefix(uiLang) + '/blog')}">${escapeHtml(pick(L.backToList, uiLang))}</a>
        <article class="blog-post">
          <header class="blog-post__head">
            <span class="blog-badge blog-badge--${escapeHtml(catKey)}">${escapeHtml(catLabel)}</span>
            <h1 class="blog-post__title">${escapeHtml(post.title)}</h1>
            <div class="blog-post__meta">
              <time>${escapeHtml(dateStr)}</time>
              <span class="blog-card__lang">${escapeHtml((post.lang || '').toUpperCase())}</span>
              ${post.url ? `<a class="blog-post__src" href="${escapeHtml(post.url)}" target="_blank" rel="noopener">original ↗</a>` : ''}
            </div>
          </header>
          <div class="blog-post__body">${bodyHtml}</div>
        </article>
      </section>
    `;
  } catch (e) {
    if (e.name === 'AbortError') return;
    root.innerHTML = `<section class="blog-section"><p class="blog-empty">Error: ${escapeHtml(e.message)}</p></section>`;
  }
}
