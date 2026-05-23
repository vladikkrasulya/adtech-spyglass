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

// ── ClickHouse config ────────────────────────────────────────────────────────

const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || '';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CH_ENABLED = !!(CH_URL && CH_USER);

function chHeaders() {
  const h = { 'Content-Type': 'text/plain' };
  if (CH_USER) h['X-ClickHouse-User'] = CH_USER;
  if (CH_PASSWORD) h['X-ClickHouse-Key'] = CH_PASSWORD;
  return h;
}

// ── Sources ──────────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'AdExchanger', url: 'https://www.adexchanger.com/feed/' },
  { name: 'ExchangeWire', url: 'https://www.exchangewire.com/feed/' },
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
    .replace(/<[^>]+>/g, ' ')                       // strip HTML tags
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

// ── ClickHouse helpers ───────────────────────────────────────────────────────

/**
 * Run a SELECT query against ClickHouse. Returns array of row objects.
 * @param {string} sql
 * @returns {Promise<object[]>}
 */
async function chQuery(sql) {
  const url = `${CH_URL}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const resp = await fetch(url, { headers: chHeaders(), signal: controller.signal });
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
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check whether a URL already exists in analytics.blog_drafts.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function urlExists(url) {
  // Escape single-quotes to prevent SQL injection (URLs shouldn't have them,
  // but be safe).
  const safe = url.replace(/'/g, "\\'");
  const rows = await chQuery(
    `SELECT count() AS n FROM analytics.blog_drafts WHERE url = '${safe}'`,
  );
  return rows.length > 0 && Number(rows[0].n) > 0;
}

/**
 * INSERT a new draft into analytics.blog_drafts.
 * @param {{ title: string, url: string, summary: string }} draft
 */
async function insertDraft({ title, url, summary }) {
  // Trailing-Z strip per CH DateTime64 memory note.
  const now = new Date().toISOString().slice(0, -1);

  const row = {
    id: randomUUID(),
    title,
    url,
    summary,
    category: 'news',
    lang: 'en',
    source_event_id: 0,
    created_at: now,
    status: 'pending',
  };

  const ndjson = JSON.stringify(row);
  const insertUrl = `${CH_URL}/?query=${encodeURIComponent('INSERT INTO analytics.blog_drafts FORMAT JSONEachRow')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const resp = await fetch(insertUrl, {
      method: 'POST',
      headers: chHeaders(),
      body: ndjson,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`CH insert failed ${resp.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── crawl ─────────────────────────────────────────────────────────────────────

/**
 * Run one full crawl cycle across all SOURCES.
 * Best-effort: per-source errors are logged but don't abort other sources.
 *
 * @returns {Promise<{ fetched: number, inserted: number, skipped: number }>}
 */
async function crawl() {
  if (!CH_ENABLED) {
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
