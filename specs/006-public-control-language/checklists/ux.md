# UX Requirements Checklist: Public Control Language

**Purpose**: Review the clarity, completeness, consistency, and measurability of the UI-control
requirements before release
**Created**: 2026-08-20
**Feature**: [spec.md](../spec.md)

**Depth**: Formal release gate
**Audience**: PR/release reviewer
**Focus**: Visual hierarchy, responsive completeness, accessibility, locale/theme parity

## Requirement Completeness

- [x] CHK001 Are all control roles and applicable interaction states explicitly enumerated?
      [Completeness, Spec §FR-002–FR-003]
- [x] CHK002 Are standalone shells, SPA chrome, route modules, and modal surfaces all included or
      explicitly excluded? [Completeness, Spec §FR-001, §FR-007–FR-013]
- [x] CHK003 Are requirements present for keyboard, touch, and assistive-technology users rather than
      pointer-only interaction? [Completeness, Spec §FR-012–FR-014]
- [x] CHK004 Are EN, UK, RU, light theme, dark theme, phone, compact desktop, and full desktop contexts
      covered? [Completeness, Spec §FR-004, §FR-006, §FR-014]

## Requirement Clarity

- [x] CHK005 Is the distinction between primary, secondary, destructive, ghost, selection, and
      disclosure roles unambiguous? [Clarity, Spec §FR-002]
- [x] CHK006 Are “cohesive”, “tidy”, and “concise” translated into objective state, geometry,
      contrast, and hierarchy requirements? [Clarity, Spec §FR-002–FR-005]
- [x] CHK007 Are phone, compact-layout, and desktop popup directions stated without an ambiguous
      “responsive” fallback? [Clarity, Spec §FR-009]
- [x] CHK008 Is the supported viewport floor and allowed rounding tolerance quantified? [Clarity,
      Spec §FR-014, §SC-001–SC-002]

## Requirement Consistency

- [x] CHK009 Do responsive requirements preserve the same jobs and selected values instead of
      silently removing functionality? [Consistency, Spec §FR-008–FR-011]
- [x] CHK010 Are route-specific refinements consistent with the shared semantic role contract?
      [Consistency, Spec §FR-001–FR-003]
- [x] CHK011 Do locale requirements preserve meaning while permitting label-length-specific layout
      adaptation? [Consistency, Spec §FR-006, Edge Cases]
- [x] CHK012 Does the 1.14.3 release requirement agree with the declared compatible app-only scope?
      [Consistency, Spec §FR-016, Assumptions]

## Acceptance Criteria Quality

- [x] CHK013 Can viewport fit, overlap, gutter, popup direction, and pointer-hit requirements be
      measured objectively? [Measurability, Spec §SC-001–SC-004]
- [x] CHK014 Is the required text contrast threshold quantified for both themes? [Measurability,
      Spec §FR-004, §SC-006]
- [x] CHK015 Is keyboard completion defined by reachability, activation, visible focus, and focus
      restoration rather than a vague accessibility claim? [Measurability, Spec §SC-005]
- [x] CHK016 Are release completion signals named without hard-coding a test count? [Acceptance
      Criteria, Spec §SC-007]

## Scenario and Edge-Case Coverage

- [x] CHK017 Are localized overflow, closed absolute popups, stacking/clipping, disabled hover, and
      reduced standalone CSS ownership addressed? [Coverage, Spec §Edge Cases]
- [x] CHK018 Are existing data, validation, API, privacy, authentication, Core, CLI, and unrelated
      assessment boundaries explicitly protected? [Scope, Spec §Assumptions]

## Notes

- All 18 requirement-quality items passed on 2026-08-20. No unresolved ambiguity warranted a user
  question because viewport, locale, semantic, compatibility, and release choices were already fixed
  by the user's implementation request and repository contracts.
