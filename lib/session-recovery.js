'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const MAX_ENTRIES = 16_384;
const MAX_BYTES = 4 * 1024 * 1024;
const LOOKUP_RE = /^sr1:[a-f0-9]{64}$/;
const COOKIE_RE = /^[a-f0-9]{64}$/;

function unavailable() {
  return Object.assign(new Error('session_recovery_unavailable'), {
    code: 'session_recovery_unavailable',
    status: 503,
  });
}

/**
 * Auth's only recovery owner. The SQLite sidecar holds a kernel-released lock;
 * it contains no application tables. The checkpoint never stores raw cookies.
 *
 * Every serving process has a durably dirty checkpoint. Only the caller that
 * has drained HTTP and fenced further mutations may request a clean close.
 * Therefore an unrecorded revocation during total-write failure cannot be
 * followed by trusted hydration after a crash.
 *
 * @param {{directory:string, store:any, io?:typeof fs, now?:()=>number,
 * maxEntries?:number, maxBytes?:number}} options
 */
function createSessionRecovery({
  directory,
  store,
  io = fs,
  now = Date.now,
  maxEntries = MAX_ENTRIES,
  maxBytes = MAX_BYTES,
}) {
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > MAX_ENTRIES ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES
  )
    throw unavailable();
  const checkpoint = path.join(directory, 'checkpoint.json');
  const ownership = path.join(directory, 'owner.sqlite');
  let lock;
  let closed = false;
  let uncertain = false;
  let state;
  let activeRows;

  function syncDirectory(dir) {
    const fd = io.openSync(dir, io.constants.O_RDONLY);
    try {
      io.fsyncSync(fd);
    } finally {
      io.closeSync(fd);
    }
  }

  function write(next) {
    const body = JSON.stringify(next);
    if (Buffer.byteLength(body) > maxBytes) throw unavailable();
    const temporary = path.join(directory, '.checkpoint-' + crypto.randomBytes(12).toString('hex'));
    let fd;
    try {
      fd = io.openSync(
        temporary,
        io.constants.O_WRONLY |
          io.constants.O_CREAT |
          io.constants.O_EXCL |
          (io.constants.O_NOFOLLOW || 0),
        0o600,
      );
      io.writeFileSync(fd, body);
      io.fsyncSync(fd);
      io.closeSync(fd);
      fd = undefined;
      io.renameSync(temporary, checkpoint);
      syncDirectory(directory);
    } finally {
      if (fd !== undefined) io.closeSync(fd);
      try {
        io.unlinkSync(temporary);
      } catch {
        /* rename already consumed the owned temporary */
      }
    }
  }

  function read() {
    const fd = io.openSync(checkpoint, io.constants.O_RDONLY | (io.constants.O_NOFOLLOW || 0));
    try {
      const stat = io.fstatSync(fd);
      if (!stat.isFile() || stat.size > maxBytes) throw unavailable();
      const value = JSON.parse(io.readFileSync(fd, 'utf8'));
      if (
        !value ||
        value.version !== 1 ||
        typeof value.clean !== 'boolean' ||
        !COOKIE_RE.test(value.key) ||
        !Array.isArray(value.revocations) ||
        value.revocations.length > maxEntries ||
        Object.keys(value).some((key) => !['version', 'clean', 'key', 'revocations'].includes(key))
      )
        throw unavailable();
      const seen = new Set();
      for (const entry of value.revocations) {
        if (
          !entry ||
          !LOOKUP_RE.test(entry.id) ||
          !Number.isSafeInteger(entry.expiresAt) ||
          entry.expiresAt < 0 ||
          seen.has(entry.id) ||
          Object.keys(entry).some((key) => !['id', 'expiresAt'].includes(key))
        )
          throw unavailable();
        seen.add(entry.id);
      }
      return value;
    } finally {
      io.closeSync(fd);
    }
  }

  function release() {
    if (lock) {
      try {
        lock.exec('ROLLBACK');
      } catch {
        /* transaction may not have started */
      }
      lock.close();
      lock = null;
    }
  }

  try {
    io.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dirStat = io.lstatSync(directory);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw unavailable();
    io.chmodSync(directory, 0o700);
    syncDirectory(path.dirname(directory));
    try {
      if (io.lstatSync(ownership).isSymbolicLink()) throw unavailable();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    lock = new Database(ownership, { timeout: 100 });
    io.chmodSync(ownership, 0o600);
    lock.exec('BEGIN EXCLUSIVE');

    try {
      state = read();
    } catch {
      state = null;
    }
    store.pruneExpired();
    activeRows = store.loadActive();
    // Legacy rows cannot be retained even beside a valid checkpoint: a restored
    // old DB must not create an old-image raw-cookie authentication path.
    if (!state || !state.clean || activeRows.some((row) => !LOOKUP_RE.test(row.token))) {
      store.destroyAll();
      activeRows = [];
      state = {
        version: 1,
        key: crypto.randomBytes(32).toString('hex'),
        clean: false,
        revocations: [],
      };
    }
    state.clean = false;
    state.revocations = state.revocations.filter((entry) => entry.expiresAt > now());
    write(state); // Must finish, including directory fsync, before authentication.
    const revoked = new Set(state.revocations.map((entry) => entry.id));
    activeRows = activeRows.filter((row) => !revoked.has(row.token));
  } catch {
    release();
    throw unavailable();
  }

  return {
    activeRows,
    lookup(raw) {
      if (closed || typeof raw !== 'string' || !COOKIE_RE.test(raw)) return null;
      return (
        'sr1:' +
        crypto.createHmac('sha256', Buffer.from(state.key, 'hex')).update(raw).digest('hex')
      );
    },
    /** Persist all known affected identities together, before deleting DB rows. */
    revoke(entries) {
      if (closed) return false;
      try {
        const merged = new Map(
          state.revocations
            .filter((entry) => entry.expiresAt > now())
            .map((entry) => [entry.id, entry]),
        );
        for (const entry of entries) {
          if (!LOOKUP_RE.test(entry.id) || !Number.isSafeInteger(entry.expiresAt))
            throw unavailable();
          if (entry.expiresAt > now())
            merged.set(entry.id, { id: entry.id, expiresAt: entry.expiresAt });
        }
        if (merged.size > maxEntries) throw unavailable();
        const next = {
          ...state,
          clean: false,
          revocations: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
        };
        write(next);
        state = next;
        return true;
      } catch {
        // The prearmed fence, rather than this non-durable latch, supplies
        // restart safety. Never mark clean after an unaccounted write failure.
        uncertain = true;
        return false;
      }
    },
    stats() {
      return { revocations: state.revocations.length, uncertain };
    },
    close({ clean = false } = {}) {
      if (closed) return false;
      let persistedClean = false;
      try {
        if (clean && !uncertain) {
          write({ ...state, clean: true });
          persistedClean = true;
        }
      } catch {
        // No clean certification is returned. A failure after rename may leave
        // the safe clean snapshot; recovery validates whichever file survived.
      } finally {
        closed = true;
        release();
      }
      return persistedClean;
    },
  };
}

module.exports = { createSessionRecovery, MAX_ENTRIES, MAX_BYTES };
