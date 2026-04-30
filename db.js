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
const SCHEMA_VERSION = 2;

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
      SELECT id, user_id, partner_id, title, bid_req, bid_res, status, notes, created_at
      FROM samples WHERE id = ? AND user_id = ?
    `,
      )
      .get(id, userId);
  },
  create({ userId, partner_id, title, bid_req, bid_res, status, notes }) {
    // Verify partner belongs to user (or is null) — prevents cross-user assignment.
    if (partner_id != null) {
      const owns = Partners.get({ id: partner_id, userId });
      if (!owns) throw new Error('Partner does not belong to this user');
    }
    const info = db
      .prepare(
        `
      INSERT INTO samples(user_id, partner_id, title, bid_req, bid_res, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        userId,
        partner_id || null,
        String(title || 'untitled').trim(),
        String(bid_req || ''),
        String(bid_res || ''),
        String(status || ''),
        String(notes || '').trim(),
      );
    return Samples.get({ id: info.lastInsertRowid, userId });
  },
  update({ id, userId, partner_id, title, bid_req, bid_res, status, notes }) {
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
      SET partner_id = ?, title = ?, bid_req = ?, bid_res = ?, status = ?, notes = ?
      WHERE id = ? AND user_id = ?
    `,
    ).run(
      partner_id !== undefined ? partner_id || null : cur.partner_id,
      title != null ? String(title).trim() : cur.title,
      bid_req != null ? String(bid_req) : cur.bid_req,
      bid_res != null ? String(bid_res) : cur.bid_res,
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
