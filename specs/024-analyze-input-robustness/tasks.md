# Tasks: The Analyze Boundary Survives Malformed and Oversized Input

**Input**: Design documents from `/specs/024-analyze-input-robustness/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/analyze-input-boundary.md, quickstart.md

**Tests**: REQUIRED — Constitution VII and spec FR-006 demand the changed behaviour be pinned at the
public boundary in the same change. The 020 corpus already recorded each defect as an expected-failure
marker on the committed engine; those markers are the reproduction, retired only once the product
meets the spec expectation.

**Organization**: By user story. Work spans `packages/core`, the server transport, the analyze
handler, the browser bundle, the 020 corpus and the governing contracts.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read the constitution, specs/ROADMAP.md, the HTTP API and validator contracts, and the 020 records for DEF-115/DEF-204/DEF-300/DEF-303; confirm all four as recorded expected-failure markers on the committed engine (corpus core/http/browser layers).
- [x] T002 Pin the normative basis in research.md: OpenRTB 2.6 at 403cbba (§4.2.1 BidResponse root, §4.2.2 SeatBid.bid) and the docs/api-v1.md HTTP contract (200 success envelope; 400 payload_too_large); trace which layer each defect crashes at.
- [x] T003 Map the blast radius of the fixes and the one harness change through the real loadCorpus() so the change is scoped to the six affected cases and nothing else.

---

## Phase 2: User Story 1 — a malformed bid shape still yields structured findings (Priority: P1)

- [x] T004 [US1] packages/core/categories.js: guard the category walk with Array.isArray on `imp`, `seatbid` and each seat's `bid`, so a non-array value decodes to no categories instead of throwing; POST /api/analyze keeps its 200 envelope for shape-bid-object and shape-seatbid-object (FR-001).
- [x] T005 [US1] public/ortbtools.app.js: resolve the winning bid through Array.isArray guards and default a null/non-object first bid to `{}`, so shape-bid-null, shape-bid-object and multiplicity-empty-bid-array reach structured validation without a client `cur` dereference (FR-002).

**Checkpoint**: the DEF-115 HTTP cases and the DEF-204/DEF-115 browser cases pass normatively.

---

## Phase 3: User Story 2 — a scalar response is validated, not silently dropped (Priority: P1)

- [x] T006 [US2] modules/analyze/handler.js: treat a present scalar `bidRes` (a non-null, non-undefined, non-object value) as a submitted response, so validate() surfaces payload.invalid_root and crosscheck reports crosscheck.no_response; leave the absent and empty-object cases unchanged (FR-003).
- [x] T007 [US2] tests/corpus/lib/http-run.js: represent a scalar response side in runHttp so the fixed product is judged on the correct side, and drop the per-side `invalid` status expectation when both sides are present (the merged envelope cannot express it; the Core layer still asserts it) — scoped to the one scalar case, verified through loadCorpus() (FR-006).

**Checkpoint**: mut-input-shape-number-root-response passes normatively at HTTP; the Core layer is unchanged.

---

## Phase 4: User Story 3 — an oversized body returns the documented error (Priority: P2)

- [x] T008 [US3] lib/http.js: on a body over the 2 MiB cap, reject with payload_too_large and drain without buffering instead of destroying the socket, so the handler delivers the documented 400 error envelope for encoding-request-body-oversized (FR-004).
- [x] T009 [US3] lib/http.js: record the unbounded-drain trade-off in the code comment, naming the per-IP analyze rate limiter and the flat-memory measurement that bound it (FR-008).

**Checkpoint**: a 2.1 MiB body and a 40 MiB body both return 400 payload_too_large with flat memory.

---

## Phase 5: Ledger, versions and delivery

- [x] T010 Retire DEF-115, DEF-204, DEF-300 and DEF-303 from the ledger (tests/corpus/known-gaps.json and the mut-input-shape and mut-encoding-limits shards) and remove the knownGap block from their six case files; survey every remaining recorded deviation with deviationVerdict() and confirm each still matches exactly, with nothing re-pinned and no record hiding a second deviation (FR-006).
- [x] T011 Bump packages/core to 0.43.0 with the CLI dependency range and package-lock.json; record the malformed-shape, scalar-response and oversized-body rules in specs/000-platform-baseline/contracts/http-api.md and core-validator.md and a Resolutions entry in the 020 defect report (FR-005, FR-007).
- [x] T012 Run the corpus layers (core, http, browser), the no-change guards (spec-refs, i18n-audit, validator), prettier, eslint and tsc; then rebase onto main, run `npm run ci`, commit the authored paths and push under the standing authorization; wait for the hosted run (FR-006, FR-007).

## Evidence

- Reproduction before the change (T001): the six cases were recorded expected-failure markers on the
  committed engine at their applicable layers.
- After the change: the six cases pass normatively — core+http over the four HTTP/Core cases report
  0 failures, and the browser layer over the five affected cases reports 5/5 pass in real Chrome.
- Broad regression: corpus-lib, corpus-fixture-contract, corpus-report, full corpus-core and
  corpus-http run with 0 failures; every remaining recorded deviation keeps its exact signature.
- No-change guards: spec-refs, i18n-audit and validator suites pass; no finding id, level or message
  changed.
- Independent verification: the reviewer re-ran the corpus, the five browser cases in real Chrome and
  a live oversized-body HTTP probe (2.1 MiB and 40 MiB → 400 payload_too_large, flat memory), and
  confirmed the two harness edits affect exactly the one scalar case.
- Repository gate and hosted CI: recorded on the pull request.

## Requirement traceability

| Requirement | Tasks            |
| ----------- | ---------------- |
| FR-001      | T004             |
| FR-002      | T005             |
| FR-003      | T006             |
| FR-004      | T008             |
| FR-005      | T011             |
| FR-006      | T007, T010, T012 |
| FR-007      | T011, T012       |
| FR-008      | T009             |
