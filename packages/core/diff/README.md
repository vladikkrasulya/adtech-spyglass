# OpenRTB semantic diff engine

Pure CommonJS data-to-data comparison for JSON-compatible values. The engine has no side effects and exposes no UI, transport, persistence, clock, or randomness dependencies.

## API

```js
const { diffJson, rawDiff, semanticDiff } = require('@ortbtools/core');

rawDiff(left, right);
semanticDiff(left, right);
diffJson(left, right, { mode: 'raw' });
diffJson(left, right, { mode: 'semantic' });
```

Every call returns:

```js
{
  mode: 'raw' | 'semantic',
  equal: boolean,
  changes: [{ op, path, leftPath, rightPath, before?, after? }],
  warnings: [{ code, path, leftPath, rightPath, ...details }]
}
```

- `path` is deterministic. Ordinary segments follow RFC 6901 escaping. Semantic array members use selector segments such as `@id=%22imp-1%22` and `@set=%22USD%22`.
- `leftPath` and `rightPath` are concrete RFC 6901 pointers into the inputs; the absent side of an add/remove is `null`.
- `before` and `after` are detached JSON copies, so the result does not alias either input.

## Modes

Raw mode ignores object key order, as JSON objects are unordered, and compares every array positionally.

Semantic mode adds only the rules in `registry.js`:

- `/imp` matched by `id`
- `/seatbid` matched by `seat`
- `/seatbid/*/bid` matched by `id`
- explicitly listed set-like OpenRTB arrays compared by canonical member value

All other arrays remain positional. In particular, `source.ext.schain.nodes` is order-sensitive.

Set-like arrays have mathematical set semantics: both order and duplicate multiplicity are ignored. For example, `cur: ["USD", "USD", "EUR"]` is equal to `cur: ["EUR", "USD"]` in semantic mode.

If either side of an identity-matched array contains missing, invalid, or duplicate identities, that complete array falls back to positional comparison. The result includes an `array_identity_fallback` warning with indices and duplicate values for both sides; no data is silently discarded.

`equal` reports only whether `changes` is empty; warnings are independent. A degraded positional comparison can therefore return `equal: true` with non-empty `warnings`. Consumers must surface those warnings to show that the comparison was weaker instead of presenting an unqualified “no differences” state.

Inputs must be JSON-compatible: finite numbers, strings, booleans, null, dense arrays, and plain objects with data properties. Cycles, accessors, sparse arrays, non-JSON values, and nesting deeper than the `512`-level limit fail with a pointer-bearing `TypeError`. The depth guard rejects an excessive input before recursive comparison can exhaust the JavaScript call stack.
