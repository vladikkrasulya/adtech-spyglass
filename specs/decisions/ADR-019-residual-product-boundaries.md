# ADR-019: Complete residual product behavior with explicit provenance

**Status**: Accepted
**Date**: 2026-09-09
**Feature**: [033](../033-close-remaining-questions/spec.md)

## Context

The owner explicitly resumed all residuals and four deferred product directions after032. Actual session revival, test timing and push-style defects are reproduced. Broader mapping scope, raster loading, SChain guidance and declared-route relevance require explicit compatibility/privacy choices.

## Decision

1. Add durable revocation intents and a prearmed dirty recovery fence; unsafe startup cannot hydrate/issue sessions. Orderly restart preserves trusted sessions. First installation or uncertain recovery invalidates legacy/uncertain sessions and may require login. Versioned keyed DB identities prevent an older auth image from recognizing newly issued raw bearer cookies. Close reset/invalidation and stale-password-proof paths at the shared boundary.
2. Add confirmed normalized-path mappings only for the nine non-format roles. Existing version1 exact semantics remain; version2 explicitly discriminates path scope, exact wins and schema2 export prevents silent downgrade reinterpretation. Field-scope saves omit observed values. No new physical SQLite schema is required.
3. Extend only explicit signed-in raster loading to selected push/Native/banner assets, including responsive/CSS image references. Preserve styling, sandbox, current probe and original selected identity. Do not automatically fetch advertiser resources or grant remote execution. Document endpoint disclosure and per-resource failure.
4. Disable unintended automatic Web Analytics injection for this site, keeping the application's existing CSP. Do not use broad CSP origins or no-transform as substitutes for the intended single-site configuration change.
5. Add source-backed duplicate-chain/copy/declared-sender diagnostics and serialized inspection. A complete single node is valid; optional rid/domain omissions cannot remain recommendation-level warnings; legacy IDs retain compatibility under correct nonblocking guidance. Factual chain length is not a universal compliance threshold. Sender context is declared, never inferred from app.bundle or free-form labels.
6. Execute nineteen pinned direct-adapter witnesses using isolated trigger/control and explicit transformation/fanout oracles. Retain the historical auction results and amend only newly witnessed corpus claims.
7. Select the explicit033 alternative anticipated by008: declared-route relevance with typed adapter/profile, direction, pinned revision and declared provenance. This completes a user-selected-profile workflow; it does not reconstruct or claim actual traffic measurements.
8. Native browsers, actual zoom, screen-reader and device checks require execution evidence. Missing environments remain open; document-only dispositions cannot close requested verification.

## Alternatives

Memory-only revocation or a journal without a prearmed fence cannot cover restart after total-write failure. Public hashes do not protect old-image lookup from someone who knows the raw cookie; keyed identities and no legacy fallback do. Silently discarding all sessions on every orderly restart would unnecessarily regress continuity.

Magic wildcard/params markers can reinterpret legacy mappings; a version discriminator is explicit. Automatic creative fetching or remote execution expands privacy and sandbox boundaries; explicit raster action satisfies the selected outcome. Heuristic SChain ownership/length rules lack normative support. Replacing historical audit outcomes would conceal the old oracle's actual limits; a new witnessed generation preserves them.

## Consequences

App/Core public additions require independent minor versions and CLI dependency alignment. Authentication recovery may require login after first install or uncertain crash. The private checkpoint needs documented lifecycle, backup/recovery handling and bounded fault tests. Existing exact mappings and legacy public IDs remain interpretable. New user-visible meaning ships in all three locales. No external model, arbitrary proxy, raw payload logging or registry publication is authorized.

## Related

[033 spec](../033-close-remaining-questions/spec.md), [session contract](../033-close-remaining-questions/contracts/session-recovery.md), [inspection contract](../033-close-remaining-questions/contracts/inspection.md), [008](../008-openrtb-dialect-verification/spec.md), [016](../016-ext-key-alphabet/spec.md), [ADR-015](ADR-015-storable-roles-and-response-variants.md), [ADR-016](ADR-016-recommended-fields-are-guidance.md), [ADR-018](ADR-018-maintenance-boundaries-and-degradation.md).

### Process ownership lock

The private recovery directory also contains a fixed-path SQLite ownership sidecar using the existing better-sqlite3 dependency. A lifetime `BEGIN EXCLUSIVE` transaction supplies an OS-released crash-safe lock on Linux and macOS; it contains no application tables or rows. Acquisition uses a bounded busy timeout and fails closed. No PID-file stale-lock recovery is used. Concurrent-owner and actual crash-release regressions cover the boundary. This is an ownership mechanism, not an additional application data store.
