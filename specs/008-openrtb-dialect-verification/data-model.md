# Data Model: OpenRTB Dialect Verification

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

All entities live outside the product tree (research D2). No product schema changes.

## Frozen Sample Manifest (one per line, B1 and B2)

| Field                                            | Meaning                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `line`                                           | `B1` or `B2`                                                                                                                                                          |
| `frozenAt`                                       | ISO timestamp; execution before this timestamp is impossible, after it the member list is immutable (FR-006)                                                          |
| `members[]`                                      | B1: rule references (`bidder`, `field`, `disposition`, evidence line). B2: adapter names with stratum labels (size tercile, yield class, prior-verification exposure) |
| `selectionRationale`                             | which stratum admitted each member (research D4/D5)                                                                                                                   |
| `corpusRef`, `commit`, `imageDigest`, `mockHash` | the pinned world (research D7)                                                                                                                                        |

**Invariant**: a manifest edited after first execution invalidates every result that cites it.

## Witness Case (B1)

| Field             | Meaning                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `rule`            | reference into the corpus (bidder, field, disposition, evidence)                                                      |
| `triggeringInput` | synthetic BidRequest that satisfies the rule's stated condition                                                       |
| `expected`        | the claimed behaviour, stated as an assertion over `httpcalls[].requestbody` or the error surface                     |
| `minimalPair`     | the same input minimally changed so the stated condition no longer holds (FR-001)                                     |
| `pairExpected`    | the claimed behaviour absent                                                                                          |
| `outcome`         | `pass` \| `fail` \| `inconclusive` (FR-007) — pass requires both halves plus the adapter's execution control (SC-002) |
| `recordedAgainst` | image digest + adapter revision                                                                                       |

## Execution Control (B1, one per adapter per run)

| Field      | Meaning                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter`  | bidder name                                                                                                                                           |
| `evidence` | proof the pinned adapter executed (its `httpcalls` entry present with HTTP status from the mock) — a vacuous pass is unrecordable without it (FR-010) |

## Blind Reading (B2)

| Field                | Meaning                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `adapter`, `stratum` | sampled member and why it is in the sample                                                              |
| `readerContext`      | literally what the reader received: adapter path + disposition taxonomy, nothing else (research D3)     |
| `rules[]`            | the independent extraction, same shape as corpus rules, citations restricted to the adapter's own files |

## Adjudication Record (B2)

| Field            | Meaning                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `candidate`      | rule present in the blind reading, absent from the corpus                                                           |
| `outcome`        | `confirmed-omission` \| `disposition-disagreement` (→ routes to B1) \| `not-a-rule` \| `reader-error` (research D6) |
| `sourceEvidence` | the adapter lines read during adjudication                                                                          |

## State transitions

`corpus rule`: `unverified → verified` (witness pass) · `unverified/verified → failed-witness` (SC-005: marked in the same change that discovered it) · new rule enters as `confirmed-omission` with B2 provenance.
