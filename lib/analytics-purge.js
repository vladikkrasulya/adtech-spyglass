'use strict';

/**
 * lib/analytics-purge.js — best-effort erasure of one user's ClickHouse rows.
 *
 * Account deletion (POST /api/auth/delete-account) removes the SQLite side in
 * a single transaction. ClickHouse is a separate, optional store, so its
 * cleanup runs after the commit and can never fail the request.
 *
 * Tables that carry a `user_id` column:
 *   - analytics.ortbtools_events          operational request log (also holds IP)
 *   - analytics.ortbtools_product_events  anonymous product counters (user_id when signed in)
 * `analytics.validation_logs` has NO user_id (format/version/finding counts
 * only), so there is nothing to delete there.
 *
 * Uses the lightweight `DELETE FROM … WHERE user_id = N`. The id is an integer
 * validated here, never interpolated from a string. The database account needs
 * the ALTER DELETE privilege; without it the purge logs a warning and the rows
 * age out through their TTL (90 / 180 days).
 *
 * Race: events from the user's last seconds may still sit in the in-process
 * write buffers. The purge flushes those buffers and waits `settleMs` before
 * deleting so a late INSERT does not land after the DELETE.
 */

const TABLES = Object.freeze(['analytics.ortbtools_events', 'analytics.ortbtools_product_events']);
const DEFAULT_SETTLE_MS = 5000;
const DELETE_TIMEOUT_MS = 15000;

/**
 * @param {number} userId
 * @param {{
 *   chExec: (sql: string, opts?: {timeoutMs?: number}) => Promise<void>,
 *   isEnabled: () => boolean,
 *   logger?: { warn?: Function, info?: Function },
 *   flush?: Array<() => void>,
 *   settleMs?: number,
 * }} deps
 * @returns {Promise<{ attempted: boolean, tables: string[], failed: string[] }>}
 *   Never rejects.
 */
async function purgeUserAnalytics(userId, deps) {
  const { chExec, isEnabled, logger = {}, flush = [], settleMs = DEFAULT_SETTLE_MS } = deps;
  const result = { attempted: false, tables: [], failed: [] };
  try {
    if (!Number.isSafeInteger(userId) || userId <= 0) return result;
    if (!isEnabled()) {
      logger.info?.('ClickHouse not configured — nothing to purge for deleted account');
      return result;
    }
    result.attempted = true;
    for (const fn of flush) {
      try {
        fn();
      } catch (_e) {
        /* best-effort */
      }
    }
    if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs).unref?.());
    for (const table of TABLES) {
      try {
        await chExec(`DELETE FROM ${table} WHERE user_id = ${userId}`, {
          timeoutMs: DELETE_TIMEOUT_MS,
        });
        result.tables.push(table);
      } catch (err) {
        result.failed.push(table);
        logger.warn?.(
          { err: err && err.message, table },
          'ClickHouse purge for deleted account failed; rows expire via TTL',
        );
      }
    }
  } catch (err) {
    logger.warn?.({ err: err && err.message }, 'ClickHouse purge for deleted account failed');
  }
  return result;
}

module.exports = { purgeUserAnalytics, TABLES };
