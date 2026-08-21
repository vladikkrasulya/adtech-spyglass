# Data Model: OpenRTB Dialect Verification

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

All entities live outside the product tree (research D2). No product schema changes.

## Frozen Sample Manifest (one per line, B1 and B2)

| Field                                            | Meaning                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `line`                                           | `B1` or `B2`                                                                                                                                                          |
| `generation`, `frozenAt`                         | Monotonic generation and ISO timestamp; together with content hashes they identify the immutable sample used by a run (FR-006)                                        |
| `members[]`                                      | B1: rule references (`bidder`, `field`, `disposition`, evidence line). B2: adapter names with stratum labels (size tercile, yield class, prior-verification exposure) |
| `selectionRationale`                             | which stratum admitted each member (research D4/D5)                                                                                                                   |
| `corpusRef`, `commit`, `imageDigest`, `mockHash` | the pinned world (research D7)                                                                                                                                        |

**Invariant**: a manifest edited after first execution invalidates every result that cites that
generation. Manifest membership is never repaired; the execution bundle may be, before any canonical
result stands on it (spec clarification 2026-08-21). The superseded manifest and results remain retained with an invalidation reason.

## Frozen B1 Execution Bundle

| Field                                                                | Meaning                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `manifestHash`, `caseBundleHash`, `runnerHash`                       | Exact membership, assertions and executable harness used by the run                         |
| `labConfigHash`, `endpointMapHash`, `mockHash`, `imageDigest`        | Exact fail-closed lab world                                                                 |
| `controlBundleHash`, `selectionScriptHash`, `selectionInputHashes[]` | Controls and reproducible selector                                                          |
| `preflight`                                                          | Internal-network, no-host-publication, egress-denial and internal reachability observations |

## Witness Case (B1)

| Field             | Meaning                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rule`            | reference into the corpus (bidder, field, disposition, evidence)                                                                                               |
| `triggeringInput` | synthetic BidRequest that satisfies the rule's stated condition                                                                                                |
| `expected`        | the claimed behaviour, stated as an assertion over `httpcalls[].requestbody` or the error surface                                                              |
| `minimalPair`     | the same input with exactly one pre-registered causal delta: condition removed, or one source-valid field removed for an unconditional transformation (FR-001) |
| `pairExpected`    | conditional behaviour absent, or the pre-registered collapsed output for an unconditional transformation                                                       |
| `outcome`         | `pass` \| `fail` \| `inconclusive` (FR-007) — pass requires both halves plus the adapter's execution control (SC-002)                                          |
| `synthetic`       | literal `true`; non-synthetic payloads are rejected                                                                                                            |
| `recordedAgainst` | image digest + adapter revision + frozen execution-bundle hash                                                                                                 |

## Execution Control (B1, one per adapter per run)

| Field      | Meaning                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter`  | bidder name                                                                                                                                                                       |
| `evidence` | proof from a separate valid request that the pinned adapter reached the mock URI and the mock returned its known status/body — a vacuous pass is unrecordable without it (FR-010) |

## Blind Reading (B2)

| Field                | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `adapter`, `stratum` | sampled member and why it is in the sample                                                                     |
| `readerContext`      | exact prompt, runtime/model and mount allowlist: copied adapter subtree + taxonomy + output only (research D3) |
| `rules[]`            | the independent extraction, same shape as corpus rules, citations restricted to the adapter's own files        |

**Unblinding invariant**: every sampled adapter has one schema-valid reading; the reading index and
content hashes are immutable before any process that can see the corpus performs a diff.

## Adjudication Record (B2)

| Field                                                                      | Meaning                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `candidateId`, `blindRepresentation`, `matchedFrozenCorpusRepresentations` | the reading and corpus representations plus the normalized adapter/field/disposition/condition identity                      |
| `outcome`                                                                  | `confirmed-omission` \| `disposition-disagreement` (→ named follow-up queue) \| `not-a-rule` \| `reader-error` (research D6) |
| `productionCitations`, `rationale`                                         | the adapter lines read during adjudication and why they settle the outcome                                                   |

## Retained Run

| Field                         | Meaning                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runId`, `generation`         | Immutable identity; results are never overwritten                                                                                                                                                   |
| `status`                      | `canonical` \| `aborted` \| `invalidated`                                                                                                                                                           |
| `reason`                      | Required unless canonical                                                                                                                                                                           |
| `bundleHash`                  | Content-addressed link to the frozen inputs. The bytes behind it are retained beside the run as `<run-id>.bundle.json`; a run that cannot show them declares the loss and is never the reported run |
| `corpusBefore`, `corpusAfter` | Hashes and summary counts around any status/rule mutation, retained in `corpus-mutation-report.json` and `evidence/`                                                                                |

## State transitions

`corpus rule`: `unverified → verified` (witness pass) · `unverified/verified → failed-witness` (SC-005: marked in the same change that discovered it) · new rule enters as `confirmed-omission` with B2 provenance.
