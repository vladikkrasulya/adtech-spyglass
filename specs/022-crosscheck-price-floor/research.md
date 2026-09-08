# Phase 0 Research: Crosscheck Price and Floor

**Date**: 2026-09-08. Line numbers refer to the pinned copies retained beside this feature's evidence
(`ortbtools-research/2026-09-08-022-crosscheck-price/`): OpenRTB 2.6 at commit
`403cbba542de3a5d9cfcccd0a34e74b01b79a9f1`, OpenRTB 3.0 FINAL, and AdCOM 1.0 FINAL at
`df8ba06de0ba77c82efee7a2dc832bd4968474d6`.

## R1. What the specifications say

OpenRTB 2.6 §4.2.3 Object: Bid — `price` is `float; required`, "Bid price expressed as CPM although
the actual transaction is for a unit impression only." `dealid` is `string`, "Reference to the deal.id
from the bid request if this bid pertains to a private marketplace direct deal."

OpenRTB 2.6 §3.2.4 Object: Imp — `bidfloor` is `float; default 0`, "Minimum bid for this impression
expressed in CPM." `bidfloorcur` is `string; default "USD"`, "Currency specified using ISO-4217 alpha
codes. This may be different from bid currency returned by bidder if this is allowed by the exchange."

OpenRTB 2.6 §3.2.12 Object: Deal — `id` is `string; required`, "A unique identifier for the direct
deal." `bidfloor` is `float; default 0`. `bidfloorcur` is `string; default "USD"` and carries the
decisive clause: the deal's floor currency does not inherit from the impression. §6.2.5's worked
example shows an impression floor of 0.03 alongside deals carrying their own, higher floors — a Deal
is a self-contained economic object, not a modifier of the impression floor.

OpenRTB 3.0 Object: Item — the floor fields are `flr` and `flrcur` (`openrtb-3.0-FINAL.md:517`), and
Object: Deal repeats `flr`/`flrcur` (`:586`). The spelling `flrcu` appears nowhere in the document.
AdCOM 1.0 carries no floor or price field at all: the floor layer belongs to OpenRTB, which is why
the projection reads it from the item rather than from the placement.

## R2. Price validity (decision)

**Decision**: a usable bid price is `typeof price === 'number' && Number.isFinite(price) && price >= 0`,
with no coercion at any step. Zero is a real bid.

The predicate is not new: `packages/core/rules/price-floor/index.js` already rejected exactly these
values on the validation side. Crosscheck's `Number.isFinite(Number(priceRaw))` accepted `[]` (0),
`[1]` (1), `true` (1), `''` (0), `'1.25'` (1.25) and any negative number, so the two engines
disagreed about which prices exist. Copying the validator's predicate byte-for-byte is what makes the
disagreement structurally impossible rather than merely fixed today.

**Alternatives rejected**: a stricter coercion (still coercion, still the root cause); a new finding
id for a negative price (the ledger and all six fixtures ask for the existing `price_invalid`, and
ids are public compatibility keys); tightening the separate `response.bid.price_required` rule in
`rules-response.js` (a different, looser id outside these three defects, with no fixture asking for
the change).

## R3. Deal floor (decision)

**Decision**: extract the PMP-deal match already living inside `resolveFloor()` into an exported
`resolveDealFloor(bid, imp)` in the same file, have `resolveFloor()` call it first so its own answer
is provably unchanged, and have `crosscheck.js` call the same function before its existing
impression-floor logic. A matched deal's `bidfloor` governs at any finite value including `0`; its
currency comes from the deal's own `bidfloorcur`.

The require edge was checked before deciding: `rules/price-floor/index.js` requires only
`../../findings`, so `crosscheck.js → rules/price-floor` is one-directional with no cycle, and the
plugin loader reads only `{id, description, appliesTo, validate}` off the module, so an extra named
export is invisible to it.

**Alternatives rejected**: calling the whole `resolveFloor()` from crosscheck — its impression branch
requires `bidfloor > 0` and collapses the absent and malformed cases that crosscheck deliberately
keeps apart and that existing tests pin by name; a new shared module — an extra file and indirection
for one additional consumer when the rule plugin already documents itself as the floor authority;
duplicating the match in crosscheck — precisely the mechanism that produced this defect.

## R4. OpenRTB 3.0 (decision)

**Decision**: two independent corrections. The item projection reads `item.flrcur`; the misspelled
name is dropped outright rather than kept as an alias, because no conforming payload carries it and
tolerating it would invite the same silent default back. Separately, a paired 3.0 request is
projected to `{cur}` before it reaches the response rule pass, because those rules read a 2.x-shaped
`req.cur` and the raw 3.0 envelope keeps that list at `openrtb.request.cur`.

The projection deliberately carries only `cur`, never the items. Projecting items as well would newly
activate the per-bid floor rule for every 3.0 pair — a behaviour change with no corpus coverage and
no defect record, which belongs to its own feature if it is ever wanted.

## R5. Boundaries this feature does not cross

A negative `bidfloor`, on an impression or on a deal, is accepted by both engines and printed as the
stated floor. `imp.bidfloor_invalid` fires only for a non-numeric floor, and that logic is unchanged
here. Nothing in the product flags a negative floor today; surfacing it is a separate additive
finding and is recorded as a follow-up rather than smuggled into this change.
