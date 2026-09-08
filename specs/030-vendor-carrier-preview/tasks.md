# Tasks: Preview Identity for Vendor and AdCOM Carriers

**Feature**: [030](./spec.md) | **Plan**: [plan.md](./plan.md) | **Status**: Complete

## Phase 1 — Read the carriers from their own evidence

- [x] T001 [US1] Read the AdCOM Native object out of the OpenRTB 3.0 fixtures and record exactly
      which field names differ from oRTB Native 1.x (FR-002).
- [x] T002 [US2] Read the documented vendor Native and banner shapes out of the fixture provenance
      of the cases that need them, rather than from assumption (FR-003, FR-004).
- [x] T003 [US3] Establish what the identity measurement actually reads, so the fix targets the
      measured surface and not a plausible-looking one (FR-006).

## Phase 2 — Implementation

- [x] T004 [US1] Unwrap the OpenRTB 3.0 envelope in both creative-resolution paths (FR-001).
- [x] T005 [US1] Map an AdCOM `media.ad.display.native` creative onto the oRTB Native 1.x shape and
      feed the existing native renderer (FR-002).
- [x] T006 [US2] Add the documented vendor Native material resolver, behind the push gate (FR-003,
      FR-005).
- [x] T007 [US2] Add the documented vendor banner wrapper resolver, behind the same gate (FR-004,
      FR-005).
- [x] T008 [US3] Carry a material's own title and description to the preview as a separate value and
      print them above the destination in the inert-text block (FR-006).

## Phase 3 — Ground truth

- [x] T009 Measure every new predicate across all 257 corpus cases and keep the measurement as a
      standing test (FR-003, FR-004, FR-005).
- [x] T010 Retire the resolved signatures from the ten affected cases and remove the four ledger
      records (SC-001, SC-002, SC-003, SC-004).
- [x] T011 Correct the two format expectations the wire cannot support, and record the reason in
      [ADR-017](../decisions/ADR-017-format-tags-follow-the-wire.md) (FR-007).
- [x] T012 Record the resolutions in the [020 defect ledger](../020-ad-format-verification-matrix/defects.md).

## Phase 4 — Verification

- [x] T013 Run the ten affected cases at the browser layer and confirm each renders its own carrier
      (SC-001, SC-002, SC-003, SC-004).
- [x] T014 Run the full corpus at every layer and confirm no other case changes verdict (SC-005).
- [x] T015 Run the complete repository gate through the pre-push hook and confirm the ledger is
      empty (SC-006).
