# Contract: Key-Role Layer (Core)

**Owner**: `packages/core/dialects/` | **Feature**: [016](../spec.md) | **Date**: 2026-08-28

Pure, deterministic, no I/O, no network — Constitution Principle IV. Every function below is a
data-to-data mapping over the committed manifests.

---

## `key-role-vocabulary.js`

```js
/** @type {readonly string[]} 10 canonical role IDs, frozen. */
CANONICAL_ROLES;

/** @type {readonly string[]} 20 storable labels: 11 pre-existing + 9 new role IDs. */
STORABLE_LABELS;

/** @type {readonly string[]} The pre-existing specific format labels. Format recognition
 *  tests membership HERE, never "is an accepted stored label". */
FORMAT_LABELS;

/**
 * Project a canonical role to the label an operator may save.
 * @param {string} role
 * @param {{valueStatus: 'resolved'|'unknown'|'not-applicable', valueLabel?: string}} value
 * @returns {string|null} null when the role is not storable and no projection applies
 */
projectRoleToLabel(role, value);
```

**Guarantees**

- `format-declaration` projects to `custom` when `valueStatus` is `unknown`; to a specific format
  label only when `valueStatus` is `resolved` and `valueLabel` is a `FORMAT_LABELS` member.
- `format-declaration`, `unknown`, `ambiguous`, `other` are never returned as storable labels.
- Each of the nine new labels is inert to format recognition: it is absent from `FORMAT_LABELS`.
- `STORABLE_LABELS` is the single source consumed by the save route, the model response schema, the
  browser picker and any export (FR-024). No consumer declares its own array.

---

## `key-role-alphabet.js`

```js
/**
 * Look up one signal's role state. Exact code-point identity — no case folding,
 * trimming, or separator normalisation (R-01).
 *
 * @param {object} input
 * @param {string} input.signalPath   'ext.<key>' or 'imp[].ext.<key>'
 * @param {unknown} input.signalValue
 * @param {object|null} [input.context] allowlisted payload context
 * @returns {{state:'resolved', role:string, score:number, evidence:object[]}
 *          |{state:'ambiguous', roleCandidates:string[], evidence:object[]}
 *          |{state:'abstain', evidence:object[]}}
 */
lookupKeyRole(input);
```

**Guarantees**

- Never returns `null`; absence of an entry is an explicit `abstain` carrying its evidence.
- `score` is one of exactly `0.90`, `0.80`, `0.70`, `0.60`, `0.40` and appears only on `resolved`.
- Equal inputs return the identical exact score across process restarts and locales (FR-007).
- An unlisted casing abstains; it never inherits a differently-cased entry (v1 has no alias
  fallback).
- Named rules and corpus adjudication are consulted under one runtime identity per exact key; a
  key present in both retains both provenance classes in `evidence`.
- The opaque numeric value never raises or lowers `score`.
- Lexical or name-only inference abstains unless the exact name is an independently reviewed
  named rule.

---

## `signal-lexicon.js` — additive change

```js
/**
 * Classified form of the existing resolver, for the precedence matrix.
 * @returns {{kind:'terminal-flag'|'specific-format'|'guarded-contradiction'
 *            |'broad-heuristic'|'abstain', suggestion: object|null}}
 */
classifySignal(input);
```

`resolveSignal()` keeps its **exact** current signature, return shape and behaviour, implemented as a
thin projection of `classifySignal()`. Existing callers — including
`scripts/label-calibration.js` — are unaffected (R-05).

---

## `resolve-precedence.js`

```js
/**
 * Combine the classified legacy verdict with the role-layer state per FR-001.
 * @returns {{outcome:'saved'|'resolved'|'ambiguous'|'legacy'|'model', answer: object|null}}
 */
combine({ savedMapping, legacy, role });
```

**The matrix is the contract.** Every row of the spec's precedence table is a test case in
`tests/key-role-precedence.test.js`. Two guarantees carry the most weight:

1. **No demotion.** A role-layer `abstain` never turns a previously deterministic answer into a
   model call. Where the legacy verdict is `broad-heuristic` and the role layer abstains, the legacy
   answer is preserved.
2. **No overrule of accepted format evidence.** `terminal-flag` stays terminal regardless of role
   state. `specific-format` is preserved when the role layer resolves `format-declaration` or
   abstains, and yields deterministic `ambiguous` when the role layer resolves a non-format role or
   is itself ambiguous — it is never silently replaced.

---

## Non-goals, asserted by test

- No value dictionary. `lookupKeyRole` never returns a decoded meaning for an opaque numeric value,
  in any state (FR-002).
- No writes. Nothing in this layer touches `dialect_mappings` (FR-014).
- No network, no filesystem read at call time; manifests are `require`d once at module scope.
- No suppression. A layer result is a suggestion; suppression begins only after an operator save.
