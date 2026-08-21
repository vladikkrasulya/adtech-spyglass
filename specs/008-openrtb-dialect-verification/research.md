# Research: OpenRTB Dialect Verification

**Date**: 2026-08-21 · **Spec**: [spec.md](./spec.md)

Most unknowns here were resolved empirically earlier in the same working session that produced the
corpus; this file records the decisions with their rejected alternatives rather than re-deriving
them.

## D1 — Where B1 executes

**Decision**: `prebid-server:local` (built from the pinned commit `0ba3523`) plus the mock DSP on a
Docker bridge created with `--internal`. Neither PBS nor the mock has a published host port; the
preflight and witness runner execute as one-shot clients on that bridge. The run has a fail-closed
preflight: direct egress must fail, every sampled adapter must have an explicit mock route, and every
observed outgoing URI must use the mock host.

**Rationale**: Already proven: one auction request produced four materially different outgoing
requests, and all four divergences matched extracted rules. `"test": 1` yields
`ext.debug.httpcalls.{bidder}[].requestbody` — the exact outgoing payload, which is the observable
B1 asserts against. Nothing leaves the machine, which keeps the "never an auction participant"
boundary structural rather than disciplinary.

**Alternatives considered**: Driving adapter Go code directly via unit harness — rejected: it
re-implements request assembly and would test our harness, not the adapter path. Live partner
endpoints — rejected outright (out of scope by spec; also returns only 401s, so it is worse
evidence, not just riskier).

**Consequence adopted**: endpoint overrides are defense in depth, not the security boundary. Some
adapters choose a hard-coded or secondary endpoint despite the ordinary endpoint setting; PBS also
attempts vendor-list fetches during startup. Therefore the internal network is mandatory and a
configuration that merely lists overrides is not accepted as isolated.

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

**Decision**: Process and filesystem isolation. Each blind reading is produced by a fresh invocation
inside a mount namespace that contains a copied adapter subtree, the extraction taxonomy and its own
output path, and masks the research corpus, repository, assessment record, prior results and
quarantine tree. The corpus diff happens only after all readings have been validated, hashed and
made immutable.

**Rationale**: Blindness by instruction ("do not look") is not verifiable. The original proposal
withheld the corpus path in the prompt but still gave the agent an unrestricted shared filesystem;
that did not enforce blindness. Mount-level absence makes the boundary inspectable.

**Alternatives considered**: A human second reader — unavailable. The same agent re-reading with the
corpus withheld from the prompt but present on disk — rejected because discovery remained possible.

## D4 — B1 sample construction (before freezing)

**Decision**: Purposive, four explicit quotas, frozen as a 48-member manifest before any valid
generation-2 execution:

1. all nine `forbidden` rules;
2. three source-verified multi-impression defects: LockerDome survivor indexing, SmartyAds final-imp
   routing and HuaweiAds final-imp authorization inputs;
3. twelve bounded money/identity rules, split evenly by theme and deliberately covering loss and
   rewrite across distinct field families rather than taking an alphabetical prefix; and
4. twenty-four canonical-fixture champions, at most one per adapter.

The earlier selector is invalid. It capped an unbounded 104-rule money/identity candidate set by
alphabetical order, omitted the named defects and described `coverage-exercised-2026-08-20.json` as
frequency even though that file contains only one binary row per exercised rule. Generation 2 keeps
that file only as an eligibility gate. Its retained selector recomputes a per-fixture count from
adapter-owned exemplary/supplemental JSON: comparable OpenRTB-shaped expected bodies, impressions
correlated by ID, and an exact path drop/change counted at most once per fixture. It chooses each
adapter's strongest rule, then ranks champions by count with bytewise identity tie-breaks.

**Rationale**: The first three quotas protect consequence and known blind spots; the fourth protects
repeat manifestation on canonical adapter inputs without calling it traffic frequency. The selector
script, source inputs and counts are retained and hashed. This remains a purposive sample, not a
probability sample and not an importance score.

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
disagreement` (enters a named precision follow-up queue without changing the frozen B1 sample),
`not-a-rule` (generic plumbing; recorded with reason), `reader-error`. All four counts are reported
per adapter. Candidate identity uses adapter + normalized field + disposition + condition; free-text
detail and citation are preserved on both sides and never exact-matched as the sole oracle.

## D7 — Versions and pinning

**Decision**: Every retained run records the corpus file and extraction date; corpus before/after
hashes; prebid-server commit `0ba352315253f6692af6497d553cfb12909a1b8b`; Docker image digest;
mock, lab-config, endpoint-map, runner, case-bundle, manifest and selection-input hashes; exact
preflight output; and the invocation timestamp. The witness expectation is recorded against the
image digest, not the commit alone, because the image is what executed. Earlier invalid attempts are
retained under immutable run IDs instead of being overwritten.
