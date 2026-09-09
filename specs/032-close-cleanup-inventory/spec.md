# Feature Specification: Close the cleanup inventory

**Feature Branch**: `codex/maintenance-cleanup-20260909`
**Created**: 2026-09-09
**Status**: Verification
**Input**: The owner selected “Послідовно закрити всі 26 відкритих пунктів”. The brief also identifies `negative-floor-unflagged` and asks for evidence-backed dispositions of CL-08/09.

## User Scenarios & Testing

### User Story 1 — Equivalent auctions receive applicable checks (Priority: P1)

An analyst receives checks supported by the actual auction/material fields, with findings pointing to the original input.

**Independent Test**: Compare attributed 2.x and normative 3.0 fixtures, supported feed aliases and price/floor boundaries through public validation and HTTP.

**Acceptance Scenarios**:

1. A 3.0 placement with invalid security, inverted duration, a pop hint or an unknown item extension receives the applicable finding families at original paths.
2. Both redirect URL spellings and the documented value/notification shape reach their field validators.
3. Explicit in-page material receives the in-page type and checks of documented supplied fields without invented vendor requirements.
4. Negative impression/matched-deal floors produce a warning and no satisfied-floor verdict.
5. Missing, malformed, negative and zero prices retain existing public finding IDs, levels and paths while sharing classification.

### User Story 2 — The interface describes the current action (Priority: P1)

An analyst sees accessible feedback and only the findings and creative belonging to the current input and selected material.

**Independent Test**: In Chrome exercise fresh visit, dismissal/remount, notifications, partner failures, edit/reset and delayed analysis; switch multi-seat and 3.0 creatives and check original source identity.

**Acceptance Scenarios**:

1. The first-visit guide is visible without disrupting the workbench or verification banner; dismissal survives revisit.
2. Toast-only errors and successes have suitable live announcements without duplication.
3. Malformed JSON or invalid partner success envelopes show an error and never claim success.
4. Edit, clear, error, navigation or a newer run prevents a late response, history write or cleanup from restoring or overwriting another run.
5. A finding's side badge and navigation remain correct when a textual message prefix is absent or changed.
6. Built-in dialect acceptance matches the authoritative registry; temporary dialects still work.

### User Story 3 — Partial failures remain observable (Priority: P2)

Analysts and operators distinguish complete analysis from failed validation families, logout persistence and catalog loading.

**Independent Test**: Isolated fault injection with synthetic data proves degradation, cleanup and recovery without production records or live notifications.

**Acceptance Scenarios**:

1. A throwing rule family leaves unrelated findings intact and adds a localized warning naming only the failed family.
2. Failed durable logout deletion still clears local session state/cookie and becomes observable to the route handler.
3. A repaired catalog file is readable on a later request without process restart; its initial failure is observable.
4. Paired analysis exposes each side's type/version/status/findings structurally while preserving the combined envelope.

### User Story 4 — Maintenance evidence remains trustworthy (Priority: P2)

Maintainers can run isolated verification without killing another run, inspect the original failed attempt after a retry, and trace every cleanup closure.

**Independent Test**: Simulate concurrent browser groups and failed-first attempts; run lint, export compatibility and assertion-inventory checks.

**Acceptance Scenarios**:

1. One test run's cleanup cannot signal another run's browser.
2. A passing retry retains the original failure and is not labeled environmental without evidence.
3. Re-enabled lint rules catch future dead assignments and cause-less rethrows.
4. Legacy IDs and public VAST timeline exports remain compatible and accurately documented.
5. CL-08/09 receive concrete cited dispositions; unimplemented proposals are never counted as fixes.

### Edge Cases

Multiple/reordered seats/items and duplicate IDs; malformed collection members; normative AdCOM fields versus copied 2.x fields; zero/negative/absent/nonfinite/nonnumeric prices and floors; matched/unmatched deals and currencies; mixed vendor arrays and alias precedence; aborted navigation, delayed completions, duplicate JSON keys and repeated mounts; absent Chrome, family faults, catalog repair and persistence errors.

## Requirements

### Functional Requirements

- **FR-001**: Reconcile each of the original 26 open IDs, the extra floor defect and CL-08/09 with separate evidence and honest dispositions.
- **FR-002**: Apply eligible impression plugins to normative 3.0 placement/item facts, preserving original paths and explicit consumer/version boundaries (`scattered-format-01`, `CL-02`).
- **FR-003**: Align redirect/value-feed recognition and validation; distinguish supported in-page materials and preserve vendor precedence (`scattered-format-02/05/08`).
- **FR-004**: Share the documented pop-signal vocabulary while retaining additional corroborating signals (`scattered-format-06`).
- **FR-005**: Share price classification without removing diagnostics; flag negative effective floors and suppress satisfied-floor claims for unusable floors (`scattered-format-03`, `negative-floor-unflagged`).
- **FR-006**: Contain baseline/plugin family faults consistently with a localized degraded-analysis warning and unaffected findings (`fallbacks-silent-02`).
- **FR-007**: Give analysis explicit generation/cancellation identity and one reset ownership path; preserve selected material/source identity (`CL-04`, UI portion of `CL-02`).
- **FR-008**: Restore onboarding, accessible toast feedback and exhaustive partner failure handling (`dom-css-fragile-001`, `fallbacks-silent-03/06`).
- **FR-009**: Surface logout persistence failures after local cleanup; make catalog failures observable and recoverable (`fallbacks-silent-04/05`).
- **FR-010**: Prevent built-in dialect registry drift without rejecting temporary dialects (`dup-core-ui-003`).
- **FR-011**: Add per-side analysis results and structured side rendering while retaining legacy combined fields and message compatibility (`dup-core-ui-005`, `CL-05`).
- **FR-012**: Restrict test cleanup to owned processes; retain first failures, accurate retry labels and explicit missing-browser behavior (`CL-06`).
- **FR-013**: Correct all violations and re-enable the two disabled lint rules; remove cited dead CSS/fallback/locale keys; correct comments and document retained exports/ID naming (`dead-stale-01/02/03/04/05/06/07`, `CL-07`).
- **FR-014**: Resolve CL-08/09 with concrete capability/assertion evidence, without inventing a runtime API or claiming untested coverage.
- **FR-015**: Preserve deterministic output, EN/UK/RU parity, public IDs, privacy boundaries and normative corpus outcomes; explicitly decide additive/degradation contract changes.
- **FR-016**: Deliver through repository, corpus, browser, hosted package/Docker, verified backup and exact-SHA production gates.

### Key Entities

- **Cleanup record**: original claim, current evidence, acceptance condition and disposition.
- **Auction/material view**: original input identity/path, version facts and consumer eligibility; transient only.
- **Analysis run and side**: generation, lifecycle, current inputs/material, request/response type/version/status/findings and source locations.
- **Verification attempt**: owned processes, attempt number, original outcome and retained evidence.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All original 26 open records have completed evidence-backed dispositions; the extra floor defect and two unverifiable proposals are individually resolved.
- **SC-002**: Every changed behavior has a regression assertion; dead/comment/documentation changes instead carry explicit static-evidence rationale where appropriate.
- **SC-003**: Existing normative corpus outcomes stay normative on all applicable layers; no new suppression or known gap manufactures closure.
- **SC-004**: Concurrent verification preserves unrelated processes; a passing retry never erases the failed attempt.
- **SC-005**: Required release gates pass and production version/image/commit are verified.

## Assumptions

- Baseline: `2bd93d6`, app 1.21.0/Core 0.46.0/CLI 0.1.3. Old cleanup-header dates/counts are historical claims to reconcile.
- Four already fixed items and superseded CL-03 are retained without counting them as new repairs.
- Scoped definitions of done govern: price consolidation retains legacy diagnostics; VAST timeline documentation does not authorize a new Inspector playback feature.
- Candidates in the inventory's dropped/rejected section remain outside this set.
- No registry publication, production-data inspection, migration/restore, dependency upgrade or new external service is required.
