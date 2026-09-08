# Public-Boundary Contract: Price Validity and Floor Resolution

The Core public API (`validate()`, `crosscheck()`, and the CLI and HTTP surfaces that wrap them) is a
deterministic data-to-data contract (Constitution IV). This file records what this feature changes at
that boundary. Core moves from 0.40.0 to 0.41.0.

## What does not change

No finding id is added, removed or renamed. No level changes. No message text changes in any locale.
No `spec-refs.json` entry changes. Finding order and `(id, path)` dedup semantics are untouched.

## What changes

| Situation                                                           | Before                                             | After                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `bid.price` is `[]`, `[1]`, `true`, `''` or a numeric string        | `above_floor` / `below_floor` on a coerced number  | `crosscheck.bid.price_invalid` (crit), no floor verdict |
| `bid.price` is negative                                             | `above_floor` / `below_floor`                      | `crosscheck.bid.price_invalid` (crit), no floor verdict |
| `bid.price` is `0`, or any finite non-negative number               | ranked against the floor                           | unchanged                                               |
| `bid.price` is `null` or `undefined`                                | `price_invalid`                                    | unchanged                                               |
| `bid.dealid` matches a deal carrying a finite `bidfloor`            | ranked against `imp.bidfloor`                      | ranked against the deal's floor, in the deal's currency |
| ... and that deal floor is `0`                                      | `no_floor_set` could fire, imp floor used          | explicit floor 0, no `no_floor_set`                     |
| `bid.dealid` matches nothing, or the deal has no usable floor       | ranked against `imp.bidfloor`                      | unchanged                                               |
| OpenRTB 3.0 `item.flrcur`                                           | read from `item.flrcu`, so always defaulted to USD | read from `flrcur`                                      |
| OpenRTB 3.0 paired request reaching the response rules              | raw envelope, `req.cur` undefined → USD-only set   | projected `{cur}` from `openrtb.request.cur`            |
| OpenRTB 3.0 response currency genuinely outside the request's `cur` | `err-bid-currency-mismatch`                        | unchanged                                               |
| Any 2.x pair                                                        | —                                                  | byte-identical                                          |

## Compatibility decision

1. **Levels and ids are stable**, so automation keyed on them is unaffected. What changes is which
   payloads reach which finding, and in every case the new answer is the one the payload supports.
2. **Consumers gating on a floor verdict** see `price_invalid` where a coerced `above_floor` used to
   appear. That is the correction: the previous verdict named a number the response did not carry.
3. **The auction summary** (`totalBids`, `bidsAboveFloor`, `impsFilled`, `topPrice`) no longer counts
   a coerced price as a bid. A response mixing a valid and an invalid price now reports one bid above
   floor instead of two.
4. **`params.floor`** now prints the deal floor when a deal governs. Anything displaying that value
   shows the effective floor rather than the impression floor.
5. **One resolver, two engines.** `resolveDealFloor(bid, imp)` is exported from
   `packages/core/rules/price-floor/index.js` and imported by `packages/core/crosscheck.js`. It is an
   internal package export, not part of the published API surface; the guarantee it carries is that
   the validation and crosscheck engines name the same effective floor by construction. This closes
   the recorded backlog item about the two engines holding independent copies of the same rule.
6. **The 3.0 request projection** carries only `cur`. It does not project items, so the per-bid floor
   rule remains as inactive for 3.0 pairs as it has always been.

## Consumers checked

- `public/ortbtools.app.js` and the Inspector modules render findings generically and key on no id
  changed here.
- `packages/cli` prints levels and applies `--fail-on`; a crit crosscheck finding already failed at
  the default threshold, so exit codes are unchanged for every payload except the ones previously
  answered wrongly.
- `scripts/npm-pack-smoke.sh` and `scripts/ci-docker-smoke.sh` assert on a request-side error and on
  the presence of findings; neither depends on a floor verdict.
- The 020 corpus is the regression net: nine cases now pass normatively and the other seventy-two
  recorded deviations keep their exact signatures.
