# Contract: `POST /api/dialects/suggest-label`

**Owner**: `modules/ai-label/handler.js` | **Feature**: [016](../spec.md) | **Date**: 2026-08-28

The route gains **one** discriminated response variant and a widened label enum. Every pre-existing
response shape, status code and error semantic is unchanged. This is the public contract change
ADR-015 must record.

---

## Request — unchanged

```json
{ "signal_path": "imp[0].ext.ad_type", "signal_value": 30, "imp": {}, "locale": "uk" }
```

Validation, limits (`SIGNAL_PATH_MAX` 200, `SIGNAL_VALUE_MAX` 512), the path pattern, the auth gate
(401) and the rate limit (429) are untouched.

---

## Response 200 — five variants

### A0. Saved-mapping hit — new behaviour on this route

When the operator's default dialect carries an exact mapping for the signal, the response returns
the stored mapping itself (Spec §Public response compatibility):

```json
{
  "ok": true,
  "suggestion": {
    "label": "ignore",
    "source": "saved-mapping",
    "notes": "…stored notes if any…",
    "reason": "…"
  },
  "signal": { "path": "imp[0].ext.request_uuid", "value": "7c1e-44a0" }
}
```

No numeric confidence — the operator confirmed this mapping, and a score would misrepresent
certainty as measurement. No model call. Today the route consults no mapping at all, so this is a
new variant and part of the recorded compatibility decision (FR-028).

### A. `resolved` — new, from the role layer

```json
{
  "ok": true,
  "suggestion": {
    "resolutionStatus": "resolved",
    "role": "format-declaration",
    "roleConfidence": 0.9,
    "valueStatus": "unknown",
    "label": "custom",
    "confidence": 0.9,
    "reason": "…",
    "source": "lexicon",
    "evidence": []
  },
  "signal": { "path": "imp[0].ext.ad_type", "value": 30 }
}
```

- `confidence` is retained for compatibility and **equals** `roleConfidence`, because the projected
  label makes no specific value claim: `custom` explicitly includes "value unknown", and each new
  non-format label carries `valueStatus: not-applicable`.
- `label` is a **projection** of `role`, never an alias.
- Only `valueStatus: "resolved"` may carry `valueLabel`.

### B. `ambiguous` — new variant

```json
{
  "ok": true,
  "suggestion": {
    "resolutionStatus": "ambiguous",
    "roleCandidates": ["delivery-control", "pricing", "format-declaration"],
    "reason": "…",
    "source": "lexicon",
    "evidence": []
  },
  "signal": { "path": "imp[0].ext.limit", "value": 1 }
}
```

No singular `role`, no `roleConfidence`, no `confidence`, **no preselected `label`**. The client must
not preselect an option in the picker for this variant.

### C. Preserved legacy deterministic answer — unchanged shape

When the precedence matrix preserves an existing verdict — a terminal format flag, a specific-format
string verdict, or a broad `ignore`/`informational` heuristic over which the role layer abstained —
the response is **byte-compatible with today's**:

```json
{
  "ok": true,
  "suggestion": {
    "label": "pop",
    "confidence": 0.9,
    "reason": "…",
    "source": "lexicon",
    "evidence": ["flag-key:popunder"]
  },
  "signal": { "path": "imp[0].ext.popunder", "value": 1 }
}
```

No `resolutionStatus`, no `role`, no `roleConfidence`. A client that predates this feature keeps
working on this path because the path did not change. **This is the variant the first draft of this
contract omitted**, and it is the one that carries the no-demotion guarantee: a signal answered
deterministically today is still answered deterministically, in the same shape.

### D. Model answer — unchanged shape, routing evidence now required

Existing `label` / `confidence` / `source: "model"` shape and semantics. It **MUST** additionally
carry routing evidence recording that every deterministic source abstained before the model was
called:

```json
{
  "label": "identifier",
  "confidence": 0.7,
  "source": "model",
  "routing": { "roleLayer": "abstain", "legacy": "abstain" }
}
```

Required, not optional. Without it, variants C and D cannot be told apart, and the five route counts
SC-002 demands (`exact-format`, `role-resolved`, `role-ambiguous`, `preserved-legacy`, `model`)
cannot be produced.

---

## Saved-mapping precedence — resolved server-side

The request is **unchanged** and carries no dialect ID. The handler resolves the mapping itself
(R-11): default dialect for the authenticated operator → `loadUserDialect` →
`lookupMapping(normalizedPath, serializedValue)`, using the index-collapsed path form
(`imp[].ext.<key>`) and the same value serialization the save route and the question rule already
use. **No default dialect ⇒ no saved-mapping precedence**, and routing proceeds at the next matrix
row.

Recorded limitation: an operator may save into a chosen dialect that is not their default, so
precedence covers the default dialect only. This is strictly better than today, where this route
consults no mapping at all, and it never fails dangerously — a missed mapping yields a suggestion the
operator can still override, whereas applying a _different_ dialect's mapping would be wrong.

---

## Hard invariants across all five variants

1. **No decode.** No variant ever derives a specific ad format from an opaque numeric value, in any
   locale, at any confidence (FR-009). `valueLabel` appears only when `valueStatus` is `resolved`,
   and never from a numeric code.
2. **Projection, not aliasing.** `label` is the enumerated projection of `role`. `format-declaration`
   projects to `custom` while the value is unknown; the nine new roles project to themselves; no
   other mapping exists.
3. **A suggestion suppresses nothing.** Suppression begins only after an explicit operator save, and
   then only for the exact matching `question` at that dialect + path + serialized value. Nothing
   here creates the value-independent mapping deferred by CL-001.
4. **The model prompt payload is unchanged.** The role layer adds no field to what travels: the model
   still receives only the signal path and value, the redacted impression sketch and sibling key
   names. `docs/PRIVACY.md` is unchanged and must stay unchanged (R-08; now a requirement, FR-033).
5. **`valueStatus: resolved` is reserved.** No v1 path produces it (Spec §FR-010); a test asserts
   the role layer never emits it. The state exists so future value evidence extends the contract
   instead of changing it.
6. **Outcome→variant mapping is exhaustive** (Spec §Public response compatibility): saved-mapping
   hit → A0; every "preserve" row → C unchanged; role-layer resolved/ambiguous → A/B; only the final
   matrix row → D. No outcome is unmapped.

---

## Errors — unchanged

`401 unauthorized` · `429 rate_limited` · `503 labeller_unavailable` · `504 labeller_timeout` ·
`502 labeller_failed` / `bad_model_output`. Codes, bodies and the client's branching on `code` are
untouched. Unavailability remains a supported state (ADR-012 §7): the role layer answers more
signals, so the model is reached less often, but when it is reached and unreachable the behaviour is
exactly as today.

---

## `POST /api/dialects/:id/mappings` — widened accepted set

`semantic_label` now accepts the 20 storable labels. Everything else is unchanged: the route still
requires a non-empty `signal_value` string, still stores against
`(dialect_id, signal_path, signal_value)`, and still performs no wildcard matching. **No schema
migration.**

**Compatibility floor (FR-021, SC-010)**: every mapping stored before this change keeps its exact
meaning and runtime behaviour. Asserted by regression over the pre-existing label set, not by
inspection.

---

## Model response schema — widened enum

`lib/ollama.js`'s constrained-decoding enum gains the nine new role labels, so a fallback answer can
stop collapsing them into `ignore` / `informational`. Its singular `label` / `confidence` / `reason`
shape and its calibrated, non-deterministic confidence semantics are otherwise unchanged.

**Claim-aware ceiling (FR-008)**: the prompt contract states the exemption, and the output validator
and any post-processing **must accept `identifier @ 0.70` unchanged** for a numeric value. A blanket
`numeric ⇒ confidence ≤ 0.30` rule anywhere in the chain is non-conforming.

---

## Client obligations — `public/modules/inspector/dialect-label.js`

1. Render `resolved` with the role and the value as **two distinct things**, only one of which the
   operator decides (FR-010, Story 3).
2. Render `ambiguous` with candidates and evidence, preselecting nothing.
3. Keep provenance and source visible; a table answer and a model guess must not share a badge
   (ADR-012 §4).
4. Show unverified evidence with its literal status.
5. State the saved mapping's real scope: **this dialect, this normalized path, this exact serialized
   value** — never "all future traffic" (FR-015).
6. Present all twenty labels with localized names and descriptions in en/uk/ru (FR-023, R-06).
