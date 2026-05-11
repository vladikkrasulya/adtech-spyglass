'use strict';

/**
 * SQLite store for users, partners, and saved bid samples.
 *
 *   users(id, email, password_hash, created_at)
 *   partners(id, user_id → users.id ON DELETE CASCADE, name, slug, notes, created_at)
 *     UNIQUE(user_id, slug) — slugs are scoped per user
 *   samples(id, user_id → users.id ON DELETE CASCADE,
 *           partner_id → partners.id ON DELETE SET NULL,
 *           title, bid_req, bid_res, status, notes, created_at)
 *
 * Schema versioning: PRAGMA user_version. Bumped on every breaking change.
 *   v0 → v2 (Phase 7): added users, scoped partners+samples per user. v0 data
 *                      wiped (was test-only).
 *   v1 was an internal draft, never shipped.
 *   v2 → v3 (Phase 7 full): zero-knowledge crypto columns on users + samples.
 *   v3 → v4 (Phase 8): users.email_verified_at for SMTP-based email verify.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.SPYGLASS_DATA_DIR || '/data';
const SCHEMA_VERSION = 7;

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'spyglass.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // 5s headroom for SQLITE_BUSY during contentions (backup script runs
  // sqlite3 .backup at 03:30 UA daily; without this pragma a write
  // request during the backup window returns immediately with BUSY).
  db.pragma('busy_timeout = 5000');

  // better-sqlite3 returns user_version as a number on some builds and a
  // string on others — coerce so the comparison is numeric, not lexicographic
  // ("10" < "9" is true otherwise and migrations would silently skip).
  const cur = Number(db.pragma('user_version', { simple: true })) || 0;
  if (cur < SCHEMA_VERSION) {
    // Atomicity: wrap migrate() + user_version bump in one transaction so
    // a crash mid-flow rolls back the schema and leaves user_version at the
    // pre-migration value. Without this, a partial migration could land
    // half-built tables with stale user_version, and the next boot would
    // either re-run the same blocks (crashing on duplicate-column or
    // already-exists errors) or skip them (running app code against an
    // incomplete schema).
    db.transaction(() => {
      migrate(db, cur);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  return db;
}

function migrate(db, fromVersion) {
  // v0 → v2: users land, partners/samples become per-user. Existing v0 data
  // (test fixtures only — confirmed empty in production) is dropped.
  if (fromVersion < 2) {
    db.exec(`
      DROP TABLE IF EXISTS samples;
      DROP TABLE IF EXISTS partners;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      );

      CREATE TABLE partners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
        UNIQUE(user_id, slug)
      );
      CREATE INDEX idx_partners_user ON partners(user_id);

      CREATE TABLE samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        bid_req TEXT NOT NULL DEFAULT '',
        bid_res TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      );
      CREATE INDEX idx_samples_user ON samples(user_id);
      CREATE INDEX idx_samples_partner ON samples(partner_id);
      CREATE INDEX idx_samples_created ON samples(created_at DESC);
    `);
  }

  // v2 → v3: zero-knowledge client-side encryption.
  // Adds per-user crypto state (KEK/DEK pattern) plus per-sample IVs.
  // Existing samples are wiped — they're plaintext relics from before crypto;
  // we don't try to retrofit them since v0 data was already test-only.
  // Existing users keep their accounts but get NULL crypto state — they
  // bootstrap encryption on next login (the password is in hand at that
  // moment to derive the KEK).
  if (fromVersion < 3) {
    db.exec(`
      DELETE FROM samples;

      ALTER TABLE users ADD COLUMN kdf_salt TEXT;
      ALTER TABLE users ADD COLUMN dek_wrapped TEXT;
      ALTER TABLE users ADD COLUMN dek_iv TEXT;
      ALTER TABLE users ADD COLUMN recovery_salt TEXT;
      ALTER TABLE users ADD COLUMN recovery_dek_wrapped TEXT;
      ALTER TABLE users ADD COLUMN recovery_dek_iv TEXT;

      ALTER TABLE samples ADD COLUMN req_iv TEXT;
      ALTER TABLE samples ADD COLUMN res_iv TEXT;
    `);
  }

  // v3 → v4 (Phase 8): track email verification timestamp. NULL = unverified;
  // unix-ms when the user clicked their verify-email link. Existing users get
  // NULL (we don't grandfather them as verified — they'll see the banner and
  // can request a fresh verify email).
  if (fromVersion < 4) {
    db.exec(`
      ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
    `);
  }

  // v4 → v5 (2026-05-09 v0.16.0): per-user analyze usage log. Stores
  // METADATA ONLY — version, status, format, finding counts. Never the
  // payload (that would defeat zero-knowledge). Anonymous calls are not
  // tracked (user_id is NOT NULL with CASCADE — if account deletes, log
  // wipes too). Used by the personal cabinet's Insights section.
  //
  // Why metadata-only: the operator can already see counts (request log
  // exists implicitly via container access), but we want to surface the
  // user-friendly aggregate WITHOUT building a separate "we record your
  // every move" surface. The log row is small (~50 bytes) and indexed
  // on (user_id, ts DESC) for fast cabinet queries.
  if (fromVersion < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analyze_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
        payload_type TEXT NOT NULL,
        version TEXT,
        status TEXT NOT NULL,
        format TEXT,
        finding_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_analyze_log_user_ts ON analyze_log(user_id, ts DESC);
    `);
  }

  // v5 → v6 (2026-05-09 v0.18.0): persistent sessions + per-user
  // preferred_locale.
  //
  // Sessions previously lived in an in-process Map, which means every
  // server restart (including the routine `compose up --build` cycle)
  // kicks all logged-in users out — even though the cookie is Max-Age
  // 30 days, the server forgets the token. New `sessions` table
  // mirrors the Map; auth.js loads it on startup and writes through on
  // create/destroy. CASCADE on user_id so account-delete sweeps tokens.
  //
  // `users.preferred_locale` carries the language preference for
  // logged-in users across devices. NULL = no explicit preference.
  // Set via POST /api/auth/preferences from the lang menu when authed.
  // Anonymous users keep working off localStorage + a cookie (handled
  // server-side too — see resolveLocaleRoute).
  if (fromVersion < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        ip TEXT,
        ua TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      ALTER TABLE users ADD COLUMN preferred_locale TEXT;
    `);
  }

  // v6 → v7: behavior corpus (Chapter B foundation, 2026-05-10).
  //
  // Captures runtime probe event streams labelled by the user as
  // legitimate / fraud / ambiguous so the next iteration can run all 12
  // detection patterns over the corpus and emit a confusion matrix
  // (precision/recall per id). This v0 only ships storage + listing;
  // the matrix runner lands in a follow-up sprint.
  //
  // events_json is the same shape produced by the in-iframe
  // creative-probe.js (heartbeat + click + nav events). source_sample_id
  // links to a saved sample if the corpus entry was captured while one
  // was loaded; nullable for synthetic/anonymous captures.
  if (fromVersion < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS behavior_corpus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL CHECK(label IN ('legitimate','fraud','ambiguous')),
        events_json TEXT NOT NULL,
        source_sample_id INTEGER REFERENCES samples(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      );
      CREATE INDEX IF NOT EXISTS idx_corpus_user ON behavior_corpus(user_id);
      CREATE INDEX IF NOT EXISTS idx_corpus_label ON behavior_corpus(label);
      CREATE INDEX IF NOT EXISTS idx_corpus_created ON behavior_corpus(created_at DESC);
    `);
  }
}

const db = init();

function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'partner'
  );
}

// Slug uniqueness is per-user.
function ensureUniqueSlug(userId, base) {
  const stmt = db.prepare('SELECT 1 FROM partners WHERE user_id = ? AND slug = ?');
  let slug = base;
  let n = 2;
  while (stmt.get(userId, slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

const partnerCols = 'id, user_id, name, slug, notes, created_at';
// `is_encrypted` derived from req_iv presence — when the client encrypted the
// payload before save, an IV was stored. Surfacing as a boolean lets the
// list-views (cabinet recent-samples, library list) render an "encrypted/plain"
// pill without exposing the raw IV bytes. Older v3 samples have NULL iv → 0.
const sampleCols =
  'id, user_id, partner_id, title, status, notes, created_at, ' +
  'length(bid_req) AS req_len, length(bid_res) AS res_len, ' +
  '(req_iv IS NOT NULL) AS is_encrypted';

const Users = {
  /** @param {{ email: string, password_hash: string }} u */
  create({ email, password_hash }) {
    const info = db
      .prepare('INSERT INTO users(email, password_hash) VALUES (?, ?)')
      .run(String(email).trim().toLowerCase(), String(password_hash));
    return Users.get(info.lastInsertRowid);
  },
  get(id) {
    return db
      .prepare(
        'SELECT id, email, created_at, email_verified_at, preferred_locale FROM users WHERE id = ?',
      )
      .get(id);
  },
  getByEmail(email) {
    return db
      .prepare(
        'SELECT id, email, password_hash, created_at, email_verified_at, preferred_locale FROM users WHERE email = ?',
      )
      .get(
        String(email || '')
          .trim()
          .toLowerCase(),
      );
  },
  setPreferredLocale(id, locale) {
    // null clears the preference; valid locales pass through.
    const value = locale == null ? null : String(locale);
    db.prepare('UPDATE users SET preferred_locale = ? WHERE id = ?').run(value, id);
  },
  count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },

  // ── Crypto state (Phase 7 — zero-knowledge encryption) ───────────────
  // Server is opaque storage for these. Salt + wrapped DEK + IV come from
  // the client (Web Crypto API in browser); server never sees the password
  // beyond bcrypt-verify, never sees the plaintext DEK, never sees decrypted
  // sample bodies.

  /**
   * Returns crypto state for the user, or null fields if not yet bootstrapped.
   * @param {number} id
   */
  getCryptoState(id) {
    return db
      .prepare(
        `SELECT kdf_salt, dek_wrapped, dek_iv,
                recovery_salt, recovery_dek_wrapped, recovery_dek_iv
         FROM users WHERE id = ?`,
      )
      .get(id);
  },

  /**
   * Persist the per-user crypto state. Called once at register/first-login
   * (bootstrap), and again on password change (re-wraps DEK with new KEK).
   * @param {number} id
   * @param {{
   *   kdf_salt: string, dek_wrapped: string, dek_iv: string,
   *   recovery_salt: string, recovery_dek_wrapped: string, recovery_dek_iv: string
   * }} state
   */
  setCryptoState(id, state) {
    db.prepare(
      `UPDATE users
       SET kdf_salt = ?, dek_wrapped = ?, dek_iv = ?,
           recovery_salt = ?, recovery_dek_wrapped = ?, recovery_dek_iv = ?
       WHERE id = ?`,
    ).run(
      String(state.kdf_salt),
      String(state.dek_wrapped),
      String(state.dek_iv),
      String(state.recovery_salt),
      String(state.recovery_dek_wrapped),
      String(state.recovery_dek_iv),
      id,
    );
  },

  /**
   * Update only the password-derived crypto fields (kdf_salt + dek_wrapped +
   * dek_iv). Recovery state stays untouched — used by reset-password modes
   * 'rotate' and 'recover' where the user re-wraps DEK with a new KEK derived
   * from the new password, but the recovery wrap (under the recovery KEK) is
   * still valid.
   * @param {number} id
   * @param {{ kdf_salt: string, dek_wrapped: string, dek_iv: string }} state
   */
  setPasswordCryptoState(id, state) {
    db.prepare(
      `UPDATE users
       SET kdf_salt = ?, dek_wrapped = ?, dek_iv = ?
       WHERE id = ?`,
    ).run(String(state.kdf_salt), String(state.dek_wrapped), String(state.dek_iv), id);
  },

  // ── Phase 8 — email verification + password reset ───────────────────

  /**
   * Stamp email_verified_at = now (unix-ms). Idempotent: re-verifying a
   * verified email is a no-op overwrite.
   * @param {number} id
   */
  markEmailVerified(id) {
    db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(Date.now(), id);
  },

  /**
   * Replace bcrypt password hash. Used by both /reset-password and any
   * future change-password endpoint. Caller is responsible for rotating
   * crypto state via setCryptoState in the same transaction-shaped flow
   * (see spyglass_crypto_architecture: wrap-rotation gotcha).
   * @param {number} id
   * @param {string} password_hash
   */
  updatePassword(id, password_hash) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(String(password_hash), id);
  },

  /**
   * Atomic password + password-side crypto rotation. Used by reset-password
   * mode='rotate' and mode='recover'. Wraps updatePassword +
   * setPasswordCryptoState in a single db.transaction so a crash between
   * the two leaves the user neither half-locked-out (new password but old
   * wrap = can't decrypt with new KEK) nor half-rolled (old password but
   * new wrap = can't decrypt with old KEK).
   *
   * Recovery wrap (recovery_dek_wrapped + recovery_salt) is intentionally
   * untouched — rotation keeps the existing recovery key valid.
   *
   * @param {number} id
   * @param {string} password_hash  — new bcrypt hash
   * @param {{ kdf_salt: string, dek_wrapped: string, dek_iv: string }} state
   */
  updatePasswordAndCrypto(id, password_hash, state) {
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(String(password_hash), id);
      db.prepare(
        `UPDATE users
         SET kdf_salt = ?, dek_wrapped = ?, dek_iv = ?
         WHERE id = ?`,
      ).run(String(state.kdf_salt), String(state.dek_wrapped), String(state.dek_iv), id);
      // Sessions invalidated atomically with password change (post-audit
      // fix v0.37.1). Pre-fix the session DB delete happened in a separate
      // call after the password commit; if THAT second call threw
      // (SQLITE_BUSY), DB had new password but stale session rows that
      // re-hydrated to the in-memory Map on next container restart —
      // stolen-cookie revival. Now both land or neither does.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    })();
  },

  /**
   * Atomic password reset + full wipe. Used by reset-password mode='wipe'
   * when user lost both password AND recovery key. Combines updatePassword
   * + clearCryptoState + wipeUserData (all five per-user tables) in a single
   * db.transaction so a crash mid-flow rolls back everything — the user
   * either keeps their old state entirely or transitions to the clean-slate
   * state, never an inconsistent middle.
   *
   * @param {number} id
   * @param {string} password_hash  — new bcrypt hash
   * @returns {{
   *   samplesDeleted: number, partnersDeleted: number,
   *   analyzeLogDeleted: number, behaviorCorpusDeleted: number,
   *   sessionsDeleted: number,
   * }}
   */
  updatePasswordAndWipe(id, password_hash) {
    return db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(String(password_hash), id);
      db.prepare(
        `UPDATE users
         SET kdf_salt = NULL, dek_wrapped = NULL, dek_iv = NULL,
             recovery_salt = NULL, recovery_dek_wrapped = NULL, recovery_dek_iv = NULL
         WHERE id = ?`,
      ).run(id);
      const samplesDeleted = db.prepare('DELETE FROM samples WHERE user_id = ?').run(id).changes;
      const partnersDeleted = db.prepare('DELETE FROM partners WHERE user_id = ?').run(id).changes;
      const analyzeLogDeleted = db
        .prepare('DELETE FROM analyze_log WHERE user_id = ?')
        .run(id).changes;
      const behaviorCorpusDeleted = db
        .prepare('DELETE FROM behavior_corpus WHERE user_id = ?')
        .run(id).changes;
      const sessionsDeleted = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id).changes;
      return {
        samplesDeleted,
        partnersDeleted,
        analyzeLogDeleted,
        behaviorCorpusDeleted,
        sessionsDeleted,
      };
    })();
  },

  /**
   * Null out crypto state — used by reset-password mode='wipe' so the user
   * re-bootstraps encryption on next login (existing flow handles NULL
   * crypto state by triggering bootstrap).
   * @param {number} id
   */
  clearCryptoState(id) {
    db.prepare(
      `UPDATE users
       SET kdf_salt = NULL, dek_wrapped = NULL, dek_iv = NULL,
           recovery_salt = NULL, recovery_dek_wrapped = NULL, recovery_dek_iv = NULL
       WHERE id = ?`,
    ).run(id);
  },

  /**
   * Hard-delete all user data: samples + partners + analyze_log +
   * behavior_corpus + sessions. Used by reset-password mode='wipe' when
   * user has lost both password AND recovery key. Does NOT delete the
   * user row (account survives, becomes empty). Returns counts of rows
   * deleted per table.
   *
   * Why sessions too: a wiping user has effectively repudiated their
   * old identity — any sessions issued under the old password are now
   * stale by intent. Without this sweep, a stolen cookie from before
   * the wipe would still authenticate against the new (empty) account.
   *
   * Why analyze_log + behavior_corpus: these carry per-user metadata
   * about activity. Wipe-mode is the user's explicit "delete my history"
   * request; leaving these behind leaks behavioral signal across what
   * the user expects to be a fresh start.
   *
   * @param {number} id
   */
  wipeUserData(id) {
    const samplesDeleted = db.prepare('DELETE FROM samples WHERE user_id = ?').run(id).changes;
    const partnersDeleted = db.prepare('DELETE FROM partners WHERE user_id = ?').run(id).changes;
    const analyzeLogDeleted = db
      .prepare('DELETE FROM analyze_log WHERE user_id = ?')
      .run(id).changes;
    const behaviorCorpusDeleted = db
      .prepare('DELETE FROM behavior_corpus WHERE user_id = ?')
      .run(id).changes;
    const sessionsDeleted = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id).changes;
    return {
      samplesDeleted,
      partnersDeleted,
      analyzeLogDeleted,
      behaviorCorpusDeleted,
      sessionsDeleted,
    };
  },
};

const Partners = {
  /** @param {{ userId: number }} opts */
  list({ userId }) {
    return db
      .prepare(
        `SELECT ${partnerCols} FROM partners WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(userId);
  },
  /** @param {{ id: number, userId: number }} opts */
  get({ id, userId }) {
    return db
      .prepare(`SELECT ${partnerCols} FROM partners WHERE id = ? AND user_id = ?`)
      .get(id, userId);
  },
  create({ userId, name, slug, notes }) {
    // Trim early + require non-empty post-trim. Server route already
    // validates `b.name` truthy, but `"   "` slips through as truthy
    // and lands in DB as the empty string. Tag with stable code so the
    // client can show a precise toast.
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      const err = /** @type {Error & { code: string }} */ (new Error('Partner name is required'));
      err.code = 'partner_name_required';
      throw err;
    }
    const baseSlug = slug ? slugify(slug) : slugify(trimmedName);
    const finalSlug = ensureUniqueSlug(userId, baseSlug);
    const info = db
      .prepare('INSERT INTO partners(user_id, name, slug, notes) VALUES (?, ?, ?, ?)')
      .run(userId, trimmedName, finalSlug, String(notes || '').trim());
    return Partners.get({ id: info.lastInsertRowid, userId });
  },
  update({ id, userId, name, slug, notes }) {
    const cur = Partners.get({ id, userId });
    if (!cur) return null;
    let finalSlug = cur.slug;
    if (slug && slug !== cur.slug) {
      const base = slugify(slug);
      finalSlug = ensureUniqueSlug(userId, base);
    }
    db.prepare(
      'UPDATE partners SET name = ?, slug = ?, notes = ? WHERE id = ? AND user_id = ?',
    ).run(
      name != null ? String(name).trim() : cur.name,
      finalSlug,
      notes != null ? String(notes).trim() : cur.notes,
      id,
      userId,
    );
    return Partners.get({ id, userId });
  },
  delete({ id, userId }) {
    const info = db.prepare('DELETE FROM partners WHERE id = ? AND user_id = ?').run(id, userId);
    return info.changes > 0;
  },
  /**
   * Count saved samples currently assigned to this partner. Used by the
   * delete-partner confirm dialog so the user sees "X samples will become
   * unassigned" before they pull the trigger.
   */
  countSamples({ id, userId }) {
    return db
      .prepare('SELECT COUNT(*) AS n FROM samples WHERE partner_id = ? AND user_id = ?')
      .get(id, userId).n;
  },
};

const Samples = {
  /** @param {{ userId: number, partnerId?: number | 'unassigned' }} opts */
  list({ userId, partnerId }) {
    if (partnerId === 'unassigned') {
      return db
        .prepare(
          `SELECT ${sampleCols} FROM samples
           WHERE user_id = ? AND partner_id IS NULL
           ORDER BY created_at DESC`,
        )
        .all(userId);
    }
    if (partnerId != null) {
      return db
        .prepare(
          `SELECT ${sampleCols} FROM samples
           WHERE user_id = ? AND partner_id = ?
           ORDER BY created_at DESC`,
        )
        .all(userId, partnerId);
    }
    return db
      .prepare(`SELECT ${sampleCols} FROM samples WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId);
  },
  /** @param {{ id: number, userId: number }} opts */
  get({ id, userId }) {
    return db
      .prepare(
        `
      SELECT id, user_id, partner_id, title,
             bid_req, bid_res, req_iv, res_iv,
             status, notes, created_at
      FROM samples WHERE id = ? AND user_id = ?
    `,
      )
      .get(id, userId);
  },
  // bid_req / bid_res are AES-GCM ciphertext (base64) when crypto is enabled.
  // req_iv / res_iv are the per-blob IVs (base64). Both are opaque to the
  // server — it just stores and returns them.
  create({ userId, partner_id, title, bid_req, bid_res, req_iv, res_iv, status, notes }) {
    // Verify partner belongs to user (or is null) — prevents cross-user assignment.
    // Tag the error with a stable `code` so the UI can show a precise toast
    // (the typical race is: another tab deleted the partner between picker
    // and submit; UI should refresh the partner cache, not show a generic
    // "save failed").
    if (partner_id != null) {
      const owns = Partners.get({ id: partner_id, userId });
      if (!owns) {
        const err = /** @type {Error & { code: string }} */ (
          new Error('Partner does not belong to this user (was it deleted?)')
        );
        err.code = 'partner_not_found';
        throw err;
      }
    }
    // Wrap INSERT + read-back in a transaction so the row + its return
    // value land atomically. Without this, an exception between INSERT
    // and Samples.get() would leave a row in the DB while the client
    // saw a failure response → next save would create a duplicate.
    // SQLite + better-sqlite3 transactions are synchronous, no async
    // boundaries inside the txn body, so this is bulletproof.
    const txn = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO samples(user_id, partner_id, title, bid_req, bid_res, req_iv, res_iv, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          partner_id || null,
          String(title || 'untitled').trim(),
          String(bid_req || ''),
          String(bid_res || ''),
          req_iv != null ? String(req_iv) : null,
          res_iv != null ? String(res_iv) : null,
          String(status || ''),
          String(notes || '').trim(),
        );
      return Samples.get({ id: info.lastInsertRowid, userId });
    });
    return txn();
  },
  update({ id, userId, partner_id, title, bid_req, bid_res, req_iv, res_iv, status, notes }) {
    const cur = Samples.get({ id, userId });
    if (!cur) return null;
    // If reassigning partner, verify ownership. Same coded error as
    // create() so the UI can refresh and re-prompt cleanly.
    if (partner_id !== undefined && partner_id != null) {
      const owns = Partners.get({ id: partner_id, userId });
      if (!owns) {
        const err = /** @type {Error & { code: string }} */ (
          new Error('Partner does not belong to this user (was it deleted?)')
        );
        err.code = 'partner_not_found';
        throw err;
      }
    }
    db.prepare(
      `
      UPDATE samples
      SET partner_id = ?, title = ?,
          bid_req = ?, bid_res = ?, req_iv = ?, res_iv = ?,
          status = ?, notes = ?
      WHERE id = ? AND user_id = ?
    `,
    ).run(
      partner_id !== undefined ? partner_id || null : cur.partner_id,
      title != null ? String(title).trim() : cur.title,
      bid_req != null ? String(bid_req) : cur.bid_req,
      bid_res != null ? String(bid_res) : cur.bid_res,
      req_iv !== undefined ? (req_iv != null ? String(req_iv) : null) : cur.req_iv,
      res_iv !== undefined ? (res_iv != null ? String(res_iv) : null) : cur.res_iv,
      status != null ? String(status) : cur.status,
      notes != null ? String(notes).trim() : cur.notes,
      id,
      userId,
    );
    return Samples.get({ id, userId });
  },
  delete({ id, userId }) {
    const info = db.prepare('DELETE FROM samples WHERE id = ? AND user_id = ?').run(id, userId);
    return info.changes > 0;
  },
};

// ─────────────────────────────────────────────────────────────────────────
// AnalyzeLog — per-user usage tracking (METADATA only, no payload bodies).
// See migration v4→v5 for the storage rationale; the model layer stays
// thin: a single record() insert on every analyze, plus an insights()
// aggregator returning the rollup the cabinet renders.
// ─────────────────────────────────────────────────────────────────────────
const AnalyzeLog = {
  /**
   * Persist one analyze call. Caller passes already-derived metadata so
   * we never look at the user's payload contents here.
   *
   * @param {{
   *   userId: number,
   *   payloadType: 'request' | 'response' | 'both',
   *   version: string | null,
   *   status: string,
   *   format: string | null,
   *   findingCount: number,
   *   errorCount: number,
   *   warningCount: number
   * }} entry
   */
  record(entry) {
    if (!entry || typeof entry.userId !== 'number') return;
    db.prepare(
      `INSERT INTO analyze_log
         (user_id, payload_type, version, status, format,
          finding_count, error_count, warning_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.userId,
      String(entry.payloadType || 'unknown'),
      entry.version != null ? String(entry.version) : null,
      String(entry.status || 'unknown'),
      entry.format != null ? String(entry.format) : null,
      Number(entry.findingCount) || 0,
      Number(entry.errorCount) || 0,
      Number(entry.warningCount) || 0,
    );
  },

  /**
   * Aggregate insights for the personal cabinet. Returns: lifetime total,
   * 7-day + 30-day windows, status / version / format distributions, daily
   * activity (last 30 days), first/last analyze timestamps.
   *
   * One round-trip: SQLite handles the math fast even at 100k+ rows on
   * an indexed (user_id, ts DESC) scan.
   *
   * @param {number} userId
   */
  insights(userId) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const since7 = now - 7 * day;
    const since30 = now - 30 * day;

    const total = db
      .prepare('SELECT COUNT(*) AS n FROM analyze_log WHERE user_id = ?')
      .get(userId).n;
    const last7 = db
      .prepare('SELECT COUNT(*) AS n FROM analyze_log WHERE user_id = ? AND ts >= ?')
      .get(userId, since7).n;
    const last30 = db
      .prepare('SELECT COUNT(*) AS n FROM analyze_log WHERE user_id = ? AND ts >= ?')
      .get(userId, since30).n;

    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS n FROM analyze_log WHERE user_id = ? GROUP BY status')
      .all(userId)
      .reduce((acc, r) => ((acc[r.status] = r.n), acc), {});

    const byVersion = db
      .prepare(
        `SELECT COALESCE(version, 'unknown') AS version, COUNT(*) AS n
         FROM analyze_log WHERE user_id = ? GROUP BY version`,
      )
      .all(userId)
      .reduce((acc, r) => ((acc[r.version] = r.n), acc), {});

    const byFormat = db
      .prepare(
        `SELECT COALESCE(format, 'unknown') AS format, COUNT(*) AS n
         FROM analyze_log WHERE user_id = ? GROUP BY format`,
      )
      .all(userId)
      .reduce((acc, r) => ((acc[r.format] = r.n), acc), {});

    // Daily activity for last 30 days. Bucketing in JS to avoid SQLite
    // strftime() locale dependency. Returns array of {date:'YYYY-MM-DD', n}
    // sorted ascending — caller can render bar chart.
    const daily = db
      .prepare(
        `SELECT ts FROM analyze_log
         WHERE user_id = ? AND ts >= ?
         ORDER BY ts ASC`,
      )
      .all(userId, since30);
    const dailyMap = new Map();
    for (const r of daily) {
      const d = new Date(r.ts).toISOString().slice(0, 10);
      dailyMap.set(d, (dailyMap.get(d) || 0) + 1);
    }
    const activity = Array.from(dailyMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, n]) => ({ date, n }));

    const range = db
      .prepare('SELECT MIN(ts) AS first, MAX(ts) AS last FROM analyze_log WHERE user_id = ?')
      .get(userId);

    // Total error/warning counts across all analyzes (sum, not row-count).
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(error_count), 0) AS errors,
                COALESCE(SUM(warning_count), 0) AS warnings,
                COALESCE(SUM(finding_count), 0) AS findings
         FROM analyze_log WHERE user_id = ?`,
      )
      .get(userId);

    return {
      total,
      last7,
      last30,
      byStatus,
      byVersion,
      byFormat,
      activity,
      first_at: range && range.first ? range.first : null,
      last_at: range && range.last ? range.last : null,
      sums: totals,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Sessions — persistent session store (replaces the v0.17.0 in-memory Map).
//
// Why DB-backed: every server restart wiped the Map, kicking all logged-in
// users out even though their cookie was still valid. With this table the
// session survives `compose up --build` cycles (and crashes / kernel panics).
//
// Auth.js loads the table into an in-memory Map on startup for fast lookup;
// writes go to BOTH (write-through) so the Map stays the hot read path.
// ─────────────────────────────────────────────────────────────────────────
const Sessions = {
  /** @param {{ token: string, userId: number, expiresAt: number, ip: string, ua: string }} s */
  create(s) {
    db.prepare(
      `INSERT INTO sessions(token, user_id, expires_at, ip, ua)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(s.token, s.userId, s.expiresAt, s.ip || null, s.ua || null);
  },
  destroy(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },
  /** Refresh expiresAt in DB (sliding session — call on activity if desired). */
  touch(token, expiresAt) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(expiresAt, token);
  },
  /** Load all non-expired sessions on startup. Auth.js calls once at boot. */
  loadActive() {
    return db
      .prepare(
        'SELECT token, user_id AS userId, expires_at AS expiresAt, ip, ua FROM sessions WHERE expires_at > ?',
      )
      .all(Date.now());
  },
  /** Sweep expired rows. Cheap to run on every load + periodically. */
  pruneExpired() {
    const r = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return r.changes;
  },
  destroyForUser(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Behavior corpus (Chapter B foundation)
//
// Per-user labelled event-stream archive. Captured on the behavior tab:
// the user runs a probe, sees the verdict, and decides this looks like
// real fraud / legitimate user / ambiguous edge case. Saved entries feed
// the next sprint's confusion-matrix runner.
//
// Validation:
//   - label MUST be one of {legitimate, fraud, ambiguous} (CHECK constraint
//     in schema; we still pre-validate so the API returns a clean 400).
//   - events_json must be a non-empty string; we don't decode or schema-
//     check the events here — that's the consumer's job (matrix runner).
//   - notes is freeform text, capped at 4kB to keep rows compact.
// ─────────────────────────────────────────────────────────────────────────
const BehaviorCorpus = {
  LABELS: ['legitimate', 'fraud', 'ambiguous'],
  /**
   * @param {{
   *   userId: number,
   *   label: 'legitimate'|'fraud'|'ambiguous',
   *   events: object[],
   *   sourceSampleId?: number|null,
   *   notes?: string
   * }} entry
   * @returns {{ id: number }}
   */
  create(entry) {
    if (!entry || typeof entry.userId !== 'number') {
      throw new Error('user_required');
    }
    if (!BehaviorCorpus.LABELS.includes(entry.label)) {
      throw new Error('label_invalid');
    }
    if (!Array.isArray(entry.events) || !entry.events.length) {
      throw new Error('events_required');
    }
    const json = JSON.stringify(entry.events);
    if (json.length > 1024 * 1024) {
      throw new Error('events_too_large'); // 1 MB cap, more than enough
    }
    const notes = String(entry.notes || '').slice(0, 4096);
    const r = db
      .prepare(
        `INSERT INTO behavior_corpus(user_id, label, events_json, source_sample_id, notes)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        entry.userId,
        entry.label,
        json,
        entry.sourceSampleId != null ? Number(entry.sourceSampleId) : null,
        notes,
      );
    return { id: Number(r.lastInsertRowid) };
  },

  /**
   * Return entries for one user, newest first. event_count + event_bytes
   * derived in SQL so the listing is fast regardless of corpus size.
   */
  listForUser(userId, opts = {}) {
    const where = ['user_id = ?'];
    const params = [userId];
    if (opts.label && BehaviorCorpus.LABELS.includes(opts.label)) {
      where.push('label = ?');
      params.push(opts.label);
    }
    const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
    return db
      .prepare(
        `SELECT id, label, source_sample_id AS sourceSampleId, notes, created_at AS createdAt,
                length(events_json) AS eventBytes,
                json_array_length(events_json) AS eventCount
         FROM behavior_corpus
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ${limit}`,
      )
      .all(...params);
  },

  /** Full row including the events_json blob — used for matrix replay. */
  getById(id, userId) {
    return db
      .prepare(
        `SELECT id, user_id AS userId, label, events_json AS eventsJson,
                source_sample_id AS sourceSampleId, notes, created_at AS createdAt
         FROM behavior_corpus
         WHERE id = ? AND user_id = ?`,
      )
      .get(id, userId);
  },

  /** Counts per label for the cabinet card. */
  countsForUser(userId) {
    const rows = db
      .prepare(
        `SELECT label, COUNT(*) AS n FROM behavior_corpus
         WHERE user_id = ? GROUP BY label`,
      )
      .all(userId);
    const out = { legitimate: 0, fraud: 0, ambiguous: 0, total: 0 };
    for (const r of rows) {
      out[r.label] = r.n;
      out.total += r.n;
    }
    return out;
  },

  destroy(id, userId) {
    const r = db
      .prepare('DELETE FROM behavior_corpus WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return r.changes > 0;
  },
};

module.exports = {
  db,
  Users,
  Partners,
  Samples,
  AnalyzeLog,
  Sessions,
  BehaviorCorpus,
  slugify,
  SCHEMA_VERSION,
};
