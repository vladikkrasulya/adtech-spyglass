'use strict';

/**
 * modules/blog/handler.js — GET /api/v1/blog/list, /api/v1/blog/post, /blog/rss.xml
 *
 * Hybrid blog:
 *   - Editorial posts: read from content/posts/{lang}/*.md with YAML frontmatter.
 *   - Firehose posts:  served from analytics.blog_posts (ClickHouse).
 *
 * Frontmatter parser: inline regex (no js-yaml dep). Handles arrays as [a, b] or
 * "a, b" strings. Shallow keys only.
 *
 * CH client: raw fetch to http://clickhouse:8123 using X-ClickHouse-User /
 * X-ClickHouse-Key headers (same pattern as lib/event-log.js).
 */

const fs = require('fs');
const path = require('path');
const { sendJson, sendError } = require('../../lib/http');
const log = require('../../lib/logger').child('blog');

// Env-overridable (prod: /data/content-posts persistent volume). Default = repo
// seed / baked copy. Mirrors lib/blog-service.js + modules/admin/blog.js.
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '../../content/posts');
// Editorial langs are a FIXED whitelist. `lang` becomes a path segment
// (content/posts/{lang}); without this guard the public blog list accepted
// `?lang=../../docs` and leaked docs/*.md (path traversal — fixed 2026-06-14).
const LANGS = ['uk', 'en', 'ru'];
// RSS feed links must use the public brand domain (ortbtools.com), NOT the
// kyivtech proxy host that PUBLIC_BASE_URL points to. Share the one canonical
// origin with the SEO module.
const { ORIGIN: PUBLIC_BASE } = require('../../lib/seo');

// ── ClickHouse client (same approach as lib/event-log.js) ─────────────────
const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || '';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
// Bound CH reads so a hung ClickHouse can't hang public blog list/post/rss.
const CH_TIMEOUT_MS = Number(process.env.BLOG_CH_TIMEOUT_MS) || 8000;

function chHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (CH_USER) h['X-ClickHouse-User'] = CH_USER;
  if (CH_PASSWORD) h['X-ClickHouse-Key'] = CH_PASSWORD;
  return h;
}

async function chQuery(sql) {
  const url = `${CH_URL}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CH_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, { headers: chHeaders(), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`CH query failed ${resp.status}: ${text.slice(0, 200)}`);
  }
  const text = await resp.text();
  if (!text.trim()) return [];
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

// ── Frontmatter parser ──────────────────────────────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const raw = match[1];
  const body = match[2];
  const meta = {};
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Array: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    meta[key] = val;
  }
  return { meta, body };
}

// ── Editorial post reader ───────────────────────────────────────────────────
function readMarkdownPosts(lang) {
  if (!LANGS.includes(lang)) return []; // traversal guard: lang is a path segment
  const dir = path.resolve(CONTENT_DIR, lang);
  // defense-in-depth: never escape CONTENT_DIR even if LANGS ever changes
  if (!dir.startsWith(path.resolve(CONTENT_DIR) + path.sep)) return [];
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const { meta, body } = parseFrontmatter(content);
    return {
      slug: meta.slug || path.basename(f, '.md'),
      lang,
      title: meta.title || '',
      category: meta.category || 'guide',
      summary:
        body
          .trim()
          .split('\n')
          .find((l) => l.trim()) || '',
      published_at: meta.date || new Date().toISOString(),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      source: 'markdown',
      body,
    };
  });
}

// ── Per-route cache (60s TTL) ───────────────────────────────────────────────
const cache = new Map(); // key → { ts, data }
const CACHE_TTL_MS = 60_000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

// ── Handlers ─────────────────────────────────────────────────────────────
function createBlogModule(deps = {}) {
  // Public, ClickHouse-backed reads. Param-varying requests bypass the in-memory
  // cache and hit CH, so a per-IP limiter bounds the load-amplification risk
  // against the shared analytics instance. Optional so tests can construct the
  // module with no deps.
  const { readLimiter, auth, READ_MAX_PER_WINDOW } = deps;
  function rateLimited(req, res) {
    if (readLimiter && auth && !readLimiter(auth.clientIp(req))) {
      sendError(
        res,
        429,
        'rate_limited',
        `Too many requests. Try again shortly (limit: ${READ_MAX_PER_WINDOW}/min/IP).`,
      );
      return true;
    }
    return false;
  }

  /**
   * GET /api/v1/blog/list?lang=&category=&offset=&limit=
   * Merges editorial + published DB posts, sorted by published_at desc.
   */
  async function handleBlogList(req, res, parsed) {
    if (rateLimited(req, res)) return;
    const q = parsed.searchParams;
    const filterLang = q.get('lang') || '';
    const filterCategory = q.get('category') || '';
    const offset = Math.max(0, parseInt(q.get('offset'), 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(q.get('limit'), 10) || 20));

    const cacheKey = `list:${filterLang}:${filterCategory}:${offset}:${limit}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return sendJson(res, 200, cached);
    }

    try {
      // Editorial posts — whitelist `lang`: an unknown value yields no editorial
      // posts (and the DB clause below won't match), instead of a path segment.
      const langs = filterLang ? (LANGS.includes(filterLang) ? [filterLang] : []) : LANGS;
      let editorial = [];
      for (const l of langs) {
        editorial = editorial.concat(readMarkdownPosts(l));
      }

      // DB posts from ClickHouse
      let dbPosts = [];
      try {
        const langClause = filterLang ? `AND lang = '${filterLang.replace(/'/g, '')}'` : '';
        const catClause = filterCategory
          ? `AND category = '${filterCategory.replace(/'/g, '')}'`
          : '';
        const rows = await chQuery(
          `SELECT slug, lang, title, category, summary, published_at, tags, url, source_draft_id
           FROM analytics.blog_posts FINAL
           WHERE 1=1 ${langClause} ${catClause}
           ORDER BY published_at DESC
           LIMIT ${limit + offset + editorial.length}`,
        );
        dbPosts = rows.map((r) => ({
          slug: r.slug,
          lang: r.lang,
          title: r.title,
          category: r.category,
          summary: r.summary,
          published_at: r.published_at,
          tags: r.tags || [],
          source: 'db',
          url: r.url || null,
        }));
      } catch (e) {
        log.warn({ err: e }, 'blog list: CH query failed, serving editorial only');
      }

      // Merge: deduplicate editorial over DB (editorial takes precedence for same slug+lang)
      const seen = new Set();
      const allItems = [];
      for (const p of editorial) {
        const key = `${p.slug}:${p.lang}`;
        seen.add(key);
        allItems.push(p);
      }
      for (const p of dbPosts) {
        const key = `${p.slug}:${p.lang}`;
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(p);
        }
      }

      // Apply category filter to editorial (DB query already filtered)
      let filtered = allItems;
      if (filterCategory) {
        filtered = allItems.filter((p) => p.category === filterCategory);
      }

      // Sort by published_at desc
      filtered.sort((a, b) => (b.published_at > a.published_at ? 1 : -1));

      const total = filtered.length;
      const items = filtered.slice(offset, offset + limit).map((p) => {
        const { body: _body, ...rest } = p;
        return rest;
      });

      const result = { ok: true, count: total, items };
      cacheSet(cacheKey, result);
      sendJson(res, 200, result);
    } catch (e) {
      log.error({ err: e }, 'blog list failed');
      sendError(res, 500, 'blog_list_failed', e.message);
    }
  }

  /**
   * GET /api/v1/blog/post?slug=&lang=
   * Tries editorial markdown first, falls back to analytics.blog_posts.
   */
  async function handleBlogPost(req, res, parsed) {
    if (rateLimited(req, res)) return;
    const q = parsed.searchParams;
    const slug = (q.get('slug') || '').replace(/[^a-z0-9-_]/gi, '');
    const lang = (q.get('lang') || 'en').replace(/[^a-z]/gi, '').slice(0, 4);

    if (!slug) {
      return sendError(res, 400, 'missing_slug', 'slug is required');
    }

    const cacheKey = `post:${slug}:${lang}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return sendJson(res, 200, cached);
    }

    try {
      // Try editorial markdown first
      const mdPath = path.join(CONTENT_DIR, lang, `${slug}.md`);
      if (fs.existsSync(mdPath)) {
        const content = fs.readFileSync(mdPath, 'utf8');
        const { meta, body } = parseFrontmatter(content);
        const post = {
          slug: meta.slug || slug,
          lang,
          title: meta.title || '',
          category: meta.category || 'guide',
          summary:
            body
              .trim()
              .split('\n')
              .find((l) => l.trim()) || '',
          published_at: meta.date || new Date().toISOString(),
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          body,
          source: 'markdown',
          url: null,
        };
        const result = { ok: true, post };
        cacheSet(cacheKey, result);
        return sendJson(res, 200, result);
      }

      // Fall back to DB
      const rows = await chQuery(
        `SELECT slug, lang, title, category, summary, body, published_at, tags, url, source_draft_id
         FROM analytics.blog_posts FINAL
         WHERE slug = '${slug.replace(/'/g, '')}' AND lang = '${lang.replace(/'/g, '')}'
         LIMIT 1`,
      );
      if (!rows.length) {
        return sendError(res, 404, 'post_not_found', 'Post not found');
      }
      const r = rows[0];
      const post = {
        slug: r.slug,
        lang: r.lang,
        title: r.title,
        category: r.category,
        summary: r.summary,
        published_at: r.published_at,
        tags: r.tags || [],
        body: r.body,
        source: 'db',
        url: r.url || null,
      };
      const result = { ok: true, post };
      cacheSet(cacheKey, result);
      sendJson(res, 200, result);
    } catch (e) {
      log.error({ err: e }, 'blog post failed');
      sendError(res, 500, 'blog_post_failed', e.message);
    }
  }

  /**
   * GET /blog/rss.xml — last 20 posts across all langs as RSS 2.0
   */
  async function handleBlogRss(req, res) {
    if (rateLimited(req, res)) return;
    try {
      // Load editorial posts (all langs)
      let editorial = [];
      for (const l of LANGS) {
        editorial = editorial.concat(readMarkdownPosts(l));
      }

      // Load DB posts
      let dbPosts = [];
      try {
        const rows = await chQuery(
          `SELECT slug, lang, title, category, summary, published_at
           FROM analytics.blog_posts FINAL
           ORDER BY published_at DESC
           LIMIT 20`,
        );
        dbPosts = rows.map((r) => ({
          slug: r.slug,
          lang: r.lang,
          title: r.title,
          summary: r.summary,
          published_at: r.published_at,
          source: 'db',
        }));
      } catch {
        // CH unavailable — RSS from editorial only
      }

      // Merge deduplicated
      const seen = new Set();
      const allItems = [];
      for (const p of editorial) {
        const key = `${p.slug}:${p.lang}`;
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(p);
        }
      }
      for (const p of dbPosts) {
        const key = `${p.slug}:${p.lang}`;
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(p);
        }
      }
      allItems.sort((a, b) => (b.published_at > a.published_at ? 1 : -1));
      const items = allItems.slice(0, 20);

      function xmlEscape(s) {
        return String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      const rssItems = items
        .map((p) => {
          const url = `${PUBLIC_BASE}/blog/${p.lang}/${p.slug}`;
          const pubDate = new Date(p.published_at).toUTCString();
          return `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <pubDate>${xmlEscape(pubDate)}</pubDate>
      <description>${xmlEscape(p.summary)}</description>
    </item>`;
        })
        .join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Spyglass Blog</title>
    <link>${PUBLIC_BASE}/blog</link>
    <description>OpenRTB internals, adtech news, and integration guides</description>
    <language>mul</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${rssItems}
  </channel>
</rss>`;

      const buf = Buffer.from(xml, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=300',
      });
      res.end(buf);
    } catch (e) {
      log.error({ err: e }, 'blog rss failed');
      res.writeHead(500);
      res.end('RSS generation failed');
    }
  }

  return {
    id: 'blog',
    routes: [
      { method: 'GET', path: '/api/v1/blog/list', handler: handleBlogList },
      { method: 'GET', path: '/api/v1/blog/post', handler: handleBlogPost },
      { method: 'GET', path: '/blog/rss.xml', handler: handleBlogRss },
    ],
  };
}

module.exports = { createBlogModule };
