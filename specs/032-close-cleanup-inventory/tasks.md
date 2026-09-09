# Tasks: Close the cleanup inventory

**Feature**: [spec](spec.md) · [plan](plan.md). Every changed behavior requires a meaningful regression before closure.

## Phase 1 — Setup

- [x] T001 Verify clean baseline and create isolated worktree; record source in research.md (FR-001).
- [x] T002 Read current governance/contracts and investigate every named owner; write spec.md and research.md (FR-001–015).
- [x] T003 Record compatibility decisions in ../decisions/ADR-018-maintenance-boundaries-and-degradation.md and contracts/maintenance-compatibility.md (FR-015).
- [x] T004 Run pre-implementation cross-artifact analysis and record its outcome in verification.md (FR-001–016).

## Phase 2 — Shared foundations

- [x] T005 [US1] Add frozen-input/original-path/identity regression cases in tests/auction-view.test.js (FR-002).
- [x] T006 [US1] Implement packages/core/auction-view.js and generated public/core/auction-view.js via scripts/gen-browser-core.js, preserving auction-shape compatibility (CL-02; FR-002).
- [x] T007 [US1] Adopt distinct view adapters in packages/core/index.js and crosscheck.js, keeping response pairReq currency-only (CL-02; FR-002).
- [x] T008 [US2] Generate one built-in dialect registry and consume it in public/ortbtools.app.js and public/modules/dialects/index.js with temp-dialect/parity coverage (dup-core-ui-003; FR-010).

## Phase 3 — Applicable validation (US1)

- [x] T009 [US1] Assert normative AdCOM plugin paths and implement explicit mappings/repathing in packages/core/index.js and auction-view.js (scattered-format-01; FR-002).
- [x] T010 [US1] Unify redirect alias dispatch and validation with exact supplied-key tests in packages/core/detect.js and rules-feed.js (scattered-format-02; FR-003).
- [x] T011 [US1] Unify value+nUrl dispatch and retain missing-click diagnostics in packages/core/detect.js and rules-feed.js with tests (scattered-format-05; FR-003).
- [x] T012 [US1] Recognize/validate per-material in-page shapes, homogeneous/mixed arrays and supplied fields in packages/core/rules-feed.js with locale/spec-reference tests (scattered-format-08; FR-003/015).
- [x] T013 [US1] Share pop keys/value predicate in packages/core/non-iab-formats.js and dialects/shape-fingerprint.js with signal/score tests (scattered-format-06; FR-004).
- [x] T014 [US1] Share price state classification while pinning legacy IDs/paths/predicates in packages/core/rules-response.js and rules/price-floor/index.js (scattered-format-03; FR-005).
- [x] T015 [US1] Add request/deal negative-floor warnings and unusable economic state across versioned request rules, price-floor and crosscheck, with zero/currency/deal controls (negative-floor-unflagged; FR-005/015).

## Phase 4 — Current action UI (US2)

- [x] T016 [US2] Add delayed first-flight/replace/clear/Intel/remount regression tests for public/modules/inspector/analysis-run.js (FR-007).
- [x] T017 [US2] Implement mount-owned controller and integrate all async commit/reset/history/button paths in public/ortbtools.app.js (CL-04; FR-007).
- [x] T018 [US2] Use shared auction descriptors for strip/slots/matched selected dimensions in public/ortbtools.app.js, preserving vendor and original-bid identity tests (CL-02; FR-002/007).
- [x] T019 [US2] Give onboarding an explicit banner slot in all inspector templates/CSS and test verification-banner coexistence/dismissal/remount (dom-css-fragile-001; FR-008).
- [x] T020 [US2] Add persistent live-region semantics in public/index.*.html and public/core/utils.js with locale/toast browser coverage (fallbacks-silent-03; FR-008).
- [x] T021 [US2] Require valid partner success payloads in public/modules/partners/index.js and test malformed create/delete/count responses (fallbacks-silent-06; FR-008).
- [x] T022 [US2] Stamp temporary finding origin in public/modules/intel/index.js; use structural side in public/ortbtools.app.js and test prefix-independent badges/details (dup-core-ui-005/CL-05; FR-011).
- [x] T023 [US2] Remove only cited dead CSS img selectors, validation.errors fallback and four unused web locale keys; run existing UI/i18n guards (dead-stale-02/03/05; FR-013).
- [x] T024 [US2] Display unfiltered incompleteness from analysis responses even with filtered warning findings in public/ortbtools.app.js and locale dictionaries (FR-006/015).

## Phase 5 — Observable failures and sides (US3)

- [x] T025 [US3] Fault-inject all baseline families and plugin applies/validate in isolated tests; implement safe warning/completeness propagation in packages/core/index.js and rules/index.js (fallbacks-silent-02; FR-006/015).
- [x] T026 [US3] Add located per-side results and shared legacy prefix decoration in modules/analyze/handler.js; test single/pair/scalar/raw/currency/incomplete compatibility (CL-05/dup-core-ui-005; FR-011).
- [x] T027 [P] [US3] Surface individual logout persistence failure after Map/cookie cleanup in auth.js and modules/auth/handler.js with synthetic fault tests (fallbacks-silent-04; FR-009).
- [x] T028 [P] [US3] Log and avoid caching failed catalog loads in modules/findings/handler.js with injected repair/recovery tests (fallbacks-silent-05; FR-009).

## Phase 6 — Trustworthy maintenance (US4)

- [x] T029 [US4] Add owned-process lifecycle tests covering concurrent runs, unrelated matching profiles, interruptions, repeated failures and retry retention under tests/ (CL-06; FR-012).
- [x] T030 [US4] Implement owned runner/attempt cleanup and accurate attempt diagnostics in scripts/run-tests.js and its lifecycle helper; route package.json test:browser through it (CL-06; FR-012).
- [x] T031 [US4] Fix 18 verified lint violations across owned Core/UI/backend/test files; enable both rules in eslint.config.js (dead-stale-04; FR-013).
- [x] T032 [US4] Correct only stale severity/AdPod comments in packages/core/severity-registry.js and rules/index.js with existing guards (dead-stale-06/07; FR-013).
- [x] T033 [US4] Retain/document package-root VAST timeline exports and add consumer-boundary assertions in tests/vast-timeline.test.js (dead-stale-01; FR-013).
- [x] T034 [US4] Document new/legacy ID naming and guard the fixed legacy allowlist/suppression contract in tests/finding-id-policy.test.js (CL-07; FR-013/015).
- [x] T035 [US4] Record CL-08 boundary-specific capability decision and exact existing assertions in inventory.md (FR-014).
- [x] T036 [US4] Add assertion-level capability coverage and reference guard for CL-09 in feature inventory/tests (FR-014).

## Phase 7 — Convergence and release

- [x] T037 Reconcile each original ID and extra/disposition in inventory.md and ../020-ad-format-verification-matrix/cleanup-backlog.md with evidence (FR-001).
- [x] T038 Update current baseline/API/privacy-as-needed, ADR index, ROADMAP, CHANGELOG and independent version surfaces for final contracts (FR-015/016).
- [ ] T039 Run focused integration, all normative corpus, settled Linux CI, package/browser/Docker gates and independent convergence; record verification.md (FR-015/016).
- [ ] T040 Commit authored scope, nonforce push main, wait exact hosted gates, verify fresh canonical backup, deploy and read back release/health/smoke (FR-016).

## Dependencies and execution

T001–T004 precede implementation. T005–T007 define the view consumed by T009/T018. Core can implement US1/faults while UI implements its controller/onboarding and infrastructure implements owned runner; shared generated exports and catalog filenames are handed off explicitly. T026/T022/T024 converge on the documented sides/completeness contract. Lint fixes stay with file owners; enablement is verified only after all lanes finish. T037–T040 require all per-item acceptance evidence. Root owns final task state and never counts a passing focused test as full release completion.

## Phase 8: Convergence

- [x] T041 [HIGH] Surface malformed JSON, invalid envelopes and invalid sample counts from the partner count request in public/modules/partners/index.js as a localized visible error; retain a generic confirmation only with explicit unavailable-count feedback and no implied verified count. Add synthetic failure and valid-mutation controls in tests/maintenance-ui.test.js per FR-008, US2/AC3 and T021 (partial).
- [x] T042 [HIGH] Handle expected analysis fetch rejection at its transport boundary in public/ortbtools.app.js with localized failure feedback, cleared result state and current-run/cancellation guards; preserve diagnostics for unrelated processing errors. Add focused stale-run and network-failure assertions and restore the existing 12 UX corpus outcomes without broad console exemptions or oracle changes per FR-007/015, SC-003, plan Phase 8 and T017 (partial).

## Phase 9: Convergence

- [x] T043 [LOW] Correct the Ukrainian and Russian `toast.logout_failed` strings in public/i18n.js to informal singular address (`спробуй` / `попробуй`), retaining their safe failure meaning and EN/UK/RU parity; verify the existing locale guard per FR-015 and Constitution VI (partial).

## Phase 10: Convergence

- [x] T044 [LOW] Align only the three `onboarding.banner.text` strings in public/i18n.js with the actual localized Load sample / Завантажити зразок / Загрузить пример menu and the action of choosing a synthetic example; remove the stale example-control reference and immediate paired-load implication. Verify existing locale guards and the targeted onboarding review per FR-008/015, US2/AC1, plan Phase 4 and Constitution VI (partial).
