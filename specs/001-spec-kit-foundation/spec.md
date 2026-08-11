# Feature Specification: Spec Kit Foundation

**Feature Branch**: `chore/spec-kit-foundation`

**Created**: 2026-08-11

**Status**: Complete

**Input**: User description: "Adopt GitHub Spec Kit completely so every supported agent knows how
to work, how the project works, what is already built, where it is going, and why durable decisions
were made; retire competing agent rulebooks and verify the migration with tests."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Agent Starts With One Canonical Context (Priority: P1)

As a maintainer delegating work to an AI coding agent, I want every supported agent to enter the same
governed workflow and read the same project memory so that results do not depend on whether I opened
Codex, Claude, Cursor, or Gemini.

**Why this priority**: Competing or tool-specific instructions are the root cause this migration must
remove. Without one canonical context, every other artifact can still drift.

**Independent Test**: Start each supported agent in a clean checkout, invoke the same context-bearing
core delivery phase, and confirm that it loads the constitution, whose routing rules require the
current roadmap, relevant platform baseline, and active feature, while every integration exposes the
same lifecycle commands without a root agent rulebook.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** a supported agent starts a context-bearing core delivery
   command, **Then** it reads one constitution and follows its route to the same canonical project
   artifacts.
2. **Given** multiple installed agent integrations, **When** their installation status is checked,
   **Then** every integration is healthy, multi-install-safe, and has no missing or modified managed
   files.
3. **Given** an arbitrary off-workflow prompt or a bundled assessment command, **When** no automatic
   context adapter is installed, **Then** the documentation distinguishes bounded pre-delivery
   assessment from the context-bearing core delivery path rather than claiming universal passive
   enforcement.

---

### User Story 2 - Maintainer Can Answer What, How, Why, and Next (Priority: P1)

As a maintainer or reviewer, I want a small, explicit project-memory tree that separates current
product behavior, architecture, contracts, decisions, and priorities so that I can find the answer
without reconciling several overlapping roadmaps and architecture files.

**Why this priority**: Agents cannot work predictably when current state, durable rationale, and
future intent are mixed in historical documents.

**Independent Test**: From the project-memory index, locate the current product surface, component
ownership, privacy boundary, release path, durable design decisions, and next priority using no more
than one index plus the named canonical artifact for each concern.

**Acceptance Scenarios**:

1. **Given** a question about current behavior, **When** the maintainer follows the memory index,
   **Then** the platform baseline or retained public contract provides one current answer.
2. **Given** a question about why a durable choice exists, **When** the maintainer follows the decision
   index, **Then** an accepted ADR records context, decision, alternatives, and consequences.
3. **Given** a question about what happens next, **When** the maintainer opens the roadmap, **Then** it
   contains only current status, dependencies, and priorities—not a second architecture history.

---

### User Story 3 - Change Moves Through a Complete, Auditable Lifecycle (Priority: P2)

As a maintainer, I want ideas and accepted changes to pass through explicit discovery,
specification, planning, tasking, analysis, implementation, verification, and convergence so that
scope, rationale, and evidence survive across sessions.

**Why this priority**: A directory tree alone does not improve delivery unless it is the working
memory agents update while they work.

**Independent Test**: Follow one real migration from constitution through a ready specification,
plan, contracts, tasks, implementation evidence, and convergence; verify that each phase can resume
from repository artifacts without relying on chat history.

**Acceptance Scenarios**:

1. **Given** an uncertain idea, **When** it enters discovery, **Then** evidence can produce a go,
   clarify, park, or kill decision before feature implementation begins.
2. **Given** accepted work, **When** it reaches implementation, **Then** its requirements map to
   executable tasks and all critical cross-artifact findings are resolved first.
3. **Given** completed tasks, **When** convergence runs, **Then** unmet work is appended traceably or
   the feature is reported clean without rewriting prior task history.

---

### User Story 4 - The Foundation Can Become a Reusable Fleet Standard (Priority: P3)

As the owner of multiple projects, I want this repository to prove a pinned, upgradeable Spec Kit
baseline that can later be packaged as an organization-owned preset, extension, workflow, and bundle
without importing unaudited community automation.

**Why this priority**: The first project should teach us the safe universal pattern, but distribution
must not make this migration riskier or silently execute tools across all repositories.

**Independent Test**: Reproduce the pinned setup in an empty fixture, compare managed integration
status and command coverage, and identify the remaining first-party automation work without changing
another real project.

**Acceptance Scenarios**:

1. **Given** the documented pinned release, **When** the setup is reproduced in a fixture, **Then** it
   creates the same canonical infrastructure and supported integrations.
2. **Given** a proposed community package or automatic workflow, **When** it has not passed a source
   and mutation-scope review, **Then** the foundation rejects it rather than installing it by URL.

### Edge Cases

- A supported agent integration is installed but its extension commands were not materialized.
- The local Spec Kit CLI is older or newer than the version recorded by the project.
- A generated core adapter no longer matches its manifest hash, or an approved extension adapter no
  longer matches its repository-pinned integrity hash.
- A new agent has no multi-install-safe integration or no native skill-discovery convention.
- An active feature is missing a plan, tasks, checklist, or requirement coverage.
- A retained public/runbook document conflicts with implementation evidence or a baseline contract.
- A specification accidentally includes production payloads, secrets, identifiers, or private URLs.
- Generated agent files enter formatting, lint, package, or Docker runtime contexts.
- The working tree already contains unrelated changes or work belongs to another active feature.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The project MUST have one versioned constitution containing all normative agent and
  delivery rules, with no competing root-level agent rulebook.
- **FR-002**: The project MUST expose a canonical memory index that routes readers to current product
  state, architecture, contracts, decisions, roadmap, and active features without duplicating those
  contents.
- **FR-003**: The project MUST provide an as-built platform baseline covering product surfaces,
  component ownership, data entities, privacy boundaries, public interfaces, locales, testing, and
  release/deployment behavior.
- **FR-004**: The roadmap MUST contain only current status, ordered priorities, dependencies, and
  links to their owning feature or decision artifacts.
- **FR-005**: Durable architectural and product choices MUST be recorded as indexed decisions with
  context, chosen outcome, alternatives, consequences, and related contracts.
- **FR-006**: Codex, Claude, Cursor, and Gemini MUST resolve the same core and approved extension
  lifecycle capabilities from generated adapters while sharing one canonical policy source. Core
  adapters MUST remain manifest-tracked; approved extension adapters MUST remain content-pinned by
  deterministic repository guards because Spec Kit does not include their rendered hashes in the
  integration manifests.
- **FR-007**: The setup MUST NOT install the agent-context extension, generic unsafe multi-install,
  community automation, URL-delivered extensions, or automatic Git mutation hooks. The bundled
  upstream workflow MAY remain as a managed compatibility artifact, but it MUST NOT be the canonical
  delivery path or be invoked automatically from CI, hooks, or a production worktree.
- **FR-008**: Uncertain ideas MUST have an evidence-oriented assessment route before delivery;
  accepted work MUST have an explicit full manual delivery route through convergence.
- **FR-009**: Tool-specific legacy rulebooks, duplicate live roadmaps, duplicate live architecture
  maps, and stale specialist-agent prompts MUST be retired after their valid knowledge is migrated.
- **FR-010**: Human-facing privacy, security, operations, API, release, and package documentation MUST
  retain conventional locations while linking to—not re-stating—the canonical governance and
  platform memory.
- **FR-011**: Automated repository checks MUST reject missing canonical artifacts, legacy rulebooks,
  unresolved live placeholders, incomplete active features, broken local links, unsupported agent
  configuration, and accidental runtime/package inclusion of generated governance files.
- **FR-012**: Generated Spec Kit and agent-adapter artifacts MUST be treated as package-owned output:
  excluded from repository formatting rewrites and runtime images, but checked against their
  upstream manifests or repository-pinned integrity hashes and for correct executable modes where
  applicable.
- **FR-013**: Specifications, assessments, decisions, and evidence MUST contain only synthetic or
  redacted data and MUST never become a store for secrets, payload bodies, personal identifiers, or
  private incident URLs.
- **FR-014**: The project MUST record the exact Spec Kit release and source revision used for the
  migration, plus a reviewed upgrade procedure that does not silently overwrite authored memory.
- **FR-015**: The migration itself MUST be represented by a complete Spec Kit feature package and
  pass the same analysis and verification gates it establishes for future work.

### Key Entities

- **Constitution**: Versioned normative rules and governance amendment history.
- **Platform Baseline**: Current as-built product, architecture, data, and interface contracts.
- **Feature Package**: Prioritized requirements, plan, design artifacts, executable tasks, and
  acceptance evidence for one bounded change.
- **Decision Record**: Durable rationale and consequences for an accepted or superseded choice.
- **Roadmap Item**: Current priority/status pointer to an owning feature or decision.
- **Integration Adapter**: Generated agent entry point with no independent policy; core files are
  manifest-tracked and approved extension output is repository-pinned by content hash.
- **Assessment**: Evidence funnel for deciding whether an idea should enter delivery.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A new supported agent can locate the governing rules, current baseline, active work, and
  durable rationale through at most one index hop per concern and without a root agent rulebook.
- **SC-002**: All four supported integrations report healthy multi-install status with zero modified,
  missing, invalid, or unchecked core-managed paths, expose identical approved lifecycle stages, and
  pass offline content-integrity checks for approved extension adapters.
- **SC-003**: The live project-memory tree contains zero unexplained template placeholders, zero
  unresolved clarification markers in ready artifacts, and zero broken local Markdown links.
- **SC-004**: Repository guards fail when any retired rulebook returns, any required feature artifact
  disappears, generated governance enters the runtime image, or document ownership becomes
  ambiguous.
- **SC-005**: The migration feature has 100% traceable coverage from functional requirements to
  tasks, all task evidence is current, and convergence finds no remaining specified work.
- **SC-006**: Existing application quality gates pass without modifying runtime behavior, production
  data, package publication state, or deployed infrastructure.
- **SC-007**: A clean temporary fixture can reproduce the pinned core infrastructure and supported
  integration set using only reviewed bundled assets.

## Assumptions

- Spec Kit governance is guaranteed when accepted work starts through a context-bearing core delivery
  skill; bundled assessment stages remain bounded pre-delivery tools and passive enforcement for them
  or arbitrary prompts requires a separately designed and tested first-party context extension.
- Codex, Claude, Cursor, and Gemini are the supported agent set for this baseline. Other agents can be
  evaluated later only when their integrations are multi-install-safe and have a real discovery path.
- Git history preserves retired documents, so the repository does not need a second live archive of
  obsolete rulebooks.
- Stable public, security, and operations documents remain necessary for humans and external tools;
  full migration means one owner per concern, not hiding every document under `.specify/`.
- This feature changes repository governance, documentation, and tests only. It does not authorize a
  production deployment, npm publication, repository rename, or data migration.
