'use strict';

/**
 * lib/blog-service.js — shared blog publish/reject used by BOTH the human
 * approval gate (modules/admin/blog.js) and the AI auto-moderator
 * (lib/news-moderator.js). One code path, two callers — no divergence.
 */

const fs = require('fs');
const path = require('path');
const { chInsert, chExec, chEsc, chQuery, isEnabled } = require('./clickhouse');

// Blog content root. Env-overridable so production can point it at a persistent
// volume (CONTENT_DIR=/data/content-posts) instead of the baked seed in the image
// — promoted posts then survive container recreate. Default = the repo seed for
// dev/tests + the image's baked copy.
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '../content/posts');
// Read path runs INSIDE the public HTML serve path → keep the CH timeout tight
// so a slow/down ClickHouse never stalls a page render. Caching + graceful
// degradation (below) mean a CH outage costs SSR body, never the whole page.
const SEO_CH_TIMEOUT_MS = Number(process.env.SEO_CH_TIMEOUT_MS) || 1500;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/i;
const LANGS = ['en', 'uk', 'ru'];

function nowCh() {
  // ClickHouse DateTime64 dislikes the trailing 'Z'.
  return new Date().toISOString().slice(0, -1);
}

function slugify(str) {
  return String(str == null ? '' : str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/**
 * Publish one localized row into analytics.blog_posts and mark the source
 * draft 'published'. Called once per language (en/uk/ru) for an AI article, or
 * once for a single-language admin publish.
 *
 * @param {object} p
 * @param {string} p.slug
 * @param {string} p.lang              'en' | 'uk' | 'ru'
 * @param {string} p.title
 * @param {string} p.category          'news' | 'analysis' | 'guide'
 * @param {string} p.summary
 * @param {string} [p.body]            defaults to summary
 * @param {string|null} [p.url]
 * @param {string} [p.source_draft_id] draft to mark published (skipped if absent)
 * @param {string[]} [p.tags]
 * @param {string} [p.approvedBy]      'admin' | 'AI-Moderator'
 */
async function publishPost(p) {
  const now = nowCh();
  await chInsert('analytics.blog_posts', [
    {
      slug: p.slug,
      lang: p.lang,
      title: p.title,
      category: p.category,
      summary: p.summary,
      body: p.body != null ? p.body : p.summary,
      url: p.url || null,
      tags: Array.isArray(p.tags) ? p.tags : [],
      published_at: now,
      source_draft_id: p.source_draft_id || null,
    },
  ]);

  if (p.source_draft_id) {
    const sets = [`status = 'published'`, `approved_at = '${now}'`, `slug = '${chEsc(p.slug)}'`];
    if (p.approvedBy) sets.push(`approved_by = '${chEsc(p.approvedBy)}'`);
    await chExec(
      `ALTER TABLE analytics.blog_drafts UPDATE ${sets.join(', ')} WHERE id = '${chEsc(p.source_draft_id)}'`,
    );
  }
}

/**
 * Mark a draft 'rejected'.
 * @param {string} draftId
 * @param {{ approvedBy?: string }} [opts]
 */
async function rejectPost(draftId, opts = {}) {
  const now = nowCh();
  const sets = [`status = 'rejected'`, `approved_at = '${now}'`];
  if (opts.approvedBy) sets.push(`approved_by = '${chEsc(opts.approvedBy)}'`);
  await chExec(
    `ALTER TABLE analytics.blog_drafts UPDATE ${sets.join(', ')} WHERE id = '${chEsc(draftId)}'`,
  );
}

// ── Read path: getPost / getAllActivePosts (for server-side SEO + SSR) ───────
// Frontmatter parser — same grammar as modules/blog/handler.js (intentional
// shared copy; the API handler is a self-contained module factory).
function parseFrontmatter(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: String(content) };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Array literal `[a, b, c]` → string[]; keep `val` a string so tsc doesn't
    // see a cross-type reassignment — write the array straight into meta.
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[kv[1]] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      meta[kv[1]] = val;
    }
  }
  return { meta, body: match[2] };
}

function firstLine(body) {
  return (
    String(body)
      .trim()
      .split('\n')
      .find((l) => l.trim()) || ''
  );
}

// Editorial markdown is the routing source of truth: a post lives at
// content/posts/<lang>/<slug>.md, so the FILE NAME is the routing slug.
function readMarkdownPost(slug, lang) {
  if (!SLUG_RE.test(slug) || !LANGS.includes(lang)) return null;
  try {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, lang, `${slug}.md`), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    return {
      slug,
      lang,
      title: meta.title || '',
      category: meta.category || 'guide',
      summary: meta.summary || firstLine(body),
      body,
      url: meta.url || null,
      published_at: meta.date || '',
      source: 'markdown',
    };
  } catch {
    return null;
  }
}

// ── tiny TTL cache (read path) ───────────────────────────────────────────────
const _cache = new Map(); // key → { ts, data }
const POST_TTL_MS = 5 * 60_000;
const LIST_TTL_MS = 5 * 60_000;

/**
 * Fetch one post for SSR/SEO. Markdown-first (local, no CH), then
 * analytics.blog_posts. Cached. NEVER throws — on CH error returns a stale
 * cached value if present, else null (caller then serves the shell sans SSR).
 * @returns {Promise<object|null>}
 */
async function getPost(slug, lang) {
  if (!SLUG_RE.test(slug) || !LANGS.includes(lang)) return null;
  const md = readMarkdownPost(slug, lang);
  if (md) return md;

  const key = `post:${lang}:${slug}`;
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < POST_TTL_MS) return entry.data;
  if (!isEnabled()) return entry ? entry.data : null;

  try {
    const rows = await chQuery(
      `SELECT slug, lang, title, category, summary, body, url, toString(published_at) AS published_at
       FROM analytics.blog_posts FINAL
       WHERE slug = '${chEsc(slug)}' AND lang = '${chEsc(lang)}'
       LIMIT 1`,
      { timeoutMs: SEO_CH_TIMEOUT_MS },
    );
    const post = rows[0] ? { ...rows[0], source: 'db' } : null;
    _cache.set(key, { ts: Date.now(), data: post });
    return post;
  } catch {
    return entry ? entry.data : null; // graceful: stale-or-null, never throw
  }
}

/**
 * All published post (slug, lang) pairs for the sitemap — markdown files ∪
 * analytics.blog_posts, deduped by slug:lang. Cached + graceful (CH error →
 * stale cache, else markdown-only).
 * @returns {Promise<Array<{slug:string, lang:string}>>}
 */
async function getAllActivePosts() {
  const key = 'all:posts';
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < LIST_TTL_MS) return entry.data;

  const seen = new Map(); // slug:lang → {slug, lang}
  for (const lang of LANGS) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(CONTENT_DIR, lang)).filter((f) => f.endsWith('.md'));
    } catch {
      /* dir may not exist */
    }
    for (const f of files) {
      const slug = f.slice(0, -3);
      if (SLUG_RE.test(slug)) seen.set(`${slug}:${lang}`, { slug, lang });
    }
  }

  if (isEnabled()) {
    try {
      const rows = await chQuery(
        `SELECT DISTINCT slug, lang FROM analytics.blog_posts FINAL WHERE slug != '' AND lang != ''`,
        { timeoutMs: SEO_CH_TIMEOUT_MS },
      );
      for (const r of rows) {
        if (r.slug && LANGS.includes(r.lang))
          seen.set(`${r.slug}:${r.lang}`, { slug: r.slug, lang: r.lang });
      }
    } catch {
      if (entry) return entry.data; // CH error → last good list
    }
  }

  const data = Array.from(seen.values());
  _cache.set(key, { ts: Date.now(), data });
  return data;
}

module.exports = {
  publishPost,
  rejectPost,
  slugify,
  nowCh,
  parseFrontmatter,
  getPost,
  getAllActivePosts,
};
