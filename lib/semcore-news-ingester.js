'use strict';

/**
 * lib/semcore-news-ingester.js — pull adtech-relevant items from the Mozok
 * semantic-core ledger (analytics.news_events) into blog_drafts for the
 * ortbtools firehose pipeline.
 *
 * Complements the RSS crawler (AdExchanger, etc.) with classified items from
 * the broad news pipeline. Dedupes by URL against blog_drafts + blog_posts.
 */

const { randomUUID } = require('crypto');
const log = require('./logger').child('semcore-news-ingester');
const { chQuery, chInsert, chEsc, isEnabled } = require('./clickhouse');

const ADTECH_TOPICS = [
  'Adtech_Marketing',
  'Startups_VC',
  'Markets_Finance',
  'Business_Corporate',
  'Consumer_Tech',
  'Software_Dev',
  'Cybersecurity',
  'AI_ML',
];

const LOOKBACK_DAYS = Number(process.env.SEMCORE_NEWS_LOOKBACK_DAYS) || 14;
const BATCH_LIMIT = Number(process.env.SEMCORE_NEWS_BATCH) || 25;

function quoteTopics() {
  return ADTECH_TOPICS.map((t) => `'${t}'`).join(',');
}

async function urlKnown(url) {
  const esc = chEsc(url);
  const rows = await chQuery(
    `SELECT count() AS n FROM (
       SELECT url FROM analytics.blog_drafts WHERE url = '${esc}'
       UNION ALL
       SELECT url FROM analytics.blog_posts FINAL WHERE url = '${esc}' AND url != ''
     )`,
  );
  return rows.length > 0 && Number(rows[0].n) > 0;
}

async function fetchCandidates() {
  return chQuery(
    `SELECT item_id, title, link, summary, source, lang
     FROM analytics.news_events FINAL
     WHERE classify_state = 'enriched'
       AND topic IN (${quoteTopics()})
       AND audience_fit IN ('high', 'medium')
       AND NOT (has(tags, 'politics') OR has(tags, 'analysis') OR has(tags, 'intl'))
       AND link != ''
       AND pub_date >= today() - ${LOOKBACK_DAYS}
     ORDER BY hot DESC, pub_date DESC NULLS LAST
     LIMIT ${BATCH_LIMIT}`,
    { timeoutMs: 15_000 },
  );
}

/**
 * @returns {Promise<{ scanned: number, inserted: number, skipped: number }>}
 */
async function ingest() {
  if (!isEnabled()) {
    log.warn('ClickHouse not configured — semcore ingester is a no-op');
    return { scanned: 0, inserted: 0, skipped: 0 };
  }

  let candidates;
  try {
    candidates = await fetchCandidates();
  } catch (err) {
    log.error({ err: err.message }, 'failed to fetch semcore candidates');
    throw err;
  }

  let inserted = 0;
  let skipped = 0;

  for (const row of candidates) {
    const url = String(row.link || '').trim();
    const title = String(row.title || '').trim();
    if (!url || !title) {
      skipped++;
      continue;
    }
    try {
      if (await urlKnown(url)) {
        skipped++;
        continue;
      }
      const summary = String(row.summary || title).slice(0, 600);
      const now = new Date().toISOString().slice(0, -1);
      await chInsert('analytics.blog_drafts', [
        {
          id: randomUUID(),
          title: title.slice(0, 300),
          url,
          summary,
          category: 'news',
          lang: String(row.lang || 'en').slice(0, 8) || 'en',
          source_event_id: Number(row.item_id) || 0,
          created_at: now,
          status: 'pending',
        },
      ]);
      inserted++;
    } catch (err) {
      log.warn({ url, err: err.message }, 'failed to insert draft — skipping');
      skipped++;
    }
  }

  log.info({ scanned: candidates.length, inserted, skipped }, 'semcore ingest done');
  return { scanned: candidates.length, inserted, skipped };
}

module.exports = { ingest, ADTECH_TOPICS };
