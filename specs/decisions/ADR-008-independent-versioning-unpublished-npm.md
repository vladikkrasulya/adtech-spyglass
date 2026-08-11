# ADR-008: Independent Versioning and Unpublished npm Packages

**Status**: Accepted
**Date**: 2026-08-11

## Context

The hosted application, reusable validator Core, and CLI expose different contracts and release
cadences. They live in one npm workspace, but a web deployment does not imply a package release.
Repository package metadata and a publish workflow exist even though the public registry has not yet
received `@ortbtools/core` or `@ortbtools/cli`.

## Decision

Maintain independent SemVer lines:

- the root private package versions the hosted application;
- `@ortbtools/core` versions its public validation and data-to-data API;
- `@ortbtools/cli` versions terminal flags, output, and exit behavior, and declares a compatible Core
  range.

Core and CLI are repository workspaces until a separately authorized first publication succeeds and
is verified in the public registry. Documentation must not offer executable registry-install claims
before that verification. The first publication, if accepted, runs package CI and pack smoke, then
publishes Core before CLI because CLI depends on Core.

## Alternatives Considered

- Give app, Core, and CLI one shared version. Rejected because unrelated changes would force empty
  releases and obscure which public contract changed.
- Publish packages automatically with every app deployment. Rejected because registry mutation has
  distinct credentials, ordering, rollback limitations, and consumer impact.
- Present package names as already installable because manifests exist. Rejected because workspace
  availability is not registry availability.
- Remove package metadata until publication. Rejected because local CLI/Core packaging and pack
  validation are useful before registry release.

## Consequences

- Release notes and version bumps must name the changed surface; an app-only change does not bump
  Core or CLI.
- A Core breaking change may require a coordinated CLI range/version update, while still remaining a
  separate release decision.
- Users clone the repository for these workspaces until the registry state is verified.
- npm publication and GitHub repository identity remain explicit roadmap decisions rather than
  implied completion of the Spec Kit migration.

## Related Artifacts

- [Locales/versioning contract](../000-platform-baseline/contracts/locales-versioning.md)
- [npm publication runbook](../../docs/NPM_PUBLISH.md)
- [Core package manifest](../../packages/core/package.json)
- [CLI package manifest](../../packages/cli/package.json)
- [Root package manifest](../../package.json)
