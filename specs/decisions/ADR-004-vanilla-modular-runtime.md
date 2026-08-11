# ADR-004: Vanilla Modular Runtime

**Status**: Accepted
**Date**: 2026-05-23

## Context

ortbtools began as a dependency-light Node and browser application and grew into several backend
capabilities and SPA sections. Central files became hotspots, but adopting a framework would add a
second migration problem and a build/runtime contract without proving that the existing product
required it. The system needed bounded ownership and cleanup more than a new rendering abstraction.

## Decision

Keep the runtime on vanilla Node.js and browser JavaScript without an application framework or
bundler:

- `server.js` remains the `node:http` composition root;
- backend features own handler modules registered through `lib/router.js`;
- `@ortbtools/core` and `@ortbtools/cli` remain npm workspaces;
- SPA sections are registered lazily and implement the `mount` lifecycle;
- every activation receives a mount-scoped `AbortSignal` plus a LIFO cleanup registry, followed by
  optional `unmount` and DOM cleanup.

New work extends the owning subsystem's contract. A framework, bundler, service, database, global
state facade, or parallel router requires measured need and a superseding or additional ADR.

## Alternatives Considered

- Rewrite the browser in React, Vue, or another framework. Rejected because the migration cost and
  bundle/runtime change were not justified by current state complexity.
- Keep every route and UI feature in central monoliths. Rejected because explicit module ownership
  and lifecycle isolation already reduce change scope without a rewrite.
- Split capabilities into separate services. Rejected because the operational overhead would exceed
  current scale and create new network contracts.

## Consequences

- Production remains a single self-contained application image with a small dependency surface.
- Module contracts, lifecycle cleanup, and tests carry responsibilities a framework might otherwise
  provide.
- Existing hotspot files remain legitimate refactor candidates, but extraction should proceed behind
  current interfaces rather than through a wholesale rewrite.
- Source edits require an image rebuild; there is no bundler-generated runtime artifact or live
  source mount.

## Related Artifacts

- [Platform architecture plan](../000-platform-baseline/plan.md)
- [Frontend module contract](../000-platform-baseline/contracts/frontend-modules.md)
- [Backend router](../../lib/router.js)
- [Frontend registry](../../public/core/registry.js)
- [Frontend module guide](../../public/modules/README.md)
