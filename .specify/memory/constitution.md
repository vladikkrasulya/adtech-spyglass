<!--
Sync Impact Report
- Version change: 2.0.0 -> 2.1.0 (2026-08-25)
- Reason: materially complete the 2.0.0 authorization split so the agent
  operator can carry a reviewed release through its bounded, reversible path
  without a second conversation at each release step.
- MINOR because this amendment adds standing authorization for authored,
  in-scope commits and the canonical backup gate, and makes that backup a
  mandatory obligation immediately before a standing-authorized deployment.
- Expanded: Principle VIII action-specific standing conditions; the canonical
  pre-deploy backup as part of deployment authorization; the explicit-only
  boundary for direct `/data` access outside documented flows; and the rule that
  tool or mechanism availability never expands authorization.
- Synchronized current owners: `specs/README.md`, `CONTRIBUTING.md`, the release,
  versioning, and agent-integration contracts, the operations runbook, ADR-010,
  ADR-013, the decision index, and the pre-push hook. Added a focused governance
  consistency test over that explicit allowlist.
- Historical closed feature, assessment, audit, changelog, and dated deployment
  records are left as written because they describe the authorization actually
  used at the time rather than current policy.
- Unchanged: npm publication, data migration or restore, destructive data
  actions, issue creation, force-pushing, and history rewriting require explicit
  per-action authorization.
- Previous version 2.0.0 introduced the standing/explicit authorization split;
  version 1.0.0 added principles I-VIII, Project Constraints, and Spec-Driven
  Delivery.
- Follow-up TODOs: none
-->

# ortbtools Constitution

## Core Principles

### I. Spec Kit Is the Working Memory

Every non-trivial change MUST have one active Spec Kit feature package containing a testable
`spec.md`, an implementation `plan.md`, and an executable `tasks.md`. Before substantive authored or
implementation work starts or resumes, the agent MUST read this constitution, `specs/ROADMAP.md`, the
relevant `specs/000-platform-baseline/` contracts, and the active feature package. The pinned CLI MAY
first create deterministic empty/template scaffolding and the machine-local pointer needed to resolve
that package; no requirements, design, source, or task decisions may be authored before context is
loaded. Task state and evidence MUST be updated at material phase boundaries. Uncertain ideas enter
through `speckit.assess`, whose bundled pre-delivery adapters do not automatically load full project
memory; the operator MUST enter them from the project-memory index, and a `go` decision MUST return
through `speckit.specify`. Accepted work enters through the context-bearing core delivery lifecycle.
Conversation history, root-level agent files, and issue descriptions are not sources of project
intent.

### II. Truth Is Evidence-Backed

Claims about behavior, privacy, versions, package availability, production state, or test results
MUST be verified against code, tests, live state, or an authoritative external source. An agent MUST
distinguish repository state from deployed state and MUST NOT call an unrun check successful. When a
canonical artifact conflicts with implementation evidence, work stops until the contradiction is
resolved or recorded as an explicit decision. Stable facts belong in contracts; rationale belongs in
ADRs; only current priorities belong in the roadmap.

### III. Privacy and Security Boundaries Are Non-Negotiable

Raw payloads sent to analysis endpoints are processed transiently and MUST NOT be persisted in
application logs or analytics. The hosted Inspector does send payload bodies to server endpoints;
copy MUST NOT describe hosted analysis as client-only. The official browser save flow encrypts saved
BidRequest and BidResponse bodies with AES-GCM before upload, while sample metadata, partner data,
dialect mappings, activity data, and operational request metadata can remain server-readable. Any
change to collection, retention, encryption, authentication, sandboxing, SSRF controls, or external
model use MUST update the privacy/security contract and its regression tests in the same change.
Tracked Spec Kit artifacts MUST contain only synthetic or redacted evidence—never payload bodies,
secrets, tokens, DSNs, private incident links, email addresses, IP addresses, or production records.

### IV. Public Contracts Stay Deterministic and Compatible

Core validation findings MUST retain stable IDs, deterministic order, stable deduplication semantics,
and explicit provenance where maintained. The main Core validation, detection, mirror, and crosscheck
APIs remain deterministic data-to-data functions with no network calls. Contract changes require
tests at the public boundary and an explicit compatibility decision; silent changes to finding IDs,
API shapes, CLI exit behavior, storage schemas, or route semantics are prohibited. Dialect behavior
MUST be justified by evidence and MUST preserve the IAB baseline unless suppression is an explicit,
tested contract.

### V. Architecture Remains Explicit and Bounded

The current runtime is vanilla Node.js and browser JavaScript: a `node:http` composition root,
backend handler modules, an npm-workspace Core/CLI, and lazy SPA sections with owned lifecycle
cleanup. New code MUST follow the owning subsystem's existing contract rather than inventing a
parallel framework, global facade, router, state store, build pipeline, or deployment path. A new
framework, bundler, service, database, or cross-cutting abstraction requires measured need and an ADR
that explains why the existing design is insufficient. Frontend sections MUST honor `AbortSignal`
and registered cleanup; source changes are not live until the immutable image is rebuilt.

### VI. Locales and User-Facing Meaning Move Together

English, Ukrainian, and Russian are one product contract. Every user-visible change MUST update all
applicable locale variants in the same change, including browser dictionaries, module dictionaries,
HTML templates, and Core finding messages. Ukrainian and Russian use informal singular address.
Tests MUST assert key parity or equivalent observable behavior where a missing translation could
surface as `undefined` or stale copy. A wording change that alters a privacy, security, or product
promise is a contract change, not cosmetic copy editing.

### VII. Verification Is Proportional and Reproducible

Every behavior change MUST include or update a regression test unless the spec records why a test is
not applicable. During implementation, run the narrowest relevant tests first; before merge, run
`npm run ci` and any package, Docker, browser, or production smoke gate required by the changed
surface. Tests MUST avoid live production data and external network dependencies. Reports MUST cite
the exact command, outcome, and known sandbox limitations, and MUST use the current test runner as
the count authority rather than hard-coding totals in documentation.

### VIII. Releases and Production Changes Are Traceable

The app, Core, and CLI have independent SemVer lines and MUST be bumped only when their public
contract changes. Unpublished packages MUST NOT have executable registry-install claims. Production
deploys use an immutable image tagged with the exact Git SHA, readiness and smoke gates, and automatic
rollback; a restart of an old image is not a deployment.

Planning, task generation, code changes, tool installation, credentials, and mechanism availability
do not expand authorization by themselves. Two classes are distinguished because they fail
differently:

**Standing authorization (agent operator).** The following bounded actions are pre-authorized under
their action-specific conditions:

- stage only authored, in-scope changes from the current task, run the required repository gates
  against that settled scope, and then commit it; never include unrelated or peer-owned work;
- non-force push those reviewed commits to `main` from a clean worktree after the required local gates
  pass, then wait for the required hosted gates before deployment;
- immediately before deployment, run the documented `scripts/backup-db.sh` flow and verify the fresh
  SQLite and persistent-content archives; this operator gate is part of the standing deployment
  authorization even though `deploy.sh` does not create or validate it;
- deploy only through `scripts/deploy.sh` from a clean `HEAD == main == origin/main`, with repository
  gates green, using an image built in that run from that SHA, while leaving application/database/build
  readiness, smoke, and automatic rollback armed; and
- roll back through `deploy.sh`'s automatic path or the documented `scripts/rollback.sh` flow. Rollback
  is always authorized and never waits for a decision because it is the safety action.

After deployment or rollback, the agent operator MUST report the version, image tag, Git SHA, and gate
outcomes whether the operation succeeded or failed.

**Explicit authorization, per action.** npm publication, data migration or restore, destructive data
actions, issue creation, force-pushing, history rewriting, direct access to `/data` outside the
documented backup/deploy/rollback flows, and any release operation that would bypass a gate, disable
automatic rollback, or activate an image outside the documented exact-SHA flow. These actions are not
made safe merely because a command or credential is available; each requires a stated scope, evidence,
and a decision at the time.

## Project Constraints

- Node.js `>=22.13.0`, CommonJS Core, `node:test`, Prettier, ESLint, and JSDoc type checking are the
  current supported development baseline.
- SQLite is the account/library store; ClickHouse is analytics/blog infrastructure. Payload bodies
  MUST NOT be introduced into ClickHouse or request logs.
- Interactive intel and news relevance remain deterministic rules. External model use is isolated to
  the documented news translation/categorization path unless a new spec changes that boundary.
- Creative preview remains sandboxed without `allow-same-origin`; outbound proxy changes preserve
  allowlists plus port, time, redirect, and response-size limits.
- The only runtime mount is `/data`; application source, modules, packages, samples, and design assets
  are baked into the image.
- Preserve unrelated user changes in a dirty worktree. Never stage or commit work this session did
  not author; a dirty tree blocks push and deployment by design and the block is cleared by its author,
  not around.
- Destructive data actions and irreversible external mutations require exact targets and explicit
  authorization. Authored in-scope commits, non-force pushes to `main`, the canonical pre-deploy
  backup, deployment, and rollback carry the standing authorization defined in Principle VIII and its
  conditions.

Canonical ownership is intentionally split by concern:

- this constitution: normative project rules;
- `specs/ROADMAP.md`: current ordering and status;
- feature `spec.md`: what and why; `plan.md`: how; `tasks.md`: executable progress;
- `specs/DECISIONS.md` and ADRs: why durable choices were made;
- `specs/000-platform-baseline/`: current as-built product and architecture contracts;
- `docs/PRIVACY.md`, `SECURITY.md`, `docs/OPERATIONS.md`, `docs/api-v1.md`, and
  `docs/NPM_PUBLISH.md`: public/security/operations contracts that retain their conventional paths;
- code, schema, and runtime telemetry: implementation evidence, not substitutes for intent.

## Spec-Driven Delivery

1. For an uncertain product idea, run `speckit.assess.intake` → `research` → `define` → `shape` →
   `decide`. A killed or parked idea is a valid outcome.
2. For accepted work, run `speckit.specify`; resolve material ambiguity with `speckit.clarify`, then
   run `speckit.plan` and the relevant `speckit.checklist` before `speckit.tasks`.
3. Run `speckit.analyze` before implementation. Critical constitution conflicts and uncovered core
   requirements MUST be fixed in the artifacts before code changes begin.
4. Implement bounded task phases, test each independently, and update checkboxes/evidence while the
   context is fresh. Do not reconstruct progress from chat history at the end.
5. Run `speckit.converge` only after implementation and verification. If it appends tasks, implement
   and verify them, then converge again until clean.
6. Update the baseline contract or an ADR whenever a change alters current architecture or the reason
   behind it. Update the roadmap when priority or status changes.
7. Use only reviewed, pinned Spec Kit assets. Community extensions, presets, bundles, URL installs,
   automatic workflows, and lifecycle hooks are prohibited until their source and mutation scope are
   audited and accepted by ADR.
8. Generated integration files are adapters, not policy. Do not hand-edit them; update or reinstall
   them through the pinned Spec Kit CLI. `AGENTS.md`, `CLAUDE.md`, and other parallel rulebooks are
   prohibited because they create competing governance.

## Governance

This constitution supersedes conflicting project process guidance. Amendments require an explicit
reason, impact report, SemVer bump, ISO date, and a consistency review of active specs and retained
contracts. MAJOR changes remove or redefine governance; MINOR changes add or materially expand a
principle; PATCH changes clarify without changing obligations.

Every feature plan and review MUST evaluate all MUST statements. Exceptions are allowed only when a
feature spec names the violated rule, documents evidence and a bounded alternative, and obtains
explicit maintainer approval; privacy, secret-handling, and destructive-action constraints cannot be
waived implicitly. Managed Spec Kit version/integration status and repository governance tests are
merge gates. Production mutation carries the two-class authorization defined in Principle VIII:
gated, reversible release actions are pre-authorized under stated conditions; irreversible mutations
require a separate, explicit operator decision. An agent that cannot satisfy a stated condition MUST
stop and say which one, rather than proceed or work around it.

**Version**: 2.1.0 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-25
