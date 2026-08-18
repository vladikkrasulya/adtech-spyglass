'use strict';

/**
 * tests/crosscheck-audit.test.js — regression gates for the 2026-08-18 audit of
 * packages/core/crosscheck.js.
 *
 * Three defects, one theme: the crosscheck stated something about the pasted
 * payload that the payload did not say.
 *
 *   1. A valid oRTB 3.0 pair (both sides `clean` through validate()) came back
 *      as one CRIT — "No valid BidRequest to crosscheck against, paste the
 *      request in the left field" — because the version test was
 *      `Array.isArray(req.imp)` and 3.0 spells that `openrtb.request.item[]`.
 *      Every comparison the user came for was skipped in silence.
 *   2. `Number(imp.bidfloor) || 0` invented floors: `"1,50"` became a printed
 *      `0.0000` under a green "above floor", `true` became `1.0000` and
 *      `[1.5]` became `1.5000` under a red "below floor" — verdicts against
 *      numbers that appear nowhere in the request.
 *   3. The imp index was keyed on the raw `imp.id`, so a numeric slot id never
 *      matched a string `bid.impid`. The bid did not merely lose its impid
 *      finding: resolution failure skips the rest of the per-bid block, so
 *      price↔floor, bcat, badv and size went unchecked and the auction summary
 *      reported an empty auction that had in fact cleared.
 *
 * Assertions are on stable `id` / `path` / `params`, never on message text, per
 * the convention in tests/validator.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { crosscheck } = require('../packages/core/crosscheck');
const core = require('@ortbtools/core');

const byId = (findings, id) => findings.find((f) => f.id === id);

// ── fixtures ──────────────────────────────────────────────────────────────

/**
 * A 3.0 pair that is clean on both sides: same auction id, one item, one bid.
 * Typed loose because the per-test variants reshape `media` and `placement`.
 *
 * @returns {any}
 */
const req30 = () => ({
  openrtb: {
    ver: '3.0',
    request: {
      id: 'auc-1',
      cur: ['USD'],
      context: {
        site: { domain: 'x.com' },
        device: { ua: 'UA', ip: '1.2.3.4', lang: 'en' },
        restrictions: { bcat: ['IAB25'], badv: ['evil.com'] },
      },
      item: [
        {
          id: 's1',
          flr: 1.0,
          flrcu: 'USD',
          spec: { placement: { display: { w: 300, h: 250, displayfmt: [{ w: 728, h: 90 }] } } },
        },
      ],
    },
  },
});

/** @returns {any} */
const res30 = () => ({
  openrtb: {
    ver: '3.0',
    response: {
      id: 'auc-1',
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: 'b1',
              item: 's1',
              price: 1.5,
              media: { adomain: ['ok.com'], display: { w: 300, h: 250, adm: '<div/>' } },
            },
          ],
        },
      ],
    },
  },
});

/** 2.x pair with a numeric slot id — the shape that broke impid resolution. */
const reqNumericImpId = () => ({
  id: 'r1',
  cur: ['USD'],
  imp: [{ id: 1, bidfloor: 0.16, bidfloorcur: 'USD', banner: { w: 300, h: 250 } }],
});
const resStringImpId = () => ({
  id: 'r1',
  cur: 'USD',
  seatbid: [{ bid: [{ id: 'b', impid: '1', price: 0.65, w: 300, h: 250, adomain: ['x.com'] }] }],
});

// ── 1. oRTB 3.0 envelope ──────────────────────────────────────────────────

test('crosscheck 3.0: a valid envelope pair is crosschecked, not declared missing', () => {
  const findings = crosscheck(req30(), res30());
  assert.equal(
    byId(findings, 'crosscheck.no_request'),
    undefined,
    'a pasted 3.0 request must never be reported as absent',
  );
  const idm = byId(findings, 'crosscheck.id_match');
  assert.ok(idm && idm.ok, 'the auction ids match and that is the whole point of the pair');
  assert.equal(idm.path, 'openrtb.response.id', 'path names where the id really lives in 3.0');
  assert.ok(byId(findings, 'crosscheck.bid.impid_resolved'), 'bid.item resolves to item.id');
  assert.ok(byId(findings, 'crosscheck.bid.above_floor'), 'flr participates in the floor compare');
  assert.ok(byId(findings, 'crosscheck.bid.size_match'), 'placement.display sizes are compared');
  const sum = byId(findings, 'crosscheck.auction.summary');
  assert.deepEqual(
    { filled: sum.params.impsFilled, total: sum.params.impsTotal, top: sum.params.topPrice },
    { filled: 1, total: 1, top: '1.5000' },
    'the summary counts the 3.0 item and the bid that filled it',
  );
});

test('crosscheck 3.0: both sides validate clean, so the pair must not produce a CRIT', () => {
  // The defect was visible precisely because nothing else complained: the two
  // payloads passed their own 3.0 rule sets and the crosscheck alone shouted.
  assert.equal(core.validate(req30()).status, 'clean');
  assert.equal(core.validate(res30()).status, 'clean');
  const findings = core.crosscheck(req30(), res30(), { locale: 'en' });
  assert.equal(
    findings.filter((f) => f.level === 'crit').length,
    0,
    'a clean 3.0 pair has nothing critical to report',
  );
});

test('crosscheck 3.0: every finding resolves to real message text', () => {
  // The projection reuses the existing finding vocabulary on purpose — a new
  // id would need entries in messages/*.json to render at all, and would show
  // up in the UI as a bracketed id until it got them.
  const findings = core.crosscheck(req30(), res30(), { locale: 'en' });
  for (const f of findings) {
    assert.notEqual(f.msg, '[' + f.id + ']', `${f.id} has no message text`);
  }
});

test('crosscheck 3.0: restrictions.bcat / badv are enforced against media', () => {
  const res = res30();
  const bid = res.openrtb.response.seatbid[0].bid[0];
  bid.media.adomain = ['evil.com'];
  bid.media.cat = ['IAB25-3']; // child of the blocked IAB25
  const findings = crosscheck(req30(), res);
  const cat = byId(findings, 'crosscheck.bid.cat_blocked');
  const adv = byId(findings, 'crosscheck.bid.adomain_blocked');
  assert.ok(cat && cat.level === 'crit', 'context.restrictions.bcat must block the child category');
  assert.equal(cat.path, 'openrtb.response.seatbid[0].bid[0].media.cat');
  assert.ok(adv && adv.level === 'crit', 'context.restrictions.badv must block the advertiser');
  assert.equal(adv.path, 'openrtb.response.seatbid[0].bid[0].media.adomain');
});

test('crosscheck 3.0: the spec-strict media.ad wrapper is read too', () => {
  // AdCOM nests the Ad object under media.ad; this repo's own rules-response-30
  // reads the fields straight off media. Both shapes ship in real traffic, and
  // the finding path has to name whichever one the user pasted.
  const res = res30();
  const bid = res.openrtb.response.seatbid[0].bid[0];
  bid.media = { ad: { adomain: ['evil.com'], display: { w: 300, h: 250, adm: '<div/>' } } };
  const adv = byId(crosscheck(req30(), res), 'crosscheck.bid.adomain_blocked');
  assert.ok(adv, 'the wrapped Ad object must be unwrapped, not skipped');
  assert.equal(adv.path, 'openrtb.response.seatbid[0].bid[0].media.ad.adomain');
});

test('crosscheck 3.0: video markup is sniffed for VAST at its real path', () => {
  const req = req30();
  req.openrtb.request.item[0].spec.placement = { video: { mime: ['video/mp4'] } };
  const res = res30();
  res.openrtb.response.seatbid[0].bid[0].media = { video: { adm: 'not-vast-at-all' } };
  const f = byId(crosscheck(req, res), 'crosscheck.bid.video_not_vast');
  assert.ok(f && f.level === 'warn');
  assert.equal(f.path, 'openrtb.response.seatbid[0].bid[0].media.video.adm');
});

test('crosscheck 3.0: a no-bid still gets its id checked', () => {
  const findings = crosscheck(req30(), {
    openrtb: { ver: '3.0', response: { id: 'somebody-elses-auction', nbr: 2 } },
  });
  assert.equal(findings.length, 1, 'no seatbid → the id check and nothing else');
  assert.equal(findings[0].id, 'crosscheck.id_mismatch');
  assert.equal(findings[0].level, 'crit');
});

test('crosscheck 3.0: an envelope without item[] is still "no request"', () => {
  // Honest: there is nothing to crosscheck against. validate() reports the
  // missing item[] on the request side; crosscheck does not double up on it.
  const findings = crosscheck({ openrtb: { ver: '3.0', request: { id: 'q' } } }, res30());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'crosscheck.no_request');
});

test('crosscheck 3.0: request-side findings point into the envelope', () => {
  const req = req30();
  delete req.openrtb.request.item[0].flr;
  const f = byId(crosscheck(req, res30()), 'crosscheck.bid.no_floor_set');
  assert.ok(f);
  assert.equal(f.path, 'openrtb.request.item[0].flr', '3.0 spells the floor `flr`');
});

test('crosscheck: a 2.x pair keeps its 2.x paths untouched', () => {
  // The projection must be invisible to 2.x payloads — same ids, same paths,
  // same params as before the 3.0 work.
  const findings = crosscheck(reqNumericImpId(), resStringImpId());
  assert.equal(byId(findings, 'crosscheck.id_match').path, 'id');
  assert.equal(byId(findings, 'crosscheck.cur_allowed').path, 'cur');
  assert.equal(
    byId(findings, 'crosscheck.bid.impid_resolved').path,
    'seatbid[0].bid[0].impid',
    '2.x bids are still addressed as impid, not item',
  );
  assert.equal(byId(findings, 'crosscheck.bid.above_floor').path, 'seatbid[0].bid[0].price');
});

// ── 2. floors that are not numbers ────────────────────────────────────────

for (const [label, raw] of [
  ['decimal comma "1,50"', '1,50'],
  ['currency-suffixed "1.50 USD"', '1.50 USD'],
  ['boolean true', true],
  ['array [1.5]', [1.5]],
  ['NaN-producing "abc"', 'abc'],
]) {
  test(`crosscheck: a ${label} floor produces no invented floor verdict`, () => {
    const req = {
      id: 'r',
      cur: ['USD'],
      imp: [{ id: '1', bidfloor: raw, bidfloorcur: 'USD' }],
    };
    const res = { id: 'r', cur: 'USD', seatbid: [{ bid: [{ id: 'b', impid: '1', price: 0.65 }] }] };
    const findings = crosscheck(req, res);

    // No verdict at all: neither branch can name a floor the request contains.
    assert.equal(byId(findings, 'crosscheck.bid.above_floor'), undefined);
    assert.equal(byId(findings, 'crosscheck.bid.below_floor'), undefined);
    // And nothing prints a `floor` param for this bid.
    for (const f of findings) {
      assert.equal(
        f.params && f.params.floor,
        undefined,
        `${f.id} printed a floor derived from ${JSON.stringify(raw)}`,
      );
    }
    // The slot has no usable minimum and the operator is told so.
    const note = byId(findings, 'crosscheck.bid.no_floor_set');
    assert.ok(note && note.level === 'warn', 'an unusable floor is no floor, and that is a WARN');
    assert.equal(note.path, 'imp[0].bidfloor');
    // The bid is still a contender for the slot — the same call the
    // currency-mismatch branch makes when it cannot rank a bid either.
    const sum = byId(findings, 'crosscheck.auction.summary');
    assert.equal(sum.params.impsFilled, 1);
    assert.equal(sum.params.topPrice, '0.6500');
  });
}

test('crosscheck: the request-side validator still names the malformed floor', () => {
  // Why crosscheck does not need a finding id of its own for a broken floor:
  // rules-request.js already reports the type defect at the exact path.
  const { findings } = core.validate({
    id: 'r',
    cur: ['USD'],
    imp: [{ id: '1', bidfloor: '1,50', bidfloorcur: 'USD', banner: { w: 300, h: 250 } }],
  });
  const f = byId(findings, 'imp.bidfloor_invalid');
  assert.ok(f, 'the malformed floor is reported on the request side');
  assert.equal(f.path, 'imp[0].bidfloor');
});

test('crosscheck: an absent floor still compares against the spec default of 0', () => {
  // Absent is NOT the same as unusable: "no bidfloor" has a spec meaning (no
  // minimum), so the comparison is still possible and still runs.
  const req = { id: 'r', cur: ['USD'], imp: [{ id: '1' }] };
  const res = { id: 'r', cur: 'USD', seatbid: [{ bid: [{ id: 'b', impid: '1', price: 0.65 }] }] };
  const findings = crosscheck(req, res);
  const above = byId(findings, 'crosscheck.bid.above_floor');
  assert.ok(above && above.ok);
  assert.equal(above.params.floor, '0.0000');
  assert.ok(byId(findings, 'crosscheck.bid.no_floor_set'), 'and the degenerate auction is flagged');
});

test('crosscheck: a numeric floor is unaffected by the unusable-floor branch', () => {
  const req = { id: 'r', cur: ['USD'], imp: [{ id: '1', bidfloor: 1.0, bidfloorcur: 'USD' }] };
  const low = { id: 'r', cur: 'USD', seatbid: [{ bid: [{ id: 'b', impid: '1', price: 0.65 }] }] };
  const high = { id: 'r', cur: 'USD', seatbid: [{ bid: [{ id: 'b', impid: '1', price: 1.65 }] }] };
  const below = byId(crosscheck(req, low), 'crosscheck.bid.below_floor');
  assert.ok(below && below.params.floor === '1.0000');
  const above = byId(crosscheck(req, high), 'crosscheck.bid.above_floor');
  assert.ok(above && above.params.floor === '1.0000');
});

test('crosscheck: an unusable floor is not silently treated as a currency mismatch', () => {
  // floor_currency_mismatch gates on `floor > 0`, which a non-number could
  // never satisfy honestly — assert the branch stays out of the way.
  const req = { id: 'r', cur: ['USD'], imp: [{ id: '1', bidfloor: '1,50', bidfloorcur: 'EUR' }] };
  const res = { id: 'r', cur: 'USD', seatbid: [{ bid: [{ id: 'b', impid: '1', price: 0.65 }] }] };
  assert.equal(
    byId(crosscheck(req, res), 'crosscheck.bid.floor_currency_mismatch'),
    undefined,
    'there is no floor to be denominated in anything',
  );
});

// ── 3. impid resolution across id types ───────────────────────────────────

test('crosscheck: a numeric imp.id resolves against a string bid.impid', () => {
  const findings = crosscheck(reqNumericImpId(), resStringImpId());
  assert.equal(
    byId(findings, 'crosscheck.bid.impid_unresolved'),
    undefined,
    'imp.id 1 and bid.impid "1" name the same slot',
  );
  assert.ok(byId(findings, 'crosscheck.bid.impid_resolved'));
  // The point of the fix: everything downstream of resolution now runs.
  assert.ok(byId(findings, 'crosscheck.bid.above_floor'), 'the money check happens');
  assert.ok(byId(findings, 'crosscheck.bid.size_match'), 'the size check happens');
  const sum = byId(findings, 'crosscheck.auction.summary');
  assert.deepEqual(
    {
      filled: sum.params.impsFilled,
      above: sum.params.bidsAboveFloor,
      top: sum.params.topPrice,
    },
    { filled: 1, above: 1, top: '0.6500' },
    'the auction that cleared is reported as an auction that cleared',
  );
});

test('crosscheck: the two engines now agree on the numeric-imp.id payload', () => {
  // rules/price-floor normalises with String() on both sides and always found
  // the imp; crosscheck did not, so one payload got two opposite answers.
  const req = reqNumericImpId();
  const res = resStringImpId();
  res.seatbid[0].bid[0].price = 0.05; // under the 0.16 floor
  const cross = crosscheck(req, res);
  const rule = core
    .validate(res, { pairReq: req })
    .findings.find((f) => f.id === 'err-bid-price-below-floor');
  assert.ok(byId(cross, 'crosscheck.bid.below_floor'), 'crosscheck sees the under-floor bid');
  assert.ok(rule, 'and so does the price-floor rule, as it always did');
});

test('crosscheck: imp.id === 0 is an addressable slot', () => {
  // `if (imp && imp.id)` dropped it from the index, so every bid on slot 0
  // fell into the same silent hole as the type mismatch.
  const req = { id: 'r', cur: ['USD'], imp: [{ id: 0, bidfloor: 0.16, bidfloorcur: 'USD' }] };
  const res = { id: 'r', cur: 'USD', seatbid: [{ bid: [{ id: 'b', impid: 0, price: 0.65 }] }] };
  const findings = crosscheck(req, res);
  assert.ok(byId(findings, 'crosscheck.bid.impid_resolved'));
  assert.equal(byId(findings, 'crosscheck.bid.impid_unresolved'), undefined);
});

test('crosscheck: a genuinely unknown impid is still CRIT', () => {
  // Normalising must not turn resolution into "everything matches".
  const res = resStringImpId();
  res.seatbid[0].bid[0].impid = 'no-such-slot';
  const f = byId(crosscheck(reqNumericImpId(), res), 'crosscheck.bid.impid_unresolved');
  assert.ok(f && f.level === 'crit');
});

test('crosscheck: a bid with no impid at all does not match an imp by accident', () => {
  // `String(undefined)` is "undefined" — a real Map key. Guarded explicitly so
  // an imp literally called "undefined" cannot absorb an unaddressed bid.
  const req = { id: 'r', cur: ['USD'], imp: [{ id: 'undefined', bidfloor: 0.1 }] };
  const res = { id: 'r', cur: 'USD', seatbid: [{ bid: [{ id: 'b', price: 0.65 }] }] };
  const f = byId(crosscheck(req, res), 'crosscheck.bid.impid_unresolved');
  assert.ok(f && f.level === 'crit');
});

test('crosscheck: no_floor_set is still emitted once per slot when ids differ in type', () => {
  // The de-dupe set is keyed on the normalised id too — otherwise two bids
  // spelling the same slot differently would each emit the note.
  const req = { id: 'r', cur: ['USD'], imp: [{ id: 1 }] };
  const res = {
    id: 'r',
    cur: 'USD',
    seatbid: [
      {
        bid: [
          { id: 'b1', impid: 1, price: 1.0 },
          { id: 'b2', impid: '1', price: 2.0 },
        ],
      },
    ],
  };
  const hits = crosscheck(req, res).filter((f) => f.id === 'crosscheck.bid.no_floor_set');
  assert.equal(hits.length, 1, 'one slot, one note');
});

// ── 4. the currency-default fix this audit re-verified ────────────────────

test('crosscheck: a response without cur is USD, including in the floor compare', () => {
  // Fixed before this audit ran (2a7a044 / 92f809b); guarded here because the
  // regression is invisible — it shows up as a GREEN above-floor tick on a
  // pair whose numbers are in two different currencies.
  const req = { id: 'r1', cur: ['EUR'], imp: [{ id: '1', bidfloor: 1.0, bidfloorcur: 'EUR' }] };
  const res = { id: 'r1', seatbid: [{ bid: [{ id: 'b', impid: '1', price: 1.05 }] }] };
  const findings = crosscheck(req, res);
  const mm = byId(findings, 'crosscheck.bid.floor_currency_mismatch');
  assert.ok(mm, 'an absent res.cur means USD, which is not the EUR floor');
  assert.equal(mm.params.bidCur, 'USD');
  assert.equal(mm.params.floorCur, 'EUR');
  assert.equal(byId(findings, 'crosscheck.bid.above_floor'), undefined);
});
