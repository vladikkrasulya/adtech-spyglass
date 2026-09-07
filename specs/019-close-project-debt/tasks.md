# Tasks: Close audited project debt

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), research and closure contract.

## Phase 1: Setup

- [x] T001 Load constitution, roadmap, baseline contracts and create specs/019-close-project-debt/spec.md with independent acceptance criteria.
- [x] T002 Collect current GitHub/runtime/browser/dependency evidence in specs/019-close-project-debt/research.md.

## Phase 2: Foundation

- [x] T003 Define design, ownership and verification in specs/019-close-project-debt/plan.md and contracts/closure.md.
- [x] T004 Analyze spec/plan/task coverage and record the pre-implementation result in specs/019-close-project-debt/verification.md (FR-001–FR-012, SC-001–SC-006).
- [x] T005 Create the complete disposition and owner-choice inventory in specs/019-close-project-debt/inventory.md (FR-008, FR-009, FR-012).

## Phase 3: US1 — Coherent resource delivery

Independent test: stale/current resource HTTP contracts and old-client browser simulation.

- [x] T006 [P] [US1] Add failing resource-identity and dependency propagation cases in tests/asset-version-contract.test.js (FR-001, SC-001).
- [x] T007 [US1] Correct exact-byte hashing, relative dependency rewriting, coupled module identities and strict cache validation in server.js and optional lib/static-assets.js (FR-001).
- [x] T008 [US1] Correct loading/abort/fallback and non-destructive update recovery in public/modules/inspector/index.js, public/core/registry.js and public/shell-boot.js (FR-001, FR-010).
- [x] T009 [US1] Verify old-client transition, style failures and retained input in tests/asset-deploy-browser.test.js (FR-001, SC-001).

## Phase 4: US2 — Interface and email closure

Independent test: real-browser form/control/geometry cases and synthetic handler email assertions.

- [x] T010 [P] [US2] Add Q5-Q7 interaction/form/geometry regressions in tests/inspector-ui-closure-browser.test.js (FR-002–FR-004, SC-001).
- [x] T011 [US2] Implement one modal-owned credential form and guarded submit in public/modules/unlock/index.js (FR-002).
- [x] T012 [US2] Implement scoped accessible select enhancement in public/modules/inspector/select-control.js, inspector.css and public/ortbtools.app.js (FR-003).
- [x] T013 [US2] Repair common tab geometry and verify locale/theme/mobile bounds in public/modules/inspector/inspector.css and tests/inspector-ui-closure-browser.test.js (FR-004).
- [x] T014 [P] [US2] Complete registration/resend/recovery locale precedence tests in tests/auth.test.js (FR-005, SC-002).

## Phase 5: US3 — Maintenance and dispositions

Independent test: exact dependency/release/Git/archive/owner evidence readback.

- [x] T015 [P] [US3] Replace brittle Sentry literal guard with reviewed range/lock constraints and adversarial cases in tests/dependency-security.test.js (FR-006).
- [x] T016 [US3] Integrate reviewed PR dependency changes in package.json/package-lock.json; record combined audits and gates in specs/019-close-project-debt/verification.md (FR-006, SC-003).
- [x] T017 [P] [US3] Inventory and preserve stashes, branch commits and linked-worktree changes outside Git; record unique-work dispositions in specs/019-close-project-debt/inventory.md (FR-008, SC-004).
- [x] T018 [US3] Record received choices or the stated conservative maintenance baseline in specs/ROADMAP.md and canonical decision/operations/npm records; do not infer approval for external changes (FR-009, FR-012, SC-006).
- [x] T019 [US3] Reconcile outdated feature/intake records and exact v1.19.2/v1.19.3 delivery evidence in specs/ROADMAP.md and owning feature records (FR-007).
- [x] T020 [US3] Finish GitHub PR and historical Release dispositions with exact revision readback recorded in specs/019-close-project-debt/verification.md (FR-006, FR-007, SC-003).

## Phase 6: Integration and release

- [x] T021 Update affected baseline/privacy/operations contracts, application version surfaces and CHANGELOG.md; remove confirmed in-scope lint warnings (FR-010).
- [x] T022 Run focused integration and complete local CI/package/native-image gates; record commands/outcomes in specs/019-close-project-debt/verification.md (FR-011, SC-005).
- [x] T023 Run convergence against all requirements and dispositions; append any unmet work to specs/019-close-project-debt/tasks.md (FR-012, SC-006).
- [x] T024 Commit reviewed authored scope, non-force push clean main and verify hosted gates; record exact revision in specs/019-close-project-debt/verification.md (FR-011).
- [x] T025 Run fresh canonical backup and verification, deploy exact SHA and read back public/local/container state using scripts/backup-db.sh and scripts/deploy.sh (FR-011, SC-005).
- [x] T026 Finish current release metadata and evidence-backed closure report in specs/019-close-project-debt/verification.md and inventory.md (FR-007, FR-012, SC-003, SC-006).

## Dependencies and parallel execution

T001–T005 establish the implementation gate. US1, UI work in US2 and the dependency guard in US3 may then run in parallel on their owned files. Parent handles T014 and inventory/documents. T007 precedes T008/T009; T010 precedes UI corrections; T015 precedes dependency integration. T018 depends on actual owner replies only for dependent actions; independent tasks continue. T020 completes PR disposition after relevant integrated gates. T021–T026 are sequential, with convergence findings implemented before release. Full test runner waits for every other browser session to end.

## Implementation strategy

Complete and verify each independent slice, then integrate once. Preserve private drafts before cleanup, never apply them automatically. Pending external decisions remain explicit; a cancelled experiment is never relabeled successful. Each checkbox changes only after its stated evidence exists.

## Phase 7: US4 — Confirmed adjacent Blog debt

This evidence-driven addition executes before final integration/release. It does not revive unaccepted product proposals.

- [x] T027 [US4] Reproduce the previously recorded Admin URL/promotion defects on synthetic fixtures and add FR-013/SC-007 to specs/019-close-project-debt/spec.md.
- [x] T028 [US4] Repair source-link capability and promotion state/path/collision/metadata boundaries in public/modules/admin-blog/index.js and modules/admin/blog.js; keep reader grammar consistent in lib/blog-service.js and modules/blog/handler.js if needed (FR-013).
- [x] T029 [US4] Verify original and alternate hostile representations plus legitimate promotion through tests/blog-promotion-safety.test.js and focused Admin DOM tests (FR-013, SC-007).
- [x] T030 [US4] Independently review bypass/compatibility and update specs/000-platform-baseline/contracts/content-seo.md plus privacy/security boundary records with the tested result (FR-010, FR-013, SC-007).

## Phase 8: Convergence

- [x] T031 Reject noncanonical uppercase promotion/publication slugs before content/status writes and add explicit/persisted uppercase plus lowercase public-route/readback controls in modules/admin/blog.js and tests/blog-promotion-integrity.test.js per FR-013, SC-007, US4/AC2 and US4/AC4 (partial, HIGH).

## Phase 9: Remaining verification debt

- [x] T032 Confirm the ten retired SQLite event-log skips and add FR-014/SC-008 plus bounded test design before implementation (FR-014).
- [x] T033 Replace tests/event-log.test.js with isolated current-HTTP-contract regressions and verify auth-event privacy plus complete no-skip runner behavior (FR-014, SC-008).
- [x] T034 Validate Blog promote/status/public reads on a disposable ClickHouse instance and record exact backend version and cleanup evidence in specs/019-close-project-debt/verification.md (FR-013, SC-007).
