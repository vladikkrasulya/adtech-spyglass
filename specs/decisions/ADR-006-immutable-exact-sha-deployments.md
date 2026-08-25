# ADR-006: Immutable Exact-SHA Deployments

**Status**: Accepted
**Date**: 2026-06-28

## Context

Source bind mounts and mutable image labels allow production behavior to diverge from Git and make a
restart look like a deployment. A failed candidate also needs a verifiable rollback target; simply
starting an older container is not enough if its source identity and readiness are unknown.

## Decision

Production deploys build a self-contained image from a clean checkout where `HEAD`, `main`, and
`origin/main` are equal. The candidate tag is derived from that Git commit and the full revision is
embedded as image provenance. Application source, packages, static assets, samples, and seed content
are baked into the image; `/data` is the only runtime mount.

Before transition, the deploy records state and retains the previous image under a SHA-keyed rollback
tag. An unverified candidate starts with restart disabled, must report the expected build identity,
pass readiness polling, and pass the non-destructive public smoke. Only then may the deploy pin the
environment and arm the normal restart policy. Failure triggers the same gated process for automatic
rollback; unknown or interrupted transition state fails closed for operator review.

## Alternatives Considered

- Bind-mount source and restart the container after edits. Rejected because the running bytes would
  not be traceable to an immutable revision.
- Deploy `latest` or version-only tags. Rejected because tags can silently point at different commits
  and collide when a version bump is missed.
- Switch first and inspect later. Rejected because an unhealthy candidate could become the persisted
  recovery target.
- Rely on manual rollback without preserved provenance. Rejected because incident-time guesses are
  slower and less reliable than an exercised state machine.

## Consequences

- A source or dependency change is not live until a new image passes the complete deployment gate.
- Deployment is slower than a restart but produces auditable source identity and a tested rollback
  path.
- Persistent data and promoted content must remain compatible across candidate and rollback images;
  deployment scripts never treat `/data` as disposable.
- ~~Building, tagging, activating, or rolling back production remains a separately authorized external
  mutation, not an implied consequence of merge.~~ **Superseded by
  [ADR-013](./ADR-013-standing-release-authorization.md) (2026-08-25):** these actions now carry a
  standing authorization under stated conditions. Every other consequence here stands, and it is what
  makes that authorization safe — the gates below are exactly what bounds it.

## Related Artifacts

- [Release/deploy contract](../000-platform-baseline/contracts/release-deploy.md)
- [Operations runbook](../../docs/OPERATIONS.md)
- [Deployment script](../../scripts/deploy.sh)
- [Deployment regression tests](../../tests/immutable-image.test.js)
