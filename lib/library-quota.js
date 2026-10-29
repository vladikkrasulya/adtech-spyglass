'use strict';

/**
 * lib/library-quota.js — per-user caps on what the signed-in library may store.
 *
 * Why this exists: registration is open and needs no email confirmation, and
 * every library write accepted a body of up to 2 MiB with no per-user ceiling
 * and no write limiter. One throw-away account could fill the disk that also
 * holds the SQLite account database (~40 MB per second measured locally), and
 * the whole site fails when SQLite cannot write.
 *
 * Two independent controls, both off the hot path of a normal session:
 *   1. Row/byte caps per user (this module). A generous multiple of any real
 *      library; the defaults are overridable per deployment via env.
 *   2. A per-user write rate limiter (`writeRateLimited`) wired in server.js.
 *
 * The caps are checked inside the model methods (db.js) and the dialect
 * handler, so every caller is covered, and fail with a coded 413
 * (`quota_exceeded`) the UI can show.
 */

const { sendError } = require('./http');

const MIB = 1024 * 1024;

/** @param {string} name @param {number} fallback */
function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read on every call so a deployment (or a test) can change them without a reload. */
function limits() {
  return {
    samples: intEnv('ORTBTOOLS_LIBRARY_MAX_SAMPLES', 2000),
    corpus: intEnv('ORTBTOOLS_LIBRARY_MAX_CORPUS', 2000),
    partners: intEnv('ORTBTOOLS_LIBRARY_MAX_PARTNERS', 500),
    dialects: intEnv('ORTBTOOLS_LIBRARY_MAX_DIALECTS', 200),
    mappings: intEnv('ORTBTOOLS_LIBRARY_MAX_MAPPINGS', 10000),
    bytes: intEnv('ORTBTOOLS_LIBRARY_MAX_BYTES', 100 * MIB),
  };
}

const COUNT_SQL = {
  samples: 'SELECT COUNT(*) AS n FROM samples WHERE user_id = ?',
  corpus: 'SELECT COUNT(*) AS n FROM behavior_corpus WHERE user_id = ?',
  partners: 'SELECT COUNT(*) AS n FROM partners WHERE user_id = ?',
  dialects: 'SELECT COUNT(*) AS n FROM user_dialects WHERE user_id = ?',
  mappings:
    'SELECT COUNT(*) AS n FROM dialect_mappings m JOIN user_dialects d ON d.id = m.dialect_id WHERE d.user_id = ?',
};

// Characters, not bytes: close enough for a ceiling, and it needs no row scan
// beyond the user's own rows (idx_samples_user / idx_corpus_user).
const BYTES_SQL = `SELECT
  (SELECT COALESCE(SUM(length(coalesce(bid_req, '')) + length(coalesce(bid_res, ''))
                       + length(coalesce(title, '')) + length(coalesce(notes, ''))), 0)
     FROM samples WHERE user_id = ?)
  +
  (SELECT COALESCE(SUM(length(coalesce(events_json, '')) + length(coalesce(notes, ''))), 0)
     FROM behavior_corpus WHERE user_id = ?) AS n`;

/**
 * @param {string} resource
 * @param {number} limit
 */
function quotaError(resource, limit) {
  return Object.assign(
    new Error(`Library limit reached: at most ${limit} ${resource} per account`),
    { code: 'quota_exceeded', status: 413, resource },
  );
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function createLibraryQuota(db) {
  /** @type {Map<string, import('better-sqlite3').Statement>} */
  const prepared = new Map();
  const stmt = (sql) => {
    let s = prepared.get(sql);
    if (!s) {
      s = db.prepare(sql);
      prepared.set(sql, s);
    }
    return s;
  };

  /**
   * Throw `quota_exceeded` when adding `rows` rows of `resource`, or `bytes`
   * more characters of sample/corpus content, would pass the account's cap.
   *
   * @param {number} userId
   * @param {'samples'|'corpus'|'partners'|'dialects'|'mappings'} resource
   * @param {{ rows?: number, bytes?: number }} [add]
   */
  function assertCanAdd(userId, resource, add = {}) {
    const { rows = 1, bytes = 0 } = add;
    const cap = limits();
    if (rows > 0) {
      const have = /** @type {{n: number}} */ (stmt(COUNT_SQL[resource]).get(userId)).n;
      if (have + rows > cap[resource]) throw quotaError(resource, cap[resource]);
    }
    if (bytes > 0) {
      const used = /** @type {{n: number}} */ (stmt(BYTES_SQL).get(userId, userId)).n;
      if (used + bytes > cap.bytes) throw quotaError('bytes of saved content', cap.bytes);
    }
  }

  return { assertCanAdd };
}

/**
 * Answer 429 and return true when this user is writing too fast. The limiter
 * is optional so unit tests can build a module without one.
 *
 * @param {((key: string) => boolean) | undefined} limiter
 * @param {{ id: number }} user
 * @param {any} res
 */
function writeRateLimited(limiter, user, res) {
  if (!limiter || limiter(String(user.id))) return false;
  sendError(res, 429, 'rate_limited', 'Too many library changes. Try again shortly.');
  return true;
}

module.exports = { createLibraryQuota, writeRateLimited, limits, quotaError };
