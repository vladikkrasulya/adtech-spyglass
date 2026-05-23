'use strict';

/**
 * modules/stream/handler.js — GET /api/v1/stream + GET /api/v1/specimen/:hash
 *
 * Public RTB observability feed (Phase 1 Step 1.2). Long-lived SSE connection:
 * server emits one synthetic specimen per cadence tick (~1Hz) until the
 * client disconnects, with a 15s heartbeat comment to keep CF/nginx from
 * killing idle streams.
 *
 * Stage 2 additions:
 *   - Each emitted envelope gets a deterministic sha1[0..8] hash of the
 *     canonical specimen JSON. Same specimen content → same hash (de-dup).
 *   - Hash → envelope stored in specimenStore Map (FIFO, capped at 1000).
 *   - GET /api/v1/specimen/:hash — returns cached envelope or 404.
 *     Cache-Control: public, max-age=3600 (content-hashed, safe to cache).
 */

const crypto = require('crypto');

/** SQLite-backed specimen cache (Step 2 — persistence).
 *  Survives container restarts so /r/{hash} permalinks remain resolvable.
 *  Lazy-initialized by createStreamModule when db is passed; reads are
 *  no-ops until then (returning null). */
const MAX_SPECIMEN_STORE = 10000;

let _putStmt = null;
let _getStmt = null;
let _countStmt = null;
let _evictStmt = null;

function initSpecimenStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cached_specimens (
      hash TEXT PRIMARY KEY,
      envelope_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_specimens_created_at
      ON cached_specimens(created_at);
  `);
  _putStmt = db.prepare(
    'INSERT OR REPLACE INTO cached_specimens (hash, envelope_json, created_at) VALUES (?, ?, ?)',
  );
  _getStmt = db.prepare('SELECT envelope_json FROM cached_specimens WHERE hash = ?');
  _countStmt = db.prepare('SELECT COUNT(*) AS n FROM cached_specimens');
  // Bulk FIFO eviction: drop the oldest ~10% in one go when over cap.
  _evictStmt = db.prepare(`
    DELETE FROM cached_specimens
    WHERE hash IN (
      SELECT hash FROM cached_specimens
      ORDER BY created_at ASC
      LIMIT ?
    )
  `);
}

function specimenHash(specimen) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(specimen))
    .digest('hex')
    .slice(0, 8);
}

function specimenStorePut(hash, envelope) {
  if (!_putStmt) return; // not initialized — fail-open, no caching
  _putStmt.run(hash, JSON.stringify(envelope), Date.now());
  const { n } = _countStmt.get();
  if (n > MAX_SPECIMEN_STORE) {
    _evictStmt.run(Math.ceil(MAX_SPECIMEN_STORE * 0.1));
  }
}

function specimenStoreGet(hash) {
  if (!_getStmt) return null;
  const row = _getStmt.get(hash);
  return row ? JSON.parse(row.envelope_json) : null;
}

/**
 * @param {{
 *   streamGenerator: import('events').EventEmitter,
 *   streamBuffer: Array<unknown>,
 *   STREAM_REPLAY_MAX: number,
 *   STREAM_HEARTBEAT_MS: number,
 * }} deps
 */
function createStreamModule(deps) {
  const { streamGenerator, streamBuffer, STREAM_REPLAY_MAX, STREAM_HEARTBEAT_MS, db } = deps;
  if (db) initSpecimenStore(db);

  function handleStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      // Nginx/CF buffering would batch SSE frames and break realtime. Disable.
      'X-Accel-Buffering': 'no',
    });
    res.write(': ok\n\n'); // initial comment flushes headers, opens stream

    // Replay last N for context. Snapshot via slice — avoids race if buffer
    // mutates mid-iteration.
    const replay = streamBuffer.slice(-STREAM_REPLAY_MAX);
    for (const envelope of replay) {
      res.write('data: ' + JSON.stringify(envelope) + '\n\n');
    }

    const onSpecimen = (envelope) => {
      res.write('data: ' + JSON.stringify(envelope) + '\n\n');
    };
    streamGenerator.on('specimen', onSpecimen);

    const heartbeat = setInterval(() => res.write(': hb\n\n'), STREAM_HEARTBEAT_MS);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      streamGenerator.off('specimen', onSpecimen);
      clearInterval(heartbeat);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  // Handler for GET /api/v1/specimen/:hash
  // match.params.hash is provided by the router.
  function handleSpecimen(req, res, _parsed, match) {
    const hash = (match && match.params && match.params.hash) || '';
    if (!hash || !/^[0-9a-f]{8,12}$/i.test(hash)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'invalid hash format' }));
      return;
    }
    const envelope = specimenStoreGet(hash);
    if (!envelope) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'specimen not found' }));
      return;
    }
    const body = Buffer.from(JSON.stringify({ success: true, ...envelope }));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': body.length,
    });
    res.end(body);
  }

  return {
    id: 'stream',
    routes: [
      { method: 'GET', path: '/api/v1/stream', handler: handleStream },
      { method: 'GET', path: '/api/v1/specimen/:hash', handler: handleSpecimen },
    ],
  };
}

/** Called by server.js streamBufferPush — attaches hash field + stores envelope. */
function enrichAndStore(envelope) {
  const hash = specimenHash(envelope.specimen);
  envelope.hash = hash;
  specimenStorePut(hash, envelope);
  return envelope;
}

module.exports = { createStreamModule, enrichAndStore };
