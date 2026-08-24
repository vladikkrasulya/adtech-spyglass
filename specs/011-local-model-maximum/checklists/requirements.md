# Requirements Checklist: Local Model Maximum v3

**Purpose**: verify the specification is complete and testable before and during implementation.
**Created**: 2026-08-23

## Completeness

- [x] CHK001 Every FR maps to a user story or an edge case (FR-001…FR-013 ↔ US1…US5, Edge Cases).
- [x] CHK002 Every SC is measurable and names its instrument (runner summary, `check.py`,
      `recall.py`, router result, sibling-stack tests).
- [x] CHK003 Two SC clauses explicitly marked reported-not-gated, with the owner's confirmation
      carried as an open question (SC-003 `dropped`, SC-005 macro-F1).
- [x] CHK004 Boundaries from the owner's package are carried verbatim in substance (no 008
      rewrite; no model download/delete before baseline; corpus by migration proposal only; no
      external LLM; no runner `num_ctx`/`keep_alive` on shared GPU; runs immutable; no secrets).

## Testability

- [x] CHK010 US1 acceptance is demonstrated by immutable runs with `SHA256SUMS` verified.
- [x] CHK011 US2 acceptance is demonstrated by `check.py` (39/39, idempotent, enums) and 15/15
      adjudications through the generated classifier.
- [x] CHK012 US3 acceptance is demonstrated by `recall.py` (360/364) with misses named.
- [x] CHK013 US4 acceptance is demonstrated by a no-deep router run with per-fact reasons and a
      cached second run; deep comparison still open (T030).
- [x] CHK014 US5 acceptance is demonstrated by both sibling-stack suites and smoke.

## Carried to tasks.md (progress, not specification quality)

- [x] CHK020 Owner confirmation of the two reframed SC clauses is an explicit open question in
      spec.md Assumptions and decision.md; tracked as T027 (dropped) and in the final report (T042).
- [x] CHK021 ADJUDICATION.md for the owner's reading is T017; spec.md FR-006 states the corpus is
      not mutated.
- [x] CHK022 Freezing manifests before tuning and opening holdout once are FR-007 and tasks
      T021/T041.
- [x] CHK023 The final report labelling every unmet gate is SC-012 and task T042.
