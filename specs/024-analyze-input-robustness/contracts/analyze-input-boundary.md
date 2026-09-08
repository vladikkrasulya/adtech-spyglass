# Public-Boundary Contract: Malformed and Oversized Analyze Input

The Core public API (`validate()`, `crosscheck()`, `extractAllCategories()`) and the HTTP surface
that wraps them (`POST /api/analyze`) are deterministic data-to-data contracts (Constitution IV).
This file records what this feature changes at that boundary. Core moves from 0.42.0 to 0.43.0.

## What does not change

No finding id is added, removed or renamed. No level changes. No message text changes in any locale.
No `spec-refs.json` entry changes. Finding order and `(id, path)` dedup semantics are untouched. The
HTTP status codes and error `code` strings involved (`payload_too_large`, the 200 success envelope)
are the ones already documented in [docs/api-v1.md](../../../docs/api-v1.md).

## What changes

| Situation                                                             | Before                                                           | After                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Response with a non-array `seatbid` or `bid` (valid JSON), via HTTP   | `400 bad_request`, internal `forEach is not a function` message  | `200` success envelope with the validator's structured findings |
| The same payload, category decode in Core                             | threw a `TypeError`                                              | returns no categories for the malformed branch, no throw        |
| Malformed first bid (null / empty `bid[]` / non-array) in the browser | client `TypeError` (`reading 'cur'`) before the Analyze POST     | analysis completes; the bid resolves to an empty object         |
| A present scalar `bidRes` (e.g. `42`) alongside a valid request       | dropped as absent: clean request-only analysis, empty crosscheck | validated: `payload.invalid_root` and `crosscheck.no_response`  |
| An absent (`undefined`/`null`) or empty-object `bidRes`               | treated as absent                                                | unchanged                                                       |
| An analyze body over the 2 MiB cap                                    | socket reset mid-upload (`ECONNRESET`), no status                | `400 payload_too_large` error envelope                          |
| A body within the cap, or a well-formed payload                       | —                                                                | byte-identical                                                  |

## Compatibility decision

1. **`extractAllCategories()` no longer throws** on a malformed `imp`/`seatbid`/`bid`; it returns the
   categories it can decode and skips the malformed branch. Any caller that relied on the throw (none
   in this repository) would now receive a value instead of an exception — a strict improvement, and
   the reason Core takes a minor bump under Constitution VIII.
2. **The HTTP envelope for a malformed shape** changes from `400 bad_request` to the `200` structured
   analysis the payload actually supports. Automation keyed on the internal `forEach` message — which
   was never a documented contract — is unaffected because that message no longer occurs.
3. **A scalar response** now reaches `payload.invalid_root` and `crosscheck.no_response` where it used
   to be silently dropped. A consumer that read "no crosscheck" as "no response submitted" now sees an
   explicit invalid-response verdict; that is the correction.
4. **The oversized-body path** delivers the documented `400 payload_too_large` envelope instead of a
   transport reset, so a standard client can finally observe the contract. The drain that makes this
   possible has no explicit upper bound; it is O(bytes) with flat memory and the per-IP analyze rate
   limiter bounds abuse, a trade-off recorded at the `readJson` code boundary.

## Consumers checked

- `public/ortbtools.app.js` and the Inspector modules render findings generically and key on no id
  changed here; the winning-bid guard only changes malformed shapes.
- `packages/cli` wraps `validate()`/`crosscheck()` and prints levels; category decoding is server and
  Inspector surface, so CLI output is unchanged.
- `scripts/smoke.sh` and `scripts/ci-docker-smoke.sh` assert on the 200 envelope and on findings;
  neither depends on the malformed-shape path.
- The 020 corpus is the regression net: the six affected cases now pass normatively on their
  applicable Core, HTTP and browser layers, and every other recorded deviation keeps its signature.
