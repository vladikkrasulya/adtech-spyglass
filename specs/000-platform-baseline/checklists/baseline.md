# Platform Baseline Quality Checklist

**Purpose**: Verify that the as-built baseline is complete, current, and safe to use as agent memory
**Observed**: 2026-08-11
**Baseline**: [Platform scope](../spec.md)

## Evidence and Scope

- [x] Every current product surface is named with an implementation owner
- [x] Claims distinguish repository behavior from configurable or deployed runtime state
- [x] Core coverage limitations are explicit; no exhaustive schema-conformance claim is made
- [x] Hosted validation is described as server-side transient processing
- [x] Browser-local raw history is distinguished from server persistence
- [x] The official encrypted save flow is distinguished from direct API clients
- [x] Interactive deterministic intelligence is separated from isolated news translation
- [x] No production records, payload bodies, secrets, personal identifiers, or private URLs appear
- [x] Future priorities and historical narratives are excluded

## Contract Coverage

- [x] Core exports, finding stability, strictness, locales, dialects, and compatibility are covered
- [x] HTTP route families, access gates, limits, static fallback, and security boundaries are covered
- [x] SPA registration, mount context, cleanup order, action modules, and globals are covered
- [x] SQLite, ClickHouse, filesystem, and browser data entities are covered
- [x] Retention, deletion, crypto, telemetry, backup lag, and third-party processing are covered
- [x] Locale routing, translation ownership, terminology, and independent SemVer surfaces are covered
- [x] Content sources, SSR, indexability, canonicals, hreflang, sitemap, RSS, and 404 behavior are
      covered
- [x] Image contents, runtime mount, provenance, readiness, smoke, rollback, and CI boundaries are
      covered

## Ownership and Maintainability

- [x] Conventional privacy, security, operations, public API, and npm documents remain linked rather
      than copied wholesale
- [x] Each baseline concern has one named owner and a change trigger
- [x] Implementation evidence is indexed in `research.md`
- [x] Validation commands are grouped by changed surface and avoid live production state
- [x] Test totals are not hard-coded; runner output remains authoritative
- [x] Baseline tasks contain no product backlog or duplicate roadmap
- [x] Local Markdown links resolve within the final canonical tree
- [x] No unresolved template token or clarification marker remains

## Revalidation Rule

Any checked statement invalidated by a feature becomes a blocking baseline update for that feature.
Do not leave the box unchecked as a future reminder: update the owning contract and evidence, or mark
the baseline status non-current with a linked active feature.
