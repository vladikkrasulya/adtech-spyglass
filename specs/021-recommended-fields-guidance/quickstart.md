# Quickstart Validation: Recommended Fields Are Guidance, Not Errors

Prerequisites: repo checkout, Node.js >= 22.13.0, `npm ci` already run. Commands run from the
repository root.

## 1. Reproduce the class (before/after)

```bash
node -e '
const { validate, crosscheck } = require("@ortbtools/core");
const req = { id: "1", imp: [{ id: "1", banner: { w: 300, h: 250 } }], at: 1 };
const r = validate(req);
console.log(r.status, r.findings.map((f) => f.id + "[" + f.level + "]").join(", "));
const nobid = { id: "1", seatbid: [] };
console.log(validate(nobid).status, crosscheck(req, nobid).map((c) => c.id).join(", "));
'
```

Before this feature: `errors` with `request.device_required[error]` and
`request.no_site_or_app[error]`, then `errors` and `crosscheck.no_response`. After: `warnings` with
the same ids at warning level, then `clean` and `crosscheck.id_match`.

## 2. Narrow suites

```bash
node --test tests/validator.test.js tests/rules-25-audit.test.js tests/ortb30.test.js tests/cli.test.js tests/crosscheck-audit.test.js tests/i18n-audit.test.js
```

## 3. The 020 corpus over the affected cases

The 29 affected case ids (21 resolved, 8 re-pinned) are the files touched under `tests/corpus/`;
the non-browser layers run over the whole corpus in a few seconds:

```bash
node --test tests/corpus-lib.test.js tests/corpus-report.test.js tests/corpus-axes.test.js tests/corpus-fixture-contract.test.js tests/corpus-core.test.js tests/corpus-http.test.js
```

Browser layer for the affected cases (needs a local Chromium):

```bash
CORPUS_CASE=field-shape-device-missing,field-shape-no-site-or-app,nobid-empty-seatbid,banner-dooh-26-screen,cover-context-banner-26-unspecified CORPUS_REQUIRE_BROWSER=1 node --test --test-concurrency=1 tests/corpus-browser.test.js
```

## 4. Repository gate

```bash
npm run ci
```
