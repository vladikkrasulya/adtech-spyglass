'use strict';

/**
 * tests/banner-pos-mimes.test.js — banner.pos and banner.mimes validation for OpenRTB 2.x.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('@ortbtools/core');
const { validRequest } = require('./fixtures');

const findById = (findings, id) => findings.find((f) => f.id === id);
const findAllById = (findings, id) => findings.filter((f) => f.id === id);

function bannerImp(bannerPatch, { impIndex = 0 } = {}) {
  const req = validRequest();
  req.imp[impIndex].banner = Object.assign({}, req.imp[impIndex].banner, bannerPatch);
  return req;
}

function twoImpRequest(banner0, banner1) {
  const req = validRequest();
  req.imp[0].banner = Object.assign({}, req.imp[0].banner, banner0);
  req.imp.push({
    id: 'imp-2',
    bidfloor: 0.1,
    bidfloorcur: 'USD',
    banner: Object.assign({ w: 300, h: 250 }, banner1),
  });
  return req;
}

// ── Omitted fields ──────────────────────────────────────────────────────────

test('banner: omitted pos and mimes → no findings', () => {
  const { findings } = validate(validRequest());
  assert.equal(findById(findings, 'imp.banner.pos_nonstandard'), undefined);
  assert.equal(findById(findings, 'imp.banner.mimes_invalid'), undefined);
});

// ── banner.pos ──────────────────────────────────────────────────────────────

for (const pos of [0, 1, 2, 3, 4, 5, 6, 7]) {
  test(`banner.pos: valid ${pos}`, () => {
    const { findings } = validate(bannerImp({ pos }));
    assert.equal(findById(findings, 'imp.banner.pos_nonstandard'), undefined);
  });
}

for (const [label, pos] of [
  ['-1', -1],
  ['8', 8],
  ['500', 500],
  ['1.5', 1.5],
  ['string "1"', '1'],
  ['null', null],
]) {
  test(`banner.pos: invalid ${label}`, () => {
    const { findings } = validate(bannerImp({ pos }));
    const f = findById(findings, 'imp.banner.pos_nonstandard');
    assert.ok(f);
    assert.equal(f.level, 'warning');
    assert.equal(f.path, 'imp[0].banner.pos');
  });
}

// ── banner.mimes ────────────────────────────────────────────────────────────

test('banner.mimes: valid non-empty strings', () => {
  const { findings } = validate(bannerImp({ mimes: ['image/jpeg', 'image/png', 'image/gif'] }));
  assert.equal(findById(findings, 'imp.banner.mimes_invalid'), undefined);
});

test('banner.mimes: non-array → mimes_invalid', () => {
  const { findings } = validate(bannerImp({ mimes: 'image/jpeg' }));
  const f = findById(findings, 'imp.banner.mimes_invalid');
  assert.ok(f);
  assert.equal(f.level, 'error');
  assert.equal(f.path, 'imp[0].banner.mimes');
});

test('banner.mimes: empty array → mimes_invalid', () => {
  const { findings } = validate(bannerImp({ mimes: [] }));
  const f = findById(findings, 'imp.banner.mimes_invalid');
  assert.ok(f);
  assert.equal(f.path, 'imp[0].banner.mimes');
});

for (const [label, value] of [
  ['null', null],
  ['number', 123],
  ['object', {}],
  ['empty string', ''],
  ['whitespace only', '   '],
]) {
  test(`banner.mimes: invalid element ${label}`, () => {
    const { findings } = validate(bannerImp({ mimes: ['image/jpeg', value] }));
    const f = findById(findings, 'imp.banner.mimes_invalid');
    assert.ok(f);
    assert.equal(f.level, 'error');
    assert.equal(f.path, 'imp[0].banner.mimes[1]');
  });
}

test('banner.mimes: one finding per invalid element', () => {
  const { findings } = validate(bannerImp({ mimes: ['image/jpeg', '', null, '   ', 42] }));
  const hits = findAllById(findings, 'imp.banner.mimes_invalid');
  assert.equal(hits.length, 4);
  assert.deepEqual(
    hits.map((f) => f.path),
    [
      'imp[0].banner.mimes[1]',
      'imp[0].banner.mimes[2]',
      'imp[0].banner.mimes[3]',
      'imp[0].banner.mimes[4]',
    ],
  );
});

test('banner: second imp and second mimes element paths', () => {
  const { findings } = validate(
    twoImpRequest({ mimes: ['image/jpeg'] }, { mimes: ['image/png', ''] }),
  );
  const hits = findAllById(findings, 'imp.banner.mimes_invalid');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'imp[1].banner.mimes[1]');
  assert.equal(hits[0].params.num, 2);
});

// ── validate() integration ──────────────────────────────────────────────────

test('validate(): banner.mimes_invalid surfaces on public API', () => {
  const result = validate(bannerImp({ mimes: [] }));
  assert.equal(result.status, 'errors');
  const f = result.findings.find((x) => x.id === 'imp.banner.mimes_invalid');
  assert.ok(f);
  assert.equal(f.path, 'imp[0].banner.mimes');
  assert.equal(typeof f.msg, 'string');
  assert.ok(f.msg.length > 0);
});
