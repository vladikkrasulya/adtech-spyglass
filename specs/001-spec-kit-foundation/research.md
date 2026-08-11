# Research: Spec Kit Foundation

## Decision 1: Pin GitHub Spec Kit 0.16.2

**Decision**: Bootstrap with official tag `v0.16.2`, source commit
`4871b485f97c7fa452ec58eba325d87536c55c34`, and record both in project memory.

**Rationale**: The previously installed 0.12.13 was behind the official stable release. Version
0.16.2 adds hash-tracked multi-integration state, template resolution, bundled `assess`, a local
feature pointer, and current agent adapters. Bundled assets initialize offline and avoid mutable
catalog content.

**Alternatives considered**:

- Keep 0.12.13: rejected because it would make the new fleet baseline obsolete on adoption.
- Track `main` or run automatic upgrades: rejected because mutable generator behavior is not a
  reproducible governance dependency.

## Decision 2: Support Four Multi-Install-Safe Agents

**Decision**: Install Codex as default plus Claude, Cursor, and Gemini. Materialize the approved
extension commands for each integration, then return the default to Codex.

**Rationale**: All four integrations declare safe coexistence and use distinct generated paths.
Cycling `specify integration use` is required because extension commands render only for the active
integration. `specify integration status` verifies core manifest integrity; the repository guard
separately pins rendered `assess` adapters because extension output hashes are not recorded there.

**Alternatives considered**:

- Generic integration: rejected because it is not multi-install-safe and has no universal discovery
  convention.
- GitHub Copilot in this baseline: deferred because its current integration does not declare
  multi-install safety beside the chosen fleet.
- One authored `AGENTS.md` plus `CLAUDE.md`: rejected because it recreates policy copies and drift.

## Decision 3: Keep Only the Bundled Assess Extension

**Decision**: Install the official, offline `assess` extension. Do not install `agent-context`, Git,
community extensions/presets/bundles, URL packages, or `constitution-sync`. Remove the bundled `bug`
extension from the baseline until a hardened first-party version exists.

**Rationale**: `assess` is non-mutating outside its own idea directory and has explicit untrusted URL,
path, overwrite, and secret-redaction controls. `agent-context` exists specifically to create the
parallel agent files this migration retires. Git hooks can create branches or stage broad changes.
Community artifacts are discovery-only and unreviewed. The bundled bug flow has weaker URL safety
than `assess` and does not load this constitution before fetching incident links.

**Alternatives considered**:

- Install every bundled extension to “maximize” capability: rejected because capability without a
  safe contract increases ambiguity and mutation risk.
- Materialize constitution rules into generated templates: rejected because runtime resolution reads
  the one live constitution and materialized copies can drift.

## Decision 4: Use the Full Lifecycle Manually

**Decision**: Keep the bundled workflow as an upstream artifact but define the canonical gold path as
manual skills: assess when uncertain; specify; clarify; plan; checklist; tasks; analyze until clean;
implement bounded phases; repository CI; converge; repeat only when tasks are appended.

**Rationale**: The bundled workflow omits clarify, checklist, analyze, and converge. The available
community pipeline continues after analysis errors and can repeat implementation without a reliable
convergence branch. Workflow runners dispatch powerful agent CLIs without a capability sandbox.

**Alternatives considered**:

- Run the bundled workflow unattended: rejected because it provides less review than the desired
  standard.
- Install the community pipeline: rejected after source and control-flow review.

## Decision 5: Split Canonical Knowledge by Concern

**Decision**: Use the constitution for normative rules; platform baseline for current what/how;
feature packages for scoped intent/progress; ADRs for durable why; one roadmap for now/next; and retain
conventional privacy/security/operations/API/package docs for their public audiences.

**Rationale**: “One source of truth” means one owner per concern, not one enormous file. This split
keeps frequently changing priority separate from stable contracts and preserves conventional entry
points external users and security tools expect.

**Alternatives considered**:

- Move every document under `.specify/`: rejected because public/security/runbook contracts have
  consumers beyond coding agents.
- Keep root architecture and roadmap as mirrors: rejected because mirrors are the drift being fixed.

## Decision 6: Exclude Generated Governance From Product Tooling

**Decision**: Check in managed adapters and Spec Kit infrastructure, but exclude package-owned output
from Prettier rewrites and exclude all governance/agent roots from Docker build context. Continue to
format authored constitution and `specs/**` files.

**Rationale**: Generated files do not conform to the repository's formatting profile and would churn
on every reinstall. The Dockerfile copies the repository context, so explicit ignore rules are needed
to prevent unused prompts, scripts, and manifests from entering the runtime image.

**Alternatives considered**:

- Reformat generated output: rejected because manifest hashes and upgrades would conflict.
- Ignore all Spec Kit files in Git: rejected because other agents and clean checkouts need the same
  reviewed workflow.

## Decision 7: Defer Automatic Session Context to a First-Party Extension

**Decision**: State honestly that the initial baseline guarantees a constitution load for the
context-bearing core delivery stages. The bundled assessment adapters are bounded pre-delivery tools
and do not automatically load full project memory. Design a deterministic `session_start` context
extension as a separate assessed feature.

**Rationale**: Spec Kit 0.16.2 exposes native integration events that could inject a compact memory
index without `AGENTS.md` or `CLAUDE.md`. Such a hook runs automatically with user privileges and must
be independently specified and tested across every agent before adoption.

**Alternatives considered**:

- Claim passive universal enforcement now: rejected as false.
- Install `agent-context`: rejected because it recreates the retired files.
