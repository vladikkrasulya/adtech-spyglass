# Tasks: One Selected Creative, One Reading of the Response

**Feature**: [031](./spec.md) | **Plan**: [plan.md](./plan.md) | **Status**: Complete

## Phase 1 — Reproduce, independently

- [x] T001 [US1] Reproduce the currency defect in a real browser on a payload written for this
      feature, not on the reporter's, and record the measured chip (FR-004).
- [x] T002 [US2] Reproduce the selection defect the same way, and record what the selector marked
      against what was rendered (FR-001, FR-003).
- [x] T003 [US3] Record the third symptom found while reproducing the second: a resolved material's
      own price never reaching the chip (FR-006).
- [x] T004 Establish what the corpus could and could not have caught: the price chip is measured by
      the harness and asserted nowhere (FR-007).

## Phase 2 — Make the regressions exist and fail

- [x] T005 [US1] Add `expect.preview.price` to the corpus contract and its oracle, and assert the
      currency on the existing OpenRTB 3.0 case that already carried EUR (FR-007, SC-001).
- [x] T006 [US2] Add the first heterogeneous multi-material case the corpus has ever had, asserting
      each material's kind, marker and price at its own index (SC-002, SC-003).
- [x] T007 Confirm both regressions fail for the right reason before any product change.

## Phase 3 — One definition

- [x] T008 [US1] Unwrap the OpenRTB 3.0 envelope on the request side as well, and read currency and
      every identifier from the unwrapped payload, using the field names the engine's own 3.0
      projection uses; leave empty what 3.0 does not define (FR-004, FR-005).
- [x] T009 [US2] Complete the resolver so the single-material shapes occupy the index space, and
      enumerate them as candidates (FR-002).
- [x] T010 [US2] Resolve the first enumerated candidate on the first render, and mark that same
      candidate in the selector (FR-001, FR-003).
- [x] T011 [US3] Move the price to one function that reads the resolved candidate (FR-006).
- [x] T012 [US2] Delete the now-duplicated resolution and price code from the analysis path.
- [x] T013 Render the In-Page Push call-to-action role the preview contract already listed (FR-009).

## Phase 4 — Honest guards

- [x] T014 [US4] Rebuild the corpus-wide reach guards on the corpus loader and on every material,
      carrying the same click-alias scope the resolver applies, and add a guard that the traversal
      itself is exhaustive (FR-008, SC-004).
- [x] T015 Strengthen the static wiring assertion so it pins the new invariant rather than the old
      hard-coded index (FR-001, FR-003).

## Phase 5 — Verification

- [x] T016 Measure the displayed price for every corpus case before and after, and judge each
      difference individually (SC-005).
- [x] T017 Re-run the independent browser reproduction and confirm all three symptoms are gone
      (SC-001, SC-002, SC-003).
- [x] T018 Run the full corpus at every layer (SC-005).
- [x] T019 Run the complete repository gate through the pre-push hook (SC-006).
