# Research and decisions

## Resource delivery

The existing handler marks any `?v=` immutable. Its JS hash omits later module-token injection; relative imports and runtime core CSS can bypass rewriting; module templates revalidate separately from cached styles. A header-only correction would leave the original mismatch possible. Use exact final-byte identities, explicit coupled resource versions and non-cacheable stale-version rejection. A new token namespace avoids colliding with old cache entries. Keep one existing server delivery owner rather than introducing a build pipeline or storing prior deployment trees.

## UI

A synthetic Chrome matrix over three locales and six widths found named tabs 43px high versus More 42px and a 0.5px baseline difference. Existing negative bottom margin causes it; count colors represent useful semantics and stay distinct.

Unlock password currently has no form owner or username field. Actual saved-password autofill was not reproduced; browser form ownership is a confirmed structural defect. Follow the [Chrome sign-in form guidance](https://web.dev/articles/sign-in-form-best-practices) with a modal-owned username/password form and single submission.

Native select popups cannot share the application's panel rendering everywhere. A narrowly scoped enhancement preserves the native value/options and implements the [WAI select-only combobox interaction](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/). Trigger-only styling would not meet Q5; a general UI framework is unnecessary.

## Dependencies

PRs 78-80 were combined in an isolated temporary copy before repository implementation. Clean install, dependency graph, full and production audits (zero findings), logger/health 19 tests, lint, types and package smoke passed. Complete integrated CI/native image gates remain pending. Existing three unused lint-disable warnings will be removed if still present in the final scope.

- [Sentry 10.73.0](https://github.com/getsentry/sentry-javascript/releases/tag/10.73.0): Express/Fastify helpers are not used by this node:http app.
- [OpenTelemetry 2.11.0](https://github.com/open-telemetry/opentelemetry-js/releases/tag/v2.11.0): reviewed transitive update.
- [Puppeteer 25.10.0](https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v25.10.0) and [browser manager 3.2.2](https://github.com/puppeteer/puppeteer/releases/tag/browsers-v3.2.2): additive recording API and transport/profile fixes.
- [Globals 17.12.0](https://github.com/sindresorhus/globals/releases/tag/v17.12.0): added global names.
- [Node types update](https://github.com/DefinitelyTyped/DefinitelyTyped/commit/5558e760ea4e5ce794088c9c1d3d2b19a35634c5): FFI pointer typing correction, unused here.

Keep the reviewed Sentry minimum 10.72.0, reject unsupported ranges/majors/prereleases and lock drift, and permit reviewed later stable 10.x releases. Bumping an exact literal every week is not the security property being protected.

## Scope and evidence

Historical 011 experiments remain cancelled. No pending owner choice is inferred from elapsed time. Local drafts are preserved in private out-of-tree archives before any cleanup. Old release records use exact tag commits, not current main. Current deployment was directly verified as 1.19.3 at 2f9c3a9; do not repeat a deployment merely to update its status.

## Additional verification evidence during integration

The actual complete runner exposed ten deliberately skipped SQLite-era event-log tests. Their header dates the missing ClickHouse replacement to 2026-05-23. Source inspection confirms the current owner batches JSONEachRow HTTP writes, asynchronously filters/maps reads and relies on server TTL for retention; direct SQLite assertions cannot verify that contract. FR-014/SC-008 and T032–T034 were added before test replacement. Parent read only schema column names/types and engine names for Blog tables, then supplied them to an isolated backend probe; no production content rows were queried.
