# Feature Specification: Ad format verification matrix

**Feature**: 020-ad-format-verification-matrix
**Created**: 2026-09-07
**Status**: Complete
**Input**: User requested comprehensive automatic request/response, creative rendering and UI/UX verification, 5–10 public-source examples per ad format, and a separate cleanup backlog. Codex continues Opus's saved work after its session limit.

## User Scenarios & Testing

### User Story 1 — Trust the request/response audit (P1)

As a maintainer I can run repeatable cases for banner, video, audio, native, push, pop and inpage, including relationships and invalid mutations, and distinguish correct behavior from known defects and uncovered combinations.
Acceptance: at least five substantive, nonprovisional pairs per format; every example has source attribution and independently reasoned expectations; Core and real HTTP results identify exact case/finding differences; unexpected differences fail.

### User Story 2 — Verify the creative and interaction (P1)

As a user I can see whether the expected creative is rendered, partially rendered, inert or unsupported, and whether all bids can be inspected. As a maintainer I can repeat UI checks across locales, themes and viewport sizes.
Acceptance: real Inspector Analyze action and preview measurements, creative identity assertions, per-bid accounting, honest media readiness/playback distinctions, EN/UK/RU × light/dark × desktop/mobile interactions, errors/loading/reset/stale state and keyboard checks. Unsupported bid selection is reported as a capability gap.

### User Story 3 — Decide what to fix and clean up (P2)

As the owner I receive coverage, verified defects, UI/UX observations and an independently prioritized cleanup backlog with reproductions and proposed follow-up work.
Acceptance: generated case/layer matrix and machine-readable results; explicit skipped/not-applicable/known-gap counts; defect evidence separated from contractual preview restrictions and untested combinations; cleanup items identify affected paths and verification needed.

## Requirements

- **FR-001**: Cover seven formats with 5–10 substantive pairs each; provisional vendor documentation does not count toward the minimum.
- **FR-002**: Preserve source URL/version/license, sanitization and adaptation notes; use only synthetic/redacted payloads and generated offline assets.
- **FR-003**: Exercise Core, real HTTP and real browser independently with named applicability; count no skipped or unasserted layer as pass.
- **FR-004**: Verify bid-to-impression references, reordered/multiple impressions/seats/bids, partial/no bids, prices/floors/deals/currency, required Native assets, media MIME/protocol/duration, malformed input and request/response-only flows. Include targeted 3.0, DOOH and DAAST probes and publish remaining cross-product gaps.
- **FR-005**: Keep normative expectations separate from observations. Known gaps require exact bounded signatures, ledger evidence, unexpected-failure guards and retirement guards outside expected-failure subtests.
- **FR-006**: Verify creative identity and measurable rendering, all-bid availability and distinct media readiness/playback. Respect existing CSP and sandbox contracts.
- **FR-007**: Check locale/theme/responsive/keyboard, loading/error/reset/reanalysis and source navigation; retain reproducible evidence and describe automation limits.
- **FR-008**: Produce coverage matrix, verification report, defect ledger and separate cleanup backlog. Provide a single command for the complete audit and fail missing-browser prerequisites for that command.
- **FR-009**: Run repository required checks; preserve product contracts and avoid unrelated runtime changes.

## Scope and assumptions

This deliverable is test infrastructure, source corpus and audit evidence. Product defects and cleanup proposals become separate follow-up work. No finite corpus proves all possible payload combinations; coverage is bounded and enumerated. Video/audio playback is not promised by the currently inert VAST preview. Browser restrictions are capability limits unless behavior contradicts a stated contract. Public examples are adapted with provenance; no captured customer traffic or live ad execution.

## Success Criteria

- **SC-001**: All seven minimum counts pass corpus validation, with unique case IDs and nonempty semantic expectations.
- **SC-002**: Every executable case/layer has an explicit outcome; novel deviations, missing prerequisites and stale known gaps fail the dedicated audit.
- **SC-003**: All admitted creative cases and 12 locale/theme/viewport scenarios have recorded browser outcomes.
- **SC-004**: Every verified defect and cleanup item has affected behavior/path, evidence and a follow-up validation criterion; full CI outcome is recorded accurately.
