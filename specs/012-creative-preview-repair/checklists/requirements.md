# Specification Quality Checklist: Creative Preview Repair — Wave 1

**Purpose**: Validate specification completeness before planning
**Created**: 2026-08-25
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details in user outcomes or success criteria
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions are identified

## Evidence Discipline

- [x] The regression is pinned to a commit and a date, verified by history search, not recalled
- [x] Each cause is cited at `file:line` against the working tree, not against the dossier that found it
- [x] Causes are ordered by whether each alone would produce the reported symptom
- [x] The eighth finding (quirks mode) is recorded with the command that demonstrates it
- [x] Options rejected under adversarial verification are recorded with their reasons, so they are not re-proposed
- [x] The mapped-address defect found in passing is named and bounded as a separate narrowing change
- [x] Mapped private targets, the permitted public control, and the zero-request boundary have a
      numbered requirement, measurable criterion, owning security contract, and focused tests

## Boundary Discipline

- [x] The wave boundary is stated in the spec header, with what is excluded and why
- [x] The privacy decision this wave does **not** take is named explicitly
- [x] The constitutional constraint on the sandbox is cited and marked out of scope for all waves
- [x] The owner's accepted risk for wave 2 is recorded as not applying to wave 1

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Validation run 2026-08-25. Three items failed on the first pass and were corrected before this file
was written:

1. **Success criteria carried implementation detail.** An earlier SC named the
   `securitypolicyviolation` event as the measurement. Rewritten as SC-008, which states the outcome
   the owner needs — being able to name the refused kinds and hosts from the interface — without
   naming the mechanism. The mechanism belongs in `plan.md`.
2. **The refusal ledger was under-specified against a real failure mode.** The first draft asked only
   for a count. Adversarial review established that a creative emitting hundreds of refusals through
   the existing behaviour transport would displace genuine behaviour events, which is an
   evidence-eviction primitive rather than a cosmetic bug. Now FR-009 and an edge case, both testable.
3. **Double counting was not addressed.** The `srcdoc` document is governed by two overlapping
   policies, so one refused resource can be reported twice. Now FR-008 and an edge case.

No `[NEEDS CLARIFICATION]` markers were needed. The two decisions that would have warranted them —
which wave to take, and whether a server-side fetch on an explicit click is acceptable — were put to
the owner before the package was opened and are recorded in Assumptions.

## Cross-artifact analysis, 2026-08-25

Two independent read-only passes over the finished package: consistency across artifacts, and
verification of every technical claim against the code. Both returned `fix-first`. Eleven findings,
all resolved before implementation began.

Substantive:

- **The classifier was wired only ahead of the catch-all.** As first written, `tasks.md` widened the
  native gate and left the inline VAST regex in place, which would have left three detectors where the
  plan claimed one — and FR-003's delegation would never have reached the real render path. The
  classifier now replaces all three detections; `plan.md` Design §1 states this explicitly.
- **SC-008 was not answerable by anything the package built.** It promises the owner can say which
  resource _kinds_ are being refused; FR-007 delivered only a count and a host list, though the
  frame-to-parent payload already carried the directive. FR-007 now requires the kind breakdown, and
  T010 renders it. This is the wave 2 decision input, so its absence would have defeated the wave's
  stated purpose.
- **FR-017 mandated a mechanism the design deliberately rejects.** It said identifiers "MUST be
  escaped", while decision D4 removes the escaping helper in favour of `textContent`. Reworded to state
  the outcome; a literal reading can no longer be taken as requiring `escapeHtml()`.

Evidence corrections, all in `research.md` §1 — recorded rather than quietly fixed, because Principle
II is the reason the package is trusted:

- The `git log` invocation printed in §1 **did not reproduce**. The directive lives inside a JavaScript
  string with backslash-escaped quotes, so the pickaxe search as written matched nothing and would have
  read as "no such commit". Replaced with an invocation verified against a real run. The conclusion it
  supported was independently correct; the evidence for it was not.
- The pre-change state was cited against a file under the retired brand name — a file that no longer
  existed at `adfaccd`, having been renamed to `public/ortbtools.app.js` in `29262b9` a month earlier.
  It is now cited at `adfaccd^:public/ortbtools.app.js:881`, with the initial-commit shape noted
  separately.
- `console.error` cited at `:1398`; it is at `:1400`.

Mechanical: terminology standardised on `unidentified`; two `[P]` markers removed from tasks that
edited the same locale file; missing file paths added to four tasks; the target test file named in
T022; Phase 2 reordered so the script tag precedes the module that needs it.
