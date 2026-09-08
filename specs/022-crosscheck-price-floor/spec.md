# Feature Specification: Crosscheck Tells the Truth About Price and Floor

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013/021 precedent)

**Created**: 2026-09-08

**Status**: Complete

**Input**: Owner instruction, 2026-09-08, after [021](../021-recommended-fields-guidance/spec.md)
shipped: close the crosscheck price and deal-floor defects DEF-110, DEF-104 and DEF-105 recorded by
the [020 audit](../020-ad-format-verification-matrix/defects.md). All three are the same failure in
different places: the crosscheck engine states something about the pasted pair that the pair does not
say, and it disagrees with the validation engine while doing it.

- **DEF-110**: crosscheck ran every `bid.price` through `Number(x)` before testing finiteness.
  `Number([])` is 0, `Number([1])` is 1, `Number(true)` is 1, `Number('')` is 0 and
  `Number('1.25')` is 1.25 — so an empty array, a boolean, an empty string and a numeric string all
  produced a confident `above_floor` or `below_floor` verdict on a price the response never carried,
  and a negative price passed as a real bid. The validation engine had rejected all of them.
- **DEF-104**: crosscheck compared every bid against `imp.bidfloor` only. When a bid named a private
  deal (`bid.dealid` matching `imp.pmp.deals[].id`) that carried its own `bidfloor`, the deal's floor
  was ignored — so a bid below its deal floor was reported as above the (lower) impression floor.
  The validation engine's own `resolveFloor()` already resolved deal floors correctly, so the two
  engines answered the same payload differently.
- **DEF-105**: on the OpenRTB 3.0 path two separate misreads. The item projection read
  `item.flrcu`, a field no conforming Item carries, instead of `item.flrcur`, so every 3.0 floor was
  treated as denominated in the default USD. And the paired 3.0 request was handed to the response
  plugins as its raw envelope, so the currency rule read `cur` as `undefined` and fell back to a
  USD-only allowed set. A EUR bid, above its EUR floor, on a request that explicitly allowed EUR,
  was reported as a currency mismatch at error level.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A malformed price is never given a floor verdict (Priority: P1)

An operator pastes a response whose `bid.price` is not a JSON number — an empty array from a broken
adapter, a boolean, a quoted number, or a negative value. The Inspector must say the price is
invalid and must not rank it against the floor, because any ranking would be about a number the
response does not contain.

**Why this priority**: This is the defect that produces a confident wrong answer about money. A green
"price 1.0000 ≥ floor 0.1000" over a `true` is worse than no verdict at all.

**Independent Test**: Crosscheck a pair whose bid price is each of `[]`, `[1]`, `true`, `''`,
`'1.25'` and `-1`: each yields `crosscheck.bid.price_invalid` at crit and no floor verdict. A price
of `0` stays a real bid and is ranked normally.

**Acceptance Scenarios**:

1. **Given** a bid whose price is any non-number JSON value, **When** the pair is crosschecked,
   **Then** `crosscheck.bid.price_invalid` fires at crit and neither `crosscheck.bid.above_floor`
   nor `crosscheck.bid.below_floor` is present.
2. **Given** a bid whose price is a negative number, **When** the pair is crosschecked, **Then** the
   same holds, because a bid price is a non-negative value.
3. **Given** a bid whose price is `0`, **When** the pair is crosschecked, **Then** it is ranked
   against the floor like any other bid.
4. **Given** any of the above, **When** the same response is validated, **Then** the validation
   engine and the crosscheck engine agree that the price is or is not usable.
5. **Given** a response mixing one valid and one invalid price, **When** the pair is crosschecked,
   **Then** the auction summary counts only the valid bid.

---

### User Story 2 - The deal a bid names governs its floor (Priority: P1)

An operator pastes a private-marketplace pair: the impression carries a low public floor and a deal
with a higher floor of its own, and the bid names that deal. The Inspector must rank the bid against
the deal's floor, and must give the same answer as the validation engine.

**Why this priority**: A bid under its deal floor reported as above the public floor is a commercial
contradiction in the direction that loses money quietly.

**Independent Test**: Crosscheck a bid of 0.50 naming a deal whose floor is 0.75 on an impression
whose floor is 0.10: the verdict is `below_floor` against 0.7500. Raise the bid to 1.00 and it is
`above_floor` against the same 0.7500.

**Acceptance Scenarios**:

1. **Given** a bid whose `dealid` matches a deal carrying its own `bidfloor`, **When** the pair is
   crosschecked, **Then** the verdict names the deal's floor, not the impression's.
2. **Given** the same pair, **When** it is validated, **Then** the validation engine names the same
   effective floor, because both engines resolve it through one shared function.
3. **Given** a `dealid` that matches no deal, or a matched deal with no usable `bidfloor`, **When**
   the pair is crosschecked, **Then** the impression floor applies exactly as before.
4. **Given** a matched deal whose floor is exactly `0`, **When** the pair is crosschecked, **Then**
   that is an explicit floor: the bid is ranked against 0 and no "no floor set" note fires.
5. **Given** a matched deal whose floor is denominated in a different currency from the response,
   **When** the pair is crosschecked, **Then** the currency mismatch is reported instead of a
   numeric verdict, using the deal's own currency, which never inherits the impression's.

---

### User Story 3 - An OpenRTB 3.0 pair is read from the fields it actually has (Priority: P2)

An operator pastes a 3.0 pair priced in euros: the request allows EUR, the item's floor is EUR, and
the bid is above it. The Inspector must report a clean currency and a normal floor verdict.

**Why this priority**: The audit's only 3.0 commercial pair was reported as a blocking currency
error, which makes the 3.0 path untrustworthy for anyone pricing outside USD.

**Independent Test**: Validate and crosscheck the corpus pair `bn-banner-30-adcom`: no
`err-bid-currency-mismatch`, and `crosscheck.bid.above_floor` against the item's EUR floor.

**Acceptance Scenarios**:

1. **Given** a 3.0 item carrying `flrcur`, **When** the pair is crosschecked, **Then** the floor is
   treated as denominated in that currency.
2. **Given** a 3.0 request whose `cur` allows the response currency, **When** the response is
   validated against it, **Then** no currency mismatch is reported.
3. **Given** a 3.0 request whose `cur` does not allow the response currency, **When** the response
   is validated against it, **Then** the currency mismatch still fires, unchanged.
4. **Given** any 2.x pair, **When** it is validated or crosschecked, **Then** its behaviour is
   byte-identical to before this feature.

### Edge Cases

- `bid.dealid` present with a type that does not strictly equal any `deals[].id` (a number against a
  string id) matches nothing and falls back to the impression floor, in both engines alike.
- `imp.pmp.deals` that is not an array, a null deal entry, or duplicate deal ids: the first strict
  match wins and a malformed container is ignored, exactly as the validation engine already did.
- A negative `bidfloor`, on an impression or on a deal, is out of scope: nothing in the product flags
  it today, both engines treat it as the stated floor, and the verdict prints the number the request
  contains. Recorded as a follow-up in the [cleanup backlog](../020-ad-format-verification-matrix/cleanup-backlog.md).
- `bid.price` of `null` or `undefined` remains invalid, as before.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Crosscheck MUST treat a bid price as usable only when it is a JSON number that is
  finite and not negative, performing no type coercion; every other value MUST produce
  `crosscheck.bid.price_invalid` at crit and no floor verdict.
- **FR-002**: The crosscheck price predicate MUST be the same predicate the validation engine
  applies, so the two engines can never disagree about which prices are real.
- **FR-003**: When `bid.dealid` matches an `imp.pmp.deals[].id` whose `bidfloor` is a finite number,
  that floor MUST govern the bid at any value including `0`, and MUST be denominated in the deal's
  own `bidfloorcur`, which never inherits `imp.bidfloorcur`.
- **FR-004**: Both engines MUST resolve a deal floor through one shared function, so the effective
  floor they name is identical by construction rather than by coincidence.
- **FR-005**: When no deal governs, the existing impression-floor behaviour MUST be unchanged,
  including the absent-floor default, the "no floor set" note and the unusable-floor branch.
- **FR-006**: The OpenRTB 3.0 item projection MUST read the floor currency from `flrcur`.
- **FR-007**: A paired OpenRTB 3.0 request MUST reach the response rules in a shape whose `cur` is
  the request's accepted-currency list, so a permitted currency is not reported as a mismatch; a
  genuinely disallowed currency MUST still be reported.
- **FR-008**: No finding id MUST be added, removed or renamed, and no message text MUST change.
- **FR-009**: Every changed behaviour MUST be pinned by a regression test at the public boundary,
  and the 020 corpus MUST be updated in the same change: the nine affected cases lose their ledger
  records and pass normatively, while every other recorded deviation keeps its exact signature.
- **FR-010**: The Core package MUST take a SemVer minor bump with the CLI dependency range and the
  lock file, and the validator contract MUST record the floor-resolution and price rules.

### Key Entities _(include if feature involves data)_

- **Effective floor**: the number a bid is ranked against — a matched deal's `bidfloor` when one
  governs, otherwise the impression's `bidfloor`, otherwise the spec default of zero.
- **Usable price**: a finite, non-negative JSON number in `bid.price`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The nine audit cases recorded under DEF-104, DEF-105 and DEF-110 pass normatively on
  the Core and HTTP corpus layers with their ledger records retired.
- **SC-002**: Every other corpus case carrying a recorded deviation still reports exactly that
  deviation, with no signature re-pinned and no guard failing in either direction.
- **SC-003**: No finding id or message changes; the locale parity and severity-registry suites pass.
- **SC-004**: `npm run ci` exits 0 with zero failures and zero runner retries.

## Assumptions

- A bid price of exactly `0` is a real bid. The validation engine already treats it so, and the
  change keeps the two engines aligned rather than introducing a new opinion.
- The shared floor resolver lives in the rule plugin that already owned and documented the deal-floor
  rule; crosscheck imports it. This closes the recorded backlog item about the two engines carrying
  independent copies of the same rule.
- No new decision record is created: the governing policy is unchanged, so the durable rationale goes
  into the [platform validator contract](../000-platform-baseline/contracts/core-validator.md) and
  the [public-boundary contract](./contracts/price-floor-resolution.md) for this feature.
- Deployment is a separate release decision; this feature ends at the pushed commit with hosted CI.
