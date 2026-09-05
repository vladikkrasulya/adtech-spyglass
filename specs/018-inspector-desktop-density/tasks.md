# Tasks: Inspector desktop density

- [x] T001 (FR-006) Load project memory, specify bounded repair and analyze requirement/plan coverage.
- [x] T002 [US1] (SC-003) Capture synthetic baseline at 2560×1440 with context open and closed.
- [x] T003 [US1] (FR-001, FR-002, FR-003) Correct responsive typography and panel sizing; compact finding summaries.
- [x] T004 [US2] (FR-004, FR-005, SC-001, SC-002) Verify browser geometry, expanded details, editor alignment and controls across widths, locales and themes; inspect screenshots.
- [x] T005 (SC-004) Update baseline and app patch version; full CI and final convergence review.
- [x] T006 (SC-004) Prepare the canonical backup/deploy command with hosted-CI, exact-SHA and post-deploy readback guards.

## Dependencies and release tracking

T001 precedes implementation; T002 captures unchanged production-source CSS. T003 precedes T004. T005 gates the immutable candidate commit. T006 prepares release execution; it does not claim deployment before a commit exists. The actual push, hosted CI, fresh verified backup and deploy happen after this checklist is committed. Release completion is verified from the exact commit's CI, deployment state and the v1.19.3 tag, with final screenshots and readback in the delivery report. No production success is inferred from a checked preparation task.

## Evidence

See [verification.md](./verification.md) and [visual-evidence.json](./visual-evidence.json). The first full CI passed the runtime/browser checks but rejected the feature's lowercase status; the status and explicit FR task mapping were corrected before the final gate.
