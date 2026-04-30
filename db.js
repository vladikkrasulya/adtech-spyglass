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
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.SPYGLASS_DATA_DIR || '/data';
const SCHEMA_VERSION = 3;

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'spyglass.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const cur = db.pragma('user_version', { simple: true });
  if (cur < SCHEMA_VERSION) {
    migrate(db, cur);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
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
const sampleCols =
  'id, user_id, partner_id, title, status, notes, created_at, length(bid_req) AS req_len, length(bid_res) AS res_len';

const Users = {
  /** @param {{ email: string, password_hash: string }} u */
  create({ email, password_hash }) {
    const info = db
      .prepare('INSERT INTO users(email, password_hash) VALUES (?, ?)')
      .run(String(email).trim().toLowerCase(), String(password_hash));
    return Users.get(info.lastInsertRowid);
  },
  get(id) {
    return db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(id);
  },
  getByEmail(email) {
    return db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(
      String(email || '')
        .trim()
        .toLowerCase(),
    );
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
    const baseSlug = slug ? slugify(slug) : slugify(name);
    const finalSlug = ensureUniqueSlug(userId, baseSlug);
    const info = db
      .prepare('INSERT INTO partners(user_id, name, slug, notes) VALUES (?, ?, ?, ?)')
      .run(userId, String(name).trim(), finalSlug, String(notes || '').trim());
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
    if (partner_id != null) {
      const owns = Partners.get({ id: partner_id, userId });
      if (!owns) throw new Error('Partner does not belong to this user');
    }
    const info = db
      .prepare(
        `
      INSERT INTO samples(user_id, partner_id, title, bid_req, bid_res, req_iv, res_iv, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
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
  },
  update({ id, userId, partner_id, title, bid_req, bid_res, req_iv, res_iv, status, notes }) {
    const cur = Samples.get({ id, userId });
    if (!cur) return null;
    // If reassigning partner, verify ownership.
    if (partner_id !== undefined && partner_id != null) {
      const owns = Partners.get({ id: partner_id, userId });
      if (!owns) throw new Error('Partner does not belong to this user');
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

module.exports = { db, Users, Partners, Samples, slugify, SCHEMA_VERSION };
