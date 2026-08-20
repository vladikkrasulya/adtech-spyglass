# Specification Quality Checklist: Dialect Signal Labeller

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No unresolved clarification markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before clarification or planning.

### Deliberate exception to "no implementation details"

The **Record Order** and **Constitution and ADR Exceptions** sections name commits, file paths, and
ADRs. This is not requirement leakage; both sections exist because the constitution's Governance
clause requires a feature spec to name the rule it violates and document the evidence, and because
this package was written after the work shipped and must not carry a date implying otherwise. The
requirement, entity, and success-criteria sections — the parts that drive planning — carry no
technology names.

### Two success criteria were rewritten during validation

The first draft failed **"Success criteria are measurable"** twice, and the failures were the same
kind: a claim that reads as a measurement but cannot be checked.

- **SC-002** originally read "the majority of unknown signals are answered without consulting a
  model". Nobody has measured that share against real traffic, and the only sample available — the
  calibration bench — is deliberately skewed toward hard cases, so quoting it would have been
  misleading. Rewritten as the binary property that actually holds and can be tested: a signal the
  deterministic table can answer is never sent to a model.
- **SC-005** originally read "a proposal arrives within a few seconds". "A few" is not a threshold.
  Rewritten around the property that matters to the operator: every request ends in a stated
  outcome, and none waits indefinitely.

### No clarification was needed

The feature is already built, so every question a greenfield spec would have to ask has an answer in
the implementation. That makes this package unusually cheap to write and is precisely why it is not
evidence that the process was followed — the ordering the constitution asks for exists so the spec
can shape the code, not describe it afterwards.
