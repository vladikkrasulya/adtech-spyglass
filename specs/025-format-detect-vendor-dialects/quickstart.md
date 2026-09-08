# Quickstart: Verifying the Format-Detection Alignment

All commands run from the repository root after `npm ci`.

## Reproduce the closed defects (any base before this feature)

```bash
# Core + HTTP: DEF-160 (image_url/icon_url tag), DEF-181 (clickurl), DEF-161 (array dispatch),
# DEF-460 (standalone Native adm)
CORPUS_CASE='push-x-kadam-material-single,push-x-numeric-string-cpc,inpage-x-card-feed-single,inpage-x-card-feed-array,push-x-richads-bare-array,cover-input-push-response-only' \
  node --test tests/corpus-core.test.js tests/corpus-http.test.js

# Browser: previews and format tags for the same cases
CORPUS_REQUIRE_BROWSER=1 \
CORPUS_CASE='push-x-kadam-material-single,push-x-numeric-string-cpc,inpage-x-card-feed-single,inpage-x-card-feed-array,push-x-richads-bare-array,cover-input-push-response-only' \
  node --test tests/corpus-browser.test.js
```

Before the fix these cases are recorded expected-failure markers; after it they pass normatively
(the two-card `inpage-x-card-feed-array` keeps only the separate DEF-201 selection gap).

## Confirm the coupled DEF-107 re-pin

```bash
# These stay known gaps (their request decoder is still unbuilt) but their format deviation
# is now the re-pinned one.
CORPUS_CASE='inpage-kadam-icon-notice,inpage-kadam-separate-notice-alias,push-kadam-icon-notice' \
  node --test tests/corpus-core.test.js tests/corpus-http.test.js
```

## Confirm no finding contract changed

```bash
node --test tests/spec-refs.test.js tests/i18n-audit.test.js tests/format-detect.test.js tests/validator.test.js
```

## Full gate

```bash
npm run ci
```
