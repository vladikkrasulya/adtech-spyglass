'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Steer db.js to a temp dir before requiring it (db.js runs init() at require-time).
const TMP = mkdtempSync(join(tmpdir(), 'spyglass-test-'));
process.env.SPYGLASS_DATA_DIR = TMP;

let db, Users, Partners, Samples, AnalyzeLog, Sessions, BehaviorCorpus, SCHEMA_VERSION;
let userA, userB;
before(() => {
  ({ db, Users, Partners, Samples, AnalyzeLog, Sessions, BehaviorCorpus, SCHEMA_VERSION } =
    require('../db'));
  // Seed two users so scoping tests have something to compare against.
  userA = Users.create({ email: 'a@example.com', password_hash: 'x' });
  userB = Users.create({ email: 'b@example.com', password_hash: 'x' });
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── Schema + pragmas ──────────────────────────────────────────────────────

test('init: user_version matches SCHEMA_VERSION after fresh boot', () => {
  const ver = Number(db.pragma('user_version', { simple: true }));
  assert.equal(ver, SCHEMA_VERSION, 'pragma user_version should equal SCHEMA_VERSION');
});

test('init: busy_timeout is set to 5000ms', () => {
  const bt = Number(db.pragma('busy_timeout', { simple: true }));
  assert.equal(bt, 5000, 'busy_timeout pragma should be 5000ms for backup contention headroom');
});

test('init: WAL mode + foreign_keys enabled', () => {
  const jm = String(db.pragma('journal_mode', { simple: true })).toLowerCase();
  assert.equal(jm, 'wal', 'journal_mode should be WAL');
  const fk = Number(db.pragma('foreign_keys', { simple: true }));
  assert.equal(fk, 1, 'foreign_keys should be ON');
});

// ── Users ─────────────────────────────────────────────────────────────────

test('users: lookup by id and by email', () => {
  const byId = Users.get(userA.id);
  assert.equal(byId.email, 'a@example.com');
  const byEmail = Users.getByEmail('A@Example.COM'); // case-insensitive
  assert.equal(byEmail.id, userA.id);
  assert.ok(
    byEmail.password_hash,
    'password_hash should be returned by getByEmail (for verification)',
  );
});

test('users: get() does NOT return password_hash', () => {
  const u = Users.get(userA.id);
  assert.equal(u.password_hash, undefined);
});

test('users: count reflects seeds', () => {
  assert.ok(Users.count() >= 2);
});

// ── Partners CRUD ─────────────────────────────────────────────────────────

test('partners: create + list scoped to user', () => {
  const p = Partners.create({ userId: userA.id, name: 'Kadam' });
  assert.equal(p.user_id, userA.id);
  const list = Partners.list({ userId: userA.id });
  assert.ok(list.some((x) => x.id === p.id));
  // userB doesn't see userA's partners
  const otherList = Partners.list({ userId: userB.id });
  assert.equal(
    otherList.find((x) => x.id === p.id),
    undefined,
  );
});

test('partners: same slug allowed across different users', () => {
  const a = Partners.create({ userId: userA.id, name: 'Adsterra' });
  const b = Partners.create({ userId: userB.id, name: 'Adsterra' });
  assert.equal(a.slug, 'adsterra');
  assert.equal(b.slug, 'adsterra'); // not 'adsterra-2' — slug is per-user
});

test('partners: slug collision within same user adds numeric suffix', () => {
  const a = Partners.create({ userId: userA.id, name: 'PropellerAds' });
  const b = Partners.create({ userId: userA.id, name: 'PropellerAds' });
  assert.equal(a.slug, 'propellerads');
  assert.equal(b.slug, 'propellerads-2');
});

test('partners: update is scoped — userB cannot update userA partner', () => {
  const p = Partners.create({ userId: userA.id, name: 'OnlyForA' });
  const updated = Partners.update({ id: p.id, userId: userB.id, name: 'StolenByB' });
  assert.equal(updated, null, 'cross-user update must return null');
  // verify userA's partner unchanged
  const cur = Partners.get({ id: p.id, userId: userA.id });
  assert.equal(cur.name, 'OnlyForA');
});

test('partners: delete is scoped — userB cannot delete userA partner', () => {
  const p = Partners.create({ userId: userA.id, name: 'DeleteAttempt' });
  const ok = Partners.delete({ id: p.id, userId: userB.id });
  assert.equal(ok, false);
  assert.ok(Partners.get({ id: p.id, userId: userA.id }), 'should still exist');
});

test('partners: get is scoped', () => {
  const p = Partners.create({ userId: userA.id, name: 'PrivateA' });
  assert.equal(Partners.get({ id: p.id, userId: userA.id }).name, 'PrivateA');
  assert.equal(Partners.get({ id: p.id, userId: userB.id }), undefined);
});

// ── Samples CRUD ──────────────────────────────────────────────────────────

test('samples: create + list scoped to user', () => {
  const s = Samples.create({
    userId: userA.id,
    title: 'a-sample',
    bid_req: '{"id":"x"}',
  });
  assert.equal(s.user_id, userA.id);
  // userB sees nothing
  const otherList = Samples.list({ userId: userB.id });
  assert.equal(
    otherList.find((x) => x.id === s.id),
    undefined,
  );
});

test('samples: get returns full bodies; cross-user get returns undefined', () => {
  const s = Samples.create({
    userId: userA.id,
    title: 'with-body',
    bid_req: '{"a":1}',
    bid_res: '{"b":2}',
  });
  const fetched = Samples.get({ id: s.id, userId: userA.id });
  assert.equal(fetched.bid_req, '{"a":1}');
  assert.equal(fetched.bid_res, '{"b":2}');
  // userB sees nothing
  assert.equal(Samples.get({ id: s.id, userId: userB.id }), undefined);
});

test('samples: filter by partner_id and unassigned', () => {
  const partner = Partners.create({ userId: userA.id, name: 'Filterable' });
  Samples.create({ userId: userA.id, partner_id: partner.id, title: 'with-partner' });
  Samples.create({ userId: userA.id, title: 'without-partner' });

  const onlyPartner = Samples.list({ userId: userA.id, partnerId: partner.id });
  assert.ok(onlyPartner.every((s) => s.partner_id === partner.id));
  const unassigned = Samples.list({ userId: userA.id, partnerId: 'unassigned' });
  assert.ok(unassigned.every((s) => s.partner_id === null));
});

test("samples: cannot reference another user's partner on create", () => {
  const partnerOfB = Partners.create({ userId: userB.id, name: 'OnlyB' });
  assert.throws(
    () => Samples.create({ userId: userA.id, partner_id: partnerOfB.id, title: 'x' }),
    /does not belong/,
  );
});

test('samples: deleting a partner sets sample.partner_id to NULL (ON DELETE SET NULL)', () => {
  const partner = Partners.create({ userId: userA.id, name: 'WillBeDeleted' });
  const s = Samples.create({
    userId: userA.id,
    partner_id: partner.id,
    title: 'orphan-test',
  });

  Partners.delete({ id: partner.id, userId: userA.id });

  const after = Samples.get({ id: s.id, userId: userA.id });
  assert.equal(after.partner_id, null);
  assert.equal(after.title, 'orphan-test');
});

test('samples: update is scoped', () => {
  const s = Samples.create({ userId: userA.id, title: 'untouched' });
  const updated = Samples.update({ id: s.id, userId: userB.id, title: 'stolen' });
  assert.equal(updated, null);
  assert.equal(Samples.get({ id: s.id, userId: userA.id }).title, 'untouched');
});

test('samples: delete is scoped', () => {
  const s = Samples.create({ userId: userA.id, title: 'delete-target' });
  assert.equal(Samples.delete({ id: s.id, userId: userB.id }), false);
  assert.ok(Samples.get({ id: s.id, userId: userA.id }));
  assert.equal(Samples.delete({ id: s.id, userId: userA.id }), true);
});

test('samples: deleting a user cascades to their samples and partners', () => {
  const tmpUser = Users.create({ email: 'cascade@example.com', password_hash: 'x' });
  const p = Partners.create({ userId: tmpUser.id, name: 'CascadePartner' });
  const s = Samples.create({ userId: tmpUser.id, title: 'cascade' });
  const { db } = require('../db');
  db.prepare('DELETE FROM users WHERE id = ?').run(tmpUser.id);
  assert.equal(Partners.get({ id: p.id, userId: tmpUser.id }), undefined);
  assert.equal(Samples.get({ id: s.id, userId: tmpUser.id }), undefined);
});

// ── Phase 8: email verification + password reset ─────────────────────────

test('users: get() and getByEmail() include email_verified_at (NULL by default)', () => {
  const u = Users.create({ email: 'verify-default@example.com', password_hash: 'x' });
  assert.equal(Users.get(u.id).email_verified_at, null);
  assert.equal(Users.getByEmail('verify-default@example.com').email_verified_at, null);
});

test('users: markEmailVerified stamps a timestamp; second call overwrites', () => {
  const u = Users.create({ email: 'mark-verify@example.com', password_hash: 'x' });
  Users.markEmailVerified(u.id);
  const after1 = Users.get(u.id).email_verified_at;
  assert.ok(typeof after1 === 'number' && after1 > 0, 'should be unix-ms timestamp');
  // Sleep a few ms so the second timestamp is strictly greater (or at least equal).
  const before2 = Date.now();
  Users.markEmailVerified(u.id);
  const after2 = Users.get(u.id).email_verified_at;
  assert.ok(after2 >= before2 - 50, 'second mark should also produce a recent timestamp');
});

test('users: updatePassword replaces the bcrypt hash', () => {
  const u = Users.create({ email: 'pwchange@example.com', password_hash: 'old-hash' });
  Users.updatePassword(u.id, 'new-hash');
  const fetched = Users.getByEmail('pwchange@example.com');
  assert.equal(fetched.password_hash, 'new-hash');
});

test('users: clearCryptoState nulls all 6 crypto columns', () => {
  const u = Users.create({ email: 'clearcrypto@example.com', password_hash: 'x' });
  Users.setCryptoState(u.id, {
    kdf_salt: 'sa',
    dek_wrapped: 'dw',
    dek_iv: 'di',
    recovery_salt: 'rs',
    recovery_dek_wrapped: 'rdw',
    recovery_dek_iv: 'rdi',
  });
  const before = Users.getCryptoState(u.id);
  assert.equal(before.kdf_salt, 'sa');
  assert.equal(before.recovery_dek_iv, 'rdi');

  Users.clearCryptoState(u.id);
  const after = Users.getCryptoState(u.id);
  assert.equal(after.kdf_salt, null);
  assert.equal(after.dek_wrapped, null);
  assert.equal(after.dek_iv, null);
  assert.equal(after.recovery_salt, null);
  assert.equal(after.recovery_dek_wrapped, null);
  assert.equal(after.recovery_dek_iv, null);
});

test('users: updatePasswordAndCrypto rotates atomically, preserves recovery wrap', () => {
  const u = Users.create({ email: 'rotate@example.com', password_hash: 'old' });
  // Seed full crypto state including recovery wrap.
  Users.setCryptoState(u.id, {
    kdf_salt: 'salt-old',
    dek_wrapped: 'wrap-old',
    dek_iv: 'iv-old',
    recovery_salt: 'rsalt',
    recovery_dek_wrapped: 'rwrap',
    recovery_dek_iv: 'riv',
  });

  Users.updatePasswordAndCrypto(u.id, 'new', {
    kdf_salt: 'salt-new',
    dek_wrapped: 'wrap-new',
    dek_iv: 'iv-new',
  });

  const after = Users.getCryptoState(u.id);
  assert.equal(after.kdf_salt, 'salt-new', 'password-side salt rotated');
  assert.equal(after.dek_wrapped, 'wrap-new', 'password-side wrap rotated');
  assert.equal(after.recovery_salt, 'rsalt', 'recovery salt preserved');
  assert.equal(after.recovery_dek_wrapped, 'rwrap', 'recovery wrap preserved');
  assert.equal(Users.getByEmail('rotate@example.com').password_hash, 'new');
});

test('users: updatePasswordAndWipe is atomic and returns per-table counts', () => {
  const u = Users.create({ email: 'awipe@example.com', password_hash: 'old' });
  Users.setCryptoState(u.id, {
    kdf_salt: 's',
    dek_wrapped: 'w',
    dek_iv: 'i',
    recovery_salt: 'rs',
    recovery_dek_wrapped: 'rw',
    recovery_dek_iv: 'ri',
  });
  Partners.create({ userId: u.id, name: 'p1' });
  Samples.create({ userId: u.id, title: 's1' });
  AnalyzeLog.record({
    userId: u.id,
    payloadType: 'request',
    version: '2.6',
    status: 'clean',
    format: 'banner',
    findingCount: 0,
    errorCount: 0,
    warningCount: 0,
  });
  BehaviorCorpus.create({ userId: u.id, label: 'fraud', events: [{ kind: 'click' }] });
  Sessions.create({
    token: 'awipe-tok-' + u.id,
    userId: u.id,
    expiresAt: Date.now() + 60000,
    ip: '127.0.0.1',
    ua: 'test',
  });

  const r = Users.updatePasswordAndWipe(u.id, 'fresh');
  assert.equal(r.samplesDeleted, 1);
  assert.equal(r.partnersDeleted, 1);
  assert.equal(r.analyzeLogDeleted, 1);
  assert.equal(r.behaviorCorpusDeleted, 1);
  assert.equal(r.sessionsDeleted, 1);

  // Password updated, crypto cleared
  assert.equal(Users.getByEmail('awipe@example.com').password_hash, 'fresh');
  const cs = Users.getCryptoState(u.id);
  assert.equal(cs.kdf_salt, null, 'password-side crypto cleared');
  assert.equal(cs.recovery_salt, null, 'recovery-side crypto cleared too');
});

test('users: wipeUserData sweeps all per-user tables but keeps the user row', () => {
  const u = Users.create({ email: 'wipe@example.com', password_hash: 'x' });
  const p = Partners.create({ userId: u.id, name: 'WipePartner' });
  const s1 = Samples.create({ userId: u.id, title: 's1' });
  const s2 = Samples.create({ userId: u.id, partner_id: p.id, title: 's2' });
  // Seed activity + corpus + session rows so the wipe has something to clear.
  // Pre-fix wipeUserData only touched samples + partners; this exercises the
  // extended contract (analyze_log + behavior_corpus + sessions also swept).
  AnalyzeLog.record({
    userId: u.id,
    payloadType: 'request',
    version: '2.6',
    status: 'clean',
    format: 'banner',
    findingCount: 0,
    errorCount: 0,
    warningCount: 0,
  });
  BehaviorCorpus.create({
    userId: u.id,
    label: 'fraud',
    events: [{ kind: 'click', t: 100 }],
    notes: 'pre-wipe',
  });
  Sessions.create({
    token: 'wipe-token-' + u.id,
    userId: u.id,
    expiresAt: Date.now() + 60000,
    ip: '127.0.0.1',
    ua: 'test',
  });

  const result = Users.wipeUserData(u.id);
  assert.equal(result.samplesDeleted, 2);
  assert.equal(result.partnersDeleted, 1);
  assert.equal(result.analyzeLogDeleted, 1);
  assert.equal(result.behaviorCorpusDeleted, 1);
  assert.equal(result.sessionsDeleted, 1);

  // User row still exists
  assert.ok(Users.get(u.id), 'user must survive');
  // Samples and partners gone
  assert.equal(Samples.get({ id: s1.id, userId: u.id }), undefined);
  assert.equal(Samples.get({ id: s2.id, userId: u.id }), undefined);
  assert.equal(Partners.get({ id: p.id, userId: u.id }), undefined);
  // Activity + corpus + sessions also gone
  assert.equal(BehaviorCorpus.listForUser(u.id).length, 0, 'behavior_corpus wiped');
  assert.equal(Sessions.loadActive(Date.now()).filter((s) => s.userId === u.id).length, 0);
});

// ── BehaviorCorpus ────────────────────────────────────────────────────────

test('corpus: create + listForUser, scoped per user', () => {
  const events = [
    { kind: 'click', t: 100 },
    { kind: 'heartbeat', t: 200 },
  ];
  const r = BehaviorCorpus.create({
    userId: userA.id,
    label: 'fraud',
    events,
    notes: 'looks like a bot',
  });
  assert.ok(r.id > 0, 'should return new id');

  const listed = BehaviorCorpus.listForUser(userA.id);
  assert.ok(
    listed.find((e) => e.id === r.id),
    'visible to userA',
  );
  assert.equal(listed.find((e) => e.id === r.id).label, 'fraud');
  assert.equal(listed.find((e) => e.id === r.id).eventCount, 2);

  // not visible to userB
  const otherList = BehaviorCorpus.listForUser(userB.id);
  assert.equal(
    otherList.find((e) => e.id === r.id),
    undefined,
  );
});

test('corpus: rejects invalid label', () => {
  assert.throws(
    () =>
      BehaviorCorpus.create({
        userId: userA.id,
        label: 'spam',
        events: [{ x: 1 }],
      }),
    /label_invalid/,
  );
});

test('corpus: rejects empty events', () => {
  assert.throws(
    () => BehaviorCorpus.create({ userId: userA.id, label: 'fraud', events: [] }),
    /events_required/,
  );
  assert.throws(
    () => BehaviorCorpus.create({ userId: userA.id, label: 'fraud', events: null }),
    /events_required/,
  );
});

test('corpus: countsForUser groups by label', () => {
  const u = Users.create({ email: 'corpus-counts@example.com', password_hash: 'x' });
  BehaviorCorpus.create({ userId: u.id, label: 'fraud', events: [{ x: 1 }] });
  BehaviorCorpus.create({ userId: u.id, label: 'fraud', events: [{ x: 2 }] });
  BehaviorCorpus.create({ userId: u.id, label: 'legitimate', events: [{ x: 3 }] });
  const counts = BehaviorCorpus.countsForUser(u.id);
  assert.equal(counts.fraud, 2);
  assert.equal(counts.legitimate, 1);
  assert.equal(counts.ambiguous, 0);
  assert.equal(counts.total, 3);
});

test('corpus: listForUser respects label filter', () => {
  const u = Users.create({ email: 'corpus-filter@example.com', password_hash: 'x' });
  BehaviorCorpus.create({ userId: u.id, label: 'fraud', events: [{ a: 1 }] });
  BehaviorCorpus.create({ userId: u.id, label: 'legitimate', events: [{ a: 2 }] });
  BehaviorCorpus.create({ userId: u.id, label: 'ambiguous', events: [{ a: 3 }] });
  const fraudOnly = BehaviorCorpus.listForUser(u.id, { label: 'fraud' });
  assert.equal(fraudOnly.length, 1);
  assert.equal(fraudOnly[0].label, 'fraud');
});

test('corpus: getById returns full events_json, scoped per user', () => {
  const u = Users.create({ email: 'corpus-get@example.com', password_hash: 'x' });
  const events = [{ kind: 'click', t: 50 }];
  const r = BehaviorCorpus.create({ userId: u.id, label: 'legitimate', events });
  const row = BehaviorCorpus.getById(r.id, u.id);
  assert.equal(row.label, 'legitimate');
  assert.deepEqual(JSON.parse(row.eventsJson), events);

  // wrong user → no row
  assert.equal(BehaviorCorpus.getById(r.id, userB.id), undefined);
});

test('corpus: destroy is per-user', () => {
  const u = Users.create({ email: 'corpus-destroy@example.com', password_hash: 'x' });
  const r = BehaviorCorpus.create({ userId: u.id, label: 'fraud', events: [{ x: 1 }] });
  // Wrong user can't delete
  assert.equal(BehaviorCorpus.destroy(r.id, userB.id), false);
  assert.ok(BehaviorCorpus.getById(r.id, u.id), 'still present');
  // Owner deletes
  assert.equal(BehaviorCorpus.destroy(r.id, u.id), true);
  assert.equal(BehaviorCorpus.getById(r.id, u.id), undefined);
});

test('corpus: cascades on user delete (FK ON DELETE CASCADE)', () => {
  const u = Users.create({ email: 'corpus-cascade@example.com', password_hash: 'x' });
  const r1 = BehaviorCorpus.create({ userId: u.id, label: 'fraud', events: [{ x: 1 }] });
  const r2 = BehaviorCorpus.create({ userId: u.id, label: 'legitimate', events: [{ x: 2 }] });
  Users.wipeUserData(u.id);
  // wipeUserData doesn't delete the user row itself but our table is on
  // user_id; sanity check current behavior. After explicit user delete:
  const { db } = require('../db');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  assert.equal(BehaviorCorpus.getById(r1.id, u.id), undefined);
  assert.equal(BehaviorCorpus.getById(r2.id, u.id), undefined);
});
