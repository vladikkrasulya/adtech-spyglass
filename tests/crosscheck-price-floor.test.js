'use strict';

/**
 * tests/crosscheck-price-floor.test.js — regression gates for feature 022,
 * closing three DEF-11x findings recorded in the 020 audit
 * (tests/corpus/known-gaps.json):
 *
 *   DEF-110 — crosscheck.js coerced bid.price through `Number(x)` before
 *     testing finiteness, so `[]`, `[1]`, `true`, `''`, `-1` and `'1.25'` all
 *     "passed" and produced an above_floor/below_floor verdict on a value the
 *     response does not actually carry. The fix mirrors the validator's own,
 *     already-correct predicate byte-for-byte (rules/price-floor/index.js):
 *     `typeof price === 'number' && Number.isFinite(price) && price >= 0`.
 *
 *   DEF-104 — crosscheck.js compared every bid against `imp.bidfloor` only,
 *     never against a matched PMP deal's own floor
 *     (`bid.dealid === imp.pmp.deals[].id`), even though
 *     rules/price-floor/index.js's resolveFloor() already resolved deal
 *     floors correctly. The two engines disagreed on the same payload. The
 *     fix routes crosscheck through the same resolveDealFloor() extracted
 *     out of rules/price-floor/index.js, so a deal's own bidfloor (at ANY
 *     value, including 0) governs over the imp floor.
 *
 *   DEF-105 — two independent bugs on the OpenRTB 3.0 path: (a)
 *     crosscheck.js's projectItem30() read the misspelled `item.flrcu`
 *     instead of the spec's `item.flrcur` (openrtb-3.0-FINAL.md:517,586),
 *     defaulting every 3.0 floor's currency to USD; (b) index.js passed the
 *     raw, unprojected 3.0 request envelope as `ctx.req` to the ORTB_RESPONSE
 *     plugin pass, so rules/currency/index.js's `req.cur` read undefined off
 *     it and silently defaulted the allowed-currency set to ['USD'],
 *     producing a spurious err-bid-currency-mismatch for a wholly permitted
 *     non-USD response.
 *
 * All assertions go through the PUBLIC boundary (`require('@ortbtools/core')`
 * → validate()/crosscheck()), on stable `id`/`path`/`params`, never message
 * text, per the convention in tests/validator.test.js. Both protocol families
 * (2.x flat payload, 3.0 envelope) are covered, and several cases assert that
 * crosscheck's verdict and rules/price-floor's own finding name the SAME
 * effective floor — the two-engines-agree contract DEF-104 exists to close.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('@ortbtools/core');

const byId = (findings, id) => findings.find((f) => f.id === id);
const allById = (findings, id) => findings.filter((f) => f.id === id);

// ── 2.x fixture builders ────────────────────────────────────────────────

/** A single-imp, single-bid 2.x pair with an explicit imp floor and no deal.
 * @param {{ price?: any, bidfloor?: any, bidfloorcur?: any, dealid?: string }} [o]
 */
function pair2x(o = {}) {
  const req = {
    id: 'r',
    cur: ['USD'],
    imp: [
      {
        id: '1',
        bidfloor: 'bidfloor' in o ? o.bidfloor : 0.2,
        bidfloorcur: o.bidfloorcur || 'USD',
      },
    ],
  };
  const bid = { id: 'b', impid: '1', price: 'price' in o ? o.price : 1.25 };
  if (o.dealid) bid.dealid = o.dealid;
  const res = { id: 'r', cur: 'USD', seatbid: [{ bid: [bid] }] };
  return { req, res };
}

/** A single-imp, single-bid 2.x pair carrying one PMP deal.
 * @param {{ price?: any, impBidfloor?: any, impBidfloorcur?: string, dealId?: string, dealBidfloor?: any, dealBidfloorcur?: string, bidDealid?: string, resCur?: string }} [o]
 */
function dealPair2x(o = {}) {
  const deal = { id: o.dealId ?? 'D1' };
  if ('dealBidfloor' in o) deal.bidfloor = o.dealBidfloor;
  else deal.bidfloor = 0.75;
  if (o.dealBidfloorcur) deal.bidfloorcur = o.dealBidfloorcur;
  const imp = { id: '1', pmp: { deals: [deal] } };
  if ('impBidfloor' in o) imp.bidfloor = o.impBidfloor;
  if (o.impBidfloorcur) imp.bidfloorcur = o.impBidfloorcur;
  const req = { id: 'r', cur: ['USD'], imp: [imp] };
  const bid = {
    id: 'b',
    impid: '1',
    price: 'price' in o ? o.price : 1.25,
    dealid: o.bidDealid !== undefined ? o.bidDealid : 'D1',
  };
  const res = { id: 'r', cur: o.resCur || 'USD', seatbid: [{ bid: [bid] }] };
  return { req, res };
}

// ── 3.0 fixture builders ────────────────────────────────────────────────

/** @param {{ reqCur?: string[], flr?: number, flrcur?: string }} [o] */
function req30(o = {}) {
  return {
    openrtb: {
      ver: '3.0',
      request: {
        id: 'auc-1',
        cur: o.reqCur || ['EUR'],
        context: { site: { domain: 'x.com' }, device: { ua: 'UA', ip: '1.2.3.4', lang: 'en' } },
        item: [
          {
            id: 's1',
            flr: 'flr' in o ? o.flr : 0.5,
            flrcur: 'flrcur' in o ? o.flrcur : 'EUR',
            spec: { placement: { display: { w: 300, h: 250, displayfmt: [{ w: 300, h: 250 }] } } },
          },
        ],
      },
    },
  };
}

/** @param {{ price?: number, resCur?: string }} [o] */
function res30(o = {}) {
  return {
    openrtb: {
      ver: '3.0',
      response: {
        id: 'auc-1',
        cur: o.resCur || 'EUR',
        seatbid: [
          {
            bid: [
              {
                id: 'b1',
                item: 's1',
                price: 'price' in o ? o.price : 1.25,
                media: { adomain: ['ok.com'], display: { w: 300, h: 250, adm: '<div/>' } },
              },
            ],
          },
        ],
      },
    },
  };
}

// ── DEF-110: price validity, table-driven ─────────────────────────────────

const INVALID_PRICES = [
  ['empty array', []],
  ['one-element array', [1]],
  ['boolean true', true],
  ['boolean false', false],
  ['empty string', ''],
  ['numeric string', '1.25'],
  ['negative integer', -1],
  ['negative fraction', -0.0001],
  ['NaN', NaN],
  ['+Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['null', null],
  ['undefined', undefined],
];

for (const [label, price] of INVALID_PRICES) {
  test(`crosscheck (2.x, public boundary): bid.price = ${label} is price_invalid, never above/below floor`, () => {
    const { req, res } = pair2x({ price });
    const findings = core.crosscheck(req, res);
    const invalid = byId(findings, 'crosscheck.bid.price_invalid');
    assert.ok(invalid, `expected crosscheck.bid.price_invalid for ${label}`);
    assert.equal(invalid.level, 'crit');
    assert.equal(invalid.path, 'seatbid[0].bid[0].price');
    assert.equal(byId(findings, 'crosscheck.bid.above_floor'), undefined);
    assert.equal(byId(findings, 'crosscheck.bid.below_floor'), undefined);
  });
}

test('crosscheck: 0 is a valid bid price, not price_invalid', () => {
  const { req, res } = pair2x({ price: 0, bidfloor: 0 });
  const findings = core.crosscheck(req, res);
  assert.equal(byId(findings, 'crosscheck.bid.price_invalid'), undefined);
  const above = byId(findings, 'crosscheck.bid.above_floor');
  assert.ok(above, 'price 0 against floor 0 is above_floor (0 >= 0)');
  assert.equal(above.params.floor, '0.0000');
});

test('crosscheck: price 0 below a positive floor is below_floor, not price_invalid', () => {
  const { req, res } = pair2x({ price: 0, bidfloor: 0.2 });
  const findings = core.crosscheck(req, res);
  assert.equal(byId(findings, 'crosscheck.bid.price_invalid'), undefined);
  const below = byId(findings, 'crosscheck.bid.below_floor');
  assert.ok(below);
  assert.equal(below.params.floor, '0.2000');
});

test('crosscheck: an invalid price at the response validator agrees with crosscheck (never above/below)', () => {
  // The validator side (rules/price-floor) already rejected these correctly;
  // this pins that crosscheck now agrees rather than inventing a verdict.
  for (const [, price] of [
    ['array', []],
    ['boolean', true],
    ['string', '1.25'],
    ['negative', -1],
  ]) {
    const { req, res } = pair2x({ price });
    const { findings: valFindings } = core.validate(res, { pairReq: req });
    const cross = core.crosscheck(req, res);
    assert.ok(
      byId(valFindings, 'err-bid-price-negative'),
      `validator must reject price ${JSON.stringify(price)}`,
    );
    assert.ok(byId(cross, 'crosscheck.bid.price_invalid'));
    assert.equal(byId(cross, 'crosscheck.bid.above_floor'), undefined);
    assert.equal(byId(cross, 'crosscheck.bid.below_floor'), undefined);
  }
});

// ── DEF-104: matched PMP deal floor governs ───────────────────────────────

test('crosscheck (2.x, public boundary): a bid naming a matched PMP deal is judged against the deal floor, not the imp floor', () => {
  const { req, res } = dealPair2x({ price: 1.25, impBidfloor: 0.2, dealBidfloor: 0.75 });
  const findings = core.crosscheck(req, res);
  const above = byId(findings, 'crosscheck.bid.above_floor');
  assert.ok(above, 'price 1.25 clears the 0.75 deal floor');
  assert.equal(
    above.params.floor,
    '0.7500',
    'must report the DEAL floor, not the imp floor 0.2000',
  );
});

test('crosscheck: a bid above the imp floor but below the matched deal floor is below_floor, never above_floor', () => {
  const { req, res } = dealPair2x({ price: 0.5, impBidfloor: 0.2, dealBidfloor: 0.75 });
  const findings = core.crosscheck(req, res);
  assert.equal(byId(findings, 'crosscheck.bid.above_floor'), undefined);
  const below = byId(findings, 'crosscheck.bid.below_floor');
  assert.ok(below);
  assert.equal(below.params.floor, '0.7500');
});

test('crosscheck: bid.dealid naming a deal absent from imp.pmp.deals[] falls back to the imp floor', () => {
  const { req, res } = dealPair2x({
    price: 1.25,
    impBidfloor: 0.2,
    dealBidfloor: 0.75,
    bidDealid: 'NOPE',
  });
  const findings = core.crosscheck(req, res);
  const above = byId(findings, 'crosscheck.bid.above_floor');
  assert.ok(above);
  assert.equal(
    above.params.floor,
    '0.2000',
    'unmatched dealid must not borrow the other deal floor',
  );
});

test('crosscheck: a matched deal without a finite numeric bidfloor falls back to the imp floor', () => {
  const { req, res } = dealPair2x({
    price: 1.25,
    impBidfloor: 0.2,
    dealBidfloor: undefined,
  });
  delete req.imp[0].pmp.deals[0].bidfloor;
  const findings = core.crosscheck(req, res);
  const above = byId(findings, 'crosscheck.bid.above_floor');
  assert.ok(above);
  assert.equal(above.params.floor, '0.2000');
});

test('crosscheck: a matched deal bidfloor of exactly 0 is an explicit floor — no_floor_set does not fire and any non-negative price is above_floor', () => {
  const { req, res } = dealPair2x({ price: 1.25, impBidfloor: undefined, dealBidfloor: 0 });
  delete req.imp[0].bidfloor;
  const findings = core.crosscheck(req, res);
  assert.equal(
    byId(findings, 'crosscheck.bid.no_floor_set'),
    undefined,
    'a deal floor of 0 is still an explicit floor, even with no imp-level floor at all',
  );
  const above = byId(findings, 'crosscheck.bid.above_floor');
  assert.ok(above);
  assert.equal(above.params.floor, '0.0000');
});

test("crosscheck: a matched deal's floor currency comes from Deal.bidfloorcur, independent of Imp.bidfloorcur", () => {
  const { req, res } = dealPair2x({
    price: 1.25,
    impBidfloor: 0.2,
    impBidfloorcur: 'USD',
    dealBidfloor: 0.75,
    dealBidfloorcur: 'EUR',
    resCur: 'USD',
  });
  const findings = core.crosscheck(req, res);
  const mismatch = byId(findings, 'crosscheck.bid.floor_currency_mismatch');
  assert.ok(
    mismatch,
    'deal floor is EUR, bid settles in USD — must flag the mismatch, not borrow imp USD',
  );
  assert.equal(mismatch.params.floorCur, 'EUR');
  assert.equal(mismatch.params.bidCur, 'USD');
  assert.equal(byId(findings, 'crosscheck.bid.above_floor'), undefined);
  assert.equal(byId(findings, 'crosscheck.bid.below_floor'), undefined);
});

test('crosscheck and rules/price-floor agree on the effective floor for a matched-deal bid (both engines, public boundary)', () => {
  const { req, res } = dealPair2x({ price: 0.5, impBidfloor: 0.2, dealBidfloor: 0.75 });
  const cross = core.crosscheck(req, res);
  const { findings: valFindings } = core.validate(res, { pairReq: req });
  const crossBelow = byId(cross, 'crosscheck.bid.below_floor');
  const ruleBelow = byId(valFindings, 'err-bid-price-below-floor');
  assert.ok(crossBelow, 'crosscheck says below_floor');
  assert.ok(ruleBelow, 'the price-floor rule agrees the bid is below floor');
  assert.equal(crossBelow.params.floor, '0.7500');
  assert.equal(
    ruleBelow.params.floor,
    0.75,
    'both engines name the SAME governing floor (the deal, not the imp)',
  );
});

test("resolveDealFloor is exported from rules/price-floor and matches resolveFloor()'s own deal branch", () => {
  const priceFloor = require('@ortbtools/core/rules/price-floor');
  assert.equal(
    typeof priceFloor.resolveDealFloor,
    'function',
    'resolveDealFloor must be an exported function',
  );
  const imp = {
    id: '1',
    bidfloor: 0.2,
    pmp: { deals: [{ id: 'D1', bidfloor: 0.75, bidfloorcur: 'EUR' }] },
  };
  const bid = { impid: '1', dealid: 'D1', price: 1.25 };
  const deal = priceFloor.resolveDealFloor(bid, imp);
  assert.deepEqual(deal, { floor: 0.75, floorCur: 'EUR', source: 'deal' });
  // Contract test pinning the two functions cannot silently diverge: a
  // request-side validate() run against the same payload must find the
  // identical floor via resolveFloor() → err-bid-price-below-floor.
  const res = { id: 'r', cur: 'EUR', seatbid: [{ bid: [{ id: 'b', ...bid, price: 0.5 }] }] };
  const req = { id: 'r', cur: ['EUR'], imp: [imp] };
  const { findings } = core.validate(res, { pairReq: req });
  const f = byId(findings, 'err-bid-price-below-floor');
  assert.ok(f);
  assert.equal(
    f.params.floor,
    deal.floor,
    'resolveFloor() must resolve to the same floor resolveDealFloor() reports',
  );
});

// ── DEF-105: OpenRTB 3.0 currency + Item.flrcur ───────────────────────────

test('crosscheck (3.0, public boundary): an EUR bid above its EUR floor produces no currency mismatch, matching bn-banner-30-adcom', () => {
  const req = req30({ reqCur: ['EUR'], flr: 0.5, flrcur: 'EUR' });
  const res = res30({ price: 1.25, resCur: 'EUR' });
  const cross = core.crosscheck(req, res);
  const above = byId(cross, 'crosscheck.bid.above_floor');
  assert.ok(above, 'expected above_floor, not floor_currency_mismatch');
  assert.equal(above.params.floor, '0.5000');
  assert.equal(byId(cross, 'crosscheck.bid.floor_currency_mismatch'), undefined);

  const { findings: valFindings } = core.validate(res, { pairReq: req });
  assert.equal(
    byId(valFindings, 'err-bid-currency-mismatch'),
    undefined,
    'EUR is explicitly permitted by openrtb.request.cur; must not fire err-bid-currency-mismatch',
  );
});

test('crosscheck (3.0): projectItem30 reads item.flrcur (not the flrcu typo)', () => {
  const req = req30({ reqCur: ['EUR'], flr: 0.5, flrcur: 'EUR' });
  const res = res30({ price: 0.75, resCur: 'USD' });
  const cross = core.crosscheck(req, res);
  const mismatch = byId(cross, 'crosscheck.bid.floor_currency_mismatch');
  assert.ok(
    mismatch,
    'a genuinely USD bid against a EUR floor must still be flagged as a mismatch',
  );
  assert.equal(
    mismatch.params.floorCur,
    'EUR',
    'floorCur must come from item.flrcur, not default to USD',
  );
});

test("a 3.0 response is checked against the paired request's real cur[], not defaulted to USD (public boundary)", () => {
  const req = req30({ reqCur: ['EUR'] });
  const res = res30({ resCur: 'EUR' });
  const { findings } = core.validate(res, { pairReq: req });
  assert.equal(
    byId(findings, 'err-bid-currency-mismatch'),
    undefined,
    'EUR is in openrtb.request.cur; response.cur=EUR must be accepted',
  );
});

test('DEF-105 fix narrows rather than silences err-bid-currency-mismatch for 3.0: a genuine mismatch still fires', () => {
  const req = req30({ reqCur: ['EUR'] });
  const res = res30({ resCur: 'USD' });
  const { findings } = core.validate(res, { pairReq: req });
  const f = byId(findings, 'err-bid-currency-mismatch');
  assert.ok(f, 'USD is not in openrtb.request.cur=[EUR] — the mismatch must still be reported');
  assert.equal(f.path, 'openrtb.response.cur');
});

test('3.0: item.flrcur absent falls back to the spec default USD, same as the 2.x bidfloorcur default path', () => {
  const req = req30({ reqCur: ['USD'], flr: 0.5, flrcur: undefined });
  delete req.openrtb.request.item[0].flrcur;
  const res = res30({ price: 1.25, resCur: 'USD' });
  const cross = core.crosscheck(req, res);
  const above = byId(cross, 'crosscheck.bid.above_floor');
  assert.ok(above);
  assert.equal(above.params.floor, '0.5000');
  assert.equal(byId(cross, 'crosscheck.bid.floor_currency_mismatch'), undefined);
});

// ── no_floor_set dedup interaction under a per-bid-varying deal floor ─────

test('no_floor_set stays a single, order-independent WARN when one bid on an imp has a governing deal floor and a sibling bid does not', () => {
  for (const order of [
    ['dealBid', 'plainBid'],
    ['plainBid', 'dealBid'],
  ]) {
    const dealBid = { id: 'b-deal', impid: '1', price: 1.25, dealid: 'D1' };
    const plainBid = { id: 'b-plain', impid: '1', price: 1.25 };
    const bids = order.map((k) => (k === 'dealBid' ? dealBid : plainBid));
    const req = {
      id: 'r',
      cur: ['USD'],
      imp: [{ id: '1', pmp: { deals: [{ id: 'D1', bidfloor: 0 }] } }],
    };
    const res = { id: 'r', cur: 'USD', seatbid: [{ bid: bids }] };
    const findings = core.crosscheck(req, res);
    const notes = allById(findings, 'crosscheck.bid.no_floor_set');
    assert.equal(
      notes.length,
      1,
      `no_floor_set must fire exactly once regardless of bid order (${order.join(',')})`,
    );
  }
});
