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

## Response 200 — three variants

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

### C. Model answer — unchanged

Existing `label` / `confidence` / `source: "model"` shape. May additionally carry routing evidence
recording that a table abstention preceded it. Required fields and their semantics are identical to
today.

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
