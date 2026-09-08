# Tasks: Ad format verification matrix

## Phase 1: Setup

- [x] T001 Recover Opus work and source archive; author specs/020-ad-format-verification-matrix/spec.md and plan.md.

## Phase 2: Foundation

- [x] T002 Define oracle, ownership and report contract in specs/020-ad-format-verification-matrix/contracts/corpus-oracle.md; analyze requirement coverage before implementation.

## Phase 3: US1 — Pair semantics (P1)

Independent test: validate minimum counts, oracle self-tests, Core and real HTTP with exact gap guards.

- [x] T003 [P] [US1] Harden tests/corpus/lib/schema.js, oracle.js, core-run.js, load.js and patch.js; update tests/corpus-lib.test.js and tests/corpus-core.test.js.
- [x] T004 [P] [US1] Import 38 attributed cases and verified local assets into tests/corpus/pairs/ and tests/corpus/assets/ with tests/corpus/lib/import-reference.js.
- [x] T005 [US1] Add negative/relation/context mutations in tests/corpus/mutations/ and evidence-based tests/corpus/known-gaps.json.
- [x] T006 [P] [US1] Harden real HTTP execution/normalization in tests/corpus/lib/http-run.js and tests/corpus-http.test.js.

## Phase 4: US2 — Creative and UX (P1)

Independent test: browser case outcomes prove actual analysis/creative identity and 12 UX combinations without external network or retries.

- [x] T007 [P] [US2] Harden tests/corpus/lib/browser.js and tests/corpus-browser.test.js for actual UI action, completion, all-bid observations, asset visibility and honest playback.
- [x] T008 [US2] Add tests/corpus-ux-browser.test.js for locale/theme/viewport, keyboard, loading/error/reset/reanalysis/source navigation and screenshot evidence.

## Phase 5: US3 — Actionable audit (P2)

Independent test: fresh standalone audit produces complete outcome matrix and honest report, failing missing execution or unexpected deviations.

- [x] T009 [P] [US3] Harden tests/corpus/lib/report.js and add scripts/corpus-matrix.js, scripts/run-corpus.js and package.json test:corpus command.
- [x] T010 [US3] Generate specs/020-ad-format-verification-matrix/coverage-matrix.md and verification.md from actual run evidence.
- [x] T011 [US3] Document verified product issues in specs/020-ad-format-verification-matrix/defects.md and separately prioritized cleanup-backlog.md.

## Phase 6: Integration

- [x] T012 Run focused audit, repository CI and review; record outcomes in specs/020-ad-format-verification-matrix/verification.md.
- [x] T013 Converge spec/implementation/tasks and update specs/README.md and specs/ROADMAP.md accurately.

## Phase 7: Continuation after the session limit (orchestrating session)

- [x] T014 [US3] Independently re-run the dedicated audit (`npm run test:corpus`) and review screenshots before accepting the first-pass results; record the re-run in specs/020-ad-format-verification-matrix/verification.md.
- [x] T015 [US1] Repository hygiene for the imported corpus: GIF tracking pixels renamed from `.bin`, unfetchable media bodies moved to the private archive with `stored: false` manifest entries, `package.json` description restored, ledger shards under tests/corpus/known-gaps/.
- [x] T016 [US3] Add scripts/corpus-axes.js and tests/corpus-axes.test.js: pairwise coverage axes with covered / unverified / unsupported / not-applicable marks, written as coverage-axes.md by the dedicated audit (FR-008).
- [x] T017 [US1] Extend the corpus toward ten pairs per format and fill thin mutation categories (identity, multiplicity, format-mismatch, field-shape, encoding-limits, input-shape) with spec-grounded expectations and pinned gap signatures (FR-001, FR-004, FR-005).
- [x] T018 [US2] Add tests/corpus-ux-a11y-browser.test.js, verified against tests/corpus/lib/a11y-contract.js: accessible names, keyboard order, contrast, zoom, overflow and long values, state catalogue, large-JSON readability, with screenshots (FR-007).
- [x] T019 [US3] Merge the adversarially verified technical-debt scan into cleanup-backlog.md (four sections) and the extension gaps into defects.md; regenerate coverage-matrix.md and coverage-axes.md from the final run (FR-008).
- [x] T020 Run the integrated dedicated audit and `npm run ci` on the settled tree, regenerate coverage-matrix.md and coverage-axes.md from that run, record outcomes, then commit and push under the standing authorization; set spec status Complete and update README and ROADMAP (FR-009). Owned by the reviewing session after hand-off.

## Dependencies and parallel execution

T001 → T002 → parallel T003/T004/T006/T007/T009. T005 follows schema/import agreement; T008 follows browser driver; T010/T011 follow integrated results; T012/T013 close all stories. Core and corpus authors coordinate schema fields; only corpus author edits known-gaps.json. Browser execution is serial. Root owns report/HTTP/governance and integration.

MVP is US1 validated without browser dependency, followed by US2 and US3. All three are required for completion; product defect fixes remain follow-up work.

## Requirement traceability

| Requirement | Tasks                        |
| ----------- | ---------------------------- |
| FR-001      | T004, T017                   |
| FR-002      | T004, T007                   |
| FR-003      | T003, T006, T007, T009       |
| FR-004      | T003, T005, T006             |
| FR-005      | T003, T005, T006, T007, T009 |
| FR-006      | T007, T021                   |
| FR-007      | T008, T018, T021             |
| FR-008      | T009, T010, T011, T016, T019 |
| FR-009      | T012, T013, T020, T021       |

## Phase 8: Pointer actionability follow-up

- [x] T021 [US2] Stabilize real pointer coordinates in tests/corpus/lib/browser.js after the mobile reveal race exposed by the pre-push gate; retain actual mouse activation and all reveal assertions, verify the UX suite without screenshot timing, then run repository CI and complete delivery (FR-006, FR-007, FR-009).

## Phase 9: Close enumerated coverage gaps

- [x] T022 [US3] Review all remaining pairwise cells and protocol/context triples against source and product contracts; record applicability decisions and add a non-vacuous coverage regression guard (FR-010).
- [x] T023 [P] [US1] Add attributed protocol/context/dialect fixtures and standalone request/response scenarios, with substantive assertions and exact ledger evidence for deviations (FR-002–FR-005, FR-010).
- [x] T024 [P] [US2] Add missing creative kinds, empty/unrecognized/partial rendering and blocked-media scenarios; verify actual browser identity and state (FR-006, FR-010).
- [x] T025 [US3] Run focused layers, full audit and required local CI; regenerate reports and portable corpus, review applicability/conformance/coverage, and prepare the verified scope and evidence for delivery (FR-008–FR-010).
- [x] T026 [US1] Independently validate source properties in positive fixtures (AdCOM field types/Native nesting/context and VAST Inline identifiers), correct inherited fixture errors with provenance, and add tests/corpus-fixture-contract.test.js to the dedicated audit (FR-002, FR-005, FR-010).

Dependency: T022 applicability review precedes T023/T024 decisions; fixture authors may inspect source examples in parallel. T025 requires T026, all new cases measured and the coverage guard passing. FR-010 maps to T022–T026.

## Delivery of the completed implementation

The operator must commit the verified scope, perform the standing-authorized non-force push, and wait for hosted checks before reporting delivery complete. The pre-push hook remains mandatory. These operational outcomes are recorded in `/home/vk/.local/share/ortbtools-research/2026-09-08-coverage-closure/delivery.json`, separately from the completed implementation tasks, so the committed report does not invent its own future commit SHA or hosted result.
