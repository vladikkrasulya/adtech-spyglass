'use strict';

/**
 * price-floor audit regressions — floor resolution and currency handling.
 *
 * Three findings from the floor/currency audit land here. Two of them
 * (the `req.cur[0]` floor default and the `deals[].dealid` lookup) were already
 * closed by an earlier fix; their cases are kept anyway, because both were the
 * kind of bug that a plausible-looking "simplification" reintroduces, and
 * neither leaves a trace when it regresses — the rule just goes quiet.
 *
 * The through-line of all three: every one of them ended with the numeric floor
 * compare NOT running. That is the expensive failure mode for this rule. A bid
 * under the floor that is reported as merely "needs conversion" reads as a
 * shrug, so the assertions below check that `err-bid-price-below-floor` is
 * present, not just that some finding fired.
 */

const test = require('node:test');
const assert = require('node:assert');

const priceFloor = require('../packages/core/rules/price-floor');

/** Build the smallest response that carries one priced bid. */
function resWith(price, extra = {}) {
  return {
    id: 'r1',
    cur: 'USD',
    seatbid: [{ bid: [{ id: 'b1', impid: '1', price, ...extra }] }],
  };
}

const below = (out) => out.find((f) => f.id === 'err-bid-price-below-floor');
const mismatch = (out) => out.find((f) => f.id === 'warn-currency-conversion-needed');

// ── Finding 3: case-insensitive currency comparison ──────────────────────────
//
// ISO 4217 codes are case-insensitive, but the rule compared raw strings and
// the mismatch branch returns early — so `"usd"` vs `"USD"` skipped the floor
// compare entirely and a 3x underbid surfaced as a conversion warning.

test('price-floor: lowercase bidfloorcur still compares against the floor', () => {
  const req = { id: 'r1', cur: ['USD'], imp: [{ id: '1', bidfloor: 0.16, bidfloorcur: 'usd' }] };
  const out = priceFloor.validate(resWith(0.05), { req });

  assert.ok(below(out), '0.05 < 0.16 in the same currency must be reported as below floor');
  assert.equal(below(out).params.floor, 0.16);
  assert.ok(!mismatch(out), '"usd" and "USD" are the same currency — no conversion warning');
});

test('price-floor: lowercase response cur still compares against the floor', () => {
  // The mirror of the case above: normalising only one side would still leave
  // half the payloads in the wild silently unchecked.
  const req = { id: 'r1', cur: ['USD'], imp: [{ id: '1', bidfloor: 0.16, bidfloorcur: 'USD' }] };
  const res = { id: 'r1', cur: 'usd', seatbid: [{ bid: [{ id: 'b1', impid: '1', price: 0.05 }] }] };
  const out = priceFloor.validate(res, { req });

  assert.ok(below(out), 'response cur "usd" must not suppress the floor compare');
  assert.ok(!mismatch(out));
});

test('price-floor: lowercase bid.cur still compares against the floor', () => {
  // `bid.cur` is not an oRTB 2.x field but bidders emit it, and it takes
  // precedence over the response `cur` — so it needs the same normalising.
  const req = { id: 'r1', cur: ['USD'], imp: [{ id: '1', bidfloor: 0.16, bidfloorcur: 'USD' }] };
  const out = priceFloor.validate(resWith(0.05, { cur: 'usd' }), { req });

  assert.ok(below(out), 'bid-level "usd" must not suppress the floor compare');
  assert.ok(!mismatch(out));
});

test('price-floor: padded currency code is the same currency', () => {
  // Whitespace is a transport artifact of hand-assembled and CSV-sourced
  // payloads, not a different denomination; it suppressed the compare for
  // exactly the same reason lowercase did.
  const req = { id: 'r1', cur: ['USD'], imp: [{ id: '1', bidfloor: 0.16, bidfloorcur: ' USD ' }] };
  const out = priceFloor.validate(resWith(0.05), { req });

  assert.ok(below(out), '" USD " is USD');
  assert.ok(!mismatch(out));
});

test('price-floor: a blank or non-string bidfloorcur falls back to the USD default', () => {
  // A whitespace-only code carries no information, and `840` is not a string at
  // all; the old `imp.bidfloorcur || "USD"` passed both straight into a string
  // compare, where they matched nothing and killed the check.
  for (const cur of ['   ', '', 840, null]) {
    const req = { id: 'r1', cur: ['USD'], imp: [{ id: '1', bidfloor: 0.16, bidfloorcur: cur }] };
    const out = priceFloor.validate(resWith(0.05), { req });
    assert.ok(below(out), `bidfloorcur ${JSON.stringify(cur)} should fall back to USD`);
  }
});

test('price-floor: a genuine currency mismatch still warns and skips the compare', () => {
  // The normalising must not swallow the case the warning exists for. EUR vs
  // USD is not comparable without an FX rate, and this rule refuses to invent
  // one — so no below-floor verdict may be emitted here.
  const req = { id: 'r1', cur: ['EUR'], imp: [{ id: '1', bidfloor: 0.16, bidfloorcur: 'eur' }] };
  const out = priceFloor.validate(resWith(0.05), { req });

  const warn = mismatch(out);
  assert.ok(warn, 'EUR floor vs USD bid is a real mismatch');
  assert.ok(!below(out), 'no numeric verdict across denominations');
  // Params carry the normalised codes — echoing the raw strings is what
  // produced readouts like "bidCur: USD, floorCur: usd" in the UI.
  assert.equal(warn.params.bidCur, 'USD');
  assert.equal(warn.params.floorCur, 'EUR');
});

test('price-floor: normalising does not turn a passing bid into a failure', () => {
  // Guards the opposite direction of the same change: now that the compare
  // actually runs on case-differing pairs, it must still say "fine" when the
  // bid clears the floor.
  const req = { id: 'r1', cur: ['USD'], imp: [{ id: '1', bidfloor: 0.16, bidfloorcur: 'usd' }] };
  const out = priceFloor.validate(resWith(0.5), { req });

  assert.deepEqual(out, [], '0.50 clears a 0.16 floor — nothing to report');
});

// ── Finding 1: floor currency defaults to USD, never to req.cur[0] ───────────
//
// Already closed upstream; kept because the wrong version is the intuitive one.
// `BidRequest.cur` is the list of currencies the exchange ACCEPTS — it says
// nothing about how an unlabelled floor was priced, and `bidfloorcur` carries
// its own spec default of "USD" (oRTB 2.5/2.6 §3.2.4).

test('price-floor: an unlabelled floor is USD, not req.cur[0]', () => {
  const req = { id: 'r1', cur: ['EUR'], imp: [{ id: '1', bidfloor: 2.0 }] };
  const out = priceFloor.validate(resWith(0.5), { req });

  assert.ok(
    below(out),
    'floor with no bidfloorcur is USD by spec; the USD bid is comparable and under it',
  );
  assert.equal(below(out).params.floor, 2.0);
  assert.ok(!mismatch(out), 'req.cur ["EUR"] must not rename the floor into EUR');
});

test('price-floor: an unlabelled DEAL floor is USD, not req.cur[0]', () => {
  // Same default, the other place it applies (§3.2.12) — the deal branch has
  // its own `bidfloorcur` read and could regress independently of the imp one.
  const req = {
    id: 'r1',
    cur: ['JPY'],
    imp: [
      { id: '1', bidfloor: 0.1, bidfloorcur: 'USD', pmp: { deals: [{ id: 'd1', bidfloor: 3 }] } },
    ],
  };
  const out = priceFloor.validate(resWith(0.5, { dealid: 'd1' }), { req });

  assert.ok(below(out), 'unlabelled deal floor is USD, comparable with the USD bid');
  assert.equal(below(out).params.floor, 3);
});

// ── Finding 2: the deal floor is found via Deal.id ───────────────────────────
//
// Also already closed. The Deal object's identifier is `id` (§3.2.12); `dealid`
// is the Bid-side field (§3.2.4) that REFERS to it. Looking for `d.dealid`
// matched a property no conforming Deal carries, so a PMP deal's floor was
// never applied and underpayment on a guaranteed deal read as clean.

test('price-floor: PMP deal floor is matched on Deal.id and overrides the imp floor', () => {
  const req = {
    id: 'r1',
    cur: ['USD'],
    imp: [
      {
        id: '1',
        bidfloor: 0.1,
        bidfloorcur: 'USD',
        pmp: {
          private_auction: 1,
          deals: [{ id: 'deal-123', bidfloor: 2.0, bidfloorcur: 'USD' }],
        },
      },
    ],
  };
  const out = priceFloor.validate(resWith(0.5, { dealid: 'deal-123' }), { req });

  const f = below(out);
  assert.ok(f, '$0.50 against a $2.00 deal floor is a $1.50 CPM shortfall, not a clean payload');
  // Asserting the VALUE is the point: the bid also clears the 0.10 imp floor,
  // so a regression to the imp floor would show up as no finding at all — and
  // a half-regression that found the deal but kept the imp number would still
  // pass a mere "some finding fired" check.
  assert.equal(f.params.floor, 2.0, 'the deal floor is the one reported');
});

test('price-floor: a deal floor in lowercase currency is still applied', () => {
  // The two fixes meet here: the deal must be found by `id`, AND its lowercase
  // `bidfloorcur` must not suppress the compare. Either bug alone hides this.
  const req = {
    id: 'r1',
    cur: ['USD'],
    imp: [
      {
        id: '1',
        bidfloor: 0.1,
        pmp: { deals: [{ id: 'deal-九', bidfloor: 2.0, bidfloorcur: 'usd' }] },
      },
    ],
  };
  const out = priceFloor.validate(resWith(0.5, { dealid: 'deal-九' }), { req });

  assert.ok(below(out));
  assert.equal(below(out).params.floor, 2.0);
});

test('price-floor: a bid on an unknown dealid falls back to the imp floor', () => {
  // The deal branch must not swallow bids whose dealid matches nothing: the
  // imp-level floor still governs them.
  const req = {
    id: 'r1',
    cur: ['USD'],
    imp: [{ id: '1', bidfloor: 1.0, pmp: { deals: [{ id: 'deal-a', bidfloor: 5.0 }] } }],
  };
  const out = priceFloor.validate(resWith(0.5, { dealid: 'deal-nonexistent' }), { req });

  assert.ok(below(out));
  assert.equal(below(out).params.floor, 1.0, 'imp floor governs, not the unrelated deal');
});
