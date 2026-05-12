'use strict';

/**
 * modules/dialects/handler.js — /api/dialects route module.
 *
 * Per-user dialects + their mappings + a question-dismissal log.
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
 *   POST   /api/dialects/questions/dismiss
 *
 * Wiring (in server.js):
 *   const { createDialectsModule } = require('./modules/dialects/handler');
 *   router.register(createDialectsModule({ auth, db }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');
const log = require('../../lib/logger').child('dialects');

const SEMANTIC_LABELS = new Set([
  'pop', 'native', 'banner', 'video', 'audio',
  'in-page-push', 'push', 'interstitial-banner',
  'ignore', 'informational', 'custom',
]);

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
       FROM user_dialects WHERE id = ?`
    ),
    insertDialect: db.prepare(
      `INSERT INTO user_dialects (user_id, name, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ),
    updateDialect: db.prepare(
      `UPDATE user_dialects SET name = ?, is_default = ?, updated_at = ? WHERE id = ?`
    ),
    unsetDefaults: db.prepare(
      `UPDATE user_dialects SET is_default = 0, updated_at = ?
       WHERE user_id = ? AND is_default = 1`
    ),
    deleteDialect: db.prepare(`DELETE FROM user_dialects WHERE id = ?`),
    listMappings: db.prepare(
      `SELECT id, signal_path, signal_value, semantic_label, shape_fingerprint,
              params, confidence, notes, created_at
       FROM dialect_mappings WHERE dialect_id = ?
       ORDER BY created_at DESC`
    ),
    countMappings: db.prepare(
      `SELECT COUNT(*) AS n FROM dialect_mappings WHERE dialect_id = ?`
    ),
    getMappingWithOwner: db.prepare(
      `SELECT m.*, d.user_id AS owner_user_id
       FROM dialect_mappings m
       JOIN user_dialects d ON m.dialect_id = d.id
       WHERE m.id = ?`
    ),
    insertMapping: db.prepare(
      `INSERT INTO dialect_mappings
         (dialect_id, signal_path, signal_value, semantic_label,
          shape_fingerprint, params, version, confidence, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ),
    updateMapping: db.prepare(
      `UPDATE dialect_mappings
       SET signal_path = ?, signal_value = ?, semantic_label = ?,
           shape_fingerprint = ?, params = ?, notes = ?
       WHERE id = ?`
    ),
    deleteMapping: db.prepare(`DELETE FROM dialect_mappings WHERE id = ?`),
    insertQuestionLog: db.prepare(
      `INSERT INTO dialect_question_log
         (dialect_id, user_id, signal_path, signal_value, payload_shape_sig, asked_at, action)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
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
    if (typeof body.signal_path !== 'string' || !SIGNAL_PATH_RX.test(body.signal_path)) {
      return 'signal_path_invalid';
    }
    if (typeof body.signal_value !== 'string' || body.signal_value.length === 0) {
      return 'signal_value_required';
    }
    if (body.signal_value.length > SIGNAL_VALUE_MAX) return 'signal_value_too_long';
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

  function serializeMapping(row) {
    if (!row) return null;
    let params = null;
    if (row.params) {
      try { params = JSON.parse(row.params); } catch (_) { params = null; }
    }
    return {
      id: row.id,
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
        const now = Date.now();
        const r = stmts.insertMapping.run(
          d.id, body.signal_path, body.signal_value, body.semantic_label,
          body.shape_fingerprint || null,
          body.params ? JSON.stringify(body.params) : null,
          'user-confirmed',
          body.notes || null, now
        );
        sendJson(res, 200, {
          success: true,
          mapping: serializeMapping({
            id: r.lastInsertRowid,
            signal_path: body.signal_path,
            signal_value: body.signal_value,
            semantic_label: body.semantic_label,
            shape_fingerprint: body.shape_fingerprint || null,
            params: body.params ? JSON.stringify(body.params) : null,
            confidence: 'user-confirmed',
            notes: body.notes || null,
            created_at: now,
          }),
        });
      })
      .catch((e) => {
        log.error({ err: e }, 'create mapping failed');
        sendError(res, 400, e.code || 'bad_request', e.message);
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

    return readJson(req)
      .then((body) => {
        const merged = {
          signal_path: body.signal_path !== undefined ? body.signal_path : m.signal_path,
          signal_value: body.signal_value !== undefined ? body.signal_value : m.signal_value,
          semantic_label: body.semantic_label !== undefined ? body.semantic_label : m.semantic_label,
          shape_fingerprint: body.shape_fingerprint !== undefined ? body.shape_fingerprint : m.shape_fingerprint,
          params: body.params !== undefined ? body.params : (m.params ? JSON.parse(m.params) : null),
          notes: body.notes !== undefined ? body.notes : m.notes,
        };
        const err = validateMappingFields(merged);
        if (err) return sendError(res, 400, err, 'Invalid mapping update');
        stmts.updateMapping.run(
          merged.signal_path, merged.signal_value, merged.semantic_label,
          merged.shape_fingerprint,
          merged.params ? JSON.stringify(merged.params) : null,
          merged.notes, m.id
        );
        const fresh = stmts.getMappingWithOwner.get(m.id);
        sendJson(res, 200, { success: true, mapping: serializeMapping(fresh) });
      })
      .catch((e) => {
        log.error({ err: e }, 'update mapping failed');
        sendError(res, 400, e.code || 'bad_request', e.message);
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
    stmts.deleteMapping.run(m.id);
    sendJson(res, 200, { success: true });
  }

  // ── export / import / dismiss ──

  function handleExport(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = parseIntId(match.params.id);
    if (id == null) return sendError(res, 400, 'id_invalid', 'id invalid');
    const d = getOwnedDialect(id, user.id);
    if (!d) return sendError(res, 404, 'not_found', 'Dialect not found');

    const mappings = stmts.listMappings.all(d.id).map((row) => ({
      signal_path: row.signal_path,
      signal_value: row.signal_value,
      semantic_label: row.semantic_label,
      shape_fingerprint: row.shape_fingerprint,
      params: row.params ? safeParse(row.params) : null,
      notes: row.notes,
    }));
    res.setHeader('Content-Disposition', `attachment; filename="dialect-${d.id}.json"`);
    sendJson(res, 200, {
      name: d.name, mappings, exported_at: Date.now(), schema_version: 1,
    });
  }

  function handleImport(req, res) {
    const user = requireUser(req, res);
    if (!user) return;

    return readJson(req)
      .then((body) => {
        if (body.schema_version !== 1) {
          return sendError(res, 400, 'unsupported_schema_version', 'Expected schema_version=1');
        }
        const nameErr = validateName(body.name);
        if (nameErr) return sendError(res, 400, nameErr, 'Invalid dialect name in import');
        if (!Array.isArray(body.mappings)) {
          return sendError(res, 400, 'mappings_must_be_array', null);
        }
        for (let i = 0; i < body.mappings.length; i += 1) {
          const merr = validateMappingFields(body.mappings[i]);
          if (merr) return sendError(res, 400, merr, `Mapping at index ${i} is invalid`);
        }

        const now = Date.now();
        const importedName = (body.name.trim() + ' (imported)').slice(0, NAME_MAX);
        let newId;
        const tx = db.transaction(() => {
          const r = stmts.insertDialect.run(user.id, importedName, 0, now, now);
          newId = r.lastInsertRowid;
          for (const m of body.mappings) {
            stmts.insertMapping.run(
              newId, m.signal_path, m.signal_value, m.semantic_label,
              m.shape_fingerprint || null,
              m.params ? JSON.stringify(m.params) : null,
              'imported', m.notes || null, now
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

  function handleDismissQuestion(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    return readJson(req)
      .then((body) => {
        if (typeof body.signal_path !== 'string' || typeof body.signal_value !== 'string') {
          return sendError(res, 400, 'invalid_input', 'signal_path & signal_value required');
        }
        if (typeof body.payload_shape_sig !== 'string') {
          return sendError(res, 400, 'invalid_input', 'payload_shape_sig required');
        }
        if (body.action !== 'dismissed_once' && body.action !== 'dismissed_forever') {
          return sendError(res, 400, 'invalid_input', "action must be 'dismissed_once' or 'dismissed_forever'");
        }
        stmts.insertQuestionLog.run(
          null, user.id, body.signal_path, body.signal_value,
          body.payload_shape_sig, Date.now(), body.action
        );
        sendJson(res, 200, { success: true });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  function safeParse(s) {
    try { return JSON.parse(s); } catch (_) { return null; }
  }

  return {
    id: 'dialects',
    routes: [
      // Static paths BEFORE :id paths to avoid placeholder swallowing.
      { method: 'POST',   path: '/api/dialects/import',                          handler: handleImport },
      { method: 'POST',   path: '/api/dialects/questions/dismiss',               handler: handleDismissQuestion },

      { method: 'GET',    path: '/api/dialects',                                 handler: handleList },
      { method: 'POST',   path: '/api/dialects',                                 handler: handleCreate },
      { method: 'PATCH',  path: '/api/dialects/:id',                             handler: handleUpdate },
      { method: 'DELETE', path: '/api/dialects/:id',                             handler: handleDelete },
      { method: 'GET',    path: '/api/dialects/:id/mappings',                    handler: handleListMappings },
      { method: 'POST',   path: '/api/dialects/:id/mappings',                    handler: handleCreateMapping },
      { method: 'PATCH',  path: '/api/dialects/:id/mappings/:mapping_id',        handler: handleUpdateMapping },
      { method: 'DELETE', path: '/api/dialects/:id/mappings/:mapping_id',        handler: handleDeleteMapping },
      { method: 'GET',    path: '/api/dialects/:id/export',                      handler: handleExport },
    ],
  };
}

module.exports = { createDialectsModule };
