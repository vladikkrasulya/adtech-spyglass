# Verification

Run `node --test --test-concurrency=1 tests/inspector-density-browser.test.js` with the repository Chrome dependency available. Fixtures use disposable local state only. Verify stable typography and bounded columns at 1440/1920/2560/3840, en/uk/ru, light/dark and context visibility. Review saved synthetic desktop and phone screenshots. Run existing mobile, gutter, contrast, lifecycle and window-contract tests, then `npm run ci` and `git diff --check`. Deployment follows the baseline release contract after hosted package/Docker gates and a fresh verified backup.
