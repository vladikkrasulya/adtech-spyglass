'use strict';

/**
 * lib/mozok-display-enricher.js — batch Ollama display blurbs for Mozok news.
 *
 * Reads top adtech-filtered items from analytics.news_events, generates
 * ~90–95-word Ukrainian display text via local Ollama (gemma4-prod), and
 * caches results in analytics.news_display_cache for mozok-news-feed.js.
 *
 * Exports:
 *   enrich()          — run one batch (max 10 uncached items)
 *   startScheduled()  — startup + hourly timer (news-crawler pattern)
 *   ensureCacheTable()— CREATE TABLE IF NOT EXISTS
 */

const log = require('./logger').child('mozok-display-enricher');
const { chQuery, chInsert, chExec, isEnabled } = require('./clickhouse');
const { adtechTopicFilter } = require('./mozok-news-feed');
const { callOllama } = require('../intel-llm');
const { parseJsonLoose } = require('./news-moderator');

const CACHE_TABLE = 'analytics.news_display_cache';
const BATCH_SIZE = Number(process.env.MOZOK_DISPLAY_BATCH) || 10;
const OLLAMA_MODEL = process.env.MOZOK_DISPLAY_MODEL || process.env.OLLAMA_MODEL || 'gemma4-prod';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
  item_id UInt64,
  display_summary String,
  model String,
  enriched_at DateTime DEFAULT now(),
  lang LowCardinality(String) DEFAULT 'uk'
) ENGINE = ReplacingMergeTree(enriched_at)
ORDER BY item_id
`;

function buildDisplayPrompt(item) {
  const entities = Array.isArray(item.entities) ? item.entities.filter(Boolean).join(', ') : '';
  const snippet = (item.rss_snippet || '').trim().slice(0, 2000);
  const summary = (item.summary || '').trim().slice(0, 500);
  const lines = [
    'Напиши короткий редакційний анонс новини українською для adtech-аудиторії.',
    'Вимоги: 90–95 слів, 2–3 речення, конкретика з фактів, без зайвих вступів.',
    'Відповідь лише JSON: {"display_summary":"текст"}',
    '',
    `Джерело: ${item.source || 'невідомо'}`,
    `Тема: ${item.topic || 'невідомо'}`,
    `Заголовок: ${item.title || ''}`,
  ];
  if (summary) lines.push(`Короткий summary: ${summary}`);
  if (snippet) lines.push(`RSS-сніпет: ${snippet}`);
  if (entities) lines.push(`Сутності: ${entities}`);
  return lines.join('\n');
}

function extractDisplaySummary(text) {
  const obj = parseJsonLoose(text);
  if (obj && typeof obj.display_summary === 'string' && obj.display_summary.trim()) {
    return obj.display_summary.trim();
  }
  if (typeof text === 'string' && text.trim() && !text.trim().startsWith('{')) {
    return text.trim();
  }
  return null;
}

async function ensureCacheTable() {
  if (!isEnabled()) return false;
  await chExec(ENSURE_TABLE_SQL, { timeoutMs: 10_000 });
  return true;
}

/**
 * Fetch top adtech news not yet in display cache.
 * @returns {Promise<object[]>}
 */
async function fetchCandidates(limit = BATCH_SIZE) {
  const cap = Math.min(20, Math.max(1, limit));
  return chQuery(
    `SELECT
       n.item_id,
       n.title,
       n.source,
       n.lang,
       n.summary,
       n.rss_snippet,
       n.entities,
       n.topic
     FROM analytics.news_events AS n FINAL
     LEFT JOIN (
       SELECT item_id FROM ${CACHE_TABLE} FINAL
     ) AS c ON n.item_id = c.item_id
     WHERE n.classify_state = 'enriched'
       AND ${adtechTopicFilter(undefined, 'n')}
       AND n.audience_fit IN ('high', 'medium')
       AND c.item_id = 0
     ORDER BY n.hot DESC, n.pub_date DESC NULLS LAST
     LIMIT ${cap}`,
    { timeoutMs: 15_000 },
  );
}

/**
 * Generate and cache display blurbs for up to BATCH_SIZE items.
 * @returns {Promise<{ candidates: number, enriched: number, skipped: number, errors: number }>}
 */
async function enrich() {
  if (!isEnabled()) {
    log.warn('ClickHouse not configured — skipping display enrichment');
    return { candidates: 0, enriched: 0, skipped: 0, errors: 0 };
  }

  await ensureCacheTable();
  const candidates = await fetchCandidates();
  if (candidates.length === 0) {
    log.info('no uncached mozok display candidates');
    return { candidates: 0, enriched: 0, skipped: 0, errors: 0 };
  }

  let enriched = 0;
  let errors = 0;
  const rows = [];

  for (const item of candidates) {
    try {
      const prompt = buildDisplayPrompt(item);
      const result = await callOllama(prompt, {
        model: OLLAMA_MODEL,
        numPredict: 280,
        temperature: 0.3,
      });
      const displaySummary = extractDisplaySummary(result.response);
      if (!displaySummary || displaySummary.length < 40) {
        log.warn({ item_id: item.item_id }, 'empty or too short display_summary from Ollama');
        errors += 1;
        continue;
      }
      rows.push({
        item_id: item.item_id,
        display_summary: displaySummary.slice(0, 4000),
        model: result.model || OLLAMA_MODEL,
        enriched_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        lang: 'uk',
      });
      enriched += 1;
      log.info(
        { item_id: item.item_id, words: displaySummary.split(/\s+/).length },
        'display summary enriched',
      );
    } catch (err) {
      errors += 1;
      log.error({ item_id: item.item_id, err: err.message }, 'display enrichment failed');
    }
  }

  if (rows.length > 0) {
    await chInsert(CACHE_TABLE, rows, { timeoutMs: 10_000 });
  }

  const stats = {
    candidates: candidates.length,
    enriched,
    skipped: candidates.length - enriched - errors,
    errors,
  };
  log.info(stats, 'display enrichment cycle complete');
  return stats;
}

/**
 * Schedule recurring enrichment runs.
 * @param {{ intervalMs?: number, initialDelayMs?: number }} [opts]
 * @returns {{ stop: () => void }}
 */
function startScheduled({ intervalMs = 60 * 60 * 1000, initialDelayMs = 10_000 } = {}) {
  let running = false;
  let initialTimer = null;
  let intervalTimer = null;

  async function run() {
    if (running) return;
    running = true;
    try {
      await enrich();
    } catch (err) {
      log.error({ err: err.message }, 'unexpected display enrichment error');
    } finally {
      running = false;
    }
  }

  initialTimer = setTimeout(() => {
    run();
    intervalTimer = setInterval(run, intervalMs);
  }, initialDelayMs);

  return {
    stop() {
      if (initialTimer) clearTimeout(initialTimer);
      if (intervalTimer) clearInterval(intervalTimer);
    },
  };
}

module.exports = { enrich, startScheduled, ensureCacheTable, buildDisplayPrompt, fetchCandidates };
