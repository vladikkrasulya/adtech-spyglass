# Tasks: Validation Semantics and Media Crosscheck

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), research, data model and contract.

**Organization**: Ordered wave delivery with independently isolated implementation where ownership permits. Tests are explicitly required by the accepted task. A checked task records completed evidence, not intention. Delivery checkboxes describe the source tree before its own final commit; post-commit T024 status is recorded by PR #83 checks and the external immutable delivery receipt. T017/T023/T025 remain open until the peer-owned DEF-151 observations pass.

## Phase 1: Setup

- [x] T001 Record starting main `340ffd3`, assigned file ownership, clean isolated branch and archived obsolete worktree dispositions in external `2026-09-08-026-validation-crosscheck/` evidence; preserve peer work.
- [x] T002 Author and quality-review `specs/026-validation-crosscheck/spec.md`, `plan.md`, design artifacts and `checklists/`; set only the isolated `.specify/feature.json` pointer.

## Phase 2: Foundation

- [x] T003 Inventory all fourteen groups and twenty-five linked cases using the real `tests/corpus/lib/load.js` loader; retain the baseline 256-case payload/expectation/signature snapshot in external evidence, including unbound `expected.*` symbols and independent residual deviations.
- [x] T004 Complete read-only preimplementation analysis of `specs/026-validation-crosscheck/{spec,plan,tasks}.md`; record requirement coverage and no critical gaps before runtime edits.

## Phase 3: User Story 1 — Wave A (P1)

**Goal**: Correct selected-media, media constraints, seat restrictions and NonLinear validation.

**Independent Test**: Eleven scoped corpus cases satisfy their wave A semantic expectations, with compatible and malformed-evidence controls tested at public boundaries.

- [x] T005 [US1] Add failing selected-media, VAST MIME/duration/protocol, seat allow/block and NonLinear positive/negative public-boundary regressions in `tests/validation-semantics-crosscheck.test.js`, including preserved 022 price/floor and 023 XML evidence controls.
- [x] T006 [US1] Repair DEF-113/194/111/192 in `packages/core/crosscheck.js`, reusing existing owning helpers and applying only selected-family constraints without altering economic resolution.
- [x] T007 [US1] Repair DEF-130 in `packages/core/rules-vast.js`, keeping actual Linear media requirements and rejecting token-only evidence.
- [x] T008 [US1] Add all wave A finding messages in `packages/core/messages/{en,uk,ru}.json` and reference entries in `packages/core/spec-refs.json`; keep emitted severities statically discoverable.
- [x] T009 [US1] Bind only affected unbound fixture `expected.*` ID symbols to implemented public IDs, preserving payloads/levels/paths/parameters; retire proven wave A signatures in `tests/corpus/known-gaps.json`, `tests/corpus/known-gaps/` and affected case metadata; preserve independent residual deviations and record resolutions in `specs/020-ad-format-verification-matrix/defects.md`.
- [x] T010 [US1] Update wave A contract/version records in `specs/000-platform-baseline/contracts/{core-validator,locales-versioning}.md`, `packages/core/package.json`, `packages/cli/package.json`, `package-lock.json`, `specs/README.md` and `specs/ROADMAP.md`; reserve Core 0.45.0 and record the partial fourteen-group scope honestly.
- [x] T011 [US1] Run settled focused/corpus/full gates with private Chrome process isolation; stage the explicit wave A allowlist, commit, push once and record the hosted SHA/result in external evidence and `specs/026-validation-crosscheck/verification.md`.

## Phase 4: User Story 2 — Wave B (P2)

**Goal**: Correct Native/completeness, markup declarations, seat duplication, value domains and bounded pop semantics.

**Independent Test**: Fourteen wave B cases satisfy their scoped semantic expectations. DEF-151 is retired only after observable recognition/preview dependencies also satisfy its existing expectations.

- [x] T012 [US2] Add failing public-boundary cases for supplied/omitted `mtype`, structured 2.x/3.0 Native, duplicate seats, blank markup, `nbr`, COPPA and pop forms in `tests/validation-semantics-crosscheck.test.js` or a separately owned wave B test file.
- [x] T013 [US2] Repair DEF-195/190/198/301 response checks in `packages/core/rules-response.js` and `packages/core/rules-response-30.js`, preserving omitted-versus-invalid distinctions and existing IDs.
- [x] T014 [US2] Repair DEF-151/150 Native presence and asset semantics in `packages/core/rules-response-30.js`, `packages/core/rules-response.js`, `packages/core/crosscheck.js` and `packages/core/helpers.js` as needed, reusing one owning semantic helper instead of parallel copies.
- [x] T015 [US2] Repair DEF-197/109 in `packages/core/rules-request.js` and DEF-170 in `packages/core/rules/pop-response/index.js`, keeping the ordinary IAB baseline and supplied invalid-content diagnostics.
- [x] T016 [US2] Add wave B finding text/reference parity in `packages/core/messages/{en,uk,ru}.json` and `packages/core/spec-refs.json`; extend Core, HTTP and CLI public-boundary regression evidence in the owned `tests/` files.
- [ ] T017 [US2] Coordinate the separate DEF-151 recognition/preview owners and prove all existing five-case expectations at applicable layers before retiring that record; record evidence and any unresolved ownership dependency in `specs/026-validation-crosscheck/verification.md` without editing peer runtime files unilaterally.
- [x] T018 [US2] Apply the bounded wave B patch after the wave A commit/push if implemented in the independent scratch worktree; rerun affected public-boundary tests and inventory the exact integrated changes in external `2026-09-08-026-validation-crosscheck/` evidence.
- [x] T019 [US2] Retire only verified wave B signatures/metadata in `tests/corpus/known-gaps.json`, `tests/corpus/known-gaps/` and affected fixtures, binding unbound IDs only as in T009; retain independent deviations and append chronological resolutions in `specs/020-ad-format-verification-matrix/defects.md`.

## Phase 5: Delivery and Convergence

- [x] T020 Compare the complete real `loadCorpus()` output with the retained baseline; prove unchanged payloads, normative semantic requirements and unrelated signatures, with only explicit selected ID bindings and proven retirements in `tests/corpus/`.
- [x] T021 Reconcile Core 0.45.0, CLI Core range and lock by actual readback; complete `specs/000-platform-baseline/contracts/{core-validator,locales-versioning}.md`, `specs/README.md`, `specs/ROADMAP.md` and `specs/026-validation-crosscheck/verification.md` for the settled scope.
- [x] T022 Run settled `npm run ci` with private Chrome isolation plus package and Docker smoke gates; record exact outcomes and any retries in `specs/026-validation-crosscheck/verification.md` and external evidence.
- [ ] T023 Run convergence against `specs/026-validation-crosscheck/{spec,plan,tasks}.md`; implement and verify any remaining buildable tasks until the feature is complete, retaining all independent unresolved defects.
- [ ] T024 Stage only the explicit authored wave B allowlist, commit and push the branch once with the mandatory gate intact; wait for hosted CI on that SHA and record delivery receipt in external evidence and `specs/026-validation-crosscheck/verification.md`. Main integration remains with the maintainer.

## Dependencies and Parallel Execution

T001–T004 precede substantive runtime work. T005 precedes T006/T007; T008–T010 join the settled wave A changes before T011. T012 precedes wave B edits. T013–T016 share some files and require one owner or sequential coordination; they are not marked as independently parallel tasks.

Wave B may develop in `2026-09-08-026-validation-crosscheck/wave-b-worktree` after foundation while the root completes wave A, with separately owned tests and no edits leaking into wave A's gate inputs. Its bounded patch joins the delivery checkout only at T018 after wave A is committed/pushed. The root owns crosscheck and integration conflicts; the scratch owner coordinates any shared helper requirement. T017's peer-owned observable dependencies may be assessed in parallel with assigned-file repairs, but cannot be claimed complete without evidence.

For US1, read-only source/case analysis can run beside root implementation after the failing controls exist. For US2, read-only Native corpus/preview dependency assessment can run beside response-validator work. Source writes to a shared path are always sequentially owned.

## Implementation Strategy

Deliver US1 as the valuable first increment, preserving wave B's known deviations. Then integrate and deliver US2 with the full corpus signature audit. Push once per wave, not per defect. Final completion requires all scoped expectations, settled local and hosted gates, and accurate Core version readback; it never implies main integration or deployment.

## Requirement Coverage

| Requirement                                       | Executable tasks                         |
| ------------------------------------------------- | ---------------------------------------- |
| FR-001 — VAST MIME/duration/protocol              | T005, T006, T008, T009, T011             |
| FR-002 — Banner/audio content                     | T005, T006, T008, T009, T011             |
| FR-003 — Selected mixed media                     | T005, T006, T009, T011                   |
| FR-004 — Buyer-seat restrictions                  | T005, T006, T008, T009, T011             |
| FR-005 — NonLinear MediaFile applicability        | T005, T007, T009, T011                   |
| FR-006 — Markup-type declaration                  | T012, T013, T016, T018, T019             |
| FR-007 — AdCOM structured Native                  | T012, T014, T016, T017, T018, T019       |
| FR-008 — 2.x structured Native                    | T012, T014, T016, T018, T019             |
| FR-009 — Repeated SeatBid identity                | T012, T013, T016, T018, T019             |
| FR-010 — Blank markup                             | T012, T013, T016, T018, T019             |
| FR-011 — EXADS popunder applicability             | T012, T015, T016, T018, T019             |
| FR-012 — Pop notice-only completeness             | T012, T015, T016, T018, T019             |
| FR-013 — No-bid reason domain                     | T012, T013, T016, T018, T019             |
| FR-014 — COPPA flag domain                        | T012, T015, T016, T018, T019             |
| FR-015 — Public/economic compatibility            | T005, T006, T012, T013, T018, T020, T022 |
| FR-016 — Exact deviation retirement               | T003, T009, T017, T019, T020             |
| FR-017 — Locales, references and release evidence | T008, T010, T011, T016, T021, T022, T024 |
| SC-001 — Fourteen scoped repairs                  | T009, T017, T019, T020, T023             |
| SC-002 — Unrelated corpus preservation            | T003, T009, T019, T020                   |
| SC-003 — Localized deterministic meaning          | T008, T016, T022                         |
| SC-004 — Two verified branch deliveries           | T011, T021, T022, T023, T024             |

## Phase 6: Convergence

- [ ] T025 Complete the owner-approved AdCOM Native recognition and preview repair in `packages/core/format-detect.js` and the owning Inspector Native input adapter, preserving the active creative-selection implementation; prove all five unchanged DEF-151 cases through Core, HTTP and actual browser image/identity checks before retiring its remaining record, per FR-007, FR-016, SC-001 and T017 (partial, HIGH). The assigned semantic files already satisfy presence and asset checks; the external owner proposal is prepared, and unilateral peer-runtime edits remain outside this round's file allocation.
