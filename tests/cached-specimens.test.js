'use strict';

/**
 * tests/cached-specimens.test.js — modules/stream/handler.js specimen cache
 *
 * Regression coverage for the SQLite-backed cached_specimens store:
 *   - init + store + read via enrichAndStore / specimenStoreGet
 *   - persistence across DB close + reopen
 *   - FIFO eviction when over MAX_SPECIMEN_STORE (oldest ~10% dropped)
 *
 * Uses a temp DB file only — never touches production data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { EventEmitter } = require('events');

const {
  createStreamModule,
  enrichAndStore,
  initSpecimenStore,
  specimenStoreGet,
} = require('../modules/stream/handler');

const MAX_SPECIMEN_STORE = 10000;

function makeEnvelope(specimen) {
  return { specimen, meta: { source: 'test' } };
}

function openDb(dbPath) {
  const db = new Database(dbPath);
  initSpecimenStore(db);
  return db;
}

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyglass-specimens-'));
  return { dir, dbPath: path.join(dir, 'specimens.db') };
}

function wireModule(db) {
  const gen = /** @type {any} */ (new EventEmitter());
  gen.start = () => gen;
  gen.stop = () => gen;
  return createStreamModule({
    streamGenerator: gen,
    streamBuffer: [],
    STREAM_REPLAY_MAX: 0,
    STREAM_HEARTBEAT_MS: 1_000_000,
    db,
  });
}

test('cached_specimens: init, store, and read round-trip', () => {
  const { dir, dbPath } = makeTempDbPath();
  try {
    const db = openDb(dbPath);
    wireModule(db);
    const specimen = { id: 's1', imp: [{ id: '1', banner: { w: 300, h: 250 } }] };
    const envelope = enrichAndStore(makeEnvelope(specimen));
    assert.match(envelope.hash, /^[0-9a-f]{8}$/);
    const got = specimenStoreGet(envelope.hash);
    assert.deepEqual(got.specimen, specimen);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cached_specimens: persists after DB reopen', () => {
  const { dir, dbPath } = makeTempDbPath();
  try {
    let db = openDb(dbPath);
    wireModule(db);
    const specimen = { id: 'persist', imp: [{ id: '1', banner: { w: 728, h: 90 } }] };
    const { hash } = enrichAndStore(makeEnvelope(specimen));
    db.close();

    db = openDb(dbPath);
    wireModule(db);
    const got = specimenStoreGet(hash);
    assert.ok(got, 'specimen survives reopen');
    assert.deepEqual(got.specimen, specimen);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cached_specimens: FIFO eviction drops oldest rows over cap', () => {
  const { dir, dbPath } = makeTempDbPath();
  try {
    const db = openDb(dbPath);
    wireModule(db);
    const insert = db.prepare(
      'INSERT INTO cached_specimens (hash, envelope_json, created_at) VALUES (?, ?, ?)',
    );
    db.transaction(() => {
      for (let i = 0; i < MAX_SPECIMEN_STORE; i++) {
        const hash = `h${String(i).padStart(7, '0')}`;
        insert.run(hash, JSON.stringify(makeEnvelope({ id: hash })), i);
      }
    })();

    enrichAndStore(makeEnvelope({ id: 'overflow' }));

    const { n } = db.prepare('SELECT COUNT(*) AS n FROM cached_specimens').get();
    assert.equal(n, MAX_SPECIMEN_STORE - Math.ceil(MAX_SPECIMEN_STORE * 0.1) + 1);

    assert.equal(specimenStoreGet('h0000000'), null, 'oldest row evicted');
    assert.ok(specimenStoreGet('h0001000'), 'first row after eviction window remains');

    const overflow = [
      ...db.prepare('SELECT hash FROM cached_specimens ORDER BY created_at DESC LIMIT 1').iterate(),
    ].map((r) => r.hash);
    assert.equal(overflow.length, 1);
    assert.ok(specimenStoreGet(overflow[0]), 'newest inserted specimen readable');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
