# Data Model: Spec Kit Foundation

The feature stores no application or user data. Its entities are version-controlled knowledge and
workflow artifacts.

## Constitution

- **Identity**: `.specify/memory/constitution.md`
- **Fields**: semantic version, ratification date, amendment date, principles, project constraints,
  delivery workflow, governance rules, sync impact report
- **Rules**: exactly one live constitution; no unresolved placeholders; every amendment records an
  impact and valid SemVer change
- **Relationships**: governs every baseline, feature plan, task set, and review

## Platform Baseline

- **Identity**: `specs/000-platform-baseline/`
- **Fields**: as-built specification, architecture plan, evidence/research, system entities,
  validation quickstart, contracts, maintenance tasks/checklist
- **Rules**: describes current behavior only; a feature altering a baseline contract updates it in
  the same change
- **Relationships**: indexed by `specs/README.md`; referenced by the constitution, roadmap, features,
  and ADRs

## Feature Package

- **Identity**: `specs/NNN-short-name/`
- **Fields**: status, prioritized user stories, acceptance scenarios, FR/SC identifiers, plan,
  research, data model when relevant, contracts, checklist, ordered task IDs, evidence
- **Rules**: ready work has no unresolved clarification; implementation requires spec + plan + tasks;
  completed tasks remain traceable and convergence is append-only
- **State transitions**: Draft → Ready → In Progress → Verification → Complete; Blocked and Superseded
  are explicit terminal/holding states with rationale
- **Relationships**: one roadmap item can point to one owning feature; tasks map to requirements and
  user stories

## Decision Record

- **Identity**: `specs/decisions/ADR-NNN-short-name.md`
- **Fields**: status, date, context, decision, alternatives, consequences, related contracts/features
- **Rules**: accepted decisions are immutable except for a clearly marked amendment; reversal creates a
  superseding ADR
- **Relationships**: indexed by `specs/DECISIONS.md`; referenced from baseline/feature plans

## Roadmap Item

- **Identity**: stable row or heading in `specs/ROADMAP.md`
- **Fields**: priority, status, owner artifact, dependencies, next evidence/gate
- **Rules**: current work only; no duplicated architecture or historical stage narrative
- **Relationships**: points to a feature, assessment, or ADR that owns details

## Integration Adapter

- **Identity**: generated skill/command file plus its upstream manifest or repository-pinned integrity
  hash
- **Fields**: integration name, Spec Kit version, invocation convention, managed or pinned file hashes
- **Rules**: generated only through the pinned CLI; never hand-edited; core output must remain
  manifest-clean, approved extension output must match its offline integrity pins, and supported
  integrations must be multi-install-safe and status-clean
- **Relationships**: resolves commands that read the shared constitution and current feature package

## Assessment

- **Identity**: `.specify/assessments/<slug>/`
- **Fields**: intake, research, problem, concept, decision
- **Rules**: synthetic/redacted inputs only; evidence and counter-evidence; no source-code mutation;
  only a `go` decision hands off to a feature specification
- **State transitions**: Intake → Research → Defined → Shaped → Go / Clarify / Park / Kill

## Document Ownership Matrix

Each concern has exactly one owner. Other artifacts link to the owner and add only concern-specific
context.

| Concern                                         | Owner                                  |
| ----------------------------------------------- | -------------------------------------- |
| Normative rules                                 | Constitution                           |
| Current as-built system                         | Platform baseline                      |
| Scoped change intent/progress                   | Feature package                        |
| Durable rationale                               | Decision record                        |
| Current order/status                            | Roadmap                                |
| Public privacy/security/operations/API promises | Retained conventional contract         |
| Actual implementation evidence                  | Code, schema, tests, runtime telemetry |
