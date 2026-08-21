# Implementation Plan: OpenRTB Dialect Verification

**Branch**: `feat/openrtb-shadow-verification` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-openrtb-dialect-verification/spec.md`

## Summary

Audit the dialect corpus on two frozen, pre-registered samples: B1 verifies 20–50 consequential
rules by executing witness inputs through the pinned local prebid-server lab and asserting on the
exact outgoing request, each pass gated by a same-adapter minimal pair and a positive execution
control; B2 has an isolated blind reader re-extract ≥15 stratified adapters and adjudicates the diff
into confirmed omissions, disposition disagreements, non-rules and reader errors. All artifacts live
with the research corpus, carry full pinning, and are structurally incapable of expressing a
corpus-wide precision or recall figure. The product tree does not change.

## Technical Context

**Language/Version**: Node.js `>=22.13.0` for the witness runner and guards; Go only as the audited
artifact inside the pinned docker image (never compiled here)

**Primary Dependencies**: `prebid-server:local` image (commit `0ba3523`), mock DSP (node:22-alpine),
an internal Docker network, and a mount-namespace sandbox for blind readers; no new product
dependency

**Storage**: JSON artifacts under `~/.local/share/ortbtools-research/prebid-2026-08-20/audit/`;
no product schema change

**Testing**: The audit _is_ the test surface. Harness sanity is covered by fail-closed lab preflight,
separate mock-backed execution controls, manifest/case/runner hash checks and explicit error-surface
assertions. `npm run ci` intentionally does not run it (research D2)

**Target Platform**: The vkbox host with docker; fully offline from partners

**Project Type**: Research audit producing evidence artifacts; zero product surface

**Performance Goals**: None user-facing. Whole B1 run repeatable in under an hour so a failed freeze
can be re-cut cheaply

**Constraints**: Frozen manifests and full B1 execution bundle before valid execution (FR-006);
immutable blind readings before unblinding (FR-012); structural egress denial and mock-only routes
(FR-013); pass requires minimal pair + separate execution control (SC-002); no corpus-wide claims
(FR-009); quarantine physically absent from reader sandboxes (FR-005); product byte-identical
(FR-004, SC-006)

**Scale/Scope**: 20–50 witness cases; ≥15 blind-read adapters of 270; one corpus file mutated

## Constitution Check

_GATE: evaluated before Phase 0; re-checked after Phase 1._

- **I — Spec Kit memory**: package opened through assess → decide with three recorded
  clarifications before any execution; this plan precedes the work.
- **II — Evidence-backed truth**: the package's entire purpose. Every outcome cites frozen input,
  complete observed wire evidence and a content-addressed world; invalid attempts remain visible.
- **III — Privacy/security**: witness inputs synthetic and marked; artifacts outside the tracked
  tree; no payload from any real party exists anywhere in this work.
- **IV — Compatible contracts**: no Core/API/CLI/storage change; IAB findings byte-identical.
- **V — Bounded architecture**: no new product service; the lab is research tooling outside the
  repo. Nothing here creates a runtime the product depends on.
- **VI — Locale parity**: no user-visible strings exist in this package.
- **VII — Proportional verification**: the audit runs narrowest-first (per-case), and the repo gate
  is unaffected; quickstart guards are the reproducible check.
- **VIII — Traceable releases**: no release. The only mutation is the research corpus file, with
  provenance on every changed row.

Post-design re-check: passed. No violation, no new durable mechanism needing an ADR; the lab already
exists as research tooling and gains no product coupling.

## Project Structure

### Documentation (this feature)

```text
specs/008-openrtb-dialect-verification/
├── spec.md
├── plan.md
├── research.md          # D1–D7 decisions
├── data-model.md
├── quickstart.md
├── contracts/
│   └── audit-artifacts.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks output
```

### Audit workspace (outside the repository — research D2)

```text
~/.local/share/ortbtools-research/prebid-2026-08-20/
├── lab/                            # existing: pbs.yaml, mock-dsp.js, README
├── derived/                        # existing corpus + coverage artifacts
├── prebid-server/                  # pinned Apache-2.0 source; the citation allowlist root
└── audit/                          # NEW
    ├── manifests/                  # immutable generations + invalidation records
    ├── selectors/                  # the retained, hashed sample selector
    ├── schemas/                    # case, control and guard schemas
    ├── cases/*.json                # witness case definitions
    ├── controls/*.json             # one positive execution control per adapter
    ├── authoring/                  # case generator + bundle builder
    ├── pbs-audit.yaml              # frozen lab config
    ├── endpoint-map-v2.json        # mock-only routes and their query contracts
    ├── world-v2.json               # pinned containers, network and hashes
    ├── preflight.js, preflight-v2.json   # historical preflight; never authorizes a run
    ├── pre-run-guard.js, pre-run-guards/ # immediate, expiring topology guard
    ├── validate-b1.js, validation-b1.json
    ├── bundle-b1.json              # hashes for runner, cases, controls, config and selector
    ├── freeze-b1.js                # fd-based freeze of every bound input
    ├── run-witness.js              # runner: POST /openrtb2/auction, assert on httpcalls
    ├── runs-b1/<run-id>/           # summary.json + hash-chained journal.jsonl, never overwritten
    │   └── <run-id>.bundle.json    # the exact bundle bytes that run cited
    ├── diagnostics/                # non-canonical sweeps + the input-repair record
    ├── reader-sandbox/<run-id>/    # blind-reader mount records and staging
    ├── readings/<run-id>/          # one reading per adapter + index.json (+ .sha256)
    ├── candidates-b2.json          # machine diff, pre-adjudication
    ├── adjudication-b2-batch-{a,b}.json, adjudication-b2.json
    ├── merge-adjudication-b2.js, mutate-corpus.js
    ├── evidence/                   # corpus before/after copies
    ├── corpus-mutation-report.json # machine-readable corpus diff
    ├── bundle-digest.json          # recursive digest of this tree
    └── guards.sh + guards.js       # quickstart section 5 checks
```

**Structure Decision**: the repository holds governance and evidence summaries only; execution and
wire-shaped artifacts stay with the corpus they audit. This keeps Constitution III and V structural:
the product cannot depend on what it cannot reach, and CI cannot inherit a docker lab.

## Complexity Tracking

No constitution violation. One deliberate asymmetry worth naming: B2 blind readings are produced by
isolated agent invocations (research D3), which makes them non-deterministic across re-runs. That is
acceptable because a blind reading is a _sampled observation_, not a reproducible build step — the
manifest freezes _which_ adapters are read, not _what_ the reader must find; adjudication against
adapter source is the deterministic half.
