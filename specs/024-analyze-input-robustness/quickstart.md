# Quickstart: Verifying the Analyze Boundary Fixes

All commands run from the repository root after `npm ci`.

## Reproduce the closed defects (any base before this feature)

```bash
# HTTP layer: DEF-115 (shape crash) and DEF-300 (dropped scalar), DEF-303 (oversized reset)
CORPUS_CASE='shape-bid-object,shape-seatbid-object,mut-input-shape-number-root-response,encoding-request-body-oversized' \
  node --test tests/corpus-core.test.js tests/corpus-http.test.js

# Browser layer: DEF-204 (client cur TypeError) and DEF-115 in the Inspector
CORPUS_REQUIRE_BROWSER=1 \
CORPUS_CASE='shape-bid-null,shape-bid-object,shape-seatbid-object,multiplicity-empty-bid-array,mut-input-shape-number-root-response' \
  node --test tests/corpus-browser.test.js
```

Before the fix these cases are recorded expected-failure markers; after it they pass normatively and
their ledger records are gone.

## Live HTTP probe (DEF-303)

```bash
# Start an isolated server, then post a body over the 2 MiB cap.
PORT=3999 ORTBTOOLS_DATA_DIR="$(mktemp -d)" node server.js &
python3 - <<'PY'
import json, urllib.request
body = json.dumps({"bidReq": {"id": "x", "imp": [{"id": "1", "banner": {"w": 300, "h": 250}}]},
                   "ext": {"pad": "x" * (3 * 1024 * 1024)}}).encode()
req = urllib.request.Request("http://127.0.0.1:3999/api/analyze", data=body,
                             headers={"content-type": "application/json"})
try:
    urllib.request.urlopen(req)
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()[:120])
PY
```

Expected: `400 {"success":false,"error":"Payload exceeds 2097152 byte limit","code":"payload_too_large"}`.

## Confirm no finding contract changed

```bash
node --test tests/spec-refs.test.js tests/i18n-audit.test.js tests/validator.test.js
```

## Full gate

```bash
npm run ci
```
