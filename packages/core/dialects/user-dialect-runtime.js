'use strict';

/**
 * Runtime loader for per-user saved dialects. Conforms to the existing
 * dialect interface `{name, validateRequest, validateResponse}` so the
 * static DIALECTS registry in packages/core/index.js can dispatch to it
 * via `'user:<dialect_id>'` lookup.
 *
 * IDs are INTEGER (matching the rest of the Spyglass schema: users.id,
 * partners.id, samples.id are all INTEGER PRIMARY KEY AUTOINCREMENT).
 */

const TTL_MS = 60 * 1000;

// Per-db cache: WeakMap so closed databases get GC'd. Inner Map keyed
// by dialectId (number) holds `{dialect, expiresAt}`.
const dbCache = new WeakMap();

/**
 * @param {object} db        - better-sqlite3 database instance
 * @param {number} dialectId - INTEGER PK of the dialect to load
 * @param {object} [opts]    - { skipCache?: boolean }
 */
function loadUserDialect(db, dialectId, opts) {
  const skipCache = !!(opts && opts.skipCache);
  const now = Date.now();

  if (!skipCache) {
    const inner = dbCache.get(db);
    if (inner) {
      const hit = inner.get(dialectId);
      if (hit && hit.expiresAt > now) return hit.dialect;
    }
  }

  const meta = db.prepare('SELECT name FROM user_dialects WHERE id = ?').get(dialectId);
  if (!meta) throw new Error(`dialect_not_found:${dialectId}`);

  const rows = db
    .prepare(
      `SELECT signal_path, signal_value, semantic_label, shape_fingerprint, params
       FROM dialect_mappings
       WHERE dialect_id = ?`
    )
    .all(dialectId);

  const lookupMap = new Map();
  for (const row of rows) {
    lookupMap.set(`${row.signal_path}::${row.signal_value}`, row);
  }

  const dialect = {
    name: `user:${dialectId}`,
    validateRequest: () => [],
    validateResponse: () => [],

    shouldSuppress(finding) {
      if (!finding || !finding.path) return false;
      const value = extractValue(finding);
      if (value === undefined) return false;
      const mapping = lookupMap.get(`${finding.path}::${stringifyValue(value)}`);
      if (!mapping) return false;
      if (finding.level === 'question') return true;
      return mapping.semantic_label === 'ignore' || mapping.semantic_label === 'informational';
    },

    lookupMapping(path, value) {
      return lookupMap.get(`${path}::${stringifyValue(value)}`) || null;
    },
  };

  let inner = dbCache.get(db);
  if (!inner) {
    inner = new Map();
    dbCache.set(db, inner);
  }
  inner.set(dialectId, { dialect, expiresAt: now + TTL_MS });
  return dialect;
}

/**
 * @param {object} db
 * @param {number} userId
 * @returns {number|null} dialect id (INTEGER) or null
 */
function getDefaultDialectForUser(db, userId) {
  const row = db
    .prepare('SELECT id FROM user_dialects WHERE user_id = ? AND is_default = 1 LIMIT 1')
    .get(userId);
  return row ? row.id : null;
}

/**
 * Targeted cache invalidation. Call after any mutation to a dialect or
 * its mappings so the next validation request picks up the change.
 */
function clearCacheForDb(db, dialectId) {
  const inner = dbCache.get(db);
  if (inner) inner.delete(dialectId);
}

function extractValue(finding) {
  if (!finding.params) return undefined;
  if ('value' in finding.params) return finding.params.value;
  return undefined;
}

function stringifyValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

module.exports = {
  loadUserDialect,
  getDefaultDialectForUser,
  clearCacheForDb,
};
