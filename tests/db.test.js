'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Steer db.js to a temp dir before requiring it (db.js runs init() at require-time).
const TMP = mkdtempSync(join(tmpdir(), 'spyglass-test-'));
process.env.SPYGLASS_DATA_DIR = TMP;

let Partners, Samples;
before(() => {
  ({ Partners, Samples } = require('../db'));
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── Partners CRUD ─────────────────────────────────────────────────────────

test('partners: create + get + list', () => {
  const p = Partners.create({ name: 'Kadam', notes: 'first partner' });
  assert.equal(p.name, 'Kadam');
  assert.equal(p.slug, 'kadam');
  assert.equal(p.notes, 'first partner');
  assert.ok(p.id > 0);

  const fetched = Partners.get(p.id);
  assert.deepEqual(fetched, p);

  const list = Partners.list();
  assert.ok(list.some((x) => x.id === p.id));
});

test('partners: slug uniqueness collision adds numeric suffix', () => {
  const a = Partners.create({ name: 'Adsterra' });
  const b = Partners.create({ name: 'Adsterra' });
  assert.equal(a.slug, 'adsterra');
  assert.equal(b.slug, 'adsterra-2');
});

test('partners: update changes name and notes; preserves slug if not requested', () => {
  const p = Partners.create({ name: 'OldName' });
  const updated = Partners.update(p.id, { name: 'NewName', notes: 'changed' });
  assert.equal(updated.name, 'NewName');
  assert.equal(updated.notes, 'changed');
  assert.equal(updated.slug, p.slug);
});

test('partners: explicit slug change generates fresh unique slug', () => {
  Partners.create({ name: 'Foo', slug: 'foo' });
  const p = Partners.create({ name: 'Bar', slug: 'bar' });
  const updated = Partners.update(p.id, { slug: 'foo' }); // collision
  assert.equal(updated.slug, 'foo-2');
});

test('partners: delete removes row', () => {
  const p = Partners.create({ name: 'TempPartner' });
  assert.equal(Partners.delete(p.id), true);
  assert.equal(Partners.get(p.id), undefined);
  assert.equal(Partners.delete(p.id), false); // already gone
});

test('partners: name with accents and spaces produces clean slug', () => {
  const p = Partners.create({ name: 'PropellerAds  EU/UK!' });
  assert.equal(p.slug, 'propellerads-eu-uk');
});

// ── Samples CRUD ──────────────────────────────────────────────────────────

test('samples: create + list (no body in list response)', () => {
  const partner = Partners.create({ name: 'PartnerForSamples' });
  const s = Samples.create({
    partner_id: partner.id,
    title: 'first sample',
    bid_req: '{"id":"req-1"}',
    bid_res: '',
    status: 'Healthy',
  });
  assert.equal(s.title, 'first sample');
  assert.equal(s.partner_id, partner.id);
  assert.ok(s.id > 0);

  const list = Samples.list({ partnerId: partner.id });
  const found = list.find((x) => x.id === s.id);
  assert.ok(found);
  // List is metadata-only — no full bodies
  assert.equal(found.bid_req, undefined);
  assert.equal(found.bid_res, undefined);
  // But size info IS in list
  assert.equal(found.req_len, '{"id":"req-1"}'.length);
});

test('samples: get returns full bodies', () => {
  const s = Samples.create({
    title: 'with body',
    bid_req: '{"a":1}',
    bid_res: '{"b":2}',
  });
  const fetched = Samples.get(s.id);
  assert.equal(fetched.bid_req, '{"a":1}');
  assert.equal(fetched.bid_res, '{"b":2}');
});

test('samples: filter by unassigned vs partner', () => {
  const partner = Partners.create({ name: 'Filterable' });
  Samples.create({ partner_id: partner.id, title: 'with-partner' });
  Samples.create({ title: 'without-partner' }); // partner_id null

  const onlyPartner = Samples.list({ partnerId: partner.id });
  assert.ok(onlyPartner.every((s) => s.partner_id === partner.id));

  const unassigned = Samples.list({ partnerId: 'unassigned' });
  assert.ok(unassigned.every((s) => s.partner_id === null));
  assert.ok(unassigned.some((s) => s.title === 'without-partner'));
});

test('samples: deleting a partner sets sample.partner_id to NULL (ON DELETE SET NULL)', () => {
  const partner = Partners.create({ name: 'WillBeDeleted' });
  const s = Samples.create({ partner_id: partner.id, title: 'orphan-test' });

  Partners.delete(partner.id);

  const after = Samples.get(s.id);
  assert.equal(after.partner_id, null); // not deleted, just unassigned
  assert.equal(after.title, 'orphan-test');
});

test('samples: update changes title, partner, notes', () => {
  const p1 = Partners.create({ name: 'PartnerA' });
  const p2 = Partners.create({ name: 'PartnerB' });
  const s = Samples.create({ partner_id: p1.id, title: 'original' });

  const updated = Samples.update(s.id, { title: 'renamed', partner_id: p2.id, notes: 'note' });
  assert.equal(updated.title, 'renamed');
  assert.equal(updated.partner_id, p2.id);
  assert.equal(updated.notes, 'note');
});

test('samples: update with explicit null partner_id unassigns', () => {
  const p = Partners.create({ name: 'PartnerC' });
  const s = Samples.create({ partner_id: p.id, title: 'will-unassign' });
  const updated = Samples.update(s.id, { partner_id: null });
  assert.equal(updated.partner_id, null);
});

test('samples: delete removes row', () => {
  const s = Samples.create({ title: 'temp' });
  assert.equal(Samples.delete(s.id), true);
  assert.equal(Samples.get(s.id), undefined);
});
