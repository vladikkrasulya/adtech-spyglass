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
  const DB_VERSION = 1;
  const STORE_OBSERVATIONS = 'field_observations';
  const STORE_META = 'discovery_meta';

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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB blocked — close other Spyglass tabs'));
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
    const tx = db.transaction([STORE_OBSERVATIONS, STORE_META], 'readwrite');
    await Promise.all([
      promisify(tx.objectStore(STORE_OBSERVATIONS).clear()),
      promisify(tx.objectStore(STORE_META).clear()),
    ]);
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
  };
})();
