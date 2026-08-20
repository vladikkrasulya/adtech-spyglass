# Accepted Decisions

This index owns durable architectural and product rationale. ADRs describe why a stable boundary
exists; current implementation detail remains in the [platform baseline](./000-platform-baseline/),
and current ordering remains in the [roadmap](./ROADMAP.md).

Accepted ADRs are not silently rewritten when a decision changes. A reversal creates a new ADR that
names the record it supersedes; a clarification that preserves the decision is marked explicitly in
the existing record.

| ADR                                                                         | Status                       | Date       | Decision                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](./decisions/ADR-001-server-side-hosted-analysis.md)               | Accepted                     | 2026-04-30 | Hosted Inspector analysis runs through the server; Core remains the shared offline-capable engine                          |
| [ADR-002](./decisions/ADR-002-browser-encrypted-saved-bodies.md)            | Accepted                     | 2026-04-30 | The official web save flow encrypts bid bodies in the browser, with an explicit plaintext metadata and direct-API boundary |
| [ADR-003](./decisions/ADR-003-deterministic-interactive-intel.md)           | Accepted; amended by ADR-012 | 2026-07-22 | Interactive intelligence and news relevance use deterministic rules; model use is isolated to news transformation          |
| [ADR-004](./decisions/ADR-004-vanilla-modular-runtime.md)                   | Accepted                     | 2026-05-23 | Retain a vanilla Node/browser runtime with explicit backend and SPA module lifecycles                                      |
| [ADR-005](./decisions/ADR-005-evidence-driven-dialects.md)                  | Accepted                     | 2026-05-12 | Preserve IAB as the baseline and add dialect meaning only from evidence or explicit user mappings                          |
| [ADR-006](./decisions/ADR-006-immutable-exact-sha-deployments.md)           | Accepted                     | 2026-06-28 | Deploy immutable commit-addressed images through readiness, smoke, and rollback gates                                      |
| [ADR-007](./decisions/ADR-007-hybrid-content-indexing.md)                   | Accepted                     | 2026-07-01 | Serve editorial Markdown and ClickHouse content together while default-denying search indexing                             |
| [ADR-008](./decisions/ADR-008-independent-versioning-unpublished-npm.md)    | Accepted                     | 2026-08-11 | App, Core, and CLI version independently; registry packages remain documented as unpublished until verified                |
| [ADR-009](./decisions/ADR-009-spec-kit-document-ownership.md)               | Accepted                     | 2026-08-11 | Spec Kit owns working memory with exactly one owner per concern                                                            |
| [ADR-010](./decisions/ADR-010-supported-agents-safe-automation.md)          | Accepted                     | 2026-08-11 | Support four manifest-managed agents and keep automatic or third-party automation outside the initial safety boundary      |
| [ADR-011](./decisions/ADR-011-browser-markdown-sanitization.md)             | Accepted                     | 2026-08-11 | Treat every browser-rendered Blog body as untrusted and insert only a sanitized, closed-policy fragment                    |
| [ADR-012](./decisions/ADR-012-bounded-model-assist-on-dialect-labelling.md) | Accepted                     | 2026-08-20 | A local model may assist dialect signal labelling under seven bounded conditions; amends one clause of ADR-003             |
