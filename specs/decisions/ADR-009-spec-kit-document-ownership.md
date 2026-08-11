# ADR-009: Spec Kit and Single-Owner Project Memory

**Status**: Accepted
**Date**: 2026-08-11

## Context

The repository accumulated agent-specific rulebooks, a roadmap containing historical architecture,
and several overlapping architecture maps. They could each answer the same question differently.
Replacing them with one enormous document would reduce file count without separating stable rules,
current behavior, rationale, priority, and per-change progress.

## Decision

Adopt GitHub Spec Kit as the repository's working-memory system and assign exactly one owner per
concern:

- the constitution owns normative rules;
- the platform baseline owns current product and architecture contracts;
- a numbered feature package owns scoped what/why, how, tasks, and evidence;
- indexed ADRs own durable rationale;
- one roadmap owns current order and status;
- conventional privacy, security, operations, API, npm, and release documents retain their public
  locations and own their audience-specific contracts.

Generated agent integrations are adapters into this memory, not independent policy. Root or subtree
`AGENTS.md`, `CLAUDE.md`, duplicated live roadmaps/architecture maps, and specialist prompt rulebooks
are retired after valid knowledge reaches its owner. Git history is the archive.

## Alternatives Considered

- Keep synchronized `AGENTS.md`, `CLAUDE.md`, and tool-specific files. Rejected because manual copies
  recreate the drift the migration is meant to remove.
- Put every concern into the constitution. Rejected because frequently changing status and detailed
  current behavior would destabilize normative governance.
- Move every human contract under `.specify/`. Rejected because public users, operators, security
  tooling, and package consumers rely on conventional paths.
- Keep the old files as a live archive. Rejected because readers and agents cannot reliably know that
  a conflicting file is historical.

## Consequences

- Non-trivial work must enter through a Spec Kit feature lifecycle and maintain repository artifacts,
  not depend on conversation history.
- Every change has a clear documentation update target; ownership and link tests can fail on drift.
- Maintainers accept modest artifact upkeep in exchange for resumable, reviewable intent and
  evidence.
- Passive context for arbitrary prompts is not implied; that requires the separately assessed
  boundary in ADR-010.

## Related Artifacts

- [Project constitution](../../.specify/memory/constitution.md)
- [Project-memory index](../README.md)
- [Document-ownership contract](../001-spec-kit-foundation/contracts/document-ownership.md)
- [Spec Kit foundation feature](../001-spec-kit-foundation/spec.md)
