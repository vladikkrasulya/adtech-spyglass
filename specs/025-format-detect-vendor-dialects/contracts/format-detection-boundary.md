# Public-Boundary Contract: Format Detection and Feed Dispatch Alignment

The Core public API (`validate()`, `detectFormat()`, and the CLI and HTTP surfaces that wrap them) is
a deterministic data-to-data contract (Constitution IV). This file records what this feature changes
at that boundary. Core moves from 0.42.0 to 0.44.0 (0.43.0 is reserved by the concurrent analyze-boundary change on
pull request #81 — feature 024, which lands on its own branch — so the two Core bumps are coordinated
at merge).

## What does not change

No finding id is added, removed or renamed. No level changes. No message text changes in any locale.
No `spec-refs.json` entry changes. Finding order and `(id, path)` dedup semantics are untouched.

## What changes

| Situation                                                                   | Before                                        | After                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Material using `image_url`/`icon_url` creative slots                        | validated, but `detectFormat` returned no tag | tagged `push` (or `inpage` with an in-page ext signal)  |
| Single object using the `clickurl` click alias                              | `payload.unknown_type`                        | classified as a feed and validated                      |
| Array element using the `clickurl` click alias                              | false `feed.push.click_url_required`          | click recognized; no false missing-click error          |
| `clickurl` card in the Inspector                                            | no preview (material not recognized)          | previews with the card title as identity                |
| Array element matching the bid-price shape (`bid_price`/`notification_url`) | push-material contract → three false errors   | bid-price contract with array-indexed paths             |
| Generic priced-and-clickable array element                                  | push-material contract                        | unchanged                                               |
| Response bid `adm` = Native 1.x body, no `mtype`                            | no format tag                                 | tagged `native`                                         |
| Response bid that declares its `mtype`                                      | tagged from `mtype`                           | unchanged (the native sniff is gated on absent `mtype`) |
| Any payload using the pre-existing spellings                                | —                                             | byte-identical                                          |

## Compatibility decision

1. **Detection tags more payloads correctly.** `detectFormat` now returns a tag where it previously
   returned none for alias-spelled materials and standalone Native bodies. A consumer keyed on the
   presence of a tag receives the correct one; none is removed or renamed.
2. **Classification recognizes one more click alias.** `validate()` types a `clickurl` single object
   as a feed instead of `payload.unknown_type`, and stops a false `feed.push.click_url_required` on a
   `clickurl` array. Both are corrections toward the payload the operator pasted.
3. **One array element is validated against the right contract.** A bid-price-shaped element no longer
   draws push-material errors. The array feed type stays `Push-Materials Feed Response`; only the
   per-element findings change, and only for an element that matched a vendor-unique key.
4. **One shared bid-price contract.** `validateBidPriceMaterial(o, fp, findings)` is the single field
   contract used by both the standalone bid-price object and the array element, so the two can never
   disagree about the shape.
5. **Coupled DEF-107 re-pin.** The image-alias change incidentally corrects the response-format of the
   still-open DEF-107 Kadam cases. Their ledger records are re-pinned to the residual
   `request.url.no_decoder` deviation; DEF-107 stays open until its request decoder is built.

## Consumers checked

- `public/ortbtools.app.js` renders findings generically and previews materials through the same
  alias set aligned here; the card link and price resolution now honour `clickurl` and `bid_price`.
- `packages/cli` wraps `validate()`/`detectFormat()`; its output changes only for the payloads that
  were previously classified or tagged wrongly.
- `scripts/smoke.sh` and `scripts/ci-docker-smoke.sh` assert on the analyze envelope and on findings;
  neither depends on the alias-spelled feed paths.
- The 020 corpus is the regression net: the six affected cases now pass normatively, the coupled
  DEF-107 Kadam cases are re-pinned to their residual gap, and every other recorded deviation keeps
  its exact signature.
