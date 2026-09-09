'use strict';

/**
 * Runtime loader for per-user saved dialects. Conforms to the existing
 * dialect interface `{name, validateRequest, validateResponse}` so the
 * static DIALECTS registry in packages/core/index.js can dispatch to it
 * via `'user:<dialect_id>'` lookup.
 *
 * IDs are INTEGER (matching the rest of the ortbtools schema: users.id,
 * partners.id, samples.id are all INTEGER PRIMARY KEY AUTOINCREMENT).
 */

const TTL_MS = 60 * 1000;
const { ROLE_LABELS } = require('./key-role-vocabulary');

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
      `SELECT id, signal_path, signal_value, semantic_label, shape_fingerprint, params, version
       FROM dialect_mappings
       WHERE dialect_id = ?`,
    )
    .all(dialectId);

  const lookupMap = new Map();
  const pathMap = new Map();
  for (const row of rows) {
    if (row.version === 1) lookupMap.set(`${row.signal_path}::${row.signal_value}`, row);
    else if (
      row.version === 2 &&
      row.signal_value === '' &&
      ROLE_LABELS.includes(row.semantic_label) &&
      /^(?:imp\[\]\.ext|ext)(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\])*$/u.test(row.signal_path)
    ) {
      const existing = pathMap.get(row.signal_path);
      // API rejects duplicates. A malformed legacy/imported database still
      // resolves deterministically instead of depending on query order.
      if (!existing || row.id < existing.id)
        pathMap.set(row.signal_path, { ...row, match_scope: 'path' });
    }
  }

  function lookupMapping(path, value) {
    const normalized = String(path).replace(/\[\d+\]/g, '[]');
    const serialized = stringifyValue(value);
    return (
      lookupMap.get(`${path}::${serialized}`) ||
      lookupMap.get(`${normalized}::${serialized}`) ||
      pathMap.get(normalized) ||
      null
    );
  }

  const dialect = {
    name: `user:${dialectId}`,
    validateRequest: () => [],
    validateResponse: () => [],

    shouldSuppress(finding) {
      if (!finding || !finding.path) return false;
      const value = extractValue(finding);
      if (value === undefined) return false;
      const mapping = lookupMapping(finding.path, value);
      if (!mapping) return false;
      if (mapping.match_scope === 'path')
        return (
          finding.level === 'question' && finding.id === 'dialects.question.unknown_ext_signal'
        );
      if (finding.level === 'question') return true;
      return mapping.semantic_label === 'ignore' || mapping.semantic_label === 'informational';
    },

    lookupMapping,
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
