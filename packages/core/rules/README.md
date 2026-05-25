# Plugin-style validator rules

The legacy `rules-request.js` / `rules-response.js` are flat-file
monoliths: one big `validateRequest(req, ctx) → findings[]` function
with `// ── Section ──` markers. They cover the IAB-spec baseline.

**This folder is the modular evolution.** Each rule-group lives in its
own folder under `packages/core/rules/<plugin>/`, registered in
`./index.js`, run as a pass in addition to the legacy validators.

## Why split

- Easier to find: bug in client-hints check → `rules/client-hints/`.
  No grepping a 432-line function.
- Easier to disable: `disabledRules: ['device.client_hints.*']` already
  works because findings use prefix-style IDs.
- Easier to test: each plugin owns its own test file.
- Future LLM-tuned thresholds, statistical context, A/B
  experimentation — all natural per-plugin.

## Plugin contract

```js
// packages/core/rules/<name>/index.js
module.exports = {
  id: 'client-hints', // short slug, also doc/UI label
  description: '…', // one-line summary (for UI toggles)
  appliesTo: ['ORTB_REQUEST'], // which payload kinds run this
  // (see TYPES in detect.js)
  applies(req, ctx) {
    // optional gate — return false to skip
    return true;
  },
  validate(req, ctx) {
    // required — return Finding[]
    const findings = [];
    // … push F('plugin.rule.id', LEVELS.WARNING, 'path', { params }) …
    return findings;
  },
};
```

The `validate()` function gets the same `(payload, ctx)` shape as legacy
rules. `ctx` includes `{ dialect, version, userDialect, req }`:

- `userDialect` — the caller's loaded user dialect, or `null`. Plugins can
  call `userDialect.lookupMapping(path, value)` to resolve vendor-mapped
  signals. The pop rules use it so a saved `ext.ad_type = 40 → pop` mapping is
  recognised without hardcoding the value (see `non-iab-formats.js`).
- `req` — on the **response** side, the paired bid request (from
  `opts.pairReq`, else `null`). `pop-response` reads it to treat a pop-slot
  request's bids as pop traffic even when an individual bid has no ext hint.

Return an array (never null). Use `makeFinding(id, level, path, params)` from
`../findings`.

## Adding a new plugin

1. `mkdir packages/core/rules/<name>/`
2. Write `index.js` matching the contract above.
3. Write `README.md` explaining what the plugin checks and why each
   rule has the severity it has.
4. Add message keys to `packages/core/messages/{en,uk,ru}.json` for
   every finding-id the plugin emits.
5. Register in `packages/core/rules/index.js` (one line in the
   PLUGINS array).
6. Add tests: `tests/rules-<name>.test.js`.
7. Bump test count in `docs/ARCHMAP.md` §1.5.

## How findings flow through the pipeline

```
validate(payload, opts) in packages/core/index.js
  │
  ├─→ detectType → ORTB_REQUEST / ORTB_RESPONSE / …
  │
  ├─→ legacy rules:
  │     validateRequest(req, ctx)        ← rules-request.js   (432 LOC)
  │     validateRequest30(req, ctx)      ← rules-request-30.js
  │     validateResponse(res, ctx)       ← rules-response.js
  │     validateResponse30(res, ctx)     ← rules-response-30.js
  │
  ├─→ plugin pass:
  │     runRulePlugins(payload, ctx)     ← THIS FOLDER
  │       ├─→ client-hints/index.js .validate(...)
  │       ├─→ (future) categories/index.js .validate(...)
  │       ├─→ (future) native/index.js .validate(...)
  │       └─→ …
  │     ← findings array, merged with legacy findings
  │
  ├─→ applyDisabledRules (skip suppressed ids/prefixes)
  ├─→ dedupFindings (collapse (id,path) duplicates)
  ├─→ sortFindings (severity DESC → path ASC → id ASC)
  └─→ decorate (attach localized msg + specRef)
```

Plugin findings join legacy findings before dedup+sort, so a plugin
can't accidentally shadow a legacy finding with the same id (they'd
collapse — and the params merge keeps the latest).

## Severity rules of thumb

- **error** — the request will be rejected by spec-compliant SSPs.
  Don't use for "best-practice missing" cases.
- **warning** — the request technically works, but something is wrong
  enough that buyout / fill / targeting will degrade. Use for missing
  recommended fields, deprecated patterns, dialect mismatches.
- **info** — best-practice note. Tells the integrator "you could do
  better" but the current state is fine.

If you're not sure → **warning**. `error` is for "this WILL be
rejected"; `info` is for "this is just a tip".

## Future expansion (intentionally not done yet)

- LLM-suggested checks: a plugin could call the LLM bridge (`intel-llm.js`)
  to flag patterns it noticed across recent traffic. Architecturally
  fits — plugin just returns findings.
- Statistical context: a plugin could query `analyze_log` for "how
  common is this missing field?" and downgrade severity if it's a
  majority pattern. Fits — same shape.
- Per-plugin enable/disable UI: validator-card could show toggles per
  plugin, mapped to `disabledRules: ['<plugin>.*']`. Fits — IDs
  already namespaced.

None of that is built today. The shape just doesn't preclude it.
