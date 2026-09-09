# ADR-018: Maintenance compatibility and explicit degradation

**Status**: Accepted
**Date**: 2026-09-09
**Feature**: [032](../032-close-cleanup-inventory/spec.md)

## Context

The owner authorized all named maintenance. Normalization, family containment and per-side metadata affect public boundaries. CL-08 proposes a universal capability API without a reproduced defect.

## Decision

1. Use source-aware auction views with explicit adapters. Request plugins, currency-only response pairing and crosscheck retain distinct eligible facts and original identity/paths.
2. Contain baseline and plugin applies/validate faults, preserve other checks, add family-only `internal.rule_family_failed` warnings and unfiltered completeness metadata. Filtering cannot turn incomplete analysis clean or hide its state. Completed degraded HTTP analysis uses the success envelope. This intentionally replaces a baseline-internal throw's generic 400 and a plugin fault's silent omission. Malformed JSON, request-envelope and auth errors retain existing failure behavior.
3. Add per-side results while preserving flat fields and prefixes; rendered side uses structured provenance.
4. Preserve both price diagnostics and all legacy IDs; new IDs use dotted lowercase names.
5. Negative supplied floors are unusable. Matched negative deals do not fall back to impression floors. Warn and suppress economic above/below claims.
6. Resolve CL-08 with current detection/validation/preview/provenance boundaries and assertions, without a new runtime API. Give CL-09 assertion-level coverage including uncovered states.

## Alternatives

- One universal auction projection would simplify call sites but admit fields into consumers that historically did not accept them, including 3.0 response pairing. Explicit adapters retain those boundaries.
- Removing one price diagnostic would reduce visible duplication but break public IDs and suppression contracts. Shared classification preserves both existing predicates.
- Throwing every family error would lose unrelated findings; silently swallowing it would falsely imply complete analysis. Safe family-only warnings plus unfiltered completeness retain useful results and expose degradation.
- A new capability registry would add a public runtime model without a reproduced requirement. Existing boundary-specific states and an assertion inventory supply the requested evidence with explicit limitations.

## Consequences

App 1.22.0/Core 0.47.0 document additive diagnostics/type recognition, metadata and degradation; CLI 0.1.4 follows Core. Fault injection, exact paths, corpus preservation and locales are gates. No new framework/service/storage/creative permission or payload logging. Decision-only closures are not claimed as runtime implementation.

## Related

- [Feature 032 specification](../032-close-cleanup-inventory/spec.md), [compatibility contract](../032-close-cleanup-inventory/contracts/maintenance-compatibility.md) and [per-item evidence](../032-close-cleanup-inventory/inventory.md).
- [Current Core contract](../000-platform-baseline/contracts/core-validator.md), [HTTP contract](../000-platform-baseline/contracts/http-api.md) and [frontend ownership](../000-platform-baseline/contracts/frontend-modules.md).
