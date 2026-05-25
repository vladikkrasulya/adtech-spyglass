'use strict';

/**
 * lib/blog-service.js — shared blog publish/reject used by BOTH the human
 * approval gate (modules/admin/blog.js) and the AI auto-moderator
 * (lib/news-moderator.js). One code path, two callers — no divergence.
 */

const { chInsert, chExec, chEsc } = require('./clickhouse');

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

module.exports = { publishPost, rejectPost, slugify, nowCh };
