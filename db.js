'use strict';

/**
 * SQLite store for saved bid samples and partner labels.
 * One file at DATA_DIR/spyglass.db (bind-mounted from /srv/DATA/AppData/adtech-spyglass).
 *
 * partners(id, name, slug, notes, created_at)
 * samples(id, partner_id?, title, bid_req, bid_res, status, notes, created_at)
 *
 * partner_id is ON DELETE SET NULL — deleting a partner does not destroy the
 * samples already linked to it, they just go back to the "unassigned" bucket.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.SPYGLASS_DATA_DIR || '/data';

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'spyglass.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      notes TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
    );
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      bid_req TEXT NOT NULL DEFAULT '',
      bid_res TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
    );
    CREATE INDEX IF NOT EXISTS idx_samples_partner ON samples(partner_id);
    CREATE INDEX IF NOT EXISTS idx_samples_created ON samples(created_at DESC);
  `);

  return db;
}

const db = init();

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'partner';
}

function ensureUniqueSlug(base) {
  const stmt = db.prepare('SELECT 1 FROM partners WHERE slug = ?');
  let slug = base;
  let n = 2;
  while (stmt.get(slug)) { slug = `${base}-${n++}`; }
  return slug;
}

const partnerCols = 'id, name, slug, notes, created_at';
const sampleCols  = 'id, partner_id, title, status, notes, created_at, length(bid_req) AS req_len, length(bid_res) AS res_len';

const Partners = {
  list() {
    return db.prepare(`SELECT ${partnerCols} FROM partners ORDER BY name COLLATE NOCASE ASC`).all();
  },
  get(id) {
    return db.prepare(`SELECT ${partnerCols} FROM partners WHERE id = ?`).get(id);
  },
  create({ name, slug, notes }) {
    const baseSlug = slug ? slugify(slug) : slugify(name);
    const finalSlug = ensureUniqueSlug(baseSlug);
    const info = db.prepare(
      'INSERT INTO partners(name, slug, notes) VALUES (?, ?, ?)'
    ).run(String(name).trim(), finalSlug, String(notes || '').trim());
    return Partners.get(info.lastInsertRowid);
  },
  update(id, { name, slug, notes }) {
    const cur = Partners.get(id);
    if (!cur) return null;
    let finalSlug = cur.slug;
    if (slug && slug !== cur.slug) {
      const base = slugify(slug);
      finalSlug = ensureUniqueSlug(base);
    }
    db.prepare('UPDATE partners SET name = ?, slug = ?, notes = ? WHERE id = ?').run(
      name != null ? String(name).trim() : cur.name,
      finalSlug,
      notes != null ? String(notes).trim() : cur.notes,
      id,
    );
    return Partners.get(id);
  },
  delete(id) {
    const info = db.prepare('DELETE FROM partners WHERE id = ?').run(id);
    return info.changes > 0;
  },
};

const Samples = {
  list({ partnerId } = {}) {
    if (partnerId === 'unassigned') {
      return db.prepare(`SELECT ${sampleCols} FROM samples WHERE partner_id IS NULL ORDER BY created_at DESC`).all();
    }
    if (partnerId != null) {
      return db.prepare(`SELECT ${sampleCols} FROM samples WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId);
    }
    return db.prepare(`SELECT ${sampleCols} FROM samples ORDER BY created_at DESC`).all();
  },
  get(id) {
    return db.prepare(`
      SELECT id, partner_id, title, bid_req, bid_res, status, notes, created_at
      FROM samples WHERE id = ?
    `).get(id);
  },
  create({ partner_id, title, bid_req, bid_res, status, notes }) {
    const info = db.prepare(`
      INSERT INTO samples(partner_id, title, bid_req, bid_res, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      partner_id || null,
      String(title || 'untitled').trim(),
      String(bid_req || ''),
      String(bid_res || ''),
      String(status || ''),
      String(notes || '').trim(),
    );
    return Samples.get(info.lastInsertRowid);
  },
  update(id, { partner_id, title, bid_req, bid_res, status, notes }) {
    const cur = Samples.get(id);
    if (!cur) return null;
    db.prepare(`
      UPDATE samples
      SET partner_id = ?, title = ?, bid_req = ?, bid_res = ?, status = ?, notes = ?
      WHERE id = ?
    `).run(
      partner_id !== undefined ? (partner_id || null) : cur.partner_id,
      title != null ? String(title).trim() : cur.title,
      bid_req != null ? String(bid_req) : cur.bid_req,
      bid_res != null ? String(bid_res) : cur.bid_res,
      status != null ? String(status) : cur.status,
      notes != null ? String(notes).trim() : cur.notes,
      id,
    );
    return Samples.get(id);
  },
  delete(id) {
    const info = db.prepare('DELETE FROM samples WHERE id = ?').run(id);
    return info.changes > 0;
  },
};

module.exports = { db, Partners, Samples, slugify };
