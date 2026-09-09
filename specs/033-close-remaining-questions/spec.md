# Feature Specification: Close the remaining product questions

**Feature Branch**: `codex/close-remaining-questions-20260909`
**Created**: 2026-09-09
**Status**: In Progress
**Input**: After the owner was told that 032 closed a named inventory but left logout revival, an unexplained browser timeout, Cloudflare injection, coverage gaps and four deferred product directions, the owner explicitly requested: “Чувак, треба закрити все(”. This resumes those directions and requires delivered behavior and executed evidence, not another zero obtained by moving entries elsewhere.

## User Scenarios & Testing

### User Story 1 — A signed-out session stays signed out (Priority: P1)

A user can leave the account without an old cookie silently becoming valid after a server restart. Storage failure must produce a safe outcome and truthful feedback.

**Why this priority**: The remaining failure affects account access.
**Independent Test**: Reuse an old synthetic cookie across actual process restarts with controlled storage faults, alongside another user's legitimate session.

**Acceptance Scenarios**:

1. Given a valid session, when logout succeeds, then that cookie is rejected immediately and after restart.
2. Given failure to delete the session row, when durable revocation succeeds, then the old cookie remains rejected after restart while unrelated sessions survive an orderly restart.
3. Given failure of both deletion and revocation persistence, when the process exits unexpectedly, then previously uncertain sessions cannot be accepted after recovery; authentication remains unavailable if safety cannot be established.
4. Given an ordinary orderly restart, then active sessions remain usable. First installation or lost recovery state may require a new login, with this availability consequence explicitly documented.
5. Given password reset or account-wide invalidation, then no alternate old-session path bypasses the same boundary. Returning to the prior application image must not make newly issued raw cookies usable there.

### User Story 2 — Analysis tests follow completed user actions (Priority: P1)

Delayed sample loading must not make the verification suite assert that an analysis was run when it was never requested with populated inputs.

**Independent Test**: Hold a synthetic sample response beyond the old pause, load through the real menu, and run the original clear/error scenarios after observable readiness.

**Acceptance Scenarios**:

1. Given a delayed sample, then the test waits for that sample to populate both editors before Analyze, and the verdict appears.
2. Given an actual failure to load or analyze, then verification fails with bounded stage diagnostics and retains the initial failure. Longer sleeps, hidden retries and weakened clear assertions do not satisfy this story.

### User Story 3 — The public page has consistent analytics and security configuration (Priority: P1)

Public navigation should not receive an automatically injected analytics script that the site's own policy refuses.

**Independent Test**: Read the site's saved edge setting and the actual browser HTML response, then check the console with the existing application policy.

**Acceptance Scenarios**:

1. Given automatic Cloudflare Web Analytics injection, when it is disabled for this site, then fresh browser responses contain no injected beacon and its CSP refusal disappears.
2. Existing application security policy, first-party telemetry and unrelated domain settings retain their behavior.

### User Story 4 — Saved examples and history work across the supported interface (Priority: P1)

Users can save, unlock, reload, inspect and manage examples and history with readable controls across desktop browsers, zoom levels and the recorded device matrix.

**Independent Test**: Exercise synthetic account data and history through actual browser flows, including two tabs, reload and storage-quota failure.

**Acceptance Scenarios**:

1. Saved Library and Inspector drawer cover empty, encrypted locked/unlocked, legacy, long-title, filtered and failed states; load/edit/delete/navigation preserve the selected record and account boundary.
2. The 50-entry history ring retains its documented reload/two-tab/quota behavior for the corpus's formats and contexts; clearing history does not save or delete unrelated server records.
3. Native Chromium, Firefox and Safari checks exercise the recorded desktop matrix; actual browser zoom covers 100/125/150/200/400 percent, with keyboard-visible controls and bounded layouts.
4. Actual screen-reader and available physical-device journeys have recorded observations. Emulation, CSS scaling and computed accessibility names are labeled as such and cannot satisfy an unrun native check.
5. Every requested but unavailable execution remains explicitly open with the exact missing prerequisite; it cannot become a successful checklist item.

### User Story 5 — A mapping can describe a field independently of its value (Priority: P2)

An operator can explicitly save a role for every value at one normalized extension path in one dialect, see its scope, replace or remove it and transfer it through export/import.

**Independent Test**: Save through the browser and real temporary account store, reload, analyze different values and verify exact overrides and another user's isolation.

**Acceptance Scenarios**:

1. Exact-value scope remains the default and wins over a field-scope fallback. Only the nine non-format roles allow field scope.
2. A field-scope identifier or credential mapping does not persist the observed sensitive value. Existing exact rows, labels and arbitrary metadata retain their old interpretation.
3. Readback, editing, removal, default-dialect selection, cache invalidation and versioned import/export agree about scope. Malformed or unsupported import is atomic and does not alter existing mappings.
4. Mappings answer the relevant extension question without suppressing standard failures or manufacturing a format from an arbitrary value. The defined account/format matrix supplies executable evidence.

### User Story 6 — Explicit asset loading preserves the selected creative (Priority: P2)

A signed-in operator can inspect the selected creative's raster-resource inventory, explicitly load those resources and understand partial failures without changing the selected creative or losing its styling.

**Independent Test**: Use synthetic raster fixtures in push, Native and banner previews; verify pixels, document styles, network boundaries, retries and cancellation.

**Acceptance Scenarios**:

1. Push icon/hero, Native images, banner images/posters, responsive image sources and embedded/inline CSS image references load only after the explicit action; document head/styles and selected identity survive.
2. Duplicate resources are fetched once; limits and per-resource failure states are visible; retry requests only unresolved resources in the current selection.
3. Edit, clear, selection replacement or unmount cancels remaining work and ignores late responses. Probe identity, static analysis and reveal state remain attached to the current creative.
4. Scripts, remote stylesheets, fonts, frames, media bodies and creative destination URLs are not converted into implicit fetch or execution permissions. Private addresses, redirects, non-raster responses and oversized resources remain refused with meaningful feedback.

### User Story 7 — SChain inspection has grounded cross-field meaning (Priority: P2)

An operator can inspect structured or serialized supply chains and distinguish proven structural defects, repeated seller identities, conflicting copies and comparisons to explicitly declared sender context.

**Independent Test**: Validate positive and negative structured/serialized fixtures with source-linked rules across supported protocol envelopes.

**Acceptance Scenarios**:

1. Repeated seller identity and semantically conflicting valid copies receive precise findings; source paths remain accurate in current and historical placements.
2. A complete single-node chain, optional seller metadata, case-sensitive seller accounts and an app bundle that differs from a seller business domain do not receive invented violations.
3. The last-node comparison identifies a mismatch to an explicitly declared sender; absent or invalid context never becomes inferred actual-sender evidence.
4. The operator can inspect raw serialized chains and explicit query parameters without a network request. Encoding, duplicates and malformed fields have defined outcomes.
5. Video/CTV chain length is visible as a fact; an unsupported threshold alone does not turn a chain into a compliance violation.

### User Story 8 — Deferred dialect questions have executable evidence (Priority: P2)

The maintainer can reproduce the seven disputed classifications and twelve previously confounded cases against the retained pinned adapters, and assess relevance to an explicitly declared route profile.

**Independent Test**: Execute all nineteen frozen witnesses without network access and test declared profile selection with absent, invalid and conflicting context controls.

**Acceptance Scenarios**:

1. Every one of the seven named disagreements has a direct adapter witness and a resulting supported corpus disposition, retaining historical evidence.
2. Every one of the twelve cases has an isolated trigger and legitimate control; transformations use a declared transformation oracle rather than silently weakening the old auction oracle.
3. Route relevance is explicitly named declared-route relevance and carries adapter/profile, direction, revision and declared provenance. It does not claim to measure actual traffic.
4. Missing, unknown or incompatible context remains unknown; free-form partner labels, endpoint guesses or payload contents cannot silently supply a route.

### Edge Cases

- Interrupted revocation writes, corrupted recovery files, expired/unknown cookies, concurrent requests during shutdown and an older application image.
- Slow/failed sample fetches, analysis cancellation and stale asynchronous completions.
- Exact-null/literal-wildcard legacy mappings, duplicate field mappings, unsupported versions and account switching.
- Full HTML documents versus fragments, encoded image URLs, responsive/CSS grammar, resource caps and partially completed asset batches.
- Key-order versus node-order differences, absent optional SChain fields, malformed encodings and repeated query parameters.
- Browser storage exhaustion, two-tab events, protected browser automation, missing real devices and screen-reader observations.

## Requirements

### Functional Requirements

- **FR-001**: Track all eight stories and each named historical residual in one per-item ledger; closure requires the intended outcome and evidence.
- **FR-002**: Prevent session revival under deletion failure and tested restart/crash paths, including account-wide invalidation and safe handling of untrusted recovery state.
- **FR-003**: Preserve normal orderly session continuity and document bounded first-installation/uncertain-recovery login loss; fail closed when safety cannot be established.
- **FR-004**: Replace sample-loading timing assumptions with observable readiness and deterministic delayed-response regression, retaining failure evidence.
- **FR-005**: Remove the site's unintended automatic beacon injection and verify actual browser responses without broadening security policy.
- **FR-006**: Add and execute the saved-library/history/account-dialect matrices with synthetic data, reload, two-tab and quota controls.
- **FR-007**: Execute recorded Chromium/Firefox/Safari, native zoom, screen-reader and available real-device checks; unavailable checks remain open.
- **FR-008**: Expose explicit exact/field mapping scope with exact precedence, nine-role restriction, account/default-dialect isolation and immediate cache invalidation.
- **FR-009**: Preserve legacy mapping semantics, provide atomic versioned import/export/edit/delete, and avoid storing the observed value for field scope.
- **FR-010**: Support explicit selected-creative raster loading for push/Native/banner, responsive and inline/embedded CSS image references while preserving styles and identity.
- **FR-011**: Provide resource inventory, limits, partial error/retry and cancellation; retain current authentication, raster, SSRF, sandbox, probe and privacy boundaries.
- **FR-012**: Implement grounded SChain duplicate/copy/declared-sender checks, supported locations and operator-visible serialized inspection; preserve valid single-node and optional-field behavior.
- **FR-013**: Surface factual video/CTV chain length without unsupported compliance thresholds or inferred seller ownership.
- **FR-014**: Execute all seven disagreement and twelve inconclusive adapter witnesses against pinned verified sources with network disabled; preserve the original audit history.
- **FR-015**: Deliver declared-route relevance using typed profile/direction/revision/provenance, explicit unknown states and no fabricated traffic observations.
- **FR-016**: Record compatibility/privacy decisions before implementation; maintain deterministic Core, stable legacy IDs, account boundaries and EN/UK/RU meaning.
- **FR-017**: Retain failed attempts, source hashes, measured coverage and real blockers; neither a retry nor an accepted design decision proves unexecuted behavior.
- **FR-018**: Run focused and full required gates, independent convergence, exact hosted verification, fresh verified backup and canonical deployment; update current records with actual outcomes.

### Key Entities

- **Session recovery record**: bounded durable evidence needed to decide whether persisted session state remains trustworthy.
- **Mapping scope**: exact value or one normalized path within one account dialect, with explicit role and version.
- **Creative resource manifest**: selected-creative identity, resource roles/hosts, limits and individual load outcomes.
- **Declared inspection context**: explicitly supplied sender or route/profile identity with provenance and applicability.
- **Witness record**: original question, pinned source, synthetic trigger/control, oracle and measured outcome.
- **Execution matrix record**: user journey, browser/device/zoom/locale/theme, observed result and artifact or unresolved prerequisite.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Old synthetic cookies are rejected in every specified logout/fault/restart control; ordinary orderly continuity remains verified.
- **SC-002**: The held-sample regression completes the original user journey on its first attempt; any later failure retains diagnostic evidence.
- **SC-003**: Fresh public-browser pages have no unintended analytics injection/refusal after the saved setting change.
- **SC-004**: Every specified mapping and asset user journey passes with all three locales and independent account/selection controls.
- **SC-005**: All nineteen dialect witnesses and all defined SChain positive/negative controls have explicit measured outcomes and supported dispositions.
- **SC-006**: Every required matrix cell is either executed successfully or remains visibly open; no total-closure claim is allowed while a required cell is missing or failing.
- **SC-007**: Release and records agree on the deployed version/commit, passed gates and any remaining blocker.

## Assumptions

- “Everything” resumes the residuals and four product directions explicitly presented immediately before this request. It does not restart owner-cancelled model experiments or authorize registry publication, unrelated governance products or arbitrary third-party access.
- The owner authorizes the necessary implementation and routine verification. Existing privacy, synthetic-data and canonical release boundaries remain.
- Security and compatibility determine implementation choices. The revocation repair may require one initial login refresh and login loss after an uncertain crash, rather than retaining sessions whose safety cannot be proved.
- Explicit raster loading is the complete previously deferred preview outcome; automatic advertiser execution, wrapper fetching and broad network sandbox permissions are not introduced.
- The explicit declared-route alternative in 008 is selected; historical actual-traffic route measurements cannot be reconstructed from synthetic or unlabeled records.
- Desktop remains the priority. A CSS viewport is not a physical display/device claim; native browser, screen-reader and device executions require their actual environments.
- Execution constraint added by the owner on2026-09-09: run all further browser tests on vkbox, without opening or controlling browsers on the owner's laptop. Preserve completed native-macOS evidence; remaining Safari, VoiceOver and physical-device cells stay explicitly open when the server cannot provide their actual environment.
