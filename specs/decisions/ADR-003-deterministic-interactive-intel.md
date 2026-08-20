# ADR-003: Deterministic Interactive Intelligence

**Status**: Accepted
**Date**: 2026-07-22
**Amended by**: [ADR-012](./ADR-012-bounded-model-assist-on-dialect-labelling.md) (2026-08-20) —
narrows the scope clause below for one path only. A local model may assist **dialect signal
labelling** under seven bounded conditions. Everything else in this record stands: `/api/intel/*`,
news relevance, Inspector validation, behavior analysis, Core, and the CLI remain deterministic,
and the regression test still asserts it.

## Context

Interactive dialect naming, field-purpose hints, partner suggestions, and bid simulation previously
depended on a model bridge. That made identical inputs dependent on model availability and sampling,
introduced local/cloud infrastructure into user-facing paths, and made suggestions harder to test.
The news pipeline has a separate need to translate and categorize selected content.

## Decision

All `/api/intel/*` features use `lib/intel-rules.js`. The rules are deterministic, make no network
calls, return explicit `engine: "rules"` provenance, and preserve `unknown` when their bounded evidence
cannot justify an answer. News relevance uses the same deterministic boundary before any model call.

External model use is isolated to translation and categorization of news drafts that pass the
deterministic relevance gate. It is not available to Inspector validation, interactive Intel,
behavior analysis, Core, or CLI paths. A failed news transformation leaves the draft pending rather
than altering interactive behavior.

## Alternatives Considered

- Keep local Ollama on interactive paths. Rejected because it couples product availability and
  latency to host model infrastructure.
- Use a hosted model for interactive requests. Rejected because it adds external disclosure, cost,
  nondeterminism, and another availability dependency.
- Remove all model use, including news transformation. Not selected because translation and
  categorization are isolated editorial processing, not bid analysis.
- Guess beyond known rule tables for a more fluent answer. Rejected because an explicit unknown is a
  safer contract than unsupported confidence.

## Consequences

- Same input yields the same interactive result and can be covered by ordinary offline tests.
- Interactive payloads are not sent to a model provider.
- Rule tables require explicit maintenance and may answer `unknown` more often than a generative
  model.
- Any expansion of model scope is a privacy and architecture change requiring a new specification,
  ADR, documentation update, and regression tests.

## Related Artifacts

- [Core validator contract](../000-platform-baseline/contracts/core-validator.md)
- [Data-retention contract](../000-platform-baseline/contracts/data-retention.md)
- [Deterministic rules engine](../../lib/intel-rules.js)
- [Interactive Intel handler](../../modules/intel/handler.js)
- [Isolated news moderator](../../lib/news-moderator.js)
