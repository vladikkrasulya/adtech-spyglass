# Tasks: Vendor request dialects and Core recognition

**Input**: Design documents from `specs/028-vendor-request-dialects/`.

**Prerequisites**: Spec, plan, research, data model, contract and requirements-quality checklist; read-only cross-artifact analysis before runtime.

**Tests**: Public-boundary regressions are explicitly required. Add relevant negative/positive probes before changing behavior and record actual red/green outcomes.

## Phase 1: Setup and evidence

- [x] T001 Record verified PR #83 main base and isolated ownership; publish `specs/028-vendor-request-dialects/` and ignored `.specify/feature.json` without editing peer paths.
- [x] T002 Capture all 256 materialized cases using `tests/corpus/lib/load.js`, including the five-group/24-case scope and supplemental five DEF-151 cases; retain exact payload/expectation/signature baseline in machine-local evidence.
- [ ] T003 Record the explicit decision for only the two Kadam inpage format assertions in `specs/028-vendor-request-dialects/research.md`; retain their exact signatures unless approval arrives. This task does not block unrelated implementation.
- [x] T004 Complete requirements review and read-only spec/plan/tasks analysis for `specs/028-vendor-request-dialects/`, with zero critical conflicts or uncovered requirements before runtime.

## Phase 2: User Story 1 - Documented proprietary carriers (Priority: P1)

**Goal**: Inspect documented requests and responses without invented IAB constraints.

**Independent Test**: Scoped Core/HTTP replay and unrelated/malformed controls, independent of public preview completion.

- [x] T005 [P] [US1] Add red/green EXADS public-boundary probes in `tests/vendor-exads-validation.test.js` for six original carriers, omissions, supplied invalid values, icon-only push, banner size, price/btype and IAB/generic collision controls.
- [x] T006 [P] [US1] Add decoder public-boundary probes in `tests/vendor-url-decoders.test.js` for PPCmate/Kadam/EXADS signatures, arbitrary hosts, optional keys, address families, subtype ambiguity, raw queries, repairs and invalid supplied parameters.
- [x] T007 [US1] Implement shared EXADS recognition, validation and source-backed role helpers in `packages/core/vendor-exads.js`, preserving original paths and strict values.
- [x] T008 [US1] Implement thin PPCmate, Kadam and EXADS modules under `packages/core/decoders/request/url-ppcmate-feed/`, `url-kadam-feed/`, `url-exads-feed/`; integrate their registry and URL findings in `packages/core/decoders/request/index.js` and `packages/core/rules-request-url.js` using existing lossless helpers.
- [x] T009 [US1] Integrate EXADS routing and Kadam Native material roles through `packages/core/detect.js`, `packages/core/index.js` and `packages/core/rules-feed.js`; preserve malformed IAB structural precedence and original carrier paths.
- [x] T010 [US1] Reconcile proprietary pair exclusion in `packages/core/crosscheck.js` and, only if necessary, `modules/analyze/handler.js`, with public Core/HTTP collision controls and shared owning classification.

## Phase 3: User Story 2 - Inpage and Native format meaning (Priority: P1)

**Goal**: Preserve observed format intent without suppressing required IAB findings or changing public selection.

**Independent Test**: Six DEF-180 plus five supplemental DEF-151 Core/HTTP cases and genuine banner/markup/malformed Native controls.

- [x] T011 [P] [US2] Add format public-boundary regressions in `tests/vendor-format-recognition.test.js`, including explicit Kadam Native, hidden-placement negatives, widget/card aliases, AdCOM nested Native and actual banner alternatives.
- [x] T012 [US2] Export/reuse the owning card role resolver in `packages/core/dialects/inpage-push.js` and add bounded widget/card recognition in `packages/core/format-detect.js`, preserving baseline IAB errors and actual media tags.
- [x] T013 [US2] Add supplemental DEF-151 request/response Native recognition in `packages/core/format-detect.js`; retain 026 semantic/crosscheck behavior and leave all `public/` projection work with Opus.
- [x] T014 [US2] Extend canonical GET format consumption in `packages/core/format-detect.js` for explicit Native/inpage evidence, without inferring subtype from serialization or opaque values.

## Phase 4: User Story 3 - Explicit provisional inspection (Priority: P2)

**Goal**: Make Adon3 references inspectable with a visible limitation, without certifying a vendor standard.

**Independent Test**: Three unchanged documented-reference cases plus malformed/unknown controls and exact price preservation.

- [x] T015 [P] [US3] Add provisional public-boundary regressions in `tests/vendor-adon3-inspection.test.js` and `tests/vendor-url-decoders.test.js` for warning presence, lowercase query semantics, carrier guards, subtype ambiguity and decimal-string preservation.
- [x] T016 [US3] Implement bounded provisional response ownership in `packages/core/vendor-adon3.js` and thin request decoding in `packages/core/decoders/request/url-adon3-feed/index.js`, including canonical provisional status and independent invalid-field diagnostics.
- [x] T017 [US3] Integrate provisional response/type/format dispatch in `packages/core/detect.js`, `packages/core/index.js`, `packages/core/rules-feed.js`, `packages/core/format-detect.js` and existing URL validation, with no certification or commercial crosscheck success.

## Phase 5: User Story 4 - Evidence, compatibility and delivery (Priority: P1)

**Goal**: Deliver proven Core/backend improvements while preserving unresolved browser records.

**Independent Test**: Complete corpus comparison, exact layer reductions, required local/hosted gates and browser evidence for any whole-case retirement.

- [x] T018 [US4] Add exact public finding inventory, inline severities, en/uk/ru messages and source references in `packages/core/messages/en.json`, `uk.json`, `ru.json`, `packages/core/spec-refs.json` and this feature's contract; bind any audit `expected.*` symbols consistently in both must and mustNot assertions if present.
- [x] T019 [US4] Replay all 29 scoped cases and malformed/economic controls through public Core and real HTTP using `tests/corpus/lib/core-run.js` and `http-run.js`; demonstrate preserved 022 prices/floors/currency, 023 XML bounds and 026 Native/media semantics.
- [x] T020 [US4] Compare all 256 cases via the real `tests/corpus/lib/load.js` and unchanged evaluator; narrow only proven Core/HTTP matches in affected `tests/corpus/pairs/` and `tests/corpus/mutations/` metadata. Apply only the two specifically approved Kadam format assertions, if authorized; preserve all other expectations and unrelated signatures.
- [x] T021 [US4] Run the applicable `tests/corpus-browser.test.js` layer with isolated Chrome before push; retain every unresolved browser signature; remove only measured repaired Core-derived browser lines and retire a complete case only when all browser assertions pass. Record peer-owned EXADS/PPCmate/Kadam/inpage/AdCOM residuals in `specs/028-vendor-request-dialects/verification.md` without changing public files or DEF-180 preview assertions.
- [x] T022 [US4] Update as-built vendor semantics in `specs/000-platform-baseline/contracts/core-validator.md`, `http-api.md` where changed, and `locales-versioning.md`; update `specs/ROADMAP.md` and feature evidence with actual layer status.
- [x] T023 [US4] Set Core 0.46.0 in `packages/core/package.json`, preserve CLI 0.1.3 while updating its Core dependency to `^0.46.0` in `packages/cli/package.json`, and align `package-lock.json`; read back independent app/Core/CLI versions after integration.
- [x] T024 [US4] Run scoped formatting/type/lint, finding/ref/locale, version/package and SpecKit governance checks, then `npm run ci`; record exact commands, outcomes and any genuine environment limits in `specs/028-vendor-request-dialects/verification.md`.
- [ ] T025 [US4] Run convergence against `specs/028-vendor-request-dialects/{spec,plan,tasks}.md`, finish any remaining required work, then review and stage only authored paths; commit and non-force push the settled branch once per delivery wave.
- [ ] T026 [US4] Wait for hosted CI on the pushed revision, record exact status in the pull request receipt linked from `specs/028-vendor-request-dialects/verification.md`, and hand remaining browser signatures to their owner without claiming full group closure, publication or deployment.

## Dependencies and execution order

T001, T002 and T004 precede runtime. T003 is independently conditional and gates only its two expectation edits. Tests precede each corresponding implementation. EXADS owner and decoder modules may be developed in parallel in separate files; the decoder owner alone edits `decoders/request/**` and `rules-request-url.js`, while the integration owner serializes all detector/index/feed/format/catalog/backend changes. T008's EXADS integration uses T007 exports. T012–T014 share `format-detect.js` and are sequential. T016's two owners coordinate the provisional contract before T017. T018 precedes full scoped gates; T019 precedes metadata reduction T020; T021 precedes push and any whole-record removal. T022–T024 follow settled integration; T025 and T026 complete repository delivery. Peer preview work is not a hidden prerequisite for Core delivery with truthful residual records.

## Parallel example and incremental strategy

After setup/analysis, one worker handles `vendor-exads.js` plus its test and another handles the URL decoder tree plus its test. The integration owner prepares format/Adon3/HTTP changes sequentially in shared files. Start with documented carriers as the smallest useful slice, then format/provisional inspection. A separate delivery wave is allowed only with its own settled browser/local/hosted gates; avoid repeated pushes for unfinished integration.

## Requirement coverage

| Requirement | Tasks                              |
| ----------- | ---------------------------------- |
| FR-001      | T001, T004, T012, T021, T025       |
| FR-002      | T005, T007, T008, T019             |
| FR-003      | T005, T007, T009, T019             |
| FR-004      | T009, T010, T019                   |
| FR-005      | T006, T008, T019                   |
| FR-006      | T006, T008, T009, T011, T014       |
| FR-007      | T006, T008, T015, T016             |
| FR-008      | T015, T016, T017, T018             |
| FR-009      | T005, T006, T007, T015, T016, T019 |
| FR-010      | T006, T008, T011, T012, T014, T015 |
| FR-011      | T011, T012, T021                   |
| FR-012      | T011, T013, T019                   |
| FR-013      | T018, T019, T024                   |
| FR-014      | T005, T007, T015, T019             |
| FR-015      | T004, T010, T019, T021, T024       |
| FR-016      | T002, T003, T018, T020             |
| FR-017      | T020, T021, T022, T026             |
| FR-018      | T022, T023, T024, T025, T026       |
| SC-001      | T003, T019, T020                   |
| SC-002      | T002, T020                         |
| SC-003      | T015, T018, T020, T021, T026       |
| SC-004      | T021, T023, T024, T025, T026       |
