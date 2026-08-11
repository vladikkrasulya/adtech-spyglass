# ADR-001: Server-Side Hosted Inspector Analysis

**Status**: Accepted
**Date**: 2026-04-30

## Context

The same validation semantics must serve the hosted Inspector, authenticated workspace, CLI, tests,
and future programmatic consumers. The browser application does not bundle `@ortbtools/core`; it
renders findings returned by the Node service. Bid payloads may contain sensitive identifiers, so
the network and retention boundary must be stated without implying that hosted analysis is local or
client-only.

## Decision

The hosted Inspector sends the entered request and/or response over HTTPS to `POST /api/analyze`.
The server runs the shared Core validation, format detection, and request/response crosscheck
in-process and returns structured findings. Raw analyze bodies are transient inputs: application
code must not persist them in SQLite, ClickHouse, request logs, or model services. Authenticated and
anonymous calls use the same analysis boundary; only derived metadata may be recorded under the
documented retention contract.

`@ortbtools/core` remains a deterministic, network-free main API used in-process by the server, CLI,
and tests. Offline callers use the workspace Core or CLI rather than depending on the hosted route.

## Alternatives Considered

- Bundle Core into the browser and describe all hosted validation as client-side. Rejected because
  it is not the deployed architecture and would create a second packaging/runtime contract.
- Maintain separate browser and server validators. Rejected because findings, IDs, and rule behavior
  would drift.
- Persist submitted bodies for history or debugging. Rejected because raw payload retention is not
  required for the analysis result and would materially expand the privacy boundary.

## Consequences

- Product and privacy copy must say that hosted payloads reach the server, even though bodies are not
  persisted.
- The hosted Inspector depends on service availability and is subject to server body-size and rate
  limits.
- Logs, analytics, error reporting, and future middleware require regression checks that prevent raw
  body capture.
- Core findings stay consistent across HTTP, CLI, and tests; the HTTP handler owns only orchestration,
  authentication-aware metadata, and response shaping.

## Related Artifacts

- [Core validator contract](../000-platform-baseline/contracts/core-validator.md)
- [HTTP API contract](../000-platform-baseline/contracts/http-api.md)
- [Data-retention contract](../000-platform-baseline/contracts/data-retention.md)
- [Privacy contract](../../docs/PRIVACY.md)
- [Analyze handler](../../modules/analyze/handler.js)
- [Inspector client](../../public/ortbtools.app.js)
