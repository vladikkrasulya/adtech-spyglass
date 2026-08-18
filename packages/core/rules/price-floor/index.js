'use strict';

/**
 * Bid price validation — price >= 0 and price >= matching imp.bidfloor.
 *
 * Response-side rule that walks every seatbid[].bid[]:
 *   - bid.price must be a non-negative finite number (>= 0). Negative prices
 *     are spec violations; zero is allowed per IAB §4.3.1 (second-price).
 *   - When ctx.req is available, finds the matching imp by bid.impid === imp.id
 *     and compares bid.price against the floor:
 *       * PMP: if bid.dealid matches imp.pmp.deals[].id — the Deal's own
 *         identifier — and that deal has its own bidfloor, the deal floor wins
 *         over the imp-level floor.
 *       * Currency: if bidCur (bid.cur || res.cur || USD) differs from
 *         floorCur (imp.bidfloorcur || USD, per the field's own spec default)
 *         → emit warn-currency-conversion-needed and SKIP the numeric compare.
 *         No conversion happens here; see below. Every code is uppercased and
 *         trimmed first (normCur) — ISO 4217 is case-insensitive, and letter
 *         case must never decide whether the floor gets checked at all.
 *
 * ── Why no currency conversion ───────────────────────────────────────────
 * lib/fx.js holds a USD rate table and the Inspector shows a converted figure
 * beside a non-USD floor, but that number is display-only by design: "the same
 * payload analyses the same way", and a live rate breaks that the moment it
 * moves. So an incomparable pair produces a warning saying so, never a verdict
 * derived from a rate. The operator still gets the USD reading in the strip —
 * it just never becomes the answer.
 *
 * ── Severity ─────────────────────────────────────────────────────────────
 * Only a malformed price is an ERROR. A bid that is merely under the floor is
 * a WARNING: the response is valid oRTB, the exchange accepts and processes
 * it, and the bid loses. See the comment at the comparison itself.
 *
 * Rules:
 *   err-bid-price-negative          error   — price < 0, NaN, Infinity, or not a number
 *   err-bid-price-below-floor       warning — price < matching floor, same currency
 *   warn-currency-conversion-needed warning — bidCur != floorCur, no compare done
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

// Every currency code that reaches a comparison in this file goes through here
// first. ISO 4217 codes are case-insensitive by definition, so "usd" and "USD"
// name the same currency — but this rule used to compare the raw strings, and
// the mismatch branch below does a hard `return` that SKIPS the numeric floor
// compare entirely. A feed shipping lowercase therefore silenced the floor
// check outright: a bid at $0.05 against a $0.16 floor came back as nothing but
// "conversion needed", with the UI printing the absurd pair "bidCur: USD,
// floorCur: usd". Money the operator was meant to see went unreported because
// of letter case.
//
// crosscheck.js already normalises (see its "Real-world feeds sometimes ship
// lowercase" comment), so the two engines disagreed on identical payloads —
// crosscheck said below_floor, this rule said "can't compare". Same normalising
// here makes them agree again.
//
// The trim is deliberate too, and goes one step past crosscheck: padding is a
// transport artifact of hand-assembled and CSV-sourced payloads, not a
// different currency, and "USD " suppressed the compare for the same reason
// "usd" did. A code that is only whitespace carries no information at all, so
// it falls back rather than becoming an empty-string "currency" that matches
// nothing. Non-strings (a numeric 840, say) fall back for the same reason —
// the previous `imp.bidfloorcur || 'USD'` would have passed 840 straight into
// a string compare.
//
// Note what is deliberately NOT done: no validation that the result is a real
// ISO 4217 code. Reporting "XYZ is not a currency" would need a finding id,
// and every id has to exist in messages/*.json to render. Out of scope here.
function normCur(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const norm = raw.trim().toUpperCase();
  return norm.length > 0 ? norm : fallback;
}

/**
 * Find the effective floor for a bid against an imp.
 *
 * Takes no request: nothing at request level participates in what a floor is
 * priced in. `BidRequest.cur` is the list of currencies the exchange accepts,
 * and reading it here is exactly the bug described below.
 *
 * Returns { floor, floorCur, source } or null if no floor is set.
 */
function resolveFloor(bid, imp) {
  // `bidfloorcur` carries its own spec default of "USD" (oRTB 2.5/2.6 §3.2.4
  // for Imp, §3.2.12 for Deal) and is NOT tied to `BidRequest.cur`. `cur` is
  // only the list of currencies the exchange will ACCEPT bids in; it says
  // nothing about how an unlabelled floor was priced.
  //
  // Falling back to `req.cur[0]` — as this did — silently renamed the floor's
  // currency. On the ordinary "exchange accepts EUR, floor sent without an
  // explicit currency" request that made a USD floor look like a EUR floor,
  // the bid currency then matched it, and the numeric compare below ran on two
  // different denominations and reported a verdict with no meaning.
  //
  // Reading the spec default instead means such a payload now trips the
  // currency-mismatch warning rather than producing a confident wrong answer.
  // That warning is the honest output: the payload really is ambiguous about
  // what its floor is priced in, and that ambiguity costs real money.
  const SPEC_DEFAULT_CUR = 'USD';

  // PMP deal floor — check if bid.dealid matches a deal on imp.pmp.deals[]
  //
  // The Deal object's identifier is `id` (§3.2.12); `dealid` is the Bid-side
  // field (§3.2.4) that REFERS to it. Matching `d.dealid` compared a bid's
  // deal id against a property no conforming Deal carries, so it never
  // matched and a PMP deal's floor was never applied — the imp-level floor
  // was used in its place, or none at all.
  if (bid.dealid && imp.pmp && Array.isArray(imp.pmp.deals)) {
    const deal = imp.pmp.deals.find((d) => d && d.id === bid.dealid);
    if (deal && typeof deal.bidfloor === 'number' && Number.isFinite(deal.bidfloor)) {
      return {
        floor: deal.bidfloor,
        floorCur: normCur(deal.bidfloorcur, SPEC_DEFAULT_CUR),
        source: 'deal',
      };
    }
  }

  // imp-level floor
  if (typeof imp.bidfloor === 'number' && Number.isFinite(imp.bidfloor) && imp.bidfloor > 0) {
    return {
      floor: imp.bidfloor,
      floorCur: normCur(imp.bidfloorcur, SPEC_DEFAULT_CUR),
      source: 'imp',
    };
  }

  return null;
}

function validate(payload, ctx) {
  const findings = [];
  if (!payload || typeof payload !== 'object') return findings;
  if (!Array.isArray(payload.seatbid)) return findings;

  // Build imp lookup from paired request (if available)
  const req = ctx && ctx.req;
  const impMap = new Map();
  if (req && Array.isArray(req.imp)) {
    req.imp.forEach((imp) => {
      if (imp && imp.id != null) impMap.set(String(imp.id), imp);
    });
  }

  // Determine response-level currency (default USD per oRTB §3.3), normalised
  // so a lowercase `"cur": "usd"` on the response side cannot silence the floor
  // compare any more than a lowercase `bidfloorcur` can.
  const resCur = normCur(payload.cur, 'USD');

  payload.seatbid.forEach((sb, si) => {
    if (!sb || !Array.isArray(sb.bid)) return;
    sb.bid.forEach((bid, bi) => {
      if (!bid) return;
      const path = `seatbid[${si}].bid[${bi}]`;

      // price must be a non-negative finite number (>= 0 is valid per IAB §4.3.1)
      if (typeof bid.price !== 'number' || !Number.isFinite(bid.price) || bid.price < 0) {
        findings.push(
          F('err-bid-price-negative', LEVELS.ERROR, path + '.price', {
            val: String(bid.price ?? 'missing'),
            si,
            bi,
          }),
        );
        return; // no floor check if price itself is invalid
      }

      // floor crosscheck (only when paired request is available)
      if (impMap.size > 0 && bid.impid != null) {
        const imp = impMap.get(String(bid.impid));
        if (!imp) return;

        const floorInfo = resolveFloor(bid, imp);
        if (!floorInfo) return;

        const { floor, floorCur } = floorInfo;

        // Determine bid currency. `bid.cur` is not an oRTB 2.x field, but real
        // bidders emit it and it is the narrowest statement available about
        // what THIS bid is priced in, so it wins over the response-level `cur`
        // when present. Normalised like every other code here.
        const bidCur = normCur(bid.cur, resCur);

        // Currency mismatch → warn and skip numeric compare.
        //
        // Both sides are already normalised, so reaching this branch now means
        // two genuinely different currencies — not the same one spelled two
        // ways. The reported params are the normalised codes on purpose: they
        // are what the comparison actually ran on, and echoing the raw strings
        // is what produced the nonsensical "USD vs usd" readout.
        if (bidCur !== floorCur) {
          findings.push(
            F('warn-currency-conversion-needed', LEVELS.WARNING, path + '.price', {
              bidCur,
              floorCur,
              impid: String(bid.impid),
              si,
              bi,
            }),
          );
          return;
        }

        // Same currency — do the numeric compare.
        //
        // WARNING, not ERROR: a bid under the floor breaks nothing. The
        // payload is well-formed oRTB, the auction runs, the exchange
        // processes and accepts the response — this bid simply does not win.
        // That is an outcome to report, not a defect in the document, and at
        // ERROR it rolled the whole payload up to "errors" and told the
        // operator their perfectly valid response was broken.
        //
        // The rule id keeps its `err-` prefix on purpose: it is the key the
        // messages/*.json translations and any consumer filter are written
        // against, and renaming it would break them for a cosmetic gain. The
        // message text was always right about this ("біржа відфільтрує цей
        // бід") — only the level disagreed with it.
        if (bid.price < floor) {
          findings.push(
            F('err-bid-price-below-floor', LEVELS.WARNING, path + '.price', {
              price: bid.price,
              floor,
              impid: String(bid.impid),
              si,
              bi,
            }),
          );
        }
      }
    });
  });

  return findings;
}

module.exports = {
  id: 'price-floor',
  description:
    'Validates bid.price >= 0 (zero is valid per IAB §4.3.1) and bid.price >= effective floor (deal or imp), with currency-aware mismatch warnings.',
  appliesTo: ['ORTB_RESPONSE'],
  validate,
};
