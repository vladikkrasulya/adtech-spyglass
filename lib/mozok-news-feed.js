'use strict';

/**
 * Mozok pipeline news for ortbtools — reads analytics.news_events with an
 * adtech topic filter. Used when NEWS_CRAWLER_DISABLED=1 (CP2 indexing policy:
 * no new thin firehose blog posts, but Mozok-enriched items stay visible).
 */

const { chQuery, isEnabled } = require('./clickhouse');

const ADTECH_TOPICS = [
  'Adtech_Marketing',
  'Startups_VC',
  'Markets_Finance',
  'Business_Corporate',
  'Consumer_Tech',
  'Crypto',
  'Telecom',
];

const FEED_TAG_GUARD = "NOT (has(tags, 'politics') OR has(tags, 'analysis') OR has(tags, 'intl'))";

function quoteTopics(topics) {
  return topics.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
}

/** SQL fragment: topic IN (...) AND feed tag guard. @param {string} [alias] table alias prefix e.g. 'n' */
function adtechTopicFilter(topics = ADTECH_TOPICS, alias = '') {
  const p = alias ? `${alias}.` : '';
  const tagGuard = FEED_TAG_GUARD.replace(/\btags\b/g, `${p}tags`);
  return `(${p}topic IN (${quoteTopics(topics)})) AND ${tagGuard}`;
}

/**
 * @param {{ lang?: string, limit?: number }} [opts]
 * @returns {Promise<object[]>} blog-list-shaped items (source: 'mozok')
 */
async function fetchMozokNews({ lang = '', limit = 50 } = {}) {
  if (!isEnabled()) return [];
  const langClause = lang ? `AND n.lang = '${String(lang).replace(/'/g, "''")}'` : '';
  const cap = Math.min(100, Math.max(1, limit));
  const rows = await chQuery(
    `SELECT
       n.item_id,
       n.title,
       n.link,
       n.source,
       n.lang,
       n.summary,
       n.topic,
       n.pub_date,
       n.hot,
       d.display_summary
     FROM analytics.news_events AS n FINAL
     LEFT JOIN (
       SELECT item_id, display_summary
       FROM analytics.news_display_cache FINAL
     ) AS d ON n.item_id = d.item_id
     WHERE n.classify_state = 'enriched'
       AND ${adtechTopicFilter(ADTECH_TOPICS, 'n')}
       AND n.audience_fit IN ('high', 'medium')
       ${langClause}
     ORDER BY n.hot DESC, n.pub_date DESC NULLS LAST
     LIMIT ${cap}`,
    { timeoutMs: 8000 },
  );
  return rows.map((r) => {
    const display = (r.display_summary || '').trim();
    const fallback = (r.summary || '').trim().slice(0, 280);
    return {
      slug: `mozok-${r.item_id}`,
      lang: r.lang || 'en',
      title: r.title,
      category: 'news',
      summary: display || fallback || '',
      published_at: r.pub_date || new Date().toISOString(),
      tags: r.topic ? [r.topic] : [],
      source: 'mozok',
      url: r.link,
    };
  });
}

module.exports = { ADTECH_TOPICS, adtechTopicFilter, fetchMozokNews };
