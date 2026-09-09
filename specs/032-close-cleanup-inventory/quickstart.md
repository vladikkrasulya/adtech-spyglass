# Verification guide

Use Node 22, workspace dependencies and real Chrome. Tests use fresh temporary data with news/FX integrations disabled.

1. Run focused tests for each task, covering malformed inputs, normative paths, feed aliases, floors and isolated family faults through Core/HTTP.
2. Run browser first-flight edit/clear, replaced/aborted runs, late temporary findings, remount, source selection, onboarding, toasts and partner failures in applicable locales.
3. Run concurrent runner lifecycle tests and lint with both formerly disabled rules enabled.
4. Run `npm run test:corpus`; preserve normative outcomes without new gaps.
5. Run `CHROME_BIN=/path/to/chrome npm run ci` on isolated Linux, then package/Docker and exact-commit hosted gates.
6. Complete canonical verified backup and `scripts/deploy.sh`; verify version/image/commit, health, smoke and restart policy.

Operational evidence remains outside tracked source. Record commands/outcomes in verification.md, without production records or permanent hard-coded test counts.
