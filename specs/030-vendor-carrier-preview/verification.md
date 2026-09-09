# Verification: 030 Vendor carrier preview

**Date**: 2026-09-09 | **Feature**: [030](./spec.md) | **Status**: Complete

## What was measured, and how

Each of the four carriers was read out of the corpus fixture that needs it — the AdCOM asset names
from the 3.0 fixtures, the Kadam Native and EXADS banner field names from their recorded provenance,
the PPCmate material fields from the pop fixtures — and each new predicate was then run across all
257 corpus cases **before** the code was wired in. The four predicates reach:

| Predicate              | Cases reached | Which                                         |
| ---------------------- | ------------- | --------------------------------------------- |
| AdCOM Native           | 5             | the four 3.0 context cases and the AdCOM stub |
| Vendor Native material | 2             | both Kadam Native cases                       |
| Vendor banner wrapper  | 1             | the EXADS banner case                         |
| Material identity      | 2             | both PPCmate pop cases                        |

Exactly the sets the four ledger records name, and no other bid or material in the corpus. The
measurement is kept as a standing test, so a future loosening of any gate fails loudly instead of
quietly claiming a shape no vendor documented.

## Results

| Check                                                     | Result                             |
| --------------------------------------------------------- | ---------------------------------- |
| `tests/creative-resolution.test.js`                       | 50 pass / 0 fail (11 new)          |
| `tests/corpus-core.test.js` + `tests/corpus-http.test.js` | 541 pass / 0 fail                  |
| `tests/corpus-axes.test.js`, `tests/corpus-lib.test.js`   | pass                               |
| Browser layer, the twelve affected cases                  | 12 pass / 0 fail, no recorded gaps |
| `npx eslint`, `npx tsc --noEmit`, `npx prettier --check`  | clean                              |
| Full repository gate through the pre-push hook            | recorded in the delivery evidence  |

## One test had to change

`tests/corpus-axes.test.js` asserted its gap-accounting behaviour by picking a real recorded gap out
of the committed corpus. With the ledger empty there is none to pick, and the test failed on its own
premise rather than on the behaviour it checks. It now asserts the same accounting — a declared gap
with no measured rows is _incomplete_, the same gap with rows is _deviating_ — on a synthetic case,
which is how the rest of that file already works. The assertion is unchanged; only its subject is.

## Ledger effect

| Record  | Before                                                      | After   |
| ------- | ----------------------------------------------------------- | ------- |
| DEF-106 | EXADS banner preview shows nothing                          | Retired |
| DEF-107 | PPCmate materials show no identity; two Kadam format claims | Retired |
| DEF-151 | AdCOM Native creative not rendered                          | Retired |
| DEF-441 | Kadam Native material not rendered                          | Retired |

The [020 ledger](../020-ad-format-verification-matrix/defects.md) now holds **no records**. Every one
of the 257 corpus cases is asserted normatively at every layer that applies to it.

Two of DEF-107's four cases closed by correcting an expectation rather than by changing the product,
under [ADR-017](../decisions/ADR-017-format-tags-follow-the-wire.md): neither half of that
transaction carries the in-page-versus-push distinction, which lives only in the vendor's own account
provisioning. That decision is the one thing in this feature an owner may want to revisit, and it is
written where it can be revisited in one line.

## Deployment

Shipped in **v1.20.0** (`76570e4`), deployed 2026-09-09 through the standing path: verified pre-deploy backup, readiness, smoke 19/19, container healthy.
