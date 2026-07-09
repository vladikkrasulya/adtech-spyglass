'use strict';

/**
 * lib/news-pipeline.js — scheduled news firehose for ortbtools.com.
 *
 * Always runs:
 *   1. Semcore ledger ingest (analytics.news_events → blog_drafts)
 *   2. AI moderation + auto-publish (blog_drafts → blog_posts)
 *
 * Optionally runs (when NEWS_CRAWLER_DISABLED !== '1'):
 *   3. AdTech RSS crawler (AdExchanger, Digiday, …)
 *
 * Previously moderation only ran at the end of the RSS crawl, so pausing the
 * crawler (NEWS_CRAWLER_DISABLED=1) also froze the whole pipeline.
 */

const log = require('./logger').child('news-pipeline');
const { crawl: rssCrawl } = require('./news-crawler');
const { ingest: semcoreIngest } = require('./semcore-news-ingester');
const { moderatePendingDrafts } = require('./news-moderator');

async function runCycle() {
  try {
    const sem = await semcoreIngest();
    log.info({ sem }, 'semcore ingest complete');
  } catch (err) {
    log.error({ err: err.message }, 'semcore ingest failed (non-fatal)');
  }

  if (process.env.NEWS_CRAWLER_DISABLED !== '1') {
    try {
      const rss = await rssCrawl();
      log.info({ rss }, 'rss crawl complete');
    } catch (err) {
      log.error({ err: err.message }, 'rss crawl failed (non-fatal)');
    }
  }

  try {
    const mod = await moderatePendingDrafts();
    log.info({ mod }, 'moderation complete');
  } catch (err) {
    log.error({ err: err.message }, 'moderation failed (non-fatal)');
  }
}

function startScheduled({ intervalMs = 60 * 60 * 1000, initialDelayMs = 5_000 } = {}) {
  let running = false;
  let initialTimer = null;
  let intervalTimer = null;

  async function run() {
    if (running) return;
    running = true;
    try {
      await runCycle();
    } catch (err) {
      log.error({ err: err.message }, 'unexpected pipeline error');
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

module.exports = { runCycle, startScheduled };
