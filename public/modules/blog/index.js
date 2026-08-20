/* ============================================================
   public/modules/blog/index.js — /blog section module (Stage 3).

   Routes handled:
     /blog or /{locale}/blog             — listing view
     /blog/{lang}/{slug}                 — single post view
     /{locale}/blog/{lang}/{slug}        — single post view (locale-prefixed)

   Views:
     - Listing: header with category chips + grid of cards.
       Each card: title, summary, category badge, date, source pill.
     - Post: title + meta + body rendered through one sanitized fragment boundary.
   ============================================================ */
'use strict';

import { escapeHtml } from '/core/utils.js';
import { blogPostPath, localePath, stripLocale } from '/core/routes.js';

const FALLBACK_LANG = 'en';

// One page of cards. The API caps `limit` at 100 and reports the unpaged
// `count`, so the listing pages through with offset instead of asking for a
// single fixed slab — before this, `limit=50` with no offset made post 51 and
// everything after it unreachable from the UI on a corpus the firehose grows
// every day.
const PAGE_SIZE = 50;

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
  listFailed: {
    en: 'Could not load the posts.',
    uk: 'Не вдалося завантажити пости.',
    ru: 'Не удалось загрузить посты.',
  },
  postFailed: {
    en: 'Could not load the post.',
    uk: 'Не вдалося завантажити пост.',
    ru: 'Не удалось загрузить пост.',
  },
  retry: { en: 'Try again', uk: 'Спробувати ще раз', ru: 'Повторить' },
  // The one string in the post view that never went through pick(): a
  // firehose item's link back to the source read "original ↗" under all
  // three locales, in a meta row where the date beside it was localised.
  original: { en: 'original ↗', uk: 'оригінал ↗', ru: 'оригинал ↗' },
  showMore: { en: 'Show more', uk: 'Показати ще', ru: 'Показать ещё' },
  rss: { en: 'RSS feed', uk: 'RSS-стрічка', ru: 'RSS-лента' },
};

// "Showing 50 of 66" — a plain interpolation per locale, no plural rules
// needed (the numbers are always ≥ 1 when this line is shown at all).
const SHOWN_OF = {
  en: (shown, total) => `Showing ${shown} of ${total}`,
  uk: (shown, total) => `Показано ${shown} з ${total}`,
  ru: (shown, total) => `Показано ${shown} из ${total}`,
};
function shownOf(shown, total, lang) {
  return (SHOWN_OF[lang] || SHOWN_OF[FALLBACK_LANG])(shown, total);
}

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

// Only http(s) hrefs survive — blocks `javascript:`/`data:` schemes in
// crawled-source URLs (post.url comes from external RSS). Empty → caller omits link.
function safeHref(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

// Escape-first Markdown presentation for firehose/crawled and unknown sources.
// This output is never inserted directly: it also crosses markdown-renderer.js'
// final DOMPurify-to-DocumentFragment boundary.
function inlineMd(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="nofollow noopener">$1</a>',
    );
}
function safeRenderMarkdown(src) {
  const s = escapeHtml(String(src || '')).trim();
  if (!s) return '';
  return s
    .split(/\n{2,}/)
    .map((block) => {
      const b = block.trim();
      if (!b) return '';
      const h = b.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        const lvl = Math.min(h[1].length + 1, 4); // # → h2, ## → h3, ### → h4
        return `<h${lvl}>${inlineMd(h[2])}</h${lvl}>`;
      }
      return `<p>${inlineMd(b).replace(/\n/g, '<br />')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

// localePrefix() used to be redefined here (one of six verbatim copies).
// Blog URLs now come from /core/routes.js, which is also what search builds
// its blog links with — two call sites, one spelling.

// A published_at the platform cannot parse, or none at all.
//
// `new Date('not-a-date')` does not throw, so the old try/catch never fired:
// it returned an Invalid Date, and `toLocaleDateString()` on one is the
// literal string "Invalid Date" — in English, under every locale. That is
// what the card footer and the article meta line printed. `new Date(null)`
// is worse than useless: it is 1 January 1970, a confident wrong answer.
//
// modules/blog/handler.js already settled this question for the RSS feed —
// a pubDate it cannot parse is omitted, because a missing date is valid and
// a fabricated one is not. The UI now gives the same answer.
function parseDate(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(isoStr, lang) {
  const d = parseDate(isoStr);
  if (!d) return '';
  try {
    return d.toLocaleDateString(lang === 'uk' ? 'uk-UA' : lang === 'ru' ? 'ru-RU' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return String(isoStr).slice(0, 10);
  }
}

/** The machine-readable half of a <time>. Empty when the date did not parse,
 *  so the attribute is omitted rather than emitted invalid. */
function dateAttr(isoStr) {
  const d = parseDate(isoStr);
  return d ? d.toISOString() : '';
}

/** `<time datetime="…">Label</time>`. With no date to state it collapses to
 *  nothing — except where a class was asked for, because .blog-card__date is
 *  the `flex: 1` spacer that holds the language pill against the card's right
 *  edge, and dropping the element would slide the pill inward on exactly the
 *  cards that already look wrong. */
function timeTag(isoStr, lang, className) {
  const label = formatDate(isoStr, lang);
  const cls = className ? ` class="${escapeHtml(className)}"` : '';
  if (!label) return cls ? `<span${cls}></span>` : '';
  const attr = dateAttr(isoStr);
  return `<time${cls}${attr ? ` datetime="${escapeHtml(attr)}"` : ''}>${escapeHtml(label)}</time>`;
}

// Topic tags. The model has carried them since it was written — the reader
// parser fills them, the list and post endpoints both return them — and no
// view had ever rendered one. They are the author's own words, so they are
// shown verbatim and escaped; the `#` is what marks them as topics without
// a noun that would need three translations.
//
// Not links: filtering by tag needs a `tag` parameter on
// /api/v1/blog/list, which modules/blog/handler.js does not accept yet. A
// chip that looks clickable and does nothing is worse than a plain one.
const MAX_TAGS = 6;
function renderTags(tags) {
  if (!Array.isArray(tags)) return '';
  const list = tags
    .map((t) => String(t == null ? '' : t).trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  if (!list.length) return '';
  return `<span class="blog-post__tags">${list
    .map((t) => `<span class="blog-post__tag">#${escapeHtml(t)}</span>`)
    .join('')}</span>`;
}

/** Parse /blog/{lang}/{slug} or /{locale}/blog/{lang}/{slug} from pathname */
function parsePostRoute(pathname) {
  // Strip locale prefix: /uk/blog/uk/welcome -> /blog/uk/welcome
  const { path: stripped } = stripLocale(pathname);
  const m = stripped.match(/^\/blog\/([a-z]{2})\/([a-z0-9][a-z0-9-]*)$/);
  if (m) return { lang: m[1], slug: m[2] };
  return null;
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
        <div class="blog-head__top">
          <h1>${escapeHtml(pick(L.title, lang))}</h1>
          <a class="blog-rss" href="/blog/rss.xml" type="application/rss+xml"
             data-external title="${escapeHtml(pick(L.rss, lang))}"
             aria-label="${escapeHtml(pick(L.rss, lang))}"><span class="blog-rss__dot" aria-hidden="true"></span>RSS</a>
        </div>
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
      <div class="blog-pager" id="blogPager" hidden></div>
    </section>
  `;

  // Paging + request-ordering state.
  //
  // `generation` is bumped by every load. A response whose generation is stale
  // is dropped on the floor: the chip classes are flipped synchronously on
  // click, so without this the SLOWEST response won the grid while the chip
  // showed the LAST click — the UI confidently displaying UK cards under an
  // active RU chip. `inFlight` additionally cancels the superseded request so
  // a slow ClickHouse doesn't keep a pointless socket open.
  let generation = 0;
  let inFlight = null;
  let loaded = [];
  let total = 0;

  function pagerEl() {
    return root.querySelector('#blogPager');
  }

  function hidePager() {
    const pager = pagerEl();
    if (!pager) return;
    pager.innerHTML = '';
    pager.hidden = true;
  }

  // Localized failure block. The technical detail (HTTP 503, Failed to fetch)
  // stays, but as a secondary line — the primary message is in the user's
  // language and there is always a way forward.
  function errorHtml(detail) {
    return `
      <div class="blog-error" role="alert">
        <p class="blog-error__msg">${escapeHtml(pick(L.listFailed, lang))}</p>
        ${detail ? `<p class="blog-error__detail">${escapeHtml(detail)}</p>` : ''}
        <button type="button" class="blog-retry" data-retry>${escapeHtml(pick(L.retry, lang))}</button>
      </div>`;
  }

  function wireRetry(container, append) {
    const btn = container && container.querySelector('[data-retry]');
    if (!btn) return;
    btn.addEventListener('click', () => loadAndRender({ append }), { signal: ctx.signal });
  }

  function renderPager() {
    const pager = pagerEl();
    if (!pager) return;
    const hasMore = loaded.length < total;
    if (!loaded.length || (!hasMore && total <= PAGE_SIZE)) {
      hidePager();
      return;
    }
    pager.hidden = false;
    pager.innerHTML = `
      <p class="blog-pager__count">${escapeHtml(shownOf(loaded.length, total, lang))}</p>
      ${hasMore ? `<button type="button" class="blog-more" data-more>${escapeHtml(pick(L.showMore, lang))}</button>` : ''}
    `;
    const more = pager.querySelector('[data-more]');
    if (more) {
      more.addEventListener('click', () => loadAndRender({ append: true }), { signal: ctx.signal });
    }
  }

  function renderGrid() {
    const grid = root.querySelector('#blogGrid');
    if (!grid) return;
    if (!loaded.length) {
      grid.innerHTML = `<p class="blog-empty">${escapeHtml(pick(L.noItems, lang))}</p>`;
      hidePager();
      return;
    }
    grid.innerHTML = loaded.map((post) => renderCard(post, lang)).join('');
    renderPager();
  }

  async function loadAndRender({ append = false } = {}) {
    const grid = root.querySelector('#blogGrid');
    if (!grid) return;

    const gen = ++generation;
    if (inFlight) inFlight.abort();
    const ctrl = new AbortController();
    inFlight = ctrl;
    const onOuterAbort = () => ctrl.abort();
    if (ctx.signal.aborted) return;
    ctx.signal.addEventListener('abort', onOuterAbort, { once: true });

    const offset = append ? loaded.length : 0;
    if (append) {
      const pager = pagerEl();
      if (pager) {
        pager.hidden = false;
        pager.innerHTML = `<p class="blog-loading">${escapeHtml(pick(L.loading, lang))}</p>`;
      }
    } else {
      loaded = [];
      total = 0;
      hidePager();
      grid.innerHTML = `<div class="blog-loading">${escapeHtml(pick(L.loading, lang))}</div>`;
    }

    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (offset) params.set('offset', String(offset));
      if (activeCat) params.set('category', activeCat);
      if (activeLang) params.set('lang', activeLang);
      const resp = await fetch(`/api/v1/blog/list?${params}`, { signal: ctrl.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (gen !== generation) return; // a newer filter click already won
      if (!data.ok || !Array.isArray(data.items)) throw new Error('bad response');
      const items = data.items;
      let added = items.length;
      if (append) {
        // The firehose inserts while the reader is paging: a post published
        // between page 1 and page 2 shifts the window and would otherwise
        // repeat the item that fell across the boundary.
        const seen = new Set(loaded.map((p) => `${p.slug}:${p.lang}`));
        const fresh = items.filter((p) => !seen.has(`${p.slug}:${p.lang}`));
        added = fresh.length;
        loaded = loaded.concat(fresh);
      } else {
        loaded = items;
      }
      total = Number.isFinite(data.count) ? data.count : loaded.length;
      // A short page, an empty page, or a page that added nothing new is the
      // real end of the list — never leave "Show more" pointing at nothing.
      if (items.length < PAGE_SIZE || !added) total = loaded.length;
      renderGrid();
    } catch (e) {
      if (gen !== generation) return;
      if (e.name === 'AbortError') return;
      if (append) {
        const pager = pagerEl();
        if (pager) {
          pager.hidden = false;
          pager.innerHTML = errorHtml(e.message);
          wireRetry(pager, true);
        }
      } else {
        grid.innerHTML = errorHtml(e.message);
        hidePager();
        wireRetry(grid, false);
      }
    } finally {
      ctx.signal.removeEventListener('abort', onOuterAbort);
      if (inFlight === ctrl) inFlight = null;
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

  // Deliberately not awaited: mount() must return as soon as the shell has a
  // painted section (header + chips + loading state). Awaiting here would hold
  // the whole section mount hostage to a slow ClickHouse.
  loadAndRender();
}

function renderCard(post, uiLang) {
  const catKey = post.category || 'guide';
  const catLabel = pick(CATEGORY_LABELS[catKey] || { en: catKey }, uiLang);
  const sourceLabel =
    post.source === 'markdown' ? pick(L.editorial, uiLang) : pick(L.firehose, uiLang);
  const sourceIcon = post.source === 'markdown' ? '📝' : '📰';
  // F-15: this used to be a bare `/blog/${post.lang}/${post.slug}` with no UI
  // locale prefix. From /uk/blog the card pointed at /blog/uk/<slug>, which
  // the SPA router does not match (clicking did nothing) and which, followed
  // directly, dropped the whole shell back to EN. The article's language and
  // the UI locale are independent — /uk/blog/uk/<slug> is the real route.
  const postUrl = blogPostPath(post.lang, post.slug, uiLang);
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
        ${timeTag(post.published_at, post.lang || uiLang, 'blog-card__date')}
        <span class="blog-card__lang">${escapeHtml((post.lang || '').toUpperCase())}</span>
      </footer>
    </article>
  `;
}

// ── Single Post View ───────────────────────────────────────────────────────

async function mountPost(root, ctx, uiLang, postLang, slug) {
  let ownerNode = null;
  const ownsMount = () =>
    !ctx.signal.aborted && root.isConnected && ownerNode && root.contains(ownerNode);

  // Every full-view swap goes through setView() so ownerNode always names the
  // node this mount owns — a late response from a previous mount must never
  // overwrite a newer one.
  function setView(html) {
    root.innerHTML = html;
    ownerNode = root.firstElementChild;
  }

  const backLink = () =>
    `<a class="blog-back" href="${escapeHtml(localePath('/blog', uiLang))}">${escapeHtml(pick(L.backToList, uiLang))}</a>`;

  // The failure view keeps the "← Back to blog" link. It used to replace the
  // whole root with a bare "Error: Failed to fetch", which left the reader on
  // a dead page with no in-content way back to the listing.
  function renderFailure(detail) {
    setView(`
      <section class="blog-section blog-post-section">
        ${backLink()}
        <div class="blog-error" role="alert">
          <p class="blog-error__msg">${escapeHtml(pick(L.postFailed, uiLang))}</p>
          ${detail ? `<p class="blog-error__detail">${escapeHtml(detail)}</p>` : ''}
          <button type="button" class="blog-retry" data-retry>${escapeHtml(pick(L.retry, uiLang))}</button>
        </div>
      </section>`);
    const btn = root.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', () => load(), { signal: ctx.signal });
  }

  async function load() {
    setView(`
    <section class="blog-section blog-post-section">
      <div class="blog-loading">${escapeHtml(pick(L.loading, uiLang))}</div>
    </section>
  `);

    try {
      const resp = await fetch(
        `/api/v1/blog/post?slug=${encodeURIComponent(slug)}&lang=${encodeURIComponent(postLang)}`,
        { signal: ctx.signal },
      );
      if (!ownsMount()) return;
      if (!resp.ok) {
        if (resp.status === 404) {
          setView(`
          <section class="blog-section blog-post-section">
            ${backLink()}
            <p class="blog-empty">${escapeHtml(pick(L.notFound, uiLang))}</p>
          </section>`);
          return;
        }
        throw new Error('HTTP ' + resp.status);
      }
      const data = await resp.json();
      if (!ownsMount()) return;
      if (!data.ok || !data.post) throw new Error('bad response');

      const post = data.post;
      const catKey = post.category || 'guide';
      const catLabel = pick(CATEGORY_LABELS[catKey] || { en: catKey }, uiLang);

      if (!ownsMount()) return;
      const originalBody = String(post.body || '');
      setView(`
      <section class="blog-section blog-post-section">
        ${backLink()}
        <article class="blog-post">
          <header class="blog-post__head">
            <span class="blog-badge blog-badge--${escapeHtml(catKey)}">${escapeHtml(catLabel)}</span>
            <h1 class="blog-post__title">${escapeHtml(post.title)}</h1>
            <div class="blog-post__meta">
              ${timeTag(post.published_at, postLang, '')}
              <span class="blog-card__lang">${escapeHtml((post.lang || '').toUpperCase())}</span>
              ${safeHref(post.url) ? `<a class="blog-post__src" href="${escapeHtml(safeHref(post.url))}" target="_blank" rel="noopener nofollow">${escapeHtml(pick(L.original, uiLang))}</a>` : ''}
              ${renderTags(post.tags)}
            </div>
          </header>
          <div class="blog-post__body"></div>
        </article>
      </section>
    `);

      const bodyEl = root.querySelector('.blog-post__body');
      const ownsBody = () => ownsMount() && bodyEl && root.contains(bodyEl);
      if (!ownsBody()) return;

      try {
        const { renderBlogBody } = await import('/modules/blog/markdown-renderer.js');
        if (!ownsBody()) return;
        const fragment = renderBlogBody(originalBody, {
          source: post.source,
          limitedHtml: safeRenderMarkdown(originalBody),
          baseUrl: document.baseURI,
        });
        if (!ownsBody()) return;
        bodyEl.replaceChildren(fragment);
      } catch {
        if (!ownsBody()) return;
        bodyEl.textContent = originalBody;
      }
    } catch (e) {
      if (e.name === 'AbortError' || !ownsMount()) return;
      renderFailure(e.message);
    }
  }

  await load();
}
