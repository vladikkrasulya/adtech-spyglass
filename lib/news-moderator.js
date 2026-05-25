'use strict';

/**
 * lib/news-moderator.js — AI auto-publisher for AdTech news drafts.
 *
 * Per run (called at the end of each crawl cycle):
 *   1. Stop if today's published article count >= MAX_ARTICLES_PER_DAY.
 *   2. Take a bounded batch of 'pending' drafts (oldest first).
 *   3. Score relevance locally (Ollama). score < threshold → reject.
 *      Ollama / parse failure → leave pending (NEVER reject on infra error).
 *   4. score >= threshold → translate + categorize via OpenRouter DeepSeek.
 *      OR failure / incomplete JSON → leave pending.
 *   5. Publish 3 localized rows (en/uk/ru) via the shared blog-service.
 *   6. Stop publishing once the daily limit is hit; leave the rest pending.
 *
 * Policy: this is the AUTO path (decision logged in ROADMAP). The human gate
 * at /admin/blog shares the same publishPost/rejectPost and still handles
 * anything the moderator leaves pending.
 */

const { chQuery, isEnabled } = require('./clickhouse');
const { publishPost, rejectPost, slugify } = require('./blog-service');
const { callOllama } = require('../intel-llm');
const { callOpenRouter } = require('./openrouter');
const log = require('./logger').child('news-moderator');

const MAX_ARTICLES_PER_DAY = Number(process.env.BLOG_MAX_PER_DAY) || 3;
const RELEVANCE_THRESHOLD = Number(process.env.BLOG_RELEVANCE_MIN) || 8;
const MAX_DRAFTS_PER_RUN = Number(process.env.BLOG_MODERATE_BATCH) || 8;
const LANGS = ['en', 'uk', 'ru'];
const VALID_CATEGORIES = ['news', 'analysis', 'guide'];
const APPROVED_BY = 'AI-Moderator';

// ── pure helpers (exported for tests) ──────────────────────────────────────

/** Extract the first JSON object from a model reply. Returns null on failure. */
function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
}

/** Pull a 0–10 relevance score from a model reply. null if unparseable. */
function extractScore(text) {
  const obj = parseJsonLoose(text);
  let raw = obj && obj.relevance_score != null ? obj.relevance_score : null;
  if (raw == null && typeof text === 'string') {
    const m = text.match(/relevance_score["'\s:]+(\d+(?:\.\d+)?)/i);
    if (m) raw = m[1];
  }
  // No score parsed → null (caller leaves the draft pending). NEVER coerce a
  // missing score to 0, which would look like "low relevance" and auto-reject.
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, n));
}

function sanitizeCategory(c) {
  return VALID_CATEGORIES.includes(c) ? c : 'news';
}

function sanitizeTags(t) {
  if (!Array.isArray(t)) return [];
  return t
    .map((x) => String(x).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 5);
}

function buildScorePrompt(draft) {
  return (
    'You are an AdTech editorial relevance scorer. Rate how relevant this ' +
    'article is to a programmatic-advertising / OpenRTB audience (topics: ' +
    'OpenRTB, programmatic, SSP/DSP/exchange infrastructure, privacy sandbox, ' +
    'identity, header bidding, ad fraud). 10 = core AdTech infrastructure; ' +
    '1 = unrelated.\n\n' +
    `TITLE: ${draft.title}\nSUMMARY: ${draft.summary}\n\n` +
    'Reply with STRICT JSON only: {"relevance_score": <integer 1-10>}'
  );
}

function buildTranslatePrompt(draft) {
  return [
    {
      role: 'system',
      content:
        'You are a senior AdTech editor and EN→UK/RU translator. Preserve ' +
        'professional programmatic-advertising terminology (SSP, DSP, oRTB, ' +
        'bid floor, header bidding, etc.) — translate naturally, never calque. ' +
        'Output STRICT JSON only, no prose.',
    },
    {
      role: 'user',
      content:
        `Article (English):\nTITLE: ${draft.title}\nSUMMARY: ${draft.summary}\n\n` +
        'Produce: a url-friendly english slug; a category (one of news, ' +
        'analysis, guide); 3-5 lowercase topical tags; and the title+summary ' +
        'in en, uk, ru. JSON shape:\n' +
        '{"category":"news","slug":"...","tags":["..."],' +
        '"en":{"title":"...","summary":"..."},' +
        '"uk":{"title":"...","summary":"..."},' +
        '"ru":{"title":"...","summary":"..."}}',
    },
  ];
}

// ── ClickHouse-backed steps ────────────────────────────────────────────────

async function publishedTodayCount() {
  // uniqExact(slug) = distinct ARTICLES today. Robust to ReplacingMergeTree
  // duplicate rows AND to single-row admin posts — counting raw rows / 9 (one
  // article = 3 rows) would miscount both. One article = one slug.
  const rows = await chQuery(
    'SELECT uniqExact(slug) AS n FROM analytics.blog_posts WHERE published_at >= today()',
  );
  return rows.length ? Number(rows[0].n) || 0 : 0;
}

async function fetchPendingDrafts(limit) {
  return chQuery(
    `SELECT id, title, url, summary, category, lang FROM analytics.blog_drafts ` +
      `WHERE status = 'pending' ORDER BY created_at ASC LIMIT ${Number(limit) || 8}`,
  );
}

/**
 * Run one moderation cycle. Best-effort and idempotent-ish: anything it can't
 * confidently classify is left 'pending' for the next run.
 * @returns {Promise<{published:number, rejected:number, skipped:number, reason?:string}>}
 */
async function moderatePendingDrafts() {
  if (!isEnabled()) {
    log.warn('ClickHouse not configured — moderator is a no-op');
    return { published: 0, rejected: 0, skipped: 0, reason: 'ch_disabled' };
  }

  let publishedToday;
  try {
    publishedToday = await publishedTodayCount();
  } catch (e) {
    log.error({ err: e.message }, 'failed to read daily count — skipping run');
    return { published: 0, rejected: 0, skipped: 0, reason: 'count_failed' };
  }
  if (publishedToday >= MAX_ARTICLES_PER_DAY) {
    log.info({ publishedToday }, 'daily limit reached — skipping moderation');
    return { published: 0, rejected: 0, skipped: 0, reason: 'daily_limit' };
  }

  let drafts;
  try {
    drafts = await fetchPendingDrafts(MAX_DRAFTS_PER_RUN);
  } catch (e) {
    log.error({ err: e.message }, 'failed to fetch pending drafts');
    return { published: 0, rejected: 0, skipped: 0, reason: 'fetch_failed' };
  }

  let published = 0;
  let rejected = 0;
  let skipped = 0;

  for (const draft of drafts) {
    if (publishedToday >= MAX_ARTICLES_PER_DAY) {
      skipped++; // over the daily limit — leave pending for tomorrow
      continue;
    }

    // 1) relevance score (local Ollama) — infra failure → leave pending
    let score;
    try {
      const resp = await callOllama(buildScorePrompt(draft), { numPredict: 40, temperature: 0.1 });
      // callOllama returns the Ollama response OBJECT (it forces format:'json');
      // the model's text lives in resp.response — pass THAT to the parser, not
      // the whole object.
      score = extractScore(resp && resp.response);
    } catch (e) {
      log.warn({ id: draft.id, err: e.message }, 'score call failed — leaving pending');
      skipped++;
      continue;
    }
    if (score == null) {
      log.warn({ id: draft.id }, 'unparseable score — leaving pending');
      skipped++;
      continue;
    }
    if (score < RELEVANCE_THRESHOLD) {
      try {
        await rejectPost(draft.id, { approvedBy: APPROVED_BY });
        rejected++;
        log.info({ id: draft.id, score }, 'rejected (low relevance)');
      } catch (e) {
        log.warn({ id: draft.id, err: e.message }, 'reject failed');
      }
      continue;
    }

    // 2) translate + categorize (OpenRouter DeepSeek) — failure → leave pending
    let meta;
    try {
      const { content } = await callOpenRouter(buildTranslatePrompt(draft), {
        jsonObject: true,
        temperature: 0.2,
        maxTokens: 1200,
      });
      meta = parseJsonLoose(content);
    } catch (e) {
      log.warn({ id: draft.id, err: e.message }, 'translation failed — leaving pending');
      skipped++;
      continue;
    }
    if (!meta || !meta.en || !meta.uk || !meta.ru) {
      log.warn({ id: draft.id }, 'translation JSON incomplete — leaving pending');
      skipped++;
      continue;
    }

    const slug = slugify(meta.slug) || slugify(draft.title) || String(draft.id).slice(0, 8);
    const category = sanitizeCategory(meta.category);
    const tags = sanitizeTags(meta.tags);

    // 3) publish 3 localized rows through the shared service
    try {
      for (const lang of LANGS) {
        const loc = meta[lang] || {};
        await publishPost({
          slug,
          lang,
          title: String(loc.title || draft.title).slice(0, 300),
          category,
          summary: String(loc.summary || draft.summary).slice(0, 600),
          body: String(loc.summary || draft.summary),
          url: draft.url || null,
          source_draft_id: draft.id,
          tags,
          approvedBy: APPROVED_BY,
        });
      }
      published++;
      publishedToday++;
      log.info({ id: draft.id, slug, score }, 'auto-published (en/uk/ru)');
    } catch (e) {
      log.error({ id: draft.id, err: e.message }, 'publish failed (possibly partial)');
    }
  }

  log.info({ published, rejected, skipped, publishedToday }, 'moderation cycle complete');
  return { published, rejected, skipped };
}

module.exports = {
  moderatePendingDrafts,
  // exported for tests:
  parseJsonLoose,
  extractScore,
  sanitizeCategory,
  sanitizeTags,
  buildScorePrompt,
  buildTranslatePrompt,
  MAX_ARTICLES_PER_DAY,
  RELEVANCE_THRESHOLD,
};
