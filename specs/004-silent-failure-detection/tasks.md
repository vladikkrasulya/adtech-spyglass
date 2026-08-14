# Tasks: Silent Failure Detection

**Status**: Complete · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

> Recorded after implementation. Each task names the commit that closed it and the requirements it
> carries.

- [x] T001 [US1] Read the query verbatim and warn when decoding destroys a value — FR-005 (`9e47839`)
- [x] T002 [US2] Give `decodeRequest` a reason instead of a second meaning for `null` — FR-006 (`03a099a`)
- [x] T003 [US1] Recognise a feed URL whatever case the paste arrived in — FR-004 (`1af4921`)
- [x] T004 [US1] Close the same verbatim-query defect in the clickunder decoder — FR-005 (`6c44582`)
- [x] T005 [US2] Refuse a scheme that cannot be fetched, and name it — FR-006 (`97067f9`)
- [x] T006 [P] [US1] Build the input-repair layer, idempotent by construction — FR-002 (`a97af9c`, merged `3bc440b`)
- [x] T007 [US1] Run repair before parsing and report what it changed — FR-001, FR-003 (`71086db`)
- [x] T008 [US2] Surface refusal reasons through `detect` and `validate` — FR-006 (`6e31f28`)
- [x] T009 [P] [US3] Scan raw JSON for duplicate keys and unsafe numbers (`ad27956`)
- [x] T010 [US3] Report the control characters the scan tolerates (`1fb7a8d`)
- [x] T011 [US3] Keep one implementation of the raw scanner (`ca1f80a`)
- [x] T012 [P] [US4] Build the unknown-field detector (`16645be`, merged `3981ac4`)
- [x] T013 Reject raw control characters in tracked source (`dde49e2`, merged `eb22cf1`)
- [x] T014 [US3] Emit byte-scan findings and plumb the bytes to the validator — FR-007, FR-008 (`8760b78`)
- [x] T015 Stop pinning 2.6 on two fields the spec does not define (`e3dd7ae`)
- [x] T016 [US4] Emit findings for fields a receiver will ignore — FR-008, FR-009 (`a03d564`)
- [x] T017 [P] [US5] Build the TCF consent-string checker, offline and network-free — FR-010 (`83187cd`)
- [x] T018 [US5] Emit findings for a consent string that decodes into different consent — FR-008, FR-009 (`2f94756`)
- [x] T019 Record the research, the catalogue and its triage (`32d14ef`, `2759216`, `230c514`)
