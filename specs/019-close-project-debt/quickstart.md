# Verification quickstart

1. Run focused new resource HTTP/browser regressions on disposable fixtures. Test stale/current/duplicate versions, final-byte and dependency propagation, old tabs, style failure and abort.
2. Run UI browser regressions for combobox keyboard/typeahead/pointer/disabled/dynamic options, unlock form association and single submit, tab geometry in three locales/two themes.
3. Run auth email locale tests and dependency range/advisory tests. Run full and production `npm audit` for the reviewed combined graph.
4. Run `npm run ci` after every parallel browser session ends; the runner's Chrome cleanup is not safe in parallel with them. Run `scripts/npm-pack-smoke.sh` and `scripts/ci-docker-smoke.sh` as required by the release contract.
5. Inspect the final diff and convergence inventory; commit only session-authored scope, non-force push clean main, wait for hosted checks.
6. Use the documented `sudo -n scripts/backup-db.sh --pre-deploy` flow and verify fresh archives immediately before `scripts/deploy.sh`; do not bypass readiness, rollback or permissions.
7. Read back local/public health SHA, image labels, restart policy and version. Verify release metadata from GitHub after creation.

Record exact commands and outcomes in verification.md. Test data stays synthetic and disposable; private artifacts are archived outside Git.
