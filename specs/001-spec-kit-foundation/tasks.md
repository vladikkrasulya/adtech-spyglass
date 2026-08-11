---
description: 'Executable migration from competing project guidance to GitHub Spec Kit'
---

# Tasks: Spec Kit Foundation

**Input**: Design documents from `specs/001-spec-kit-foundation/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and
`quickstart.md`

**Tests**: Regression and integrity tests are mandatory because the feature replaces project
governance and documentation-truth gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it owns different files and has no incomplete dependency.
- **[Story]**: Maps implementation work to a user story from `spec.md`.
- Every task names its primary file path and the requirement(s) it satisfies.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the pinned, reviewed generator and managed integration skeleton.

- [x] T001 Pin Spec Kit v0.16.2 and initialize bundled infrastructure plus `assess` in `.specify/` per FR-014
- [x] T002 Install and synchronize Codex, Claude, Cursor, and Gemini adapters in `.agents/skills/`, `.claude/skills/`, `.cursor/skills/`, and `.gemini/commands/` per FR-006
- [x] T003 Record the supported integration/extension state and executable managed shell modes in `.specify/integration.json`, `.specify/extensions.yml`, and `.specify/scripts/bash/` per FR-007 and FR-012

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create one governance authority and a complete migration design before retiring anything.

**⚠️ CRITICAL**: No legacy owner is removed until its valid knowledge has a named destination.

- [x] T004 Ratify the no-placeholder v1.0.0 project constitution in `.specify/memory/constitution.md` per FR-001 and FR-013
- [x] T005 Complete the migration specification, plan, research, data model, contracts, quickstart, and checklist in `specs/001-spec-kit-foundation/` per FR-015
- [x] T006 [P] Create a failing canonical-tree and ownership regression suite in `tests/spec-kit-contract.test.js` per FR-011
- [x] T007 [P] Add precise generated-file exclusions to `.prettierignore` and `.dockerignore` before repository-wide formatting or image tests per FR-012

**Checkpoint**: The migration has an authoritative rule set, testable scope, and safe generated-file
boundaries.

---

## Phase 3: User Story 1 - One Canonical Agent Context (Priority: P1) 🎯 MVP

**Goal**: Every supported agent resolves the same approved lifecycle from generated adapters while
project policy exists only in the constitution.

**Independent Test**: Run the Spec Kit contract test and integration status check; confirm four clean
integrations, identical approved commands, Codex default, and no root agent rulebook.

### Tests for User Story 1

- [x] T008 [P] [US1] Assert the exact supported integration set, default, approved extension set, and command parity in `tests/spec-kit-contract.test.js` per FR-006 and FR-007
- [x] T009 [P] [US1] Assert retired agent rulebooks and stale specialist prompts are absent in `tests/spec-kit-contract.test.js` per FR-001 and FR-009

### Implementation for User Story 1

- [x] T010 [US1] Remove `CLAUDE.md`, `.claude/agents/`, `docs/sonnet-orchestration-plan.md`, `.Jules/palette.md`, and any competing `AGENTS.md` after migrating valid rules per FR-001 and FR-009
- [x] T011 [P] [US1] Route maintainers into Spec Kit from `README.md` and a concise `CONTRIBUTING.md` without duplicating constitution rules per FR-002 and FR-010
- [x] T012 [US1] Verify generated manifests and approved capabilities with `specify integration status` and record exact evidence in `specs/001-spec-kit-foundation/tasks.md` per SC-002

**Checkpoint**: A supported agent has one generated entry point and one normative policy source.

---

## Phase 4: User Story 2 - What, How, Why, and Next (Priority: P1)

**Goal**: Build the canonical platform baseline, decision index, and current roadmap, then retire
competing architecture and roadmap owners.

**Independent Test**: Starting at `specs/README.md`, locate each concern's sole owner in one hop and
pass recursive link/ownership checks after the old files are absent.

### Tests for User Story 2

- [x] T013 [P] [US2] Extend recursive active-document link and ownership coverage in `tests/docs-truth.test.js` and `tests/spec-kit-contract.test.js` per FR-002 and FR-011
- [x] T014 [P] [US2] Move privacy and deterministic-intel positive assertions to baseline contracts in `tests/privacy-claims.test.js` and `tests/model-free-contract.test.js` per FR-003 and FR-010

### Implementation for User Story 2

- [x] T015 [US2] Create the project-memory router and current-only priority queue in `specs/README.md` and `specs/ROADMAP.md` per FR-002 and FR-004
- [x] T016 [P] [US2] Capture current product scope, architecture, evidence, entities, and validation path in `specs/000-platform-baseline/spec.md`, `plan.md`, `research.md`, `data-model.md`, and `quickstart.md` per FR-003
- [x] T017 [P] [US2] Define current Core/API, frontend lifecycle, data-retention, locales/versioning, content/SEO, and release/deploy behavior in `specs/000-platform-baseline/contracts/` per FR-003
- [x] T018 [P] [US2] Create the accepted-decision index and architecture/product ADRs in `specs/DECISIONS.md` and `specs/decisions/` per FR-005
- [x] T019 [US2] Replace stale references and duplicated normative text in retained `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/`, package READMEs, and component READMEs with canonical links per FR-010
- [x] T020 [US2] Retire root `ROADMAP.md`, root `ARCHITECTURE.md`, `docs/ARCHMAP.md`, and `docs/TESTING.md` only after T015-T019 pass ownership review per FR-009

**Checkpoint**: Current state, current direction, and durable rationale each have one discoverable
owner and no live mirror.

---

## Phase 5: User Story 3 - Auditable Delivery Lifecycle (Priority: P2)

**Goal**: Make the Spec Kit artifacts enforceable working memory that stays consistent with existing
privacy, packaging, image, and CI truth gates.

**Independent Test**: Resolve the active feature from machine-local state, run all targeted governance
and truth tests, and show complete requirement-to-task coverage before implementation closes.

### Tests for User Story 3

- [x] T021 [P] [US3] Validate feature completeness, statuses, IDs, task format, placeholders, and roadmap ownership in `tests/spec-kit-contract.test.js` per FR-011 and FR-015
- [x] T022 [P] [US3] Update active Markdown and retired-path expectations in `tests/docs-truth.test.js` per FR-009 and FR-010
- [x] T023 [P] [US3] Enforce generated governance exclusion from Docker context in `tests/immutable-image.test.js` per FR-012

### Implementation for User Story 3

- [x] T024 [US3] Document the manual assess-to-converge gold path and passive-context limitation in `specs/README.md` and `CONTRIBUTING.md` per FR-008
- [x] T025 [P] [US3] Consolidate release history under one Unreleased section and record the migration in `CHANGELOG.md` per FR-010
- [x] T026 [US3] Run the feature quickstart and record targeted command outcomes in `specs/001-spec-kit-foundation/tasks.md` per SC-003, SC-004, and SC-005

**Checkpoint**: Governance drift becomes a deterministic CI failure rather than a documentation
review guess.

---

## Phase 6: User Story 4 - Reusable Fleet Standard (Priority: P3)

**Goal**: Leave a reproducible pinned foundation and an explicit, safely bounded path to organization
automation.

**Independent Test**: Recreate the pinned setup in a temporary Git fixture, verify the same managed
infrastructure/integration status, and ensure future automation is represented as assessed work rather
than silently installed hooks.

### Tests for User Story 4

- [x] T027 [P] [US4] Pin the exact CLI version/source revision and reviewed upgrade sequence in `tests/spec-kit-contract.test.js` per FR-014

### Implementation for User Story 4

- [x] T028 [P] [US4] Record future first-party context-extension, governance-preset, safe-workflow, and bundle work as linked priorities in `specs/ROADMAP.md` per FR-004 and FR-008
- [x] T029 [US4] Execute the clean-fixture reproduction from `specs/001-spec-kit-foundation/quickstart.md` and record evidence in `specs/001-spec-kit-foundation/tasks.md` per SC-007

**Checkpoint**: The baseline is reproducible and honest about what remains before organization-wide
automatic context injection.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Reconcile all artifacts and prove that application quality is unchanged.

- [x] T030 [P] Run Prettier on authored memory and validate all generated shell scripts with `bash -n`, recording results in `specs/001-spec-kit-foundation/tasks.md`
- [x] T031 Run `npm run ci` and `git diff --check`, recording exact results in `specs/001-spec-kit-foundation/tasks.md` per SC-006
- [x] T032 Run final Spec Kit cross-artifact analysis and convergence against `specs/001-spec-kit-foundation/`, resolving every critical/high gap before review per FR-015

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** starts immediately.
- **Phase 2** depends on generated infrastructure and blocks all retirements.
- **US1 (Phase 3)** depends on Phase 2 and establishes the agent-entry MVP.
- **US2 (Phase 4)** depends on the constitution/feature design; its baseline, contracts, and ADR tasks
  can run in parallel before the coordinated retirement task.
- **US3 (Phase 5)** depends on the canonical tree from US1/US2.
- **US4 (Phase 6)** depends on a stable configuration and can proceed after US1 while US2/US3 docs are
  being reconciled.
- **Polish (Phase 7)** depends on all desired stories.

### User Story Dependencies

- **US1**: independent after foundation and constitutes the MVP.
- **US2**: uses the integration-neutral constitution but does not depend on US1 adapter implementation.
- **US3**: depends on US1 and US2 because it validates their final paths.
- **US4**: depends on US1 configuration; it does not block the initial migration MVP.

### Parallel Opportunities

- T006 and T007 can run in parallel after the feature design exists.
- T008/T009 and T011 own distinct test/document paths.
- T013/T014 can run in parallel; T016/T017/T018 own distinct baseline/decision files.
- T021/T022/T023 own distinct test contracts.
- T027 and T028 can run in parallel before the clean-fixture evidence task.

---

## Parallel Example: User Story 2

```text
Task: T016 — author the baseline what/how/data files
Task: T017 — author the baseline behavioral contracts
Task: T018 — author the ADR index and records
```

T020 waits until all three plus retained-document link migration are complete.

---

## Implementation Strategy

### MVP First

1. Complete setup and foundation.
2. Deliver US1: one constitution plus healthy adapters and no legacy agent rulebook.
3. Stop and validate the MVP before retiring broader architecture/roadmap documents.

### Incremental Delivery

1. Build the canonical platform memory alongside existing documents.
2. Update all consumers and tests to point to the new owners.
3. Retire old owners only after link/ownership checks are green.
4. Prove the full lifecycle and clean-fixture reproduction.
5. Run complete CI and converge before opening a PR.

## Notes

- Completed tasks receive `[x]` only after their output and evidence exist.
- Managed integration files are regenerated through Spec Kit, never edited manually.
- No task authorizes commit, push, PR, publication, deployment, or production mutation.
- If unrelated working-tree changes appear, preserve them and stop before overlapping edits.

## Verification Evidence

### 2026-08-11 — managed fleet and clean fixture

- `specify --version` reported `0.16.2`.
- `specify integration status` reported `OK`, Codex default, integrations
  `codex, claude, cursor-agent, gemini`, multi-install safe, and zero modified,
  missing, invalid, or unchecked managed paths.
- `specify extension list` reported only bundled `assess` v1.0.0 with five
  commands and zero hooks.
- The clean-fixture commands in `quickstart.md` reproduced that state in a
  disposable Git repository under `/tmp`; all four adapters exposed the same
  fifteen approved capabilities and every generated shell helper passed
  `bash -n`.

### 2026-08-11 — targeted repository guards

- `tests/spec-kit-contract.test.js`: 10/10 passed.
- `tests/docs-truth.test.js`: 23/23 passed.
- `tests/privacy-claims.test.js`: 115/115 passed.
- `tests/model-free-contract.test.js`: 31/31 passed.
- `tests/immutable-image.test.js`: 52/52 passed outside the filesystem sandbox;
  the sandbox run was invalidated only by its known `spawnSync bash EPERM`
  restriction.
- Targeted total: 231/231 passed. Prettier, targeted ESLint, `tsc --noEmit`,
  and scoped `git diff --check` also exited 0.

### 2026-08-11 — complete repository gate

- `npm run ci` exited 0 outside the filesystem sandbox: Prettier, ESLint, and
  JSDoc/TypeScript checks passed; the coverage run executed 1,619 tests with
  1,609 passing, 10 intentional skips, and zero failures.
- Aggregate coverage was 85.31% lines, 85.22% branches, and 81.13% functions.
- `bash -n .specify/scripts/bash/*.sh` and `git diff --check` exited 0.
- A final `specify integration status` remained `OK` with zero managed-file
  drift; only bundled `assess` was enabled and it registered no hooks.

### 2026-08-11 — final analysis and convergence

- Independent cross-artifact review found and resolved every P0/P1 gap before
  completion: bundled-workflow invocation boundaries, exact adapter allowlists,
  content-hashed assessment adapters, assessment/passive-context limits,
  deterministic scaffold ordering, historical-document classification, Docker
  exclusions, and the client Markdown trust boundary.
- The existing unsanitized browser Markdown/editorial-promotion boundary is
  documented in the platform contract and queued for a separate assessed
  runtime-hardening feature; this governance migration does not silently change
  application behavior.
- Final review reported no remaining substantive P0/P1 blockers. T001-T032 are
  complete, requirement/task coverage is intact, and the authored feature tree
  has no unresolved clarification or template markers.
