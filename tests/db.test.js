'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Steer db.js to a temp dir before requiring it (db.js runs init() at require-time).
const TMP = mkdtempSync(join(tmpdir(), 'spyglass-test-'));
process.env.SPYGLASS_DATA_DIR = TMP;

let Users, Partners, Samples;
let userA, userB;
before(() => {
  ({ Users, Partners, Samples } = require('../db'));
  // Seed two users so scoping tests have something to compare against.
  userA = Users.create({ email: 'a@example.com', password_hash: 'x' });
  userB = Users.create({ email: 'b@example.com', password_hash: 'x' });
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
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
