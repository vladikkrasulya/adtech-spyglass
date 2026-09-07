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
const { chQuery, chInsert, chExec, chEsc } = require('../../lib/clickhouse');
const {
  publishPost,
  rejectPost,
  slugify,
  nowCh,
  parseFrontmatter,
  SLUG_RE,
} = require('../../lib/blog-service');

// Env-overridable (prod: /data/content-posts persistent volume — promoted posts
// persist across container recreate). Default = repo seed / baked copy.
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '../../content/posts');
const LANGS = ['en', 'uk', 'ru'];
const CATEGORIES = ['news', 'analysis', 'guide'];
// The app has one Node process. Serialize its admin decisions for each draft;
// filesystem exclusivity separately arbitrates different drafts using one slug.
const activeDraftActions = new Set();

function validDraftId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 256 && id.trim() === id;
}

function promotedMarkdown(draft, slug, now) {
  const fields = {
    title: draft.title,
    date: `${now}Z`,
    category: draft.category,
    tags: [],
    slug,
    source_draft_id: draft.id,
    indexable: false,
  };
  return `---\nfrontmatter_encoding: json-v1\n${Object.entries(fields)
    .map(([key, value]) => {
      const encoded = JSON.stringify(value)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
      return `${key}: ${encoded}`;
    })
    .join('\n')}\n---\n\n${draft.summary}\n`;
}

function matchesPromotion(filePath, draft, slug) {
  // Do not follow an existing symlink, directory or operator-owned article.
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) return false;
  const { meta, body } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
  return (
    meta.source_draft_id === draft.id &&
    meta.slug === slug &&
    meta.title === draft.title &&
    meta.category === draft.category &&
    meta.indexable === 'false' &&
    body === `\n${draft.summary}\n`
  );
}

function removeOwnFile(filePath, identity) {
  try {
    const current = fs.lstatSync(filePath);
    if (current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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
    if (!validDraftId(id) || !action) {
      return sendError(res, 400, 'missing_fields', 'id and action required');
    }
    if (action !== 'publish' && action !== 'promote') {
      return sendError(res, 400, 'invalid_action', 'action must be publish or promote');
    }
    if (activeDraftActions.has(id)) {
      return sendError(res, 409, 'draft_busy', 'A decision for this draft is already in progress');
    }
    activeDraftActions.add(id);

    try {
      const rows = await chQuery(
        `SELECT id, title, url, summary, category, lang, created_at, source_event_id, status, slug
         FROM analytics.blog_drafts
         WHERE id = '${chEsc(id)}'
         LIMIT 1`,
      );
      if (!rows.length) {
        return sendError(res, 404, 'draft_not_found', 'Draft not found');
      }
      const draft = rows[0];
      const allowedStates =
        action === 'publish' ? ['pending'] : ['pending', 'published', 'promoted'];
      if (!allowedStates.includes(draft.status)) {
        return sendError(
          res,
          409,
          'invalid_draft_status',
          'This draft cannot make that transition',
        );
      }
      if (!LANGS.includes(draft.lang) || !CATEGORIES.includes(draft.category)) {
        return sendError(res, 400, 'invalid_draft_metadata', 'Draft locale or category is invalid');
      }
      if (
        draft.id !== id ||
        typeof draft.title !== 'string' ||
        !draft.title.trim() ||
        typeof draft.summary !== 'string'
      ) {
        return sendError(res, 400, 'invalid_draft_metadata', 'Draft title or body is invalid');
      }
      const titleSlug = slugify(draft.title);
      const fallbackSlug = SLUG_RE.test(titleSlug) ? titleSlug : slugify(id).slice(0, 8);
      const slug = providedSlug == null ? draft.slug || fallbackSlug : providedSlug;
      if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug !== slug.toLowerCase()) {
        return sendError(
          res,
          400,
          'invalid_slug',
          'Slug must match the lowercase public Blog route',
        );
      }
      if (draft.status === 'promoted' && draft.slug !== slug) {
        return sendError(res, 409, 'invalid_draft_status', 'This draft was already promoted');
      }
      const now = nowCh();

      if (action === 'publish') {
        // Shared publish path — identical to the one the AI moderator uses.
        await publishPost({
          slug,
          lang: draft.lang,
          title: draft.title,
          category: draft.category,
          summary: draft.summary,
          body: draft.summary,
          url: draft.url || null,
          source_draft_id: draft.id,
          tags: [],
          approvedBy: 'admin',
        });
        sendJson(res, 200, { ok: true, action: 'published', slug, lang: draft.lang });
      } else {
        // A published draft may be deliberately upgraded to editorial content.
        // Repeated promotion only reconciles the exact artifact made by this
        // same draft; it never replaces an article with new or revised content.
        const dir = path.join(CONTENT_DIR, draft.lang);
        fs.mkdirSync(dir, { recursive: true });
        if (fs.realpathSync(dir) !== path.join(fs.realpathSync(CONTENT_DIR), draft.lang)) {
          return sendError(
            res,
            409,
            'invalid_content_directory',
            'Content locale directory is invalid',
          );
        }
        const filePath = path.join(dir, `${slug}.md`);
        let createdIdentity;
        if (draft.status === 'promoted') {
          if (!fs.existsSync(filePath) || !matchesPromotion(filePath, draft, slug)) {
            return sendError(res, 409, 'invalid_draft_status', 'This draft was already promoted');
          }
        } else {
          let fd;
          try {
            fd = fs.openSync(filePath, 'wx', 0o600);
            createdIdentity = fs.fstatSync(fd);
            fs.writeFileSync(fd, promotedMarkdown(draft, slug, now), 'utf8');
          } catch (error) {
            if (createdIdentity) removeOwnFile(filePath, createdIdentity);
            if (error.code !== 'EEXIST') throw error;
            if (!matchesPromotion(filePath, draft, slug)) {
              return sendError(
                res,
                409,
                'slug_exists',
                'An article already uses this locale and slug',
              );
            }
          } finally {
            if (fd !== undefined) fs.closeSync(fd);
          }

          try {
            // Wait for visibility before replying. Never blindly overwrite a
            // newer rejected/promoted decision made by another producer.
            await chExec(
              `ALTER TABLE analytics.blog_drafts UPDATE status = 'promoted', approved_at = '${now}', approved_by = 'admin', slug = '${chEsc(slug)}' WHERE id = '${chEsc(id)}' AND status IN ('pending', 'published') SETTINGS mutations_sync = 1`,
            );
            const [updated] = await chQuery(
              `SELECT status, slug FROM analytics.blog_drafts WHERE id = '${chEsc(id)}' LIMIT 1`,
            );
            if (!updated || updated.status !== 'promoted' || updated.slug !== slug) {
              if (createdIdentity) removeOwnFile(filePath, createdIdentity);
              return sendError(
                res,
                409,
                'draft_status_changed',
                'The draft decision changed during promotion',
              );
            }
          } catch {
            // A transport failure cannot establish whether CH accepted the
            // mutation. Keep the exclusively created artifact and provenance:
            // retrying this same draft/slug can reconcile without data loss.
            log.warn(
              { code: 'promotion_status_unconfirmed' },
              'promotion status was not confirmed',
            );
            return sendError(
              res,
              503,
              'promotion_status_unconfirmed',
              'The article is preserved; retry this draft with the same slug to confirm its status',
            );
          }
        }
        sendJson(res, 200, {
          ok: true,
          action: 'promoted',
          slug,
          lang: draft.lang,
          file: `${draft.lang}/${slug}.md`,
          // Persistent storage (CONTENT_DIR volume) since v1.1.5 — the post is
          // written to the data volume and survives container recreate. No git
          // commit step (content no longer lives in the git working tree).
          storage: 'persistent CONTENT_DIR volume',
        });
      }
    } catch (e) {
      log.error({ err: e }, 'approve failed');
      sendError(res, 500, 'approve_failed', e.message);
    } finally {
      activeDraftActions.delete(id);
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
    if (!validDraftId(id)) {
      return sendError(res, 400, 'missing_id', 'id required');
    }
    if (activeDraftActions.has(id)) {
      return sendError(res, 409, 'draft_busy', 'A decision for this draft is already in progress');
    }
    activeDraftActions.add(id);
    try {
      await rejectPost(id, { approvedBy: 'admin' });
      sendJson(res, 200, { ok: true, action: 'rejected', id });
    } catch (e) {
      log.error({ err: e }, 'reject failed');
      sendError(res, 500, 'reject_failed', e.message);
    } finally {
      activeDraftActions.delete(id);
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
