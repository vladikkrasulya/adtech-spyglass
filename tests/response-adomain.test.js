'use strict';

/**
 * tests/response-adomain.test.js — bid.adomain[] element validation for OpenRTB 2.x.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('@kyivtech/spyglass-core');
const { validResponse } = require('./fixtures');

const findById = (findings, id) => findings.find((f) => f.id === id);
const findAllById = (findings, id) => findings.filter((f) => f.id === id);

function bidResponse(adomain, { seat = 0, bid = 0 } = {}) {
  const res = validResponse();
  res.seatbid[seat].bid[bid].adomain = adomain;
  return res;
}

function twoSeatBidResponse() {
  const res = validResponse();
  res.seatbid.push({
    bid: [
      {
        id: 'bid-2a',
        impid: 'imp-1',
        price: 1.0,
        adm: '<html>creative</html>',
        adomain: ['advertiser.com'],
      },
      {
        id: 'bid-2b',
        impid: 'imp-1',
        price: 1.1,
        adm: '<html>creative2</html>',
        adomain: ['ads.example.com', 'localhost'],
      },
    ],
  });
  return res;
}

// ── Valid domains ───────────────────────────────────────────────────────────

test('adomain: single valid domain', () => {
  const { findings } = validate(bidResponse(['advertiser.com']));
  assert.equal(findById(findings, 'response.bid.adomain_invalid'), undefined);
});

test('adomain: multiple valid domains', () => {
  const { findings } = validate(
    bidResponse(['advertiser.com', 'ads.example.co.uk', 'my-brand.example']),
  );
  assert.equal(findById(findings, 'response.bid.adomain_invalid'), undefined);
});

// ── Invalid domains ─────────────────────────────────────────────────────────

for (const [label, value] of [
  ['empty string', ''],
  ['null', null],
  ['number', 123],
  ['localhost', 'localhost'],
  ['https URL', 'https://advertiser.com'],
  ['path suffix', 'advertiser.com/path'],
  ['port suffix', 'advertiser.com:443'],
  ['leading space', ' advertiser.com'],
]) {
  test(`adomain: invalid ${label}`, () => {
    const { findings } = validate(bidResponse([value]));
    const f = findById(findings, 'response.bid.adomain_invalid');
    assert.ok(f);
    assert.equal(f.level, 'error');
    assert.equal(f.path, 'seatbid[0].bid[0].adomain[0]');
  });
}

test('adomain: one finding per invalid element', () => {
  const { findings } = validate(
    bidResponse(['advertiser.com', '', 'localhost', 'https://evil.com']),
  );
  const hits = findAllById(findings, 'response.bid.adomain_invalid');
  assert.equal(hits.length, 3);
  assert.deepEqual(
    hits.map((f) => f.path),
    [
      'seatbid[0].bid[0].adomain[1]',
      'seatbid[0].bid[0].adomain[2]',
      'seatbid[0].bid[0].adomain[3]',
    ],
  );
});

test('adomain: second seatbid/bid/adomain path', () => {
  const { findings } = validate(twoSeatBidResponse());
  const hits = findAllById(findings, 'response.bid.adomain_invalid');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'seatbid[1].bid[1].adomain[1]');
  assert.equal(hits[0].params.sNum, 2);
  assert.equal(hits[0].params.bNum, 2);
});

// ── adomain_missing only ────────────────────────────────────────────────────

test('adomain: missing field → adomain_missing only', () => {
  const res = validResponse();
  delete res.seatbid[0].bid[0].adomain;
  const { findings } = validate(res);
  assert.ok(findById(findings, 'response.bid.adomain_missing'));
  assert.equal(findById(findings, 'response.bid.adomain_invalid'), undefined);
});

test('adomain: non-array → adomain_missing only', () => {
  const { findings } = validate(bidResponse('advertiser.com'));
  assert.ok(findById(findings, 'response.bid.adomain_missing'));
  assert.equal(findById(findings, 'response.bid.adomain_invalid'), undefined);
});

test('adomain: empty array → adomain_missing only', () => {
  const { findings } = validate(bidResponse([]));
  assert.ok(findById(findings, 'response.bid.adomain_missing'));
  assert.equal(findById(findings, 'response.bid.adomain_invalid'), undefined);
});

// ── validate() integration ──────────────────────────────────────────────────

test('validate(): adomain_invalid surfaces on public API', () => {
  const result = validate(bidResponse(['https://advertiser.com']));
  assert.equal(result.status, 'errors');
  const f = result.findings.find((x) => x.id === 'response.bid.adomain_invalid');
  assert.ok(f);
  assert.equal(typeof f.msg, 'string');
  assert.ok(f.msg.length > 0);
});
