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
      // Explicit per-post human opt-in. Frontmatter values arrive as strings,
      // so accept the bare `true` token and the quoted form. Absent → false.
      indexable: meta.indexable === true || meta.indexable === 'true',
    };
  } catch {
    return null;
  }
}

// ── Indexability quality contract (deterministic, default-deny) ──────────────
// A blog post is indexable ONLY if a human explicitly opted it in via markdown
// frontmatter AND it carries substantive, non-duplicate body content. DB /
// ClickHouse (firehose) posts are NEVER indexable until a persisted review-state
// exists — `source: 'db'` fails the very first gate. `indexable: true` is a
// human-review + topical-fit attestation, NOT an SEO word-count claim; the word
// floor below is a separate, necessary-not-sufficient guard against thin opt-ins.
const INDEXABLE_WORD_FLOOR = 150;

function normalizeText(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(s) {
  const t = normalizeText(s);
  return t ? t.split(' ').length : 0;
}

/**
 * Deterministic indexability gate. Default-deny.
 * @param {object|null} post a post object (from readMarkdownPost or DB)
 * @returns {boolean}
 */
function isIndexable(post) {
  if (!post || post.source !== 'markdown') return false; // DB/firehose never indexable
  if (post.indexable !== true) return false; // explicit human opt-in required
  const body = String(post.body == null ? '' : post.body);
  if (!body.trim()) return false; // body must exist
  if (normalizeText(body) === normalizeText(post.summary)) return false; // body != summary
  if (wordCount(body) < INDEXABLE_WORD_FLOOR) return false; // substantive internal floor
  return true;
}

// ── tiny TTL cache (read path) ───────────────────────────────────────────────
const _cache = new Map(); // key → { ts, data }
const POST_TTL_MS = 5 * 60_000;
const LIST_TTL_MS = 5 * 60_000;

/**
 * Resolve one post for SSR/SEO with an explicit TRI-STATE result so the caller
 * can tell "this slug genuinely does not exist" (→ real 404) apart from
 * "ClickHouse is momentarily unavailable" (→ 200 noindex shell, NEVER a false
 * 404). Markdown is the authoritative routing source; a FRESH per-(slug,lang)
 * CH query is the ONLY thing that confirms absence — a cached list never does,
 * and absence is never cached.
 * @returns {Promise<{status:'found',post:object}|{status:'confirmed_absent'}|{status:'unavailable'}>}
 */
async function getPost(slug, lang) {
  if (!SLUG_RE.test(slug) || !LANGS.includes(lang)) return { status: 'confirmed_absent' };
  const md = readMarkdownPost(slug, lang);
  if (md) return { status: 'found', post: md };

  // A previously-resolved FOUND post may be served from cache (perf); absence is
  // NEVER cached, so a cache miss always triggers a fresh authoritative query.
  const key = `post:${lang}:${slug}`;
  const entry = _cache.get(key);
  if (entry && entry.data && Date.now() - entry.ts < POST_TTL_MS) {
    return { status: 'found', post: entry.data };
  }

  // No markdown, no fresh cache. Only ClickHouse can now confirm presence/absence.
  if (!isEnabled()) return { status: 'unavailable' };

  try {
    const rows = await chQuery(
      `SELECT slug, lang, title, category, summary, body, url, toString(published_at) AS published_at
       FROM analytics.blog_posts FINAL
       WHERE slug = '${chEsc(slug)}' AND lang = '${chEsc(lang)}'
       LIMIT 1`,
      { timeoutMs: SEO_CH_TIMEOUT_MS },
    );
    if (rows[0]) {
      const post = { ...rows[0], source: 'db' };
      _cache.set(key, { ts: Date.now(), data: post });
      return { status: 'found', post };
    }
    // Fresh authoritative query succeeded and returned 0 rows → truly absent.
    return { status: 'confirmed_absent' };
  } catch {
    // CH error/timeout: NEVER claim absence. Serve last-good post if cached,
    // else report unavailable (caller serves a 200 noindex shell, not a 404).
    if (entry && entry.data) return { status: 'found', post: entry.data };
    return { status: 'unavailable' };
  }
}

/**
 * AVAILABILITY view: all published post (slug, lang) pairs — markdown files ∪
 * analytics.blog_posts, deduped by slug:lang. Used for existing-only hreflang
 * (which locales exist) ONLY. It deliberately includes non-indexable
 * (firehose/DB) posts, so it is NOT a sitemap/indexable source. Cached +
 * graceful (CH error → last good list, else markdown-only).
 * @returns {Promise<Array<{slug:string, lang:string}>>}
 */
async function listAllPublishedRefs() {
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

/**
 * Which locales actually exist for a slug — for existing-only HTML-head
 * hreflang. Derived from the availability view; never confirms absence.
 * @returns {Promise<string[]>}
 */
async function langsForSlug(slug) {
  const refs = await listAllPublishedRefs();
  return LANGS.filter((l) => refs.some((r) => r.slug === slug && r.lang === l));
}

/**
 * Full approved-markdown post objects that PASS the quality contract — the only
 * indexable surface. Source of truth for the sitemap + RSS. DB/firehose rows are
 * never read here, so they can never be indexed.
 * @returns {Promise<object[]>}
 */
async function listIndexablePosts() {
  const out = [];
  for (const lang of LANGS) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(CONTENT_DIR, lang)).filter((f) => f.endsWith('.md'));
    } catch {
      /* dir may not exist */
    }
    for (const f of files) {
      const slug = f.slice(0, -3);
      if (!SLUG_RE.test(slug)) continue;
      const post = readMarkdownPost(slug, lang);
      if (post && isIndexable(post)) out.push(post);
    }
  }
  return out;
}

/**
 * Indexable post (slug, lang) refs — for the dynamic sitemap.
 * @returns {Promise<Array<{slug:string, lang:string}>>}
 */
async function listIndexablePostRefs() {
  return (await listIndexablePosts()).map((p) => ({ slug: p.slug, lang: p.lang }));
}

module.exports = {
  publishPost,
  rejectPost,
  slugify,
  nowCh,
  parseFrontmatter,
  isIndexable,
  INDEXABLE_WORD_FLOOR,
  getPost,
  listAllPublishedRefs,
  langsForSlug,
  listIndexablePosts,
  listIndexablePostRefs,
};
