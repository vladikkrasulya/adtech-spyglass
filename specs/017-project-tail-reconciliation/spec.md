# Feature Specification: Project Tail Reconciliation

**Feature Branch**: `main` (maintenance continuation of the interrupted project-wide inventory)

**Created**: 2026-09-02

**Status**: Draft

**Input**: Complete the owner-requested cleanup identified by the six-source loose-end inventory:
make canonical documentation agree with shipped behavior, restore traceable release bookkeeping,
make host cleanup retain the intended rollback depth, resolve the stale dependency pull request
through the normal gates, and preserve every item that still requires an explicit owner decision.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The maintainer can trust canonical project status (Priority: P1)

The maintainer reads the roadmap, feature packages, runbooks, and user/package documentation without
encountering status, locale, or next-step claims that were already superseded by shipped work.

**Why this priority**: Stale canonical text causes already-completed work to be repeated and makes a
real open decision indistinguishable from clerical drift.

**Independent Test**: Compare each inventory finding with shipped behavior and release evidence; all
mechanical contradictions are corrected while owner decisions remain visibly open.

**Acceptance Scenarios**:

1. **Given** a completed feature or release task, **When** its canonical package is read, **Then** its
   status and checkboxes agree with the verified merged and deployed state.
2. **Given** locale documentation, **When** an unsupported locale is described, **Then** every public
   document states the same English-then-Ukrainian fallback order as the product.
3. **Given** a historical pre-Spec-Kit handoff document, **When** it is opened, **Then** it clearly
   points readers to the current canonical project memory.

---

### User Story 2 - Releases are traceable without inventing history (Priority: P1)

The maintainer can move from every release version covered by the verified inventory to its exact
historical revision and a matching release record.

**Why this priority**: A deployed version without an immutable repository reference weakens rollback,
incident review, and provenance.

**Independent Test**: Read back each inventory-approved version reference and confirm that it resolves
to the documented revision and has one matching release record.

**Acceptance Scenarios**:

1. **Given** a version-to-revision pair supported by repository evidence, **When** release references
   are listed, **Then** exactly one immutable version reference resolves to that revision.
2. **Given** a version without a proven revision in the bounded inventory, **When** reconciliation is
   complete, **Then** no reference is fabricated for it.
3. **Given** an existing or retried reconciliation run, **When** release records are created, **Then**
   existing records are preserved and no duplicate is produced.

---

### User Story 3 - Host housekeeping preserves useful rollback depth (Priority: P2)

The operator can rely on scheduled cleanup to keep the ten newest rollback references, discard older
references only, and keep old ad-hoc backups outside the cron-managed directory without deleting the
backup data.

**Why this priority**: The interrupted cleanup sorted opaque revision names rather than age, so its
claim to preserve the newest rollback depth was false.

**Independent Test**: Feed cleanup an order-independent set of dated rollback candidates and verify
that only the ten newest remain; verify the exact legacy backup tree exists at its archival location.

**Acceptance Scenarios**:

1. **Given** more than ten rollback references with readable creation times, **When** cleanup runs,
   **Then** the ten newest readable candidates remain regardless of their names, while an unreadable
   candidate is retained and logged instead of being guessed old.
2. **Given** missing, malformed, or concurrently removed candidates, **When** cleanup runs, **Then** it
   continues safely and records what it could not inspect or remove.
3. **Given** the June 28 WIP backup directory, **When** it is archived, **Then** the full tree is moved
   to the explicit archive location and no contained file is deleted.

---

### User Story 4 - The stale dependency proposal gets an evidence-backed outcome (Priority: P2)

The maintainer no longer sees an indefinitely open dependency proposal: it is refreshed against the
current baseline and accepted only if all required gates pass; otherwise its failed gate and next
action remain explicit.

**Why this priority**: Closing or merging a runtime dependency update without current evidence can
either preserve known debt or introduce a production failure.

**Independent Test**: Evaluate the refreshed proposal through the repository and production-image
gates, then confirm its final state matches the recorded evidence.

**Acceptance Scenarios**:

1. **Given** the dependency proposal rebased on current main, **When** every required gate passes,
   **Then** it may merge through the ordinary non-force workflow.
2. **Given** any required gate still fails, **When** reconciliation ends, **Then** the proposal is not
   merged and the exact failure remains visible rather than being called complete.

### Edge Cases

- Several scanner findings describe the same underlying stale line; fixing it once must close every
  duplicate without manufacturing extra work.
- A release tag or release record may already exist because the interrupted run partially completed;
  reconciliation must be idempotent.
- Host cleanup may encounter two tags pointing to one image or an image removed between enumeration
  and inspection; neither case may abort all housekeeping.
- A remote branch may be absent while a stale local tracking reference remains; absence must be
  verified remotely before any further deletion.
- Owner-only choices, stashes, unpublished packages, repository identity, alert delivery posture,
  unmerged historical branches, and research-policy choices stay outside this implementation.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Canonical project documentation MUST agree with verified shipped status and behavior for
  every mechanically closable documentation finding in the inventory.
- **FR-002**: Completed work MUST NOT retain markers that imply partial or draft status unless a
  concrete unmet acceptance criterion is named.
- **FR-003**: Locale documentation MUST state the supported three locales and the requested → English
  → Ukrainian fallback consistently.
- **FR-004**: Each release in the bounded, evidence-backed version set MUST have one immutable version
  reference and one matching release record at its verified revision.
- **FR-005**: Release history MUST NOT be inferred for versions lacking a verified revision mapping.
- **FR-006**: Scheduled rollback cleanup MUST retain the ten newest timestamped candidates by
  creation time, not by revision-name ordering, MUST retain and log unrankable candidates, and MUST
  tolerate candidates disappearing during cleanup.
- **FR-007**: The identified June 28 WIP backup tree MUST be moved intact to an explicit archival
  location outside the cron-managed backup directory.
- **FR-008**: Dependency PR #4 MUST be refreshed against current main and MUST merge only after every
  required current gate passes; otherwise it remains unmerged with the failing evidence reported.
- **FR-009**: Mechanically merged remote branches MAY be removed after ancestry and remote existence
  are verified; unmerged historical branches MUST remain pending owner choice.
- **FR-010**: Stashes and every unresolved owner-decision portion MUST remain unchanged until the
  owner gives an explicit answer; a bundled finding may still have a separately proven mechanical
  sub-action, such as pruning a tracking ref for an already absent merged remote branch.
- **FR-011**: Repository changes MUST pass formatting, static checks, tests, package smoke, and the
  production-image smoke required by the changed surfaces before a non-force push.
- **FR-012**: This maintenance change MUST NOT alter product behavior, publish npm packages, change
  alert delivery, migrate repository identity, restore data, or deploy production implicitly.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All mechanically closable inventory findings have either verified completion evidence
  or one explicit failed gate; none remains silently half-applied.
- **SC-002**: Zero known contradictions remain in the touched status and locale documentation.
- **SC-003**: All 27 evidence-backed releases in scope resolve to their verified revision and expose
  exactly one release record.
- **SC-004**: A cleanup trial over more than ten timestamped candidates retains exactly the ten
  newest by time, independent of candidate naming; any unrankable candidate is separately retained
  and logged.
- **SC-005**: The complete June 28 WIP backup tree is readable at the archive path and absent from the
  cron-managed source path.
- **SC-006**: Dependency PR #4 ends either merged with every required gate green or deliberately
  unmerged with its current failing gate identified.
- **SC-007**: The final repository scope passes every required local gate with zero new failures.

## Assumptions

- The 27 versions from `v1.6.1` through `v1.19.1` have explicit repository release evidence and form
  this bounded backfill; earlier versioning eras require a separate historical assessment.
- Moving the named WIP backup tree is archival housekeeping, not deletion or restore, and must
  preserve its contents byte-for-byte.
- Documentation and host-maintenance corrections do not require an application version bump or
  production deployment.
- The dependency proposal remains a separate change and follows its own hosted gate results.
- The owner's short approval authorizes completion of the previously enumerated mechanical work but
  does not silently answer the eight choices previously identified as owner-only.
