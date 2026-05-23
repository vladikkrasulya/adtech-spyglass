'use strict';

/**
 * modules/admin/blog.js — admin blog draft management
 *
 * Routes (all Bearer ADMIN_STATS_TOKEN gated):
 *   GET  /api/admin/blog/drafts?status=pending
 *   POST /api/admin/blog/approve   { id, action:'publish'|'promote', slug? }
 *   POST /api/admin/blog/reject    { id }
 *   POST /api/admin/blog/ingest    { source_event_id?, title, url, summary, category, lang }
 *
 * CH client: same raw-fetch pattern as lib/event-log.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendJson, sendError, readJson } = require('../../lib/http');
const log = require('../../lib/logger').child('admin-blog');

const CONTENT_DIR = path.join(__dirname, '../../content/posts');

const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || '';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';

function chHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (CH_USER) h['X-ClickHouse-User'] = CH_USER;
  if (CH_PASSWORD) h['X-ClickHouse-Key'] = CH_PASSWORD;
  return h;
}

async function chQuery(sql) {
  const url = `${CH_URL}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`;
  const resp = await fetch(url, { headers: chHeaders() });
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

async function chInsert(table, rows) {
  const ndjson = rows.map((r) => JSON.stringify(r)).join('\n');
  const url = `${CH_URL}/?query=${encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...chHeaders(), 'Content-Type': 'text/plain' },
    body: ndjson,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`CH insert failed ${resp.status}: ${text.slice(0, 200)}`);
  }
}

function requireAdminToken(req, res) {
  const expected = process.env.ADMIN_STATS_TOKEN;
  if (!expected) {
    sendError(res, 503, 'admin_disabled', 'ADMIN_STATS_TOKEN not configured');
    return false;
  }
  const auth_h = req.headers['authorization'] || '';
  const provided = auth_h.startsWith('Bearer ') ? auth_h.slice(7) : '';
  if (!provided || provided !== expected) {
    sendError(res, 401, 'unauthorized', 'Bearer token required');
    return false;
  }
  return true;
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function nowCh() {
  // ClickHouse DateTime64 — strip trailing Z (CH doesn't like it)
  return new Date().toISOString().slice(0, -1);
}

function createAdminBlogModule() {
  /**
   * GET /api/admin/blog/drafts?status=pending
   */
  async function handleListDrafts(req, res, parsed) {
    if (!requireAdminToken(req, res)) return;
    const status = parsed.searchParams.get('status') || 'pending';
    const validStatuses = ['pending', 'published', 'promoted', 'rejected'];
    if (!validStatuses.includes(status)) {
      return sendError(res, 400, 'invalid_status', 'Unknown status');
    }
    try {
      const rows = await chQuery(
        `SELECT id, title, url, summary, category, lang, source_event_id, created_at, approved_at, approved_by, slug, status
         FROM analytics.blog_drafts
         WHERE status = '${status}'
         ORDER BY created_at DESC
         LIMIT 200`,
      );
      sendJson(res, 200, { ok: true, count: rows.length, drafts: rows });
    } catch (e) {
      log.error({ err: e }, 'list drafts failed');
      sendError(res, 500, 'list_failed', e.message);
    }
  }

  /**
   * POST /api/admin/blog/approve
   * { id, action:'publish'|'promote', slug? }
   */
  async function handleApprove(req, res) {
    if (!requireAdminToken(req, res)) return;
    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, 'bad_json', 'Invalid JSON body');
    }
    const { id, action, slug: providedSlug } = body || {};
    if (!id || !action) {
      return sendError(res, 400, 'missing_fields', 'id and action required');
    }
    if (action !== 'publish' && action !== 'promote') {
      return sendError(res, 400, 'invalid_action', 'action must be publish or promote');
    }

    try {
      const rows = await chQuery(
        `SELECT id, title, url, summary, category, lang, created_at, source_event_id
         FROM analytics.blog_drafts
         WHERE id = '${id.replace(/'/g, '')}'
         LIMIT 1`,
      );
      if (!rows.length) {
        return sendError(res, 404, 'draft_not_found', 'Draft not found');
      }
      const draft = rows[0];
      const slug = providedSlug || slugify(draft.title) || id.slice(0, 8);
      const now = nowCh();

      if (action === 'publish') {
        // Write to blog_posts
        await chInsert('analytics.blog_posts', [
          {
            slug,
            lang: draft.lang,
            title: draft.title,
            category: draft.category,
            summary: draft.summary,
            body: draft.summary, // draft has no separate body; summary becomes body
            url: draft.url || null,
            tags: [],
            published_at: now,
            source_draft_id: draft.id,
          },
        ]);
        // Update draft status to published
        await fetch(
          `${CH_URL}/?query=${encodeURIComponent(
            `ALTER TABLE analytics.blog_drafts UPDATE status = 'published', approved_at = '${now}', slug = '${slug.replace(/'/g, '')}' WHERE id = '${id.replace(/'/g, '')}'`,
          )}`,
          { headers: chHeaders() },
        );
        sendJson(res, 200, { ok: true, action: 'published', slug, lang: draft.lang });
      } else {
        // action === 'promote' — write markdown file to disk
        const dir = path.join(CONTENT_DIR, draft.lang);
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${slug}.md`);
        const frontmatter = `---\ntitle: "${draft.title.replace(/"/g, '\\"')}"\ndate: "${now}Z"\ncategory: ${draft.category}\ntags: []\nslug: ${slug}\n---\n\n${draft.summary}\n`;
        fs.writeFileSync(filePath, frontmatter, 'utf8');

        // Update draft status to promoted
        await fetch(
          `${CH_URL}/?query=${encodeURIComponent(
            `ALTER TABLE analytics.blog_drafts UPDATE status = 'promoted', approved_at = '${now}', slug = '${slug.replace(/'/g, '')}' WHERE id = '${id.replace(/'/g, '')}'`,
          )}`,
          { headers: chHeaders() },
        );
        sendJson(res, 200, {
          ok: true,
          action: 'promoted',
          slug,
          lang: draft.lang,
          file: `content/posts/${draft.lang}/${slug}.md`,
          hint: 'Run: git add content/posts/ && git commit -m "blog: promote ' + slug + '"',
        });
      }
    } catch (e) {
      log.error({ err: e }, 'approve failed');
      sendError(res, 500, 'approve_failed', e.message);
    }
  }

  /**
   * POST /api/admin/blog/reject
   * { id }
   */
  async function handleReject(req, res) {
    if (!requireAdminToken(req, res)) return;
    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, 'bad_json', 'Invalid JSON body');
    }
    const { id } = body || {};
    if (!id) {
      return sendError(res, 400, 'missing_id', 'id required');
    }
    try {
      const now = nowCh();
      await fetch(
        `${CH_URL}/?query=${encodeURIComponent(
          `ALTER TABLE analytics.blog_drafts UPDATE status = 'rejected', approved_at = '${now}' WHERE id = '${id.replace(/'/g, '')}'`,
        )}`,
        { headers: chHeaders() },
      );
      sendJson(res, 200, { ok: true, action: 'rejected', id });
    } catch (e) {
      log.error({ err: e }, 'reject failed');
      sendError(res, 500, 'reject_failed', e.message);
    }
  }

  /**
   * POST /api/admin/blog/ingest
   * { source_event_id?, title, url, summary, category, lang }
   */
  async function handleIngest(req, res) {
    if (!requireAdminToken(req, res)) return;
    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, 'bad_json', 'Invalid JSON body');
    }
    const { source_event_id, title, url, summary, category, lang } = body || {};
    if (!title || !summary || !category || !lang) {
      return sendError(res, 400, 'missing_fields', 'title, summary, category, lang required');
    }
    const validCategories = ['news', 'analysis', 'guide'];
    const validLangs = ['uk', 'en', 'ru'];
    if (!validCategories.includes(category)) {
      return sendError(res, 400, 'invalid_category', 'category must be news, analysis, or guide');
    }
    if (!validLangs.includes(lang)) {
      return sendError(res, 400, 'invalid_lang', 'lang must be uk, en, or ru');
    }
    const id = crypto.randomUUID();
    const now = nowCh();
    try {
      await chInsert('analytics.blog_drafts', [
        {
          id,
          title: String(title),
          url: String(url || ''),
          summary: String(summary),
          category,
          lang,
          source_event_id: source_event_id ? Number(source_event_id) : 0,
          created_at: now,
          status: 'pending',
        },
      ]);
      sendJson(res, 201, { ok: true, id, status: 'pending' });
    } catch (e) {
      log.error({ err: e }, 'ingest failed');
      sendError(res, 500, 'ingest_failed', e.message);
    }
  }

  return {
    id: 'admin-blog',
    routes: [
      { method: 'GET', path: '/api/admin/blog/drafts', handler: handleListDrafts },
      { method: 'POST', path: '/api/admin/blog/approve', handler: handleApprove },
      { method: 'POST', path: '/api/admin/blog/reject', handler: handleReject },
      { method: 'POST', path: '/api/admin/blog/ingest', handler: handleIngest },
    ],
  };
}

module.exports = { createAdminBlogModule };
