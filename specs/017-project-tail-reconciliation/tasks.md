# Tasks: Project Tail Reconciliation

**Input**: Design documents from `specs/017-project-tail-reconciliation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [reconciliation contract](./contracts/reconciliation.md)

**Tests**: Verification is required because this sweep changes canonical contracts, external release
state, and host cleanup behavior.

**Organization**: Tasks are grouped by user story so repository truth, release truth, host cleanup,
and the dependency proposal remain independently verifiable.

## Phase 1: Setup

**Purpose**: Establish governed scope for the interrupted maintenance work.

- [x] T001 Create the feature package in `specs/017-project-tail-reconciliation/`
- [x] T002 Record owner-only exclusions in `specs/017-project-tail-reconciliation/spec.md`

---

## Phase 2: Foundational Evidence

**Purpose**: Freeze the evidence needed by every independently executable story.

- [x] T003 Reconcile all 37 raw classifier records and duplicates in
      `specs/017-project-tail-reconciliation/research.md`
- [x] T004 Verify the bounded 27-version release map in
      `specs/017-project-tail-reconciliation/contracts/reconciliation.md`
- [x] T005 Capture repository, named branch, GitHub release, Docker, backup, and PR baseline evidence in
      `specs/017-project-tail-reconciliation/research.md`

**Checkpoint**: Every mechanical action has a proven target; owner decisions are excluded.

---

## Phase 3: User Story 1 — Canonical project status (Priority: P1) 🎯 MVP

**Goal**: Remove verified stale status and locale claims without changing application behavior.

**Independent Test**: Run the contradiction searches and formatting checks in quickstart sections 1–2.

- [x] T006 [P] [US1] Close the verified release tasks in
      `specs/009-inspector-defect-repair/tasks.md` and
      `specs/010-button-confirmation-fit/tasks.md`
- [x] T007 [P] [US1] Mark 016 complete and clear resolved partial markers in
      `specs/016-ext-key-alphabet/spec.md` and `specs/016-ext-key-alphabet/tasks.md`
- [x] T008 [P] [US1] Reconcile the date and completed 016 gate in `specs/ROADMAP.md`
- [x] T009 [P] [US1] Replace the one-time stale next instruction in
      `scripts/assemble-adjudication.js`
- [x] T010 [P] [US1] Reconcile supported locales and fallback order in `docs/USER_GUIDE.md`,
      `packages/core/README.md`, and `packages/cli/README.md`
- [x] T011 [P] [US1] Mark the pre-Spec-Kit handoff historical in `walkthrough.md`
- [x] T012 [P] [US1] Correct the resolved ADR-012 debt in
      `/home/vk/.claude/projects/-srv-DATA-Stacks-ortbtools/memory/`
- [x] T013 [US1] Run the stale-claim searches and scoped formatting checks from
      `specs/017-project-tail-reconciliation/quickstart.md`

**Checkpoint**: Canonical documentation independently agrees with shipped behavior.

---

## Phase 4: User Story 2 — Traceable releases (Priority: P1)

**Goal**: Give each of the 27 proven releases one immutable tag and one public release record.

**Independent Test**: Read back remote peeled tag revisions and public release metadata for the exact
set in the reconciliation contract.

- [x] T014 [US2] Create and push every missing annotated tag in the 27-version evidence map in
      `specs/017-project-tail-reconciliation/contracts/reconciliation.md`
- [x] T015 [US2] Create idempotent public GitHub Releases with matching CHANGELOG notes for all 27
      versions in
      `specs/017-project-tail-reconciliation/contracts/reconciliation.md`
- [x] T016 [US2] Verify tag peeling, release targets, draft/prerelease flags, and latest designation
      against `specs/017-project-tail-reconciliation/contracts/reconciliation.md`

**Checkpoint**: The bounded release set is fully traceable without inferred history.

---

## Phase 5: User Story 3 — Safe host housekeeping (Priority: P2)

**Goal**: Preserve the real ten newest rollback references and archive the exact legacy backup tree.

**Independent Test**: Run quickstart section 4 and compare the retained timestamps and archive
inventory with the recorded pre-action evidence.

- [x] T017 [P] [US3] Replace lexical rollback-tag retention with timestamp ordering in the tracked
      `scripts/cleanup-rollback-tags.sh`, delegate to it from `/home/vk/.local/bin/cleanup-server.sh`,
      and document the installed retention contract in `docs/OPERATIONS.md`
- [x] T018 [US3] Reconstruct only provable recent rollback refs and apply corrected retention through
      `/home/vk/.local/bin/cleanup-server.sh`
- [x] T019 [P] [US3] Move `/srv/DATA/Backups/ortbtools/wip-backups-2026-06-28` intact to
      `/srv/DATA/Backups/archive/ortbtools-wip-backups-2026-06-28`
- [x] T020 [US3] Regression-test cleanup ordering and failure handling, then verify shell syntax,
      installed helper handoff, newest-ten ordering, image provenance, archive inode, entry count,
      byte count, and manifest hash per `specs/017-project-tail-reconciliation/quickstart.md`

**Checkpoint**: Runtime cleanup is bounded, chronological, repeatable, and non-destructive.

---

## Phase 6: User Story 4 — Dependency proposal outcome (Priority: P2)

**Goal**: Resolve PR #4 only from current full-gate evidence.

**Independent Test**: Read the PR head/base relationship and every required hosted check; verify that
merge occurs only if all are successful.

- [x] T021 [US4] Refresh GitHub PR #4 onto current `main` and trigger current hosted checks
- [x] T022 [US4] Replace the stale hard-coded native dependency version assertion in
      `scripts/ci-docker-smoke.sh` with exact lockfile-to-image verification
- [x] T023 [US4] Run the complete local gate, package smoke, and production Docker smoke on the
      maintenance scope containing the gate fix
- [ ] T024 [US4] Stage only the bounded maintenance scope, commit and non-force push `main`, and wait
      for green hosted CI on the pushed gate fix
- [ ] T025 [US4] Refresh PR #4 onto the pushed gate fix and read back every required hosted check
- [ ] T026 [US4] Merge GitHub PR #4 if all required checks pass, or leave it open and record the exact
      non-green gate in `specs/017-project-tail-reconciliation/tasks.md`

**Checkpoint**: PR #4 is either safely merged or explicitly blocked by current evidence.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Settle repository scope and close the feature with reproducible evidence.

- [ ] T027 Fast-forward local `main` after the PR outcome and rerun every gate affected by the final
      dependency state
- [ ] T028 Update completion evidence and status in `specs/017-project-tail-reconciliation/spec.md`,
      `specs/017-project-tail-reconciliation/tasks.md`, and `specs/ROADMAP.md`
- [ ] T029 Commit and non-force push the final evidence-only closure, then wait for green hosted CI
      on the pushed revision

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup precedes the foundational evidence record.
- US1, US2, and US3 depend only on foundational evidence and can execute in parallel.
- US4 depends on current main but remains a separate proposal and can be evaluated alongside US1–US3.
- The maintenance commit carrying the corrected PR gate must reach `main` before PR #4 is refreshed.
- Cross-cutting verification follows the PR outcome; the final evidence-only closure follows its
  local checks.

### User Story Dependencies

- **US1**: No dependency on external release or host state.
- **US2**: No dependency on repository text changes after the evidence map is frozen.
- **US3**: No dependency on GitHub state; backup and Docker actions are independently verified.
- **US4**: Refresh follows the maintenance push; merge waits for its own current hosted gates and is
  not bundled into the maintenance commit.

### Parallel Opportunities

- T006–T012 touch independent canonical owners and can be reviewed in parallel.
- T014–T016 and T017–T020 can run independently.
- The component checks inside T023 can run concurrently; its Docker smoke runs separately because it
  owns Docker build/run resources.

## Implementation Strategy

1. Close documentation contradictions first and verify them independently.
2. Complete release metadata and host housekeeping with exact readback.
3. Let refreshed PR #4 prove itself through current hosted CI; never bypass a non-green gate.
4. Push the proven gate fix, refresh and judge PR #4, then record the final outcome in a separate
   evidence-only closure.

## Requirement Coverage

**Requirement coverage**: FR-001 → T006–T013; FR-002 → T006–T009; FR-003 → T010/T013; FR-004 →
T014–T016; FR-005 → T004/T014–T016; FR-006 → T017/T018/T020; FR-007 → T019/T020; FR-008 →
T021–T027; FR-009 → T005; FR-010 → T002/T003/T005; FR-011 → T013/T023/T024/T027/T029;
FR-012 → T002/T023/T027/T029.
