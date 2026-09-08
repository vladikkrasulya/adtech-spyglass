# Tasks: Complete the Audio Repair

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/audio-behavior.md and quickstart.md.
**Tests**: Required by the user audit request, FR-009 and Constitution VII.
**Organization**: Bounded story phases; adopted implementation is reviewed against these tasks, not presented as newly authored or already verified.

## Phase 1: Setup

- [x] T001 Read constitution, specs/ROADMAP.md, baseline contracts and 020/021 context; preserve adopted patch provenance and isolated scope in specs/023-audio-repair/spec.md (FR-010).
- [x] T002 Register .specify/feature.json only in the isolated worktree; create specs/023-audio-repair/spec.md, plan.md, research.md, data-model.md, contracts/audio-behavior.md and quality checklists using pinned lifecycle templates (FR-007, FR-010).

## Phase 2: Foundational readiness

- [x] T003 Run read-only cross-artifact analysis of specs/023-audio-repair/spec.md, plan.md and tasks.md; resolve any critical/high coverage or constitution conflicts before new source/test edits (FR-001–FR-010).

## Phase 3: User Story 1 — actual audio evidence and bounded parsing

**Goal**: Correct independent media/protocol evidence and reliable termination.
**Independent test**: Public detector review controls and isolated worker/process malformed-input probes.

- [x] T004 [US1] Add the independent XML/media/ctype regression controls and bounded malformed-input probes with valid controls in tests/audio-repair.test.js; retain existing tests/format-detect.test.js and tests/vast.test.js (FR-001–FR-004, FR-009).
- [x] T005 [US1] Repair input progress and helper JSDoc in packages/core/format-detect.js; retain reviewed actual-attribute, DOCTYPE and scalar-ctype behavior, with no new parser dependency (FR-002–FR-004).
- [x] T006 [US1] Verify adopted MIME and metadata mapping changes in packages/core/rules-vast.js and packages/core/format-detect.js through the focused tests and public HTTP boundary in tests/audio-repair.test.js (FR-001–FR-004, FR-009).

## Phase 4: User Story 2 — useful validation and inert preview

**Goal**: Required audio MIME errors and honest DAAST document inspection.
**Independent test**: Core/HTTP/CLI invalid-versus-valid MIME controls, three locales and browser DAAST cases.

- [x] T007 [US2] Cover required/invalid/valid MIME shapes, stable finding path/level/reference and en/uk/ru output through public Core/HTTP/CLI in tests/audio-repair.test.js; verify adopted packages/core/rules-request.js, messages/{en,uk,ru}.json and spec-refs.json (FR-005, FR-007, FR-009).
- [x] T008 [US2] Verify actual DAAST roots and negative namespace cases in packages/core/vast-shape.js, public/core/vast-shape.js and public/modules/inspector/creative-classify.js using tests/creative-preview-classify.test.js and browser corpus (FR-006, FR-009).

## Phase 5: User Story 3 — trustworthy local acceptance

**Goal**: Preserve corpus evidence and complete isolated delivery without touching peers.
**Independent test**: Exact adopted corpus diff, complete affected-layer outcomes and settled local gates.

- [x] T009 [US3] Verify the 17 adopted files under tests/corpus/pairs/{audio,coverage-context}/ and tests/corpus/mutations/media-constraints/audio-mimes-missing.json preserve payloads/expectations, retire only DEF-101/112/102 in tests/corpus/known-gaps.json and retain audio-web-26-multi-imp-reversed browser DEF-201; update specs/020-ad-format-verification-matrix/defects.md feature pointer (FR-008).
- [x] T010 [US3] Run tests/corpus-core.test.js and tests/corpus-http.test.js plus the 17-case tests/corpus-browser.test.js selection; record exact outcomes and unexpected-failure guards in specs/023-audio-repair/verification.md (FR-008, FR-009).

## Phase 6: Contracts and settled gates

- [x] T011 [P] Synchronize Core0.42.0/CLI dependency^0.42.0 in packages/core/package.json, packages/cli/package.json and package-lock.json with specs/000-platform-baseline/contracts/core-validator.md and locales-versioning.md; add specs/README.md and specs/ROADMAP.md routes (FR-007, FR-010).
- [x] T012 Run the complete npm run ci in an isolated PID namespace, package smoke and required changed-surface gates; record exact commands, runner results and limitations in specs/023-audio-repair/verification.md (FR-009, FR-010).
- [x] T013 Run convergence against specs/023-audio-repair/spec.md, plan.md and tasks.md after verification; implement/verify any scoped residuals, then record the final local commit/patch and peer preservation in the external delivery receipt referenced by verification.md (FR-001–FR-010).

## Dependencies and Parallel Execution

T001→T002→T003 precede all new source/test edits. T004 precedes T005; T005 precedes T006. T007/T008 may use adopted code after T003 but serialize edits to tests/audio-repair.test.js with T004. T009 precedes T010. T011 documentation can run alongside T004–T010 on separately owned files; package mutations remain with the implementation owner. T006–T011 precede T012; T012 precedes T013.

Examples: while the implementation owner repairs US1 detector code, the records owner can finish T011 contracts. US2 browser inspection and US3 fixture-diff review can run independently if test process isolation is maintained. No simultaneous mutation of shared files or broad process cleanup is permitted.

## Implementation Strategy

First make US1's malformed-input analysis safe while preserving adopted behavior. Then prove US2 public findings and DAAST preview. Finish US3's honest corpus accounting, local gates and convergence. Delivery is a verified isolated local commit/patch; main integration, hosted CI and deployment are separate future states while peer work is active.

## Requirement Traceability

| Requirement | Tasks                                    |
| ----------- | ---------------------------------------- |
| FR-001      | T004, T006                               |
| FR-002      | T004, T005, T006                         |
| FR-003      | T004, T005, T006                         |
| FR-004      | T004, T005, T006                         |
| FR-005      | T007                                     |
| FR-006      | T008, T014                               |
| FR-007      | T002, T007, T011                         |
| FR-008      | T009, T010                               |
| FR-009      | T004, T006, T007, T008, T010, T012, T014 |
| FR-010      | T001, T002, T011, T012, T013             |

SC-001→T004–T006; SC-002→T009/T010; SC-003→T007/T011; SC-004→T012; SC-005→T001/T012/T013. All 14 tasks are complete; verification.md and the external delivery receipt record the final gates and local delivery state.

## Phase 7: Convergence

- [x] T014 [US2] Correct the three-language XML preview caption in public/modules/inspector/dialect-label.i18n.js so audio/DAAST documents identify the VAST / DAAST ad-XML family without a video-only description; retain the inert rendering kind and no-playback limitation, verify locale and browser behavior and repeat required final gates per FR-006, US2/AC3 and Constitution VI (partial).
