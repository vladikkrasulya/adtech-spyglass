'use strict';

/**
 * Admin alerts via Telegram Bot API.
 *
 * One-shot helper for surfacing operational events the user (admin) would
 * otherwise miss — email-send failures, 5xx error spikes, anything that
 * console.error swallows because nobody tails the container logs.
 *
 * Why Telegram, not Sentry/email/Slack: zero infra, the user already has a
 * bot token in /srv/DATA/.secrets/api-tokens.env, alerts arrive on phone
 * within seconds. Trade-off: no aggregation, no deduplication — every call
 * is one message. Caller is responsible for not flooding (the throttle
 * below is a safety net, not a substitute for restraint).
 *
 * Env (see .env.example):
 *   TG_BOT_TOKEN         — bot API token (Bearer for sendMessage)
 *   TG_ADMIN_CHAT_ID     — destination chat (DM with bot, or group ID)
 *
 * Dev-mode short-circuit: if either env var is missing, log to console
 * with [notify:DEV] prefix and resolve. Production runs without TG_*
 * still serve users; only the alerting goes silent.
 *
 * Public API:
 *   notifyAdmin(message, opts) — fire-and-forget; never throws.
 *
 * `opts.tag` (string) is the dedup/throttle key. Same tag within
 * THROTTLE_WINDOW_MS only sends one message — successive hits log to
 * console only. Use distinct tags for distinct error classes (e.g.
 * 'email-send-fail', 'analyze-5xx', 'auth-flood').
 */

const https = require('https');
const log = require('./lib/logger').child('notify');

const TG_HOST = 'api.telegram.org';
const REQUEST_TIMEOUT_MS = 5_000;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5 min

// In-memory throttle map: tag → lastSentAt ms epoch. Wipes on container
// restart, which is fine — we want a fresh page after a restart anyway.
/** @type {Map<string, number>} */
const _lastSent = new Map();

function isDevMode() {
  return !process.env.TG_BOT_TOKEN || !process.env.TG_ADMIN_CHAT_ID;
}

/**
 * Posts to Telegram's sendMessage. Never throws — failures go to console.
 * @param {string} text
 * @returns {Promise<{ok: boolean, dev?: boolean, error?: string}>}
 */
function postToTelegram(text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      chat_id: process.env.TG_ADMIN_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    const req = https.request(
      {
        host: TG_HOST,
        path: `/bot${process.env.TG_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true });
          } else {
            log.error(
              { statusCode: res.statusCode, body: chunks.slice(0, 200) },
              'Telegram non-2xx response',
            );
            resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          }
        });
      },
    );
    req.on('error', (err) => {
      log.error({ err }, 'Telegram request error');
      resolve({ ok: false, error: err.message });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/**
 * Send an admin alert. Fire-and-forget — never throws, never blocks the
 * caller's response. Throttled per-tag to avoid storms.
 *
 * @param {string} message — short summary; use HTML where useful (b, i, code, pre)
 * @param {{ tag?: string, level?: 'info'|'warn'|'error' }} [opts]
 * @returns {Promise<{ok: boolean, dev?: boolean, throttled?: boolean, error?: string}>}
 */
async function notifyAdmin(message, opts) {
  const o = opts || {};
  const tag = o.tag || 'untagged';
  const level = o.level || 'info';

  // Per-tag throttle: drop duplicate alerts that fire in quick succession.
  const now = Date.now();
  const last = _lastSent.get(tag) || 0;
  if (now - last < THROTTLE_WINDOW_MS) {
    return { ok: true, throttled: true };
  }
  _lastSent.set(tag, now);

  const icon = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🔵';
  const text = `${icon} <b>${escapeHtml(tag)}</b>\n${message}`;

  if (isDevMode()) {
    // Dev-mode short-circuit. Log at the requested level so the dev sees the
    // alert in the local pino stream (info/warn/error) without paging
    // Telegram. Trimmed to 200 chars to match the prior console output.
    const dev = log[level] ? log[level].bind(log) : log.info.bind(log);
    dev({ tag, devMode: true }, message.slice(0, 200));
    return { ok: true, dev: true };
  }

  try {
    return await postToTelegram(text);
  } catch (err) {
    // Belt-and-suspenders: postToTelegram already swallows everything.
    log.error({ err }, 'unexpected error in notifyAdmin');
    return { ok: false, error: err.message };
  }
}

/** Test-only: clear the in-memory throttle map. */
function _resetThrottle() {
  _lastSent.clear();
}

module.exports = { notifyAdmin, escapeHtml, _resetThrottle };
