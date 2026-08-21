# Research: OpenRTB Dialect Verification

**Date**: 2026-08-21 · **Spec**: [spec.md](./spec.md)

Most unknowns here were resolved empirically earlier in the same working session that produced the
corpus; this file records the decisions with their rejected alternatives rather than re-deriving
them.

## D1 — Where B1 executes

**Decision**: The existing local lab — `prebid-server:local` (built from the pinned commit
`0ba3523`) plus the mock DSP, both on the isolated `ortb-lab` docker network. Documented at
`~/.local/share/ortbtools-research/prebid-2026-08-20/lab/README.md`.

**Rationale**: Already proven: one auction request produced four materially different outgoing
requests, and all four divergences matched extracted rules. `"test": 1` yields
`ext.debug.httpcalls.{bidder}[].requestbody` — the exact outgoing payload, which is the observable
B1 asserts against. Nothing leaves the machine, which keeps the "never an auction participant"
boundary structural rather than disciplinary.

**Alternatives considered**: Driving adapter Go code directly via unit harness — rejected: it
re-implements request assembly and would test our harness, not the adapter path. Live partner
endpoints — rejected outright (out of scope by spec; also returns only 401s, so it is worse
evidence, not just riskier).

**Consequence adopted**: two upstream defects are part of the run book — `m152`'s endpoint fails
prebid-server's own URL validation at startup (override it), and `ix` requires an explicit
`DISABLED=false`.

## D2 — Where the audit lives

**Decision**: Entirely outside the product source tree, alongside the corpus in
`~/.local/share/ortbtools-research/prebid-2026-08-20/audit/`. The repository carries only this
feature package: spec, plan, contracts, evidence summaries in tasks.md.

**Rationale**: FR-004 freezes the product (IAB path byte-identical); Constitution V forbids new
product services without measured need; Constitution III bars payload-bearing artifacts from the
tracked tree — witness inputs are synthetic, but adapter `httpcalls` captures are wire-shaped and
belong with the research corpus. The audit is evidence _about_ data the product may later consume,
not product behaviour.

**Alternatives considered**: `tests/` in-repo — rejected: it would run in `npm run ci`, coupling the
product gate to a 46 MB research clone and a docker lab the CI runner does not have.

## D3 — How B2 blindness is enforced

**Decision**: Process isolation. Each blind reading is produced by a fresh agent whose prompt
contains the adapter directory path and the extraction taxonomy (the nine dispositions), and
nothing else — no corpus file path, no prior results, no batch context. The corpus diff happens in a
separate later step by a different invocation.

**Rationale**: Blindness by instruction ("do not look") is not verifiable; blindness by absence of
the pointer is. The reader cannot cite what it was never given a path to.

**Alternatives considered**: A human second reader — unavailable. The same agent re-reading with the
corpus withheld from the prompt but present on disk — weaker, because tool access could find it;
mitigated by also keeping the corpus outside the sampled adapter's directory tree and checking the
reading's citations only reference the adapter's own files.

## D4 — B1 sample construction (before freezing)

**Decision**: Purposive, two strata, frozen as a manifest before any execution:

1. **Most destructive** (~60% of the sample): all `forbidden` (9), the `dropped` and `rewritten`
   rules whose fields carry money or identity semantics (`bidfloor`, `tagid`, `schain`,
   `publisher.id`), and the loop-scope/aliasing defects verification itself flagged (`lockerdome`,
   `smartyads`, `huaweiads` signing-key case).
2. **Most frequent on canonical inputs** (~40%): top rules by manifestation across the 3103-fixture
   offline pass (`coverage-exercised-2026-08-20.json`), excluding those already in stratum 1.

**Rationale**: The spec fixes 20–50; the clarification fixes purposive-not-probability; the two
strata match the two ways a wrong rule hurts most — badly and often. Frequency stratum uses fixture
manifestation, which is evidence about canonical inputs, not traffic — already recorded honestly.

## D5 — B2 stratification of ≥15 adapters

**Decision**: Sample across three axes so the head of the corpus cannot dominate: size tercile of
the adapter (small/medium/large by LOC), rule yield (produced rules vs returned-empty — at least 3
of the 38 empty ones, because a silent passthrough misread as empty is exactly a recall defect),
and verification state (at least 5 adapters none of whose rules were second-read).

**Rationale**: The failure B2 exists to catch is systematic blindness of the extraction method;
stratifying by size, yield and prior-verification exposure covers the three plausible axes of that
blindness.

## D6 — Adjudication protocol

**Decision**: Each candidate omission is adjudicated by reading the cited adapter lines directly.
Outcomes: `confirmed-omission` (enters the corpus as a new rule in the same change), `disposition-
disagreement` (routes to B1 as a precision finding, per spec edge case), `not-a-rule` (generic
plumbing; recorded with reason), `reader-error`. All four counts are reported per adapter.

## D7 — Versions and pinning

**Decision**: Every artifact records: corpus file + its extraction date, prebid-server commit
`0ba352315253f6692af6497d553cfb12909a1b8b`, the docker image digest of `prebid-server:local`, and
the mock DSP script hash. The witness expectation is recorded against the image digest, not the
commit alone, because the image is what executed.
