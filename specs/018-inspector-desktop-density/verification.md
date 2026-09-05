# Verification record — 2026-09-05

Synthetic fixtures only; no screenshot account details or live request bodies copied.

At 2560 pixels before the repair: finding text 16.896px, editor 16.64px, verdict 19px; canvas 2324px, open context 330px and results 997px (1162px with context closed). After: finding/editor 13px, verdict 17px, canvas 2200px, context 240px, results 800px. The CSS geometry is recorded in [visual-evidence.json](./visual-evidence.json).

- `node --test tests/inspector-density-browser.test.js`: passed in real Chrome; 48 locale/width/theme/context combinations, plus expanded finding checks. Artifact capture used `ORTBTOOLS_DENSITY_ARTIFACTS` pointing outside the repository.
- `node --test --test-concurrency=1 tests/mobile-inspector-browser.test.js tests/gutter-width-browser.test.js tests/finding-contrast-browser.test.js tests/inspector-reentrant.test.js tests/window-contracts.test.js`: passed, no skips.
- Visual inspection of synthetic 2560×1440 light/closed and dark/open screenshots: compact text, distinct columns, readable findings, no overlay or clipping. The context's narrow history status may wrap normally.

The first full CI exposed a SpecKit status-format error, with all browser tests passing. The feature status and requirement/task references were corrected before rerunning the complete gate.

The corrected `npm run ci` passed: formatting, lint, type checking, coverage and all browser files. `git diff --check` passed. The required pre-push hook reruns CI on the final committed scope. Exact commit, hosted CI and deployment outcomes are recorded at the release gate; this document does not claim a production deployment before it happens.

## Final convergence

The implementation satisfies FR-001 through FR-006 and the build/verification portions of SC-001 through SC-004. Layout/type changes stay within their existing CSS owners. Browser regression covers stable type, bounded and separate panels, expanded finding visibility and editor/gutter metrics; existing mobile, contrast, lifecycle and window-contract tests pass. 2560px light/closed and dark/open, 1920px dark/open and 3840px dark/open screenshots were visually inspected. No additional implementation task remains. Release execution follows the prepared exact-SHA gate after commit; it is not represented as already deployed in these immutable candidate artifacts.
