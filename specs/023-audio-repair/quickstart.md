# Quickstart: Verify Audio Repair

Run from the isolated feature checkout with the supported Node runtime and its own installed workspace dependencies. Use only synthetic fixtures. The test runner can clean browser processes, so on a host shared with other agents execute complete CI inside a private PID namespace.

## Focused public and malformed-input controls

```bash
node --test tests/audio-repair.test.js tests/format-detect.test.js tests/vast.test.js tests/creative-preview-classify.test.js
node --test tests/api-stability.test.js tests/i18n-audit.test.js tests/spec-refs.test.js tests/version-consistency.test.js
```

Expected: the adopted 12 review controls, bounded malformed-input probes and valid controls pass; both audio finding IDs have stable error semantics in Core, actual HTTP and CLI plus equivalent localized messages. A malformed child timeout, crash or signal is a failure, never a skip or expected failure.

## Corpus and browser preview

```bash
node --test tests/corpus-core.test.js tests/corpus-http.test.js
CORPUS_CASE="audio-mimes-missing,audio-daast-26-request-only,audio-inapp-26-podcast-companion,audio-inapp-26-wrapper,audio-web-25-mp3-legacy,audio-web-26-live-exact-aac,audio-web-26-multi-imp-reversed,audio-x-ctv-smartspeaker-postroll,audio-x-daast-inline-podcast,audio-x-nvol-companion-html,audio-x-stitched-preroll-podcast,audio-x-vast41-bitrate-ladder,cover-context-audio-25-ctv,cover-context-audio-25-inapp,cover-context-audio-25-unspecified,cover-context-audio-26-dooh,cover-context-audio-26-unspecified" CORPUS_REQUIRE_BROWSER=1 node --test tests/corpus-browser.test.js
```

The browser selector names the 17 adopted audio IDs explicitly. Use `CORPUS_CASE`, not the unsupported `CASES` variable. Expected audio outcomes: 16 fully normative cases, one independent browser DEF-201. DAAST is visible as inert XML with no playback or remote-fetch claim. All unexpected deviations fail; remaining ledger guards continue to match.

## Settled local gates

```bash
unshare --user --map-current-user --pid --fork --mount-proc npm run ci
bash scripts/npm-pack-smoke.sh
git diff --check
```

Use the isolated Docker smoke gate when required and available per the baseline quickstart; do not target production. Record actual commands, outcomes, limitations and runner totals in verification.md. Run convergence only after implementation and verification. A verified isolated local commit/patch does not establish shared-main integration, hosted CI, npm publication or deployment.
