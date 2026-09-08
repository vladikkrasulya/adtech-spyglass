# Tasks: Preview Identity for Redirect Pops and In-Page Push Carriers

**Feature**: [029](./spec.md) | **Plan**: [plan.md](./plan.md) | **Status**: Complete

## Phase 1 — Diagnosis

- [x] T001 [US1] Locate the DEF-245 failure by measuring the rendered geometry rather than reading
      the code path: confirm `.preview-text-body` carries the destination string while its own
      client rectangle has zero width, and trace that width to `--bid-w` published by `setDims`
      before the redirect branch appends the note (FR-001).
- [x] T002 [US2] Read `packages/core/dialects/inpage-push.js` and record its claim predicate and its
      six-role alias table as the contract this feature mirrors (FR-003, FR-004).
- [x] T003 [US2] Measure the claim predicate across every corpus case before changing code, and
      record how many bids in the corpus it reaches (FR-005).

## Phase 2 — Implementation

- [x] T004 [US1] Branch `setDims(300, 250)` on the redirect-script path in `public/ortbtools.app.js`,
      before the note is appended, leaving the frame's own zero-footprint inline style untouched
      (FR-001, FR-002).
- [x] T005 [US2] Add the nested In-Page Push carrier resolver to `public/ortbtools.app.js`: the
      dialect's claim predicate, its alias table, and normalisation into the push renderer's
      canonical field names, carrying only roles that are actually present (FR-003, FR-004).
- [x] T006 [US2] Wire the resolver into both creative-resolution paths — the primary analysis path
      and the per-bid selector — after the existing flat-material lookup fails, leaving
      `isPushMaterialShape` untouched (FR-003, FR-005).

## Phase 3 — Corpus ground truth

- [x] T007 [US1] Remove the DEF-245 gap block from the four pop cases and delete the record from
      `tests/corpus/known-gaps/pop-ext.json` (FR-006).
- [x] T008 [US2] Correct the In-Page Push cases' expected preview state to the specification-grounded
      target and narrow their remaining signatures to the format-tagging deviation alone (FR-006).
- [x] T009 Record both resolutions in the [020 defect ledger](../020-ad-format-verification-matrix/defects.md).
- [x] T010 [US2] Restore the in-page empty-preview coverage cell the corrected expectations vacated,
      with a case rather than a reclassification: `cover-preview-inpage-no-bid`, the in-page member
      of the existing per-format no-bid preview family (FR-007, SC-005).

## Phase 4 — Verification

- [x] T011 [US1] Run the four pop cases at the browser layer and confirm they pass normatively,
      sandbox refusals included (SC-001).
- [x] T012 [US2] Run the five In-Page Push cases at the browser layer and confirm the card, the
      per-role placement and the remaining format-tag deviation (SC-002).
- [x] T013 Run the full corpus at every layer and confirm no other case changes verdict (SC-003).
- [x] T014 Run the complete repository gate through the pre-push hook (SC-004).
