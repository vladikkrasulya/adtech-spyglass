'use strict';

/**
 * lib/news-crawler.js — AdTech RSS feed ingester → analytics.blog_drafts
 *
 * Fetches AdExchanger + ExchangeWire RSS feeds hourly, deduplicates by URL
 * against blog_drafts, and inserts new items as pending drafts for editorial
 * moderation at /admin/blog.
 *
 * Dependency-free (Node 18+ fetch, crypto built-in). Uses the same
 * ClickHouse HTTP/JSONEachRow pattern as lib/validation-log.js and
 * lib/event-log.js.
 *
 * Exports:
 *   crawl()          — run one fetch+parse+insert cycle, returns aggregate stats
 *   startScheduled() — schedule crawl on a timer, returns { stop }
 */

const { randomUUID } = require('crypto');
const log = require('./logger').child('news-crawler');
const { chQuery, chInsert, chEsc, isEnabled } = require('./clickhouse');
const { moderatePendingDrafts } = require('./news-moderator');

// ── Sources ──────────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'AdExchanger', url: 'https://www.adexchanger.com/feed/' },
  { name: 'ExchangeWire', url: 'https://www.exchangewire.com/feed/' },
  { name: 'Digiday', url: 'https://digiday.com/feed/' },
  { name: 'IAB Tech Lab', url: 'https://iabtechlab.com/feed/' },
  // MediaPost dropped — https://www.mediapost.com/rss/ returns 404 (no public
  // RSS at that path). Re-add with a verified feed URL if one surfaces.
  { name: 'MarTech', url: 'https://martech.org/feed/' },
];

// ── fetchFeed ────────────────────────────────────────────────────────────────

/**
 * Fetch an RSS feed URL. Returns the raw XML text.
 * Times out after 10 s via AbortController.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'spyglass-news-crawler/1.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── parseRss ─────────────────────────────────────────────────────────────────

/**
 * Minimal regex-based RSS parser. No external XML libs.
 *
 * @param {string} xml
 * @returns {{ title: string, link: string, summary: string, pubDate: string }[]}
 */
function parseRss(xml) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];

    const title = extractField(block, 'title');
    const link = extractField(block, 'link');
    const summary = extractField(block, 'description');
    const pubDate = extractField(block, 'pubDate');

    if (!title || !link) continue;

    items.push({
      title: cleanText(title).slice(0, 300),
      link: link.trim(),
      summary: cleanText(summary).slice(0, 600),
      pubDate,
    });
  }
  return items;
}

/**
 * Extract a single field from an RSS item block.
 * Handles plain text and CDATA-wrapped values.
 */
function extractField(block, tag) {
  // Try CDATA variant first: <tag><![CDATA[...]]></tag>
  const cdataRe = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    'i',
  );
  const cdataM = cdataRe.exec(block);
  if (cdataM) return cdataM[1];

  // Plain text variant
  const plainRe = new RegExp(`<${tag}[^>]*>([^<]*(?:<(?!\\/?${tag})[^<]*)*)<\\/${tag}>`, 'i');
  const plainM = plainRe.exec(block);
  if (plainM) return plainM[1];

  return '';
}

/**
 * Decode HTML entities, strip HTML tags, collapse whitespace.
 */
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // strip remaining CDATA wrappers
    .replace(/<[^>]+>/g, ' ') // strip HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

// ── ClickHouse helpers (shared client) ─────────────────────────────────────

/**
 * Check whether a URL already exists in analytics.blog_drafts.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function urlExists(url) {
  const rows = await chQuery(
    `SELECT count() AS n FROM analytics.blog_drafts WHERE url = '${chEsc(url)}'`,
  );
  return rows.length > 0 && Number(rows[0].n) > 0;
}

/**
 * INSERT a new draft into analytics.blog_drafts.
 * @param {{ title: string, url: string, summary: string }} draft
 */
async function insertDraft({ title, url, summary }) {
  const now = new Date().toISOString().slice(0, -1);
  await chInsert('analytics.blog_drafts', [
    {
      id: randomUUID(),
      title,
      url,
      summary,
      category: 'news',
      lang: 'en',
      source_event_id: 0,
      created_at: now,
      status: 'pending',
    },
  ]);
}

// ── crawl ─────────────────────────────────────────────────────────────────────

/**
 * Run one full crawl cycle across all SOURCES.
 * Best-effort: per-source errors are logged but don't abort other sources.
 *
 * @returns {Promise<{ fetched: number, inserted: number, skipped: number }>}
 */
async function crawl() {
  if (!isEnabled()) {
    log.warn('ClickHouse not configured — news-crawler is a no-op');
    return { fetched: 0, inserted: 0, skipped: 0 };
  }

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const source of SOURCES) {
    try {
      log.info({ source: source.name }, 'fetching feed');
      const xml = await fetchFeed(source.url);
      const items = parseRss(xml);
      log.info({ source: source.name, parsed: items.length }, 'parsed feed');

      let inserted = 0;
      let skipped = 0;

      for (const item of items) {
        try {
          const exists = await urlExists(item.link);
          if (exists) {
            skipped++;
            continue;
          }
          await insertDraft({
            title: item.title,
            url: item.link,
            summary: item.summary,
          });
          inserted++;
        } catch (itemErr) {
          log.warn(
            { source: source.name, url: item.link, err: itemErr.message },
            'failed to process item — skipping',
          );
          skipped++;
        }
      }

      log.info(
        { source: source.name, fetched: items.length, inserted, skipped },
        'crawl source done',
      );

      totalFetched += items.length;
      totalInserted += inserted;
      totalSkipped += skipped;
    } catch (srcErr) {
      log.error(
        { source: source.name, err: srcErr.message },
        'source fetch/parse failed — skipping source',
      );
    }
  }

  log.info(
    { fetched: totalFetched, inserted: totalInserted, skipped: totalSkipped },
    'crawl cycle complete',
  );

  // AI auto-moderation: score pending drafts, translate, and auto-publish up
  // to the daily limit. Best-effort — moderation failure must not break crawl.
  try {
    const mod = await moderatePendingDrafts();
    log.info({ moderation: mod }, 'moderation cycle done');
  } catch (err) {
    log.error({ err: err.message }, 'moderation failed (non-fatal)');
  }

  return { fetched: totalFetched, inserted: totalInserted, skipped: totalSkipped };
}

// ── startScheduled ────────────────────────────────────────────────────────────

/**
 * Schedule recurring crawl runs.
 *
 * @param {{ intervalMs?: number, initialDelayMs?: number }} [opts]
 * @returns {{ stop: () => void }}
 */
function startScheduled({ intervalMs = 60 * 60 * 1000, initialDelayMs = 5_000 } = {}) {
  let running = false;
  let initialTimer = null;
  let intervalTimer = null;

  async function run() {
    if (running) return; // don't stack concurrent crawls
    running = true;
    try {
      await crawl();
    } catch (err) {
      log.error({ err: err.message }, 'unexpected crawl error');
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

module.exports = { crawl, startScheduled, fetchFeed, parseRss, urlExists, insertDraft };
