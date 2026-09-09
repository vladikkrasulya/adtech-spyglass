'use strict';

/**
 * modules/dialects/handler.js — /api/dialects route module.
 *
 * Per-user dialects + their mappings.
 * Auth-gated; anonymous → 401. Hard deletes (no soft-delete).
 * IDs are INTEGER (matches users/partners/samples convention).
 *
 * Routes:
 *   GET    /api/dialects
 *   POST   /api/dialects
 *   PATCH  /api/dialects/:id
 *   DELETE /api/dialects/:id
 *   GET    /api/dialects/:id/mappings
 *   POST   /api/dialects/:id/mappings
 *   PATCH  /api/dialects/:id/mappings/:mapping_id
 *   DELETE /api/dialects/:id/mappings/:mapping_id
 *   GET    /api/dialects/:id/export
 *   POST   /api/dialects/import
 *
 * Wiring (in server.js):
 *   const { createDialectsModule } = require('./modules/dialects/handler');
 *   router.register(createDialectsModule({ auth, db }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');
const { clearCacheForDb } = require('../../packages/core/dialects/user-dialect-runtime');
const log = require('../../lib/logger').child('dialects');

// The one normative label enumeration lives in Core (016 FR-024, ADR-015):
// eleven pre-existing labels plus the nine storable role labels. This route
// used to declare its own array; importing keeps every surface in step.
const {
  STORABLE_LABELS,
  ROLE_LABELS,
} = require('../../packages/core/dialects/key-role-vocabulary');
const SEMANTIC_LABELS = new Set(STORABLE_LABELS);

const NAME_MAX = 80;
const SIGNAL_VALUE_MAX = 256;
const NOTES_MAX = 1000;
const PARAMS_MAX = 8000;
const SIGNAL_PATH_RX = /^[a-zA-Z_][a-zA-Z0-9_.[\]]*$/;

function createDialectsModule(deps) {
  const { auth, db } = deps;

  const stmts = {
    listDialects: db.prepare(`
      SELECT d.id, d.name, d.is_default, d.updated_at,
             (SELECT COUNT(*) FROM dialect_mappings m WHERE m.dialect_id = d.id) AS mapping_count
      FROM user_dialects d
      WHERE d.user_id = ?
      ORDER BY d.is_default DESC, d.updated_at DESC
    `),
    getDialect: db.prepare(
      `SELECT id, user_id, name, is_default, created_at, updated_at
       FROM user_dialects WHERE id = ?`,
    ),
    insertDialect: db.prepare(
      `INSERT INTO user_dialects (user_id, name, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    updateDialect: db.prepare(
      `UPDATE user_dialects SET name = ?, is_default = ?, updated_at = ? WHERE id = ?`,
    ),
    unsetDefaults: db.prepare(
      `UPDATE user_dialects SET is_default = 0, updated_at = ?
       WHERE user_id = ? AND is_default = 1`,
    ),
    deleteDialect: db.prepare(`DELETE FROM user_dialects WHERE id = ?`),
    listMappings: db.prepare(
      `SELECT id, signal_path, signal_value, semantic_label, shape_fingerprint, version,
              params, confidence, notes, created_at
       FROM dialect_mappings WHERE dialect_id = ?
       ORDER BY created_at DESC`,
    ),
    countMappings: db.prepare(`SELECT COUNT(*) AS n FROM dialect_mappings WHERE dialect_id = ?`),
    getMappingWithOwner: db.prepare(
      `SELECT m.*, d.user_id AS owner_user_id
       FROM dialect_mappings m
       JOIN user_dialects d ON m.dialect_id = d.id
       WHERE m.id = ?`,
    ),
    insertMapping: db.prepare(
      `INSERT INTO dialect_mappings
         (dialect_id, signal_path, signal_value, semantic_label,
          shape_fingerprint, params, version, confidence, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateMapping: db.prepare(
      `UPDATE dialect_mappings
       SET signal_path = ?, signal_value = ?, semantic_label = ?,
           shape_fingerprint = ?, params = ?, notes = ?, version = ?
       WHERE id = ?`,
    ),
    deleteMapping: db.prepare(`DELETE FROM dialect_mappings WHERE id = ?`),
    pathConflict: db.prepare(
      `SELECT id FROM dialect_mappings
       WHERE dialect_id = ? AND version = 2 AND signal_path = ? AND id != ? LIMIT 1`,
    ),
  };

  function requireUser(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      sendError(res, 401, 'unauthorized', 'Sign in to manage dialects');
      return null;
    }
    return user;
  }

  function parseIntId(s) {
    const n = Number(s);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function getOwnedDialect(dialectId, userId) {
    const d = stmts.getDialect.get(dialectId);
    if (!d || d.user_id !== userId) return null;
    return d;
  }

  function validateName(name) {
    if (typeof name !== 'string') return 'name_must_be_string';
    const t = name.trim();
    if (t.length === 0) return 'name_empty';
    if (t.length > NAME_MAX) return 'name_too_long';
    return null;
  }

  function validateMappingFields(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'mapping_invalid';
    if (typeof body.signal_path !== 'string' || !SIGNAL_PATH_RX.test(body.signal_path)) {
      return 'signal_path_invalid';
    }
    const scope = body.match_scope === undefined ? 'value' : body.match_scope;
    if (scope !== 'value' && scope !== 'path') return 'match_scope_invalid';
    if (body.version !== undefined && body.version !== (scope === 'path' ? 2 : 1)) {
      return 'mapping_version_invalid';
    }
    if (scope === 'path') {
      if (!ROLE_LABELS.includes(body.semantic_label)) return 'path_role_required';
      if (!/^(?:imp\[\d*\]\.ext|ext)(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d*\])+$/u.test(body.signal_path))
        return 'path_scope_invalid';
      if (body.signal_value !== undefined && body.signal_value !== '')
        return 'path_value_not_allowed';
    } else if (typeof body.signal_value !== 'string' || body.signal_value.length === 0) {
      return 'signal_value_required';
    }
    if (typeof body.signal_value === 'string' && body.signal_value.length > SIGNAL_VALUE_MAX)
      return 'signal_value_too_long';
    if (!SEMANTIC_LABELS.has(body.semantic_label)) return 'semantic_label_invalid';
    if (body.notes != null) {
      if (typeof body.notes !== 'string') return 'notes_must_be_string';
      if (body.notes.length > NOTES_MAX) return 'notes_too_long';
    }
    if (body.params != null) {
      if (typeof body.params !== 'object') return 'params_must_be_object';
      if (JSON.stringify(body.params).length > PARAMS_MAX) return 'params_too_large';
    }
    return null;
  }

  function canonicalMapping(body) {
    const pathScope = body.match_scope === 'path';
    return {
      ...body,
      version: pathScope ? 2 : 1,
      match_scope: pathScope ? 'path' : 'value',
      signal_path: pathScope ? body.signal_path.replace(/\[\d+\]/g, '[]') : body.signal_path,
      signal_value: pathScope ? '' : body.signal_value,
    };
  }

  function assertPathAvailable(dialectId, mapping, exceptId = 0) {
    if (mapping.version === 2 && stmts.pathConflict.get(dialectId, mapping.signal_path, exceptId)) {
      throw Object.assign(new Error('A field mapping already exists at this path'), {
        code: 'path_mapping_exists',
        status: 409,
      });
    }
  }

  function serializeMapping(row) {
    if (!row) return null;
    let params = null;
    if (row.params) {
      try {
        params = JSON.parse(row.params);
      } catch (_) {
        params = null;
      }
    }
    return {
      id: row.id,
      version: row.version,
      match_scope: row.version === 1 ? 'value' : row.version === 2 ? 'path' : 'unknown',
      signal_path: row.signal_path,
      signal_value: row.signal_value,
      semantic_label: row.semantic_label,
      shape_fingerprint: row.shape_fingerprint,
      params,
      confidence: row.confidence,
      notes: row.notes,
      created_at: row.created_at,
    };
  }

  // ── dialects CRUD ──

  function handleList(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    const rows = stmts.listDialects.all(user.id);
    sendJson(res, 200, { success: true, dialects: rows });
  }

  function handleCreate(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    return readJson(req)
      .then((body) => {
        const err = validateName(body.name);
        if (err) return sendError(res, 400, err, 'Invalid dialect name');
        const now = Date.now();
        const isDefault = body.is_default ? 1 : 0;
        let id;
        const tx = db.transaction(() => {
          if (isDefault) stmts.unsetDefaults.run(now, user.id);
          const r = stmts.insertDialect.run(user.id, body.name.trim(), isDefault, now, now);
          id = r.lastInsertRowid;
        });
        tx();
        sendJson(res, 200, {
          success: true,
          dialect: { id, name: body.name.trim(), is_default: !!isDefault, created_at: now },
        });
      })
      .catch((e) => {
        log.error({ err: e }, 'create dialect failed');
        sendError(res, 400, e.code || 'bad_request', e.message);
      });
  }

  function handleUpdate(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = parseIntId(match.params.id);
    if (id == null) return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    const d = getOwnedDialect(id, user.id);
    if (!d) return sendError(res, 404, 'not_found', 'Dialect not found');

    return readJson(req)
      .then((body) => {
        let name = d.name;
        let isDefault = d.is_default;
        if (body.name !== undefined) {
          const err = validateName(body.name);
          if (err) return sendError(res, 400, err, 'Invalid dialect name');
          name = body.name.trim();
        }
        if (body.is_default !== undefined) isDefault = body.is_default ? 1 : 0;
        const now = Date.now();
        const tx = db.transaction(() => {
          if (isDefault && !d.is_default) stmts.unsetDefaults.run(now, user.id);
          stmts.updateDialect.run(name, isDefault, now, d.id);
        });
        tx();
        sendJson(res, 200, {
          success: true,
          dialect: { id: d.id, name, is_default: !!isDefault, updated_at: now },
        });
      })
      .catch((e) => {
        log.error({ err: e }, 'update dialect failed');
        sendError(res, 400, e.code || 'bad_request', e.message);
      });
  }

  function handleDelete(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = parseIntId(match.params.id);
    if (id == null) return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    const d = getOwnedDialect(id, user.id);
    if (!d) return sendError(res, 404, 'not_found', 'Dialect not found');
    stmts.deleteDialect.run(d.id);
    clearCacheForDb(db, d.id);
    sendJson(res, 200, { success: true });
  }

  // ── mappings ──

  function handleListMappings(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = parseIntId(match.params.id);
    if (id == null) return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    const d = getOwnedDialect(id, user.id);
    if (!d) return sendError(res, 404, 'not_found', 'Dialect not found');
    const rows = stmts.listMappings.all(d.id).map(serializeMapping);
    sendJson(res, 200, { success: true, mappings: rows });
  }

  function handleCreateMapping(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = parseIntId(match.params.id);
    if (id == null) return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    const d = getOwnedDialect(id, user.id);
    if (!d) return sendError(res, 404, 'not_found', 'Dialect not found');

    return readJson(req)
      .then((body) => {
        const err = validateMappingFields(body);
        if (err) return sendError(res, 400, err, 'Invalid mapping');
        const mapping = canonicalMapping(body);
        const now = Date.now();
        const r = db.transaction(() => {
          assertPathAvailable(d.id, mapping);
          return stmts.insertMapping.run(
            d.id,
            mapping.signal_path,
            mapping.signal_value,
            mapping.semantic_label,
            mapping.shape_fingerprint || null,
            mapping.params ? JSON.stringify(mapping.params) : null,
            mapping.version,
            'user-confirmed',
            mapping.notes || null,
            now,
          );
        })();
        clearCacheForDb(db, d.id); // analyze must see the new mapping immediately, not after 60s TTL
        sendJson(res, 200, {
          success: true,
          mapping: serializeMapping({
            id: r.lastInsertRowid,
            ...mapping,
            shape_fingerprint: mapping.shape_fingerprint || null,
            params: mapping.params ? JSON.stringify(mapping.params) : null,
            confidence: 'user-confirmed',
            notes: mapping.notes || null,
            created_at: now,
          }),
        });
      })
      .catch((e) => {
        log.error({ err: e }, 'create mapping failed');
        sendError(res, e.status || 400, e.code || 'bad_request', e.message);
      });
  }

  function handleUpdateMapping(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const mid = parseIntId(match.params.mapping_id);
    if (mid == null) return sendError(res, 400, 'id_invalid', 'mapping_id invalid');
    const m = stmts.getMappingWithOwner.get(mid);
    if (!m) return sendError(res, 404, 'not_found', 'Mapping not found');
    if (m.owner_user_id !== user.id) return sendError(res, 403, 'forbidden', 'Not your mapping');
    if (m.dialect_id !== parseIntId(match.params.id))
      return sendError(res, 404, 'not_found', 'Mapping not found');
    if (m.version !== 1 && m.version !== 2)
      return sendError(res, 409, 'mapping_version_unsupported', 'Mapping version is not supported');

    return readJson(req)
      .then((body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return sendError(res, 400, 'mapping_invalid', 'Invalid mapping');
        const scope =
          body.match_scope === undefined ? (m.version === 2 ? 'path' : 'value') : body.match_scope;
        const merged = {
          match_scope: scope,
          ...(body.version !== undefined ? { version: body.version } : {}),
          signal_path: body.signal_path !== undefined ? body.signal_path : m.signal_path,
          signal_value:
            body.signal_value !== undefined
              ? body.signal_value
              : scope === 'path'
                ? ''
                : m.signal_value,
          semantic_label:
            body.semantic_label !== undefined ? body.semantic_label : m.semantic_label,
          shape_fingerprint:
            body.shape_fingerprint !== undefined ? body.shape_fingerprint : m.shape_fingerprint,
          params: body.params !== undefined ? body.params : m.params ? JSON.parse(m.params) : null,
          notes: body.notes !== undefined ? body.notes : m.notes,
        };
        const err = validateMappingFields(merged);
        if (err) return sendError(res, 400, err, 'Invalid mapping update');
        const mapping = canonicalMapping(merged);
        db.transaction(() => {
          assertPathAvailable(m.dialect_id, mapping, m.id);
          stmts.updateMapping.run(
            mapping.signal_path,
            mapping.signal_value,
            mapping.semantic_label,
            mapping.shape_fingerprint,
            mapping.params ? JSON.stringify(mapping.params) : null,
            mapping.notes,
            mapping.version,
            m.id,
          );
        })();
        clearCacheForDb(db, m.dialect_id); // invalidate cached mappings for this dialect
        const fresh = stmts.getMappingWithOwner.get(m.id);
        sendJson(res, 200, { success: true, mapping: serializeMapping(fresh) });
      })
      .catch((e) => {
        log.error({ err: e }, 'update mapping failed');
        sendError(res, e.status || 400, e.code || 'bad_request', e.message);
      });
  }

  function handleDeleteMapping(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const mid = parseIntId(match.params.mapping_id);
    if (mid == null) return sendError(res, 400, 'id_invalid', 'mapping_id invalid');
    const m = stmts.getMappingWithOwner.get(mid);
    if (!m) return sendError(res, 404, 'not_found', 'Mapping not found');
    if (m.owner_user_id !== user.id) return sendError(res, 403, 'forbidden', 'Not your mapping');
    if (m.dialect_id !== parseIntId(match.params.id))
      return sendError(res, 404, 'not_found', 'Mapping not found');
    stmts.deleteMapping.run(m.id);
    clearCacheForDb(db, m.dialect_id); // drop cached mappings so analyze stops using the deleted one
    sendJson(res, 200, { success: true });
  }

  // ── export / import ──

  function handleExport(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = parseIntId(match.params.id);
    if (id == null) return sendError(res, 400, 'id_invalid', 'id invalid');
    const d = getOwnedDialect(id, user.id);
    if (!d) return sendError(res, 404, 'not_found', 'Dialect not found');

    const rows = stmts.listMappings.all(d.id);
    if (rows.some((row) => row.version !== 1 && row.version !== 2)) {
      return sendError(
        res,
        409,
        'mapping_version_unsupported',
        'Cannot export an unsupported mapping version',
      );
    }
    const schemaVersion = rows.some((row) => row.version === 2) ? 2 : 1;
    const mappings = rows.map((row) => ({
      ...(schemaVersion === 2
        ? { version: row.version, match_scope: row.version === 2 ? 'path' : 'value' }
        : {}),
      signal_path: row.signal_path,
      signal_value: row.signal_value,
      semantic_label: row.semantic_label,
      shape_fingerprint: row.shape_fingerprint,
      params: row.params ? safeParse(row.params) : null,
      notes: row.notes,
    }));
    res.setHeader('Content-Disposition', `attachment; filename="dialect-${d.id}.json"`);
    sendJson(res, 200, {
      name: d.name,
      mappings,
      exported_at: Date.now(),
      schema_version: schemaVersion,
    });
  }

  function handleImport(req, res) {
    const user = requireUser(req, res);
    if (!user) return;

    return readJson(req)
      .then((body) => {
        if (!body || (body.schema_version !== 1 && body.schema_version !== 2)) {
          return sendError(
            res,
            400,
            'unsupported_schema_version',
            'Expected schema_version=1 or 2',
          );
        }
        const nameErr = validateName(body.name);
        if (nameErr) return sendError(res, 400, nameErr, 'Invalid dialect name in import');
        if (!Array.isArray(body.mappings)) {
          return sendError(res, 400, 'mappings_must_be_array', null);
        }
        const mappings = [];
        const pathIdentities = new Set();
        for (let i = 0; i < body.mappings.length; i += 1) {
          const raw = body.mappings[i];
          if (
            body.schema_version === 1 &&
            raw &&
            (raw.match_scope === 'path' || (raw.version !== undefined && raw.version !== 1))
          ) {
            return sendError(
              res,
              400,
              'mapping_version_invalid',
              'Field mappings require schema_version=2',
            );
          }
          if (
            body.schema_version === 2 &&
            (!raw || !['value', 'path'].includes(raw.match_scope) || raw.version === undefined)
          ) {
            return sendError(
              res,
              400,
              'mapping_version_invalid',
              'Schema 2 requires explicit mapping scope and version',
            );
          }
          const merr = validateMappingFields(raw);
          if (merr) return sendError(res, 400, merr, `Mapping at index ${i} is invalid`);
          const mapping = canonicalMapping(raw);
          if (mapping.version === 2) {
            if (pathIdentities.has(mapping.signal_path))
              return sendError(
                res,
                409,
                'path_mapping_exists',
                'Duplicate field mapping in import',
              );
            pathIdentities.add(mapping.signal_path);
          }
          mappings.push(mapping);
        }

        const now = Date.now();
        const importedName = (body.name.trim() + ' (imported)').slice(0, NAME_MAX);
        let newId;
        const tx = db.transaction(() => {
          const r = stmts.insertDialect.run(user.id, importedName, 0, now, now);
          newId = r.lastInsertRowid;
          for (const m of mappings) {
            stmts.insertMapping.run(
              newId,
              m.signal_path,
              m.signal_value,
              m.semantic_label,
              m.shape_fingerprint || null,
              m.params ? JSON.stringify(m.params) : null,
              m.version,
              'imported',
              m.notes || null,
              now,
            );
          }
        });
        tx();
        const n = stmts.countMappings.get(newId).n;
        sendJson(res, 200, {
          success: true,
          dialect: { id: newId, name: importedName, mapping_count: n },
        });
      })
      .catch((e) => {
        log.error({ err: e }, 'import dialect failed');
        sendError(res, 400, e.code || 'bad_request', e.message);
      });
  }

  function safeParse(s) {
    try {
      return JSON.parse(s);
    } catch (_) {
      return null;
    }
  }

  return {
    id: 'dialects',
    routes: [
      // Static paths BEFORE :id paths to avoid placeholder swallowing.
      { method: 'POST', path: '/api/dialects/import', handler: handleImport },

      { method: 'GET', path: '/api/dialects', handler: handleList },
      { method: 'POST', path: '/api/dialects', handler: handleCreate },
      { method: 'PATCH', path: '/api/dialects/:id', handler: handleUpdate },
      { method: 'DELETE', path: '/api/dialects/:id', handler: handleDelete },
      { method: 'GET', path: '/api/dialects/:id/mappings', handler: handleListMappings },
      { method: 'POST', path: '/api/dialects/:id/mappings', handler: handleCreateMapping },
      {
        method: 'PATCH',
        path: '/api/dialects/:id/mappings/:mapping_id',
        handler: handleUpdateMapping,
      },
      {
        method: 'DELETE',
        path: '/api/dialects/:id/mappings/:mapping_id',
        handler: handleDeleteMapping,
      },
      { method: 'GET', path: '/api/dialects/:id/export', handler: handleExport },
    ],
  };
}

module.exports = { createDialectsModule };
