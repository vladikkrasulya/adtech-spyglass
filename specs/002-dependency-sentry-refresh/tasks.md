# Tasks: Dependency and Sentry Refresh

**Input**: Design documents from `specs/002-dependency-sentry-refresh/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and completed
requirements/security-release checklists

**Tests**: Tests are required by the feature specification. Add the narrow regression first, observe
the relevant pre-fix failure where practical, then implement and rerun the focused gate.

**Organization**: Tasks are grouped by user story so dependency cleanup, Sentry semantics, and final
runtime-scope review remain independently testable.

## Execution Evidence

- **Starting state (2026-08-11)**: local branch `chore/dependencies-sentry-rebase` started from merged
  Spec Kit `main` at `3cc2af1`; the only worktree change was the new untracked feature 002 directory.
  `.specify/feature.json` resolved `specs/002-dependency-sentry-refresh` and remained ignored;
  `.specify/extensions.yml` contained no lifecycle hooks.
- **Old PR map**: commit `7f19da94bcaff5a8d329e8eb31d67f39fad6a94d` is based on `d24064a`.
  Runtime, tests, environment, manifest, and lock changes replay cleanly. Root `ARCHITECTURE.md` and
  `ROADMAP.md` are modify/delete conflicts and must remain deleted; `docs/OPERATIONS.md` auto-merges.
  Canonical destinations are recorded in `research.md` and the feature contracts.
- **Pre-fix audits (2026-08-11)**: `npm audit --json` reported seven findings (five moderate, two
  high): the production Sentry/OpenTelemetry and `brace-expansion` chains plus development-only
  `undici`. `npm audit --omit=dev --json` reported six findings (five moderate, one high), excluding
  `undici`. Both commands reached the npm advisory service; exit status `1` was expected for the
  vulnerable baseline.
- **Pre-implementation analysis**: all 13 FRs and six buildable SCs map to tasks; 31 tasks total;
  zero critical/high, ambiguity, duplication, constitution, or unmapped-task findings. Two medium
  findings were resolved before runtime work: plan scope now names three tests, and package/Docker
  smoke are explicitly sequential.
- **Safe replay**: `git cherry-pick --no-commit 7f19da9` produced only the two predicted
  modify/delete conflicts. Both retired root documents remained deleted; `docs/OPERATIONS.md`
  auto-merged. The candidate changes one direct dependency (`@sentry/node` 10.x), its transitive
  lock graph, logger/health behavior and focused tests, environment/operations copy, and canonical
  Spec Kit memory. Review found no secret, real DSN, payload, private incident, publication,
  deployment, tracing, browser, storage, or public-shape drift.
- **Implemented contracts**: the dependency guard parses only tracked manifests, self-tests its
  comparison/advisory boundaries, rejects every reviewed affected floor, and explicitly defers
  current coverage to both live audits. Logger tests isolate production-shaped unset/malformed/valid
  cases, delete inherited DSN state, and route the valid synthetic envelope through memory only.
  Canonical environment, operations, platform, HTTP, release, and roadmap owners now use the same
  local-SDK-only meaning; target-specific host/path claims were removed.
- **Dependency proof (current tree)**: `npm ci` installed 207 packages and its install-time audit
  inspected 210 with zero findings; `npm ls --all --parseable` and the focused
  Sentry/OpenTelemetry tree both exited zero. The offline guard passed against Sentry `10.70.0`,
  OpenTelemetry Core/resources/trace `2.10.0`, instrumentation `0.220.0`, `brace-expansion` `5.0.9`,
  and `undici` `7.29.0`. A disposable `node:22.13.0-alpine` container completed an engine-strict
  production install (90 packages, 93 audited, zero findings) and loaded `@sentry/node` plus native
  `better-sqlite3`. Final live `npm audit --audit-level=low` and `npm audit --omit=dev
--audit-level=low` each exited zero with `found 0 vulnerabilities`.
- **Focused contract gate**: after clean install and the JSDoc environment-map correction,
  dependency/logger/health/docs-truth/privacy/Spec Kit suites passed 171/171. Targeted ESLint,
  `npm run typecheck`, changed-file Prettier, and `git diff --check` each exited zero. The logger
  subset covers the production-shaped unset, malformed, valid in-memory capture/flush, and both
  health projections; no real destination or network transport was used. The managed sandbox denies
  the logger test's `spawnSync` child creation with `EPERM`, so subprocess-bearing focused/full gates
  ran with the approved unsandboxed test permission; the tests themselves still use only the
  synthetic in-memory transport.
- **Integrated diff review**: the only direct manifest delta is `@sentry/node ^10.53.0` →
  `^10.70.0`; app/Core/CLI versions and every unrelated direct/dev dependency remain unchanged.
  The worktree contains only feature 002 memory, the offline guard, logger/health/tests, the
  reviewed transitive lock movement, and canonical environment/operations/baseline/roadmap truth.
  Root legacy owners remain absent. Secret/real-DSN/private-key scans, SemVer/workspace checks, and
  `git diff --check` are clean; no publish, deploy, production, tracing, browser, storage, or API
  shape file is changed.
- **Package/application smoke**: `bash scripts/npm-pack-smoke.sh` packed and installed Core `0.31.0`
  plus CLI `0.1.1`, then passed help and expected-findings validation; the CLI manifest checksum was
  identical before/after and no backup remained. `bash scripts/ci-docker-smoke.sh` built a disposable
  Node `22.22.3` production image, reached health, analyzed a synthetic request, and loaded
  `better-sqlite3 11.10.0` plus `bcrypt 6.0.0`. Its CI-only container, image tag, and volume were all
  absent after cleanup; production Compose was not used.
- **Complete CI (current tree)**: the first `npm run ci` exposed that the gitignored, machine-local
  `.specify/feature.json` pointer was still included by Prettier. `.prettierignore` now excludes that
  generated pointer, and the Spec Kit contract suite now guards the exclusion. The clean rerun before
  that final guard passed formatting, ESLint, type checking, and all 1,628 tests (1,618 pass, 10
  intentional skips, zero failures). Coverage was 85.45% lines, 85.29% branches, and 81.25%
  functions; `git diff --check` remained clean. The CI command used the same approved unsandboxed
  test permission required by the documented child-process `EPERM` limitation. T030 owns the final
  post-guard and post-timeout full rerun.
- **Final consistency analysis**: the refreshed read-only `speckit.analyze` pass covered all 13 FRs
  and six buildable SCs across 31 tasks (19/19, 100%). It found zero unmapped tasks, ambiguities,
  duplications, constitution conflicts, or P0/P1/P2 findings. The two traceability observations raised
  during the pass—plan inventory and sandbox child-process evidence—were reconciled before the clean
  rerun; before/after analyze hooks remained empty.
- **Handoff status**: after explicit authorization, commit `9eae19a` replaced the unchanged old PR #57
  head `7f19da9` through an exact `--force-with-lease`; no concurrent remote work was overwritten. The
  draft became mergeable against foundation-enabled `main`, its body was updated to current Spec Kit
  owners and evidence, and GitHub CI run #338 passed. This evidence-only follow-up records completion;
  final reporting waits for the follow-up head's own green check. The PR remains draft and no merge,
  publish, production configuration change, real delivery test, or deployment occurred.
- **Convergence**: `speckit.converge` checked 19 requirements, nine acceptance scenarios, the bounded
  plan decisions, and all eight constitution principles. It found zero missing, partial,
  contradicting, or unrequested gaps and appended no tasks; the convergence command left `tasks.md`
  byte-for-byte unchanged, and before/after convergence hooks were empty.
- **Final T030 gates (current candidate)**: repository-wide Prettier, targeted changed-JS ESLint,
  type checking, and `git diff --check` passed. Fresh full and production-only npm audits each
  returned `found 0 vulnerabilities`. Package smoke again packed/installed Core `0.31.0` and CLI
  `0.1.1`, passed help/validation, restored the CLI manifest to the same SHA-256, and left no backup.
  Docker smoke again passed health, synthetic analysis, Node `22.22.3`, `better-sqlite3 11.10.0`, and
  `bcrypt 6.0.0`; its disposable container, volume, and image were absent afterward. The first final
  CI run correctly rejected a non-canonical combined status line; after separating `Verification`
  from its status note, the Spec Kit suite passed 10/10 and the complete rerun passed all 1,628 tests
  (1,618 pass, 10 intentional skips, zero failures) with 85.45% line, 85.29% branch, and 81.25%
  function coverage. No package was published and no production service or configuration was
  touched.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no incomplete dependency
- **[Story]**: Maps the task to one feature user story
- Every task names its owning repository path or evidence file

**Requirement coverage**: FR-001 → T010/T012/T013; FR-002 → T009/T023; FR-003 → T010/T011;
FR-004 → T015–T019; FR-005 → T016–T020/T022; FR-006 → T014/T016/T021; FR-007 → T015/T021;
FR-008 → T007/T014/T023; FR-009 → T007/T023; FR-010 → T004/T018–T020/T022/T028; FR-011 →
T021/T024–T026/T030; FR-012 → T007/T023/T031; FR-013 → T008/T012/T013.

## Phase 1: Setup and Evidence Baseline

**Purpose**: Pin the current feature, old PR source, and pre-fix evidence before implementation.

- [x] T001 Record the exact local branch, current `main` base, ignored feature pointer, empty lifecycle
      hooks, and starting worktree state in `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T002 [P] Reconcile the old PR commit/file/conflict map and canonical document destinations in
      `specs/002-dependency-sentry-refresh/research.md`
- [x] T003 [P] Record fresh full and production-only npm audit baselines, including severity split and
      affected chains, in `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T004 Update foundation/dependency status and feature ownership without changing authorization in
      `specs/ROADMAP.md`

---

## Phase 2: Pre-Implementation Analysis and Safe Replay

**Purpose**: Prove the feature artifacts are internally consistent, then bring the reviewed old patch
into the current worktree without reviving retired truth owners or committing an unreviewed merge
result.

**⚠️ CRITICAL**: No user-story implementation proceeds until the staged replay is scoped and all
modify/delete conflicts preserve the Spec Kit ownership model.

- [x] T005 Run `speckit.analyze` against the complete feature 002 spec/plan/tasks/contracts, resolve
      every critical/high finding before runtime edits, and record the result in
      `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T006 Replay commit `7f19da94bcaff5a8d329e8eb31d67f39fad6a94d` without committing, retain
      deletion of root `ARCHITECTURE.md` and `ROADMAP.md`, and inspect every resulting path with `git
status`/`git diff`
- [x] T007 Remove any restored legacy-owner content and verify the replay contains no secrets, real
      DSNs, payloads, private incident links, publication, deployment, tracing, browser-proxy, storage,
      or API-shape drift in the repository diff

**Checkpoint**: The worktree contains only a reviewable feature-002 implementation candidate plus
its canonical Spec Kit artifacts.

---

## Phase 3: User Story 1 - Remove Known Dependency Findings (Priority: P1) 🎯 MVP

**Goal**: Reproduce a bounded, compatible dependency graph with zero current full and production npm
audit findings.

**Independent Test**: From a clean lockfile install, run the offline advisory-floor guard,
`npm ls --all`, `npm audit`, and `npm audit --omit=dev`; all commands must exit zero and the direct
manifest must contain no unrelated major update.

### Tests for User Story 1

- [x] T008 [US1] Add a failing offline guard for the known vulnerable Sentry/OpenTelemetry,
      `brace-expansion`, and `undici` floors in `tests/dependency-security.test.js`

### Implementation for User Story 1

- [x] T009 [US1] Update only the compatible `@sentry/node` 10.x range and reviewed transitive graph in
      `package.json` and `package-lock.json`
- [x] T010 [US1] Run `npm ci`, validate the complete dependency tree, and record the clean-install/tree
      evidence in `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T011 [US1] Run an engine-strict clean production install on exact Node.js `22.13.0`, inspect the
      affected resolved engine ranges, and record the evidence in
      `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T012 [US1] Run the full npm advisory audit and record the zero-finding result in
      `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T013 [US1] Run the production-only npm advisory audit and record the separate zero-finding result
      in `specs/002-dependency-sentry-refresh/tasks.md`

**Checkpoint**: User Story 1 is independently complete when the committed graph is reproducible,
offline-known floors are guarded, and both live audit modes are clean.

---

## Phase 4: User Story 2 - Report Truthful Local Sentry State (Priority: P1)

**Goal**: Make `sentry.ready` represent only a locally accepted SDK destination while preserving the
health shape and all existing privacy/runtime boundaries.

**Independent Test**: Isolated production-shaped child processes prove unset, malformed, and valid
synthetic configurations; the valid case captures and flushes one in-memory envelope with no network,
and health-handler tests cover injected false/true states.

### Tests for User Story 2

- [x] T014 [P] [US2] Extend the child-process helper to support an explicitly unset inherited DSN and
      add unset/malformed/valid no-egress SDK cases in `tests/logger.test.js`
- [x] T015 [P] [US2] Add explicit injected false and true Sentry projection cases in
      `tests/health.test.js`

### Implementation for User Story 2

- [x] T016 [US2] Make readiness depend on the initialized SDK client's parsed DSN, preserve no-throw
      capture/flush behavior, and remove target-specific deployment assumptions in `lib/logger.js`
- [x] T017 [P] [US2] Document the local-only health projection without exposing destination detail in
      `modules/health/handler.js`
- [x] T018 [P] [US2] Align environment and operator wording with local configuration semantics in
      `.env.example` and `docs/OPERATIONS.md`
- [x] T019 [P] [US2] Reconcile as-built Sentry ownership and the exact health API meaning in
      `specs/000-platform-baseline/plan.md` and
      `specs/000-platform-baseline/contracts/http-api.md`
- [x] T020 [P] [US2] Clarify that Sentry configuration is not an application/deployment readiness
      dependency in `specs/000-platform-baseline/contracts/release-deploy.md`
- [x] T021 [US2] Run focused logger/health tests, targeted lint, type checking, truth/privacy guards,
      and record results in `specs/002-dependency-sentry-refresh/tasks.md`

**Checkpoint**: User Story 2 is independently complete when the public shape is unchanged, malformed
configuration is false, valid local setup is true, no test performs egress, and all canonical wording
uses the same local-only claim.

---

## Phase 5: User Story 3 - Prove No Runtime-Scope Drift (Priority: P2)

**Goal**: Give reviewers complete evidence that the security refresh preserves packaging, application
runtime, privacy, governance, and production separation.

**Independent Test**: Review the complete diff, run package smoke, production-shaped Docker/application
smoke, complete CI, and governance/truth checks; all required gates pass without publication or
production mutation.

### Verification for User Story 3

- [x] T022 [P] [US3] Add or update documentation-truth coverage for the canonical local Sentry claim
      and retired-owner absence in `tests/docs-truth.test.js` and `tests/spec-kit-contract.test.js` only
      where current guards do not already cover it
- [x] T023 [US3] Review `package.json`/`package-lock.json` and the whole worktree diff for unrelated
      majors, workspace drift, secrets, production identifiers, restored legacy owners, or unauthorized
      runtime/deploy changes; record the result in `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T024 [US3] Run `bash scripts/npm-pack-smoke.sh`, verify any temporary manifest rewrite was
      restored, and record the result in `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T025 [US3] Run `bash scripts/ci-docker-smoke.sh` with no Sentry DSN, confirm disposable
      cleanup/no production service mutation, and record the result in
      `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T026 [US3] Run `npm run ci` and `git diff --check`, then record exact current-run evidence and any
      sandbox limitation in `specs/002-dependency-sentry-refresh/tasks.md`

**Checkpoint**: All three user stories are independently evidenced and the candidate is ready for
cross-artifact analysis and convergence.

---

## Phase 6: Convergence and PR Handoff

**Purpose**: Reconcile canonical memory, close every discovered task, and prepare—but do not silently
perform—the external PR mutation.

- [x] T027 Re-run the non-destructive `speckit.analyze` consistency review on the final artifacts,
      resolve every critical/high contradiction across `specs/002-dependency-sentry-refresh/`, and record
      the clean result in `tasks.md`
- [x] T028 Update feature status/evidence and current dependency next gate in
      `specs/002-dependency-sentry-refresh/spec.md`, `specs/002-dependency-sentry-refresh/tasks.md`, and
      `specs/ROADMAP.md`
- [x] T029 Run `speckit.converge`; implement and verify any appended work until convergence is clean,
      recording the result in `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T030 Re-run the final changed-file format/lint/type checks, both npm audits, package smoke, Docker
      smoke, full CI, and `git diff --check`; record only current-run evidence in
      `specs/002-dependency-sentry-refresh/tasks.md`
- [x] T031 After explicit authorization, commit the reviewed local candidate, lease-protected push it
      from `chore/dependencies-sentry-rebase` to remote `chore/dependencies-sentry`, and verify draft PR
      #57 exact head/checks without merging or deploying

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: starts immediately and pins evidence.
- **Pre-Implementation Analysis and Safe Replay (Phase 2)**: depends on setup and blocks all
  implementation.
- **User Story 1 (Phase 3)**: depends on the scoped replay; can then proceed independently.
- **User Story 2 (Phase 4)**: depends on the scoped replay; test files can be authored in parallel
  with User Story 1 lockfile review.
- **User Story 3 (Phase 5)**: depends on completed User Stories 1 and 2.
- **Convergence/Handoff (Phase 6)**: depends on all story gates; T031 additionally requires explicit
  authorization.

### User Story Dependencies

- **User Story 1 (P1)**: no dependency on Sentry readiness implementation; delivers a clean graph.
- **User Story 2 (P1)**: uses the upgraded SDK to prove API compatibility but its contract/tests are
  independently runnable once the scoped replay exists.
- **User Story 3 (P2)**: integrates evidence from both P1 stories and cannot finish before them.

### Within Each User Story

- Write the narrow regression before the implementation it protects.
- Treat `npm ci` output, not stale `node_modules`, as graph authority.
- Run focused tests before broader smoke/CI.
- Update canonical baseline/operations truth with the behavior change.
- Do not mark evidence tasks complete until the exact command has run in the current final tree.

### Parallel Opportunities

- T002 and T003 can run in parallel after T001.
- T014 and T015 touch independent test files.
- T017–T020 touch distinct implementation/document owners after T016's contract is fixed.
- T024 and T025 run sequentially because package smoke temporarily rewrites a CLI manifest before
  restoring it, while Docker smoke reads the repository build context.

---

## Parallel Example: User Story 2

```text
Task T014: production-shaped logger subprocess/no-egress tests in tests/logger.test.js
Task T015: injected health projection tests in tests/health.test.js

After logger semantics are fixed:
Task T017: health handler contract comment
Task T018: environment and operator wording
Task T019: baseline ownership and public HTTP contract
Task T020: release/deploy readiness distinction
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Pin starting evidence and complete the safe replay.
2. Add the offline known-floor regression.
3. Refresh only the reviewed compatible graph.
4. Prove clean install, tree validity, Node-floor compatibility, and both zero-finding audits.
5. Stop and review the lockfile before touching observability semantics.

### Incremental Delivery

1. User Story 1 removes current dependency findings.
2. User Story 2 corrects and tests local Sentry semantics with the upgraded real SDK.
3. User Story 3 proves packaging/application/governance boundaries across the integrated diff.
4. Analysis and convergence close specification drift before external PR handoff.

### External Mutation Boundary

Local implementation and testing do not authorize commit, force/lease push, PR readiness, merge,
publication, production configuration, real telemetry delivery, or deployment. T031 is deliberately
last and remains unchecked until exact authorization and evidence exist.
