'use strict';

/**
 * lib/seo.js — per-route SEO metadata + sitemap generation (pure, no I/O).
 *
 * server.js serves ONE static index.{en,uk,ru}.html for every SPA route, all
 * carrying the homepage's canonical/title/meta. Google therefore consolidated
 * every section + blog post into the homepage ("Alternate page with proper
 * canonical tag") and indexed nothing else.
 *
 * This module computes the correct per-route canonical / hreflang / title /
 * description / OG-Twitter tags, rewrites them into the served HTML, and
 * server-renders blog-post bodies into #app-root so crawlers get real content
 * without running JS (and without depending on the /api/v1/blog fetch that was
 * 499-ing during render).
 *
 * Pure by design: callers (server.js) pass in already-fetched post data so
 * this file has zero ClickHouse/fs coupling and is fully unit-testable.
 */

// Canonical PUBLIC domain — deliberately NOT process.env.PUBLIC_BASE_URL: that
// is set to the internal kyivtech proxy host (used for email/verify links),
// whereas SEO canonicals must point at the public brand domain (ortbtools.com,
// matching the hardcoded tags in index.{en,uk,ru}.html). Override only via the
// SEO-specific SEO_ORIGIN if the public domain ever changes.
const ORIGIN = (process.env.SEO_ORIGIN || 'https://ortbtools.com').replace(/\/+$/, '');
const LANGS = ['en', 'uk', 'ru'];
const OG_LOCALE = { en: 'en_US', uk: 'uk_UA', ru: 'ru_RU' };

// Per-section SEO copy. Titles ~50-60 chars, descriptions ~150. en is the
// source of truth; uk/ru are natural (not calqued) translations.
const SECTION_SEO = {
  '/inspector': {
    title: {
      en: 'OpenRTB Inspector — validate BidRequest/BidResponse | ortbtools',
      uk: 'OpenRTB-інспектор — валідація BidRequest/BidResponse | ortbtools',
      ru: 'OpenRTB-инспектор — валидация BidRequest/BidResponse | ortbtools',
    },
    description: {
      en: 'Paste an OpenRTB BidRequest/BidResponse and get human-readable validation, request↔response crosscheck, IAB decoding and creative preview. 100% client-side.',
      uk: 'Встав OpenRTB BidRequest/BidResponse і отримай зрозумілу валідацію, crosscheck запиту↔відповіді, IAB-декодування й прев’ю креативу. 100% у браузері.',
      ru: 'Вставь OpenRTB BidRequest/BidResponse и получи понятную валидацию, crosscheck запроса↔ответа, IAB-декодирование и превью креатива. 100% в браузере.',
    },
  },
  '/live': {
    title: {
      en: 'Live oRTB Stream — synthetic bid feed | ortbtools',
      uk: 'Живий oRTB-стрім — синтетичний потік ставок | ortbtools',
      ru: 'Живой oRTB-стрим — синтетический поток ставок | ortbtools',
    },
    description: {
      en: 'A live feed of synthetic OpenRTB specimens — click any to inspect its format, version and findings. Filter by format, version and severity.',
      uk: 'Живий потік синтетичних OpenRTB-зразків — клікни будь-який, щоб переглянути формат, версію й знахідки. Фільтри за форматом, версією, серйозністю.',
      ru: 'Живой поток синтетических OpenRTB-образцов — кликни любой, чтобы изучить формат, версию и находки. Фильтры по формату, версии и серьёзности.',
    },
  },
  '/behavior': {
    title: {
      en: 'Behavior Scenarios — curated AdTech test cases | ortbtools',
      uk: 'Behavior-сценарії — підібрані AdTech тест-кейси | ortbtools',
      ru: 'Behavior-сценарии — подобранные AdTech тест-кейсы | ortbtools',
    },
    description: {
      en: 'Curated OpenRTB test scenarios — valid bids, privacy gaps, VAST issues, crosscheck violations and malicious creatives. Run any in the inspector.',
      uk: 'Підібрані OpenRTB-сценарії — валідні ставки, прогалини приватності, VAST-проблеми, crosscheck-порушення й шкідливі креативи. Запусти будь-який в інспекторі.',
      ru: 'Подобранные OpenRTB-сценарии — валидные ставки, пробелы приватности, VAST-проблемы, crosscheck-нарушения и вредоносные креативы. Запусти любой в инспекторе.',
    },
  },
  '/library': {
    title: {
      en: 'Sample Library — saved OpenRTB specimens | ortbtools',
      uk: 'Бібліотека зразків — збережені OpenRTB-приклади | ortbtools',
      ru: 'Библиотека образцов — сохранённые OpenRTB-примеры | ortbtools',
    },
    description: {
      en: 'A catalog of curated valid and invalid OpenRTB samples plus your own zero-knowledge encrypted saves. Copy, download and load into the inspector.',
      uk: 'Каталог валідних і невалідних OpenRTB-зразків плюс твої zero-knowledge зашифровані збереження. Копіюй, завантажуй і відкривай в інспекторі.',
      ru: 'Каталог валидных и невалидных OpenRTB-образцов плюс твои zero-knowledge зашифрованные сохранения. Копируй, скачивай и открывай в инспекторе.',
    },
  },
  '/dialects': {
    title: {
      en: 'Dialect Catalog — vendor OpenRTB overlays | ortbtools',
      uk: 'Каталог діалектів — вендорні OpenRTB-оверлеї | ortbtools',
      ru: 'Каталог диалектов — вендорные OpenRTB-оверлеи | ortbtools',
    },
    description: {
      en: 'Browse the built-in OpenRTB dialects (iab, ext-rtb, inpage-push) and build your own vendor-extension mappings layered on the IAB base.',
      uk: 'Переглянь вбудовані OpenRTB-діалекти (iab, ext-rtb, inpage-push) і створи власні мапінги vendor-розширень поверх IAB-бази.',
      ru: 'Просмотри встроенные OpenRTB-диалекты (iab, ext-rtb, inpage-push) и создай свои мэппинги vendor-расширений поверх IAB-базы.',
    },
  },
  '/insights': {
    title: {
      en: 'Insights — your OpenRTB validation analytics | ortbtools',
      uk: 'Insights — аналітика твоїх OpenRTB-валідацій | ortbtools',
      ru: 'Insights — аналитика твоих OpenRTB-валидаций | ortbtools',
    },
    description: {
      en: 'Aggregate view of everything you have validated: format mix, version mix, top findings and behavior-probe hit rate across your sessions.',
      uk: 'Зведення всього, що ти валідував: розподіл форматів, версій, топ-знахідки й частота behavior-проб за твоїми сесіями.',
      ru: 'Сводка всего, что ты валидировал: распределение форматов, версий, топ-находки и частота behavior-проб по твоим сессиям.',
    },
  },
  '/blog': {
    title: {
      en: 'Blog — OpenRTB internals & AdTech news | ortbtools',
      uk: 'Блог — внутрішня кухня OpenRTB та AdTech-новини | ortbtools',
      ru: 'Блог — внутренняя кухня OpenRTB и AdTech-новости | ortbtools',
    },
    description: {
      en: 'OpenRTB internals, programmatic-advertising news and integration guides — technical deep-dives for AdTech engineers.',
      uk: 'Внутрішня кухня OpenRTB, новини programmatic-реклами та гайди з інтеграції — технічні розбори для AdTech-інженерів.',
      ru: 'Внутренняя кухня OpenRTB, новости programmatic-рекламы и гайды по интеграции — технические разборы для AdTech-инженеров.',
    },
  },
  '/docs': {
    title: {
      en: 'Docs — OpenRTB spec coverage & finding reference | ortbtools',
      uk: 'Документація — покриття oRTB-специфікації та довідник знахідок | ortbtools',
      ru: 'Документация — покрытие oRTB-спецификации и справочник находок | ortbtools',
    },
    description: {
      en: 'Reference for the validator: OpenRTB 2.5/2.6/3.0 spec coverage, every finding ID with severity and spec link, plus the integration guide.',
      uk: 'Довідник валідатора: покриття oRTB 2.5/2.6/3.0, кожен finding-ID із серйозністю й посиланням на спеку, плюс гайд з інтеграції.',
      ru: 'Справочник валидатора: покрытие oRTB 2.5/2.6/3.0, каждый finding-ID с серьёзностью и ссылкой на спеку, плюс гайд по интеграции.',
    },
  },
};

// ── escaping ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ── path helpers ───────────────────────────────────────────────────────────
function localizedPath(sectionPath, lang) {
  // sectionPath like '/blog' (en canonical, no prefix). '/' is home.
  if (sectionPath === '/') return lang === 'en' ? '/' : `/${lang}/`;
  return lang === 'en' ? sectionPath : `/${lang}${sectionPath}`;
}

/**
 * Parse a requested path into its routing dimensions.
 * @param {string} reqPath
 * @returns {{uiLang:string, isPost:boolean, postLang?:string, slug?:string, sectionPath:string}}
 */
function parseRoute(reqPath) {
  let p = (reqPath || '/').split('?')[0].replace(/\/+$/, '') || '/';
  let uiLang = 'en';
  const loc = p.match(/^\/(uk|ru)(\/.*)?$/);
  if (loc) {
    uiLang = loc[1];
    p = loc[2] || '/';
  }
  const post = p.match(/^\/blog\/(en|uk|ru)\/([a-z0-9][a-z0-9-]{0,120})$/i);
  if (post) {
    return {
      uiLang,
      isPost: true,
      postLang: post[1].toLowerCase(),
      slug: post[2],
      sectionPath: '/blog',
    };
  }
  return { uiLang, isPost: false, sectionPath: p };
}

function alternatesFor(sectionPath) {
  const alts = LANGS.map((l) => ({ hreflang: l, href: ORIGIN + localizedPath(sectionPath, l) }));
  alts.push({ hreflang: 'x-default', href: ORIGIN + (sectionPath === '/' ? '/' : sectionPath) });
  return alts;
}

/**
 * SEO for a known section route, or null if the path isn't a SEO'd section
 * (caller then leaves the static homepage tags untouched).
 */
function sectionSeo(sectionPath, uiLang) {
  const cfg = SECTION_SEO[sectionPath];
  if (!cfg) return null;
  const lang = LANGS.includes(uiLang) ? uiLang : 'en';
  const canonical = ORIGIN + localizedPath(sectionPath, lang);
  return {
    title: cfg.title[lang] || cfg.title.en,
    description: cfg.description[lang] || cfg.description.en,
    canonical,
    ogUrl: canonical,
    ogType: 'website',
    ogLocale: OG_LOCALE[lang],
    alternates: alternatesFor(sectionPath),
  };
}

/**
 * SEO for a blog post. `post` may be null (CH down / not found) — we still
 * return a per-post canonical so the page isn't consolidated into the homepage.
 */
function postSeo(slug, postLang, post) {
  const lang = LANGS.includes(postLang) ? postLang : 'en';
  const canonical = `${ORIGIN}/blog/${lang}/${slug}`;
  const title = post && post.title ? `${post.title} — ortbtools blog` : 'Blog — ortbtools';
  const description = (post && (post.summary || post.title)) || '';
  const alternates = LANGS.map((l) => ({ hreflang: l, href: `${ORIGIN}/blog/${l}/${slug}` }));
  alternates.push({ hreflang: 'x-default', href: `${ORIGIN}/blog/en/${slug}` });
  return {
    title,
    description,
    canonical,
    ogUrl: canonical,
    ogType: 'article',
    ogLocale: OG_LOCALE[lang],
    alternates,
  };
}

// ── HTML rewriting ──────────────────────────────────────────────────────────
function applySeoToHtml(html, seo) {
  if (!seo) return html;
  const a = escapeHtml;
  // canonical
  html = html.replace(
    /<link\s+rel="canonical"[\s\S]*?\/>/i,
    `<link rel="canonical" href="${a(seo.canonical)}" />`,
  );
  // drop existing hreflang alternates, then inject the new set right after canonical
  html = html.replace(/\n?\s*<link\s+rel="alternate"\s+hreflang="[^"]*"[\s\S]*?\/>/gi, '');
  const altLinks = (seo.alternates || [])
    .map(
      (alt) => `    <link rel="alternate" hreflang="${a(alt.hreflang)}" href="${a(alt.href)}" />`,
    )
    .join('\n');
  html = html.replace(/(<link\s+rel="canonical"[\s\S]*?\/>)/i, `$1\n${altLinks}`);
  // title + descriptions
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${a(seo.title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[\s\S]*?\/>/i,
    `<meta name="description" content="${a(seo.description)}" />`,
  );
  // Open Graph
  html = html.replace(
    /<meta\s+property="og:url"[\s\S]*?\/>/i,
    `<meta property="og:url" content="${a(seo.ogUrl)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"[\s\S]*?\/>/i,
    `<meta property="og:title" content="${a(seo.title)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"[\s\S]*?\/>/i,
    `<meta property="og:description" content="${a(seo.description)}" />`,
  );
  if (seo.ogType) {
    html = html.replace(
      /<meta\s+property="og:type"[\s\S]*?\/>/i,
      `<meta property="og:type" content="${a(seo.ogType)}" />`,
    );
  }
  if (seo.ogLocale) {
    html = html.replace(
      /<meta\s+property="og:locale"\s+content="[^"]*"\s*\/>/i,
      `<meta property="og:locale" content="${a(seo.ogLocale)}" />`,
    );
  }
  // Twitter
  html = html.replace(
    /<meta\s+name="twitter:title"[\s\S]*?\/>/i,
    `<meta name="twitter:title" content="${a(seo.title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"[\s\S]*?\/>/i,
    `<meta name="twitter:description" content="${a(seo.description)}" />`,
  );
  return html;
}

// Minimal, SAFE Markdown → HTML. Escapes first (so any HTML/`<script>` in the
// post body is inert), then applies a few inline/block rules on the escaped text.
function renderBodyHtml(src) {
  let s = escapeHtml(String(src || '')).trim();
  if (!s) return '';
  return s
    .split(/\n{2,}/)
    .map((block) => {
      let b = block.trim();
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
function inlineMd(s) {
  // operates on already-escaped text → safe
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="nofollow noopener">$1</a>',
    );
}

// Server-render a blog post into the #app-root shell (escaped). The client
// blog module overwrites this on the JS path — it exists purely so crawlers
// (and no-JS) get the article content + first paint.
function renderPostArticle(post) {
  const title = escapeHtml(post.title || '');
  const summary = escapeHtml(post.summary || '');
  const cat = escapeHtml(post.category || '');
  const body = renderBodyHtml(post.body || post.summary || '');
  const src = post.url
    ? `<a class="blog-post__source" href="${escapeHtml(post.url)}" rel="nofollow noopener">original ↗</a>`
    : '';
  return (
    `<section class="blog-section"><article class="blog-post">` +
    `<a class="blog-back" href="/blog">← Blog</a>` +
    (cat ? `<div class="blog-post__cat">${cat}</div>` : '') +
    `<h1>${title}</h1>` +
    (summary ? `<p class="blog-post__summary">${summary}</p>` : '') +
    `<div class="blog-post__body">${body}</div>${src}</article></section>`
  );
}

function injectPostSsr(html, post) {
  if (!post) return html;
  html = html.replace(
    /<main id="app-root">[\s\S]*?<\/main>/i,
    `<main id="app-root">${renderPostArticle(post)}</main>`,
  );
  if (!/\/modules\/blog\/blog\.css/.test(html)) {
    html = html.replace(
      /<\/head>/i,
      `    <link rel="stylesheet" href="/modules/blog/blog.css" />\n  </head>`,
    );
  }
  return html;
}

// ── sitemap ──────────────────────────────────────────────────────────────
function urlBlock(loc, alternates) {
  const alts = (alternates || [])
    .map(
      (alt) =>
        `    <xhtml:link rel="alternate" hreflang="${escapeHtml(alt.hreflang)}" href="${escapeHtml(alt.href)}"/>`,
    )
    .join('\n');
  return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${alts ? '\n' + alts : ''}\n  </url>`;
}

/**
 * Build sitemap.xml. `posts` is an array of {slug, lang} (callers fetch it;
 * pure here). Home + sections are static; posts are grouped by slug so each
 * language variant cross-links via xhtml:link alternates.
 */
function renderSitemap(posts) {
  const blocks = [];
  // home + sections
  for (const sectionPath of ['/', ...Object.keys(SECTION_SEO)]) {
    blocks.push(urlBlock(ORIGIN + localizedPath(sectionPath, 'en'), alternatesFor(sectionPath)));
  }
  // posts grouped by slug
  const bySlug = new Map();
  for (const p of posts || []) {
    if (!p || !p.slug || !LANGS.includes(p.lang)) continue;
    if (!bySlug.has(p.slug)) bySlug.set(p.slug, new Set());
    bySlug.get(p.slug).add(p.lang);
  }
  for (const [slug, langSet] of bySlug) {
    const langs = LANGS.filter((l) => langSet.has(l));
    const alts = langs.map((l) => ({ hreflang: l, href: `${ORIGIN}/blog/${l}/${slug}` }));
    if (langSet.has('en')) alts.push({ hreflang: 'x-default', href: `${ORIGIN}/blog/en/${slug}` });
    for (const l of langs) blocks.push(urlBlock(`${ORIGIN}/blog/${l}/${slug}`, alts));
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    blocks.join('\n') +
    '\n</urlset>\n'
  );
}

module.exports = {
  ORIGIN,
  SECTION_SEO,
  parseRoute,
  sectionSeo,
  postSeo,
  applySeoToHtml,
  injectPostSsr,
  renderPostArticle,
  renderBodyHtml,
  renderSitemap,
  escapeHtml,
  localizedPath,
};
