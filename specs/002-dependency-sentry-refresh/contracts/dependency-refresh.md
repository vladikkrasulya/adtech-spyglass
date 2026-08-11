# Contract: Dependency Refresh

## Scope

This feature may change the root manifest's compatible `@sentry/node` range and the transitive
lockfile graph required to clear current npm audit findings. It does not authorize broad dependency
modernization.

## Required Graph

- `@sentry/node` remains on major 10 and resolves to a release outside the audited affected range.
- All production OpenTelemetry packages resolve outside the audited affected ranges and remain
  compatible with Node.js `>=22.13.0`.
- `brace-expansion` resolves to `5.0.9` or a later compatible fixed release.
- The jsdom-owned development subtree resolves `undici` to `7.29.0` or a later compatible fixed
  release without changing jsdom's direct major in this feature.
- `better-sqlite3`, jsdom, TypeScript, ESLint, Prettier, and type-definition major upgrades are not
  introduced merely because newer releases exist.

The exact fixed versions are evidence from the generated lockfile and current audit service. If the
registry resolves newer compatible releases during implementation, the maintainer must inspect their
engine requirements and diff before accepting them.

## Reproducibility

From a clean install state:

1. `npm ci` succeeds from the committed lockfile.
2. `npm ls --all` reports no missing, extraneous, or invalid dependencies.
3. `npm audit` reports zero findings.
4. `npm audit --omit=dev` reports zero findings.
5. npm package smoke confirms Core and CLI still contain their required runtime files and executable
   boundary.
6. Application/Docker smoke confirms the production dependency graph loads in the supported runtime.

Both audit modes are mandatory. A clean production graph does not waive a development-only finding,
and a clean full graph does not replace explicit production evidence.

A tracked offline regression test rejects the known vulnerable Sentry/OpenTelemetry,
`brace-expansion`, and `undici` floors represented by this feature. It does not replace current npm
audit results and must not encode a permanently passing finding count.

## Diff Boundary

Allowed direct manifest change:

- compatible `@sentry/node` 10.x floor/range update.

Allowed lockfile movement:

- Sentry/OpenTelemetry packages affected by the direct update;
- compatible transitive fixes required to clear `brace-expansion` and `undici` findings; and
- deterministic removals/additions caused by that reviewed resolution.

Unexpected direct package changes, unrelated major resolutions, workspace metadata drift, install
scripts, registry settings, overrides, or package publication configuration stop implementation for
review.

## Mutation Boundary

This contract authorizes no npm publication, Git merge, deployment, production install, cache purge,
or production dependency mutation. It governs repository files and isolated verification only.
