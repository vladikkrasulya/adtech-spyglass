/* ============================================================
   public/modules/intel/storage.js — IndexedDB wrapper for Discovery.

   Phase 7a foundation. Two object stores:
     - field_observations
         keyPath: 'key'   (format: '{bucket}::{path}')
         fields:  bucket, path, type, valueShape, count,
                  firstSeenAt, lastSeenAt, decayedScore
     - discovery_meta
         keyPath: 'name'  (singleton-ish records, e.g. 'config')
         fields:  name, value (free-form)

   Why IndexedDB and not localStorage:
     - localStorage caps at ~5 MB and synchronous (blocks the main
       thread). field_observations grows unbounded with stream usage,
       and we don't want analyze() to ever block on storage.
     - IndexedDB is async + structured + supports indexed lookups
       (we'll use the bucket index in Phase 7b to filter banner
       summaries per traffic-class).

   The wrapper exposes Promise-returning helpers so the observer in
   `observer.js` can `await` them without callback nesting. All errors
   are caught and surfaced to console (best-effort persistence — never
   block analyze on an IDB hiccup).

   Schema migration: bumping DB_VERSION triggers onupgradeneeded.
   Phase 7b will add `co_occurrence` + `candidate_dialects` stores.
   ============================================================ */
(function () {
  'use strict';

  if (window.SpyglassIntelStorage) return;

  const DB_NAME = 'spyglass_intel_v1';
  const DB_VERSION = 3; // 7c: + intel_llm_cache
  const STORE_OBSERVATIONS = 'field_observations';
  const STORE_META = 'discovery_meta';
  const STORE_COOCCURRENCE = 'co_occurrence';
  const STORE_TEMP_DIALECTS = 'temporary_dialects';
  const STORE_LLM_CACHE = 'intel_llm_cache';

  let _dbPromise = null;

  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_OBSERVATIONS)) {
          const os = db.createObjectStore(STORE_OBSERVATIONS, { keyPath: 'key' });
          os.createIndex('bucket', 'bucket', { unique: false });
          os.createIndex('path', 'path', { unique: false });
          os.createIndex('lastSeenAt', 'lastSeenAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'name' });
        }
        // Phase 7b stores. Schema upgrade is additive; no data
        // migration needed for existing 7a databases.
        if (!db.objectStoreNames.contains(STORE_COOCCURRENCE)) {
          const os = db.createObjectStore(STORE_COOCCURRENCE, { keyPath: 'key' });
          os.createIndex('bucket', 'bucket', { unique: false });
          os.createIndex('lastSeenAt', 'lastSeenAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_TEMP_DIALECTS)) {
          db.createObjectStore(STORE_TEMP_DIALECTS, { keyPath: 'id' });
        }
        // Phase 7c: LLM-suggestion cache. Keyed by deterministic hash
        // of (kind + path + bucket) so the same field never burns a
        // second LLM call within the TTL window. expiresAt index lets
        // future cleanup pass evict expired rows in one cursor scan.
        if (!db.objectStoreNames.contains(STORE_LLM_CACHE)) {
          const os = db.createObjectStore(STORE_LLM_CACHE, { keyPath: 'key' });
          os.createIndex('expiresAt', 'expiresAt', { unique: false });
          os.createIndex('kind', 'kind', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB blocked — close other ortbtools tabs'));
    });
    // Defensive: on any rejection, drop the cached promise so the next
    // call retries instead of locking us into a permanent failure.
    _dbPromise.catch(() => {
      _dbPromise = null;
    });
    return _dbPromise;
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getObservation(key) {
    const db = await openDb();
    const tx = db.transaction(STORE_OBSERVATIONS, 'readonly');
    return promisify(tx.objectStore(STORE_OBSERVATIONS).get(key));
  }

  async function putObservation(record) {
    const db = await openDb();
    const tx = db.transaction(STORE_OBSERVATIONS, 'readwrite');
    return promisify(tx.objectStore(STORE_OBSERVATIONS).put(record));
  }

  async function listObservations(opts) {
    const o = opts || {};
    const db = await openDb();
    const tx = db.transaction(STORE_OBSERVATIONS, 'readonly');
    const store = tx.objectStore(STORE_OBSERVATIONS);
    if (o.bucket) {
      return promisify(store.index('bucket').getAll(o.bucket));
    }
    return promisify(store.getAll());
  }

  async function getMeta(name) {
    const db = await openDb();
    const tx = db.transaction(STORE_META, 'readonly');
    const r = await promisify(tx.objectStore(STORE_META).get(name));
    return r ? r.value : undefined;
  }

  async function setMeta(name, value) {
    const db = await openDb();
    const tx = db.transaction(STORE_META, 'readwrite');
    return promisify(tx.objectStore(STORE_META).put({ name, value }));
  }

  async function clearAll() {
    const db = await openDb();
    const tx = db.transaction(
      [STORE_OBSERVATIONS, STORE_META, STORE_COOCCURRENCE, STORE_TEMP_DIALECTS, STORE_LLM_CACHE],
      'readwrite',
    );
    await Promise.all([
      promisify(tx.objectStore(STORE_OBSERVATIONS).clear()),
      promisify(tx.objectStore(STORE_META).clear()),
      promisify(tx.objectStore(STORE_COOCCURRENCE).clear()),
      promisify(tx.objectStore(STORE_TEMP_DIALECTS).clear()),
      promisify(tx.objectStore(STORE_LLM_CACHE).clear()),
    ]);
  }

  // ── Phase 7b: co-occurrence ───────────────────────────────────────

  async function getCoOccurrence(key) {
    const db = await openDb();
    const tx = db.transaction(STORE_COOCCURRENCE, 'readonly');
    return promisify(tx.objectStore(STORE_COOCCURRENCE).get(key));
  }

  async function putCoOccurrence(record) {
    const db = await openDb();
    const tx = db.transaction(STORE_COOCCURRENCE, 'readwrite');
    return promisify(tx.objectStore(STORE_COOCCURRENCE).put(record));
  }

  async function listCoOccurrences(opts) {
    const o = opts || {};
    const db = await openDb();
    const tx = db.transaction(STORE_COOCCURRENCE, 'readonly');
    const store = tx.objectStore(STORE_COOCCURRENCE);
    if (o.bucket) return promisify(store.index('bucket').getAll(o.bucket));
    return promisify(store.getAll());
  }

  // ── Phase 7b: temporary dialects ──────────────────────────────────

  async function getTempDialect(id) {
    const db = await openDb();
    const tx = db.transaction(STORE_TEMP_DIALECTS, 'readonly');
    return promisify(tx.objectStore(STORE_TEMP_DIALECTS).get(id));
  }

  async function putTempDialect(spec) {
    const db = await openDb();
    const tx = db.transaction(STORE_TEMP_DIALECTS, 'readwrite');
    return promisify(tx.objectStore(STORE_TEMP_DIALECTS).put(spec));
  }

  async function deleteTempDialect(id) {
    const db = await openDb();
    const tx = db.transaction(STORE_TEMP_DIALECTS, 'readwrite');
    return promisify(tx.objectStore(STORE_TEMP_DIALECTS).delete(id));
  }

  async function listTempDialects() {
    const db = await openDb();
    const tx = db.transaction(STORE_TEMP_DIALECTS, 'readonly');
    return promisify(tx.objectStore(STORE_TEMP_DIALECTS).getAll());
  }

  // ── Phase 7c: LLM cache ───────────────────────────────────────────

  async function getLlmCache(key) {
    const db = await openDb();
    const tx = db.transaction(STORE_LLM_CACHE, 'readonly');
    const r = await promisify(tx.objectStore(STORE_LLM_CACHE).get(key));
    if (!r) return null;
    if (r.expiresAt && r.expiresAt < Date.now()) {
      // Stale — let the next putLlmCache() overwrite. Don't bother
      // deleting eagerly; cleanup is a future maintenance pass.
      return null;
    }
    return r.value;
  }

  async function putLlmCache(key, value, ttlMs) {
    const db = await openDb();
    const tx = db.transaction(STORE_LLM_CACHE, 'readwrite');
    return promisify(
      tx.objectStore(STORE_LLM_CACHE).put({
        key,
        value,
        kind: (value && value.kind) || 'unknown',
        expiresAt: Date.now() + (ttlMs || 30 * 86400 * 1000),
      }),
    );
  }

  window.SpyglassIntelStorage = {
    DB_NAME,
    DB_VERSION,
    openDb,
    getObservation,
    putObservation,
    listObservations,
    getMeta,
    setMeta,
    clearAll,
    // Phase 7b
    getCoOccurrence,
    putCoOccurrence,
    listCoOccurrences,
    getTempDialect,
    putTempDialect,
    deleteTempDialect,
    listTempDialects,
    // Phase 7c
    getLlmCache,
    putLlmCache,
  };
})();
