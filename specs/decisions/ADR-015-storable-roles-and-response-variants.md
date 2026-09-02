# ADR-015: Storable Role Labels and Discriminated Response Variants

**Status**: Accepted
**Date**: 2026-09-02
**Extends**: [ADR-005](./ADR-005-evidence-driven-dialects.md) (what a mapping stores),
[ADR-012](./ADR-012-bounded-model-assist-on-dialect-labelling.md) condition 2 (growing the
deterministic table). Amends neither: this is the recorded compatibility decision that
[016](../016-ext-key-alphabet/spec.md) FR-020/FR-028 require before any widening code lands.

## Context

The dialect labeller's savable vocabulary was built for one question — "which ad format does this
vendor field declare?" — plus two escape labels (`ignore`, `informational`) and one honest
abstention (`custom`). Feature 016's evidence shows the operator usually learns something richer:
that a field is an identifier, a price, a consent signal, a delivery switch. Today that knowledge
collapses into `ignore`/`informational` at save time, and the answer's confidence number measures a
claim the label never made.

Separately, the deterministic layer 016 adds can end in honest ambiguity (two credible roles) — a
state the single-label response shape cannot express without pretending certainty.

## Decision

The public contract changes in exactly four surfaces (016 FR-028), together, in one Core MINOR line:

1. **Stored value set.** `dialect_mappings.semantic_label` accepts nine new role IDs —
   `identifier`, `credential`, `metadata`, `media-property`, `pricing`, `targeting`,
   `privacy-consent`, `delivery-control`, `measurement` — beside the eleven pre-existing labels.
   Twenty total. **No storage migration**: new accepted values in the existing column (FR-032).
2. **HTTP response.** `POST /api/dialects/suggest-label` gains three NEW variants (of five total):
   role-layer `resolved` (role + projected label + `valueStatus`), `ambiguous` (candidates, no
   singular confidence, nothing preselected), and `saved-mapping` (the stored label, no numeric
   confidence — the operator confirmed it; a score would misrepresent certainty as measurement).
   Preserved legacy deterministic answers and model answers keep today's shape field-identically;
   model answers additionally carry required routing evidence.
3. **Core exports.** One normative vocabulary module exports `CANONICAL_ROLES` (10),
   `STORABLE_LABELS` (20) and the explicit `FORMAT_LABELS` allowlist; every surface that enumerates
   labels imports it (FR-024). Format recognition tests `FORMAT_LABELS` membership, never "is an
   accepted stored label" — each new role is inert to format recognition by test (FR-022).
4. **Model-output schema.** The constrained-decoding enum gains the same nine labels; the numeric
   confidence ceiling becomes claim-aware (FR-008) and may not clamp a role-only label because the
   observed value is numeric.

**Compatibility floor.** Every mapping stored before this change keeps its exact meaning and
behaviour across all four observable dimensions — suppression, format recognition, display,
serialization (FR-021) — proven by regression over the pre-existing eleven, not by inspection
(SC-010). Withdrawal or rename of a role after release is a new contract decision; a stored mapping
carrying a withdrawn label continues to load, suppress and display as its raw ID (FR-029).

**Version consequence** (Constitution VIII): `@ortbtools/core` 0.37.0 → 0.38.0 (MINOR, additive);
the CLI dependency range and `package-lock.json` follow in the same change; app 1.18.0 → 1.19.0 for
the operator-visible surfaces. The CLI ships no labelling surface and gains none (FR-030).

**Deployment property** (FR-031): the Inspector UI — the route's only consumer — ships in the same
immutable image as the server, so no deployed client can predate the new variants.

## Alternatives considered

- **Roles as display-only hints that save as `ignore`/`informational`.** Rejected by the
  maintainer's CL-002 decision: the dialect should record what the operator actually learned, and a
  hint that collapses on save teaches the store a lie.
- **A separate `role` column beside `semantic_label`.** Rejected: a storage migration for data the
  label value itself can carry; two columns whose disagreement becomes a new defect class.
- **Widening `custom` into a catch-all with free-text notes.** Rejected: notes are unqueryable,
  unlocalizable, and invisible to suppression semantics; the closed enum keeps behaviour testable.
- **Letting `ambiguous` answers preselect the highest-scoring candidate.** Rejected: first-wins is
  exactly the resolution the spec forbids; a preselected pick converts documented disagreement into
  a nudge.

## Consequences

- Operators can save what a field is, and read it back as the same thing (SC-009).
- Every enum-bearing surface moves in one change or CI fails: the browser picker consumes a
  generated mirror gated by a byte-equality test (R-10), because the no-bundler IIFE cannot import
  Core.
- The nine new labels ship with localized names and descriptions in en/uk/ru in the same change
  (Principle VI); the eleven pre-existing labels gain localized display at the same time without
  any change to their stored IDs (R-06, FR-021-safe).
- `format-declaration` is a role, never a stored label; it projects to `custom` while the value is
  unknown. `valueStatus: resolved` is RESERVED — no v1 path produces it, a test asserts that, and
  future value evidence extends the contract instead of changing it (FR-010).
- A future role addition or withdrawal repeats this decision's shape: recorded ADR, four surfaces,
  compatibility floor, version consequence.

## Related artifacts

- [016 spec](../016-ext-key-alphabet/spec.md) — FR-019–FR-034, the closed vocabulary, the
  suppression matrix, the response-compatibility contract
- [016 contracts](../016-ext-key-alphabet/contracts/) — key-role-layer, suggest-label-api, manifests
- [ADR-005](./ADR-005-evidence-driven-dialects.md), [ADR-012](./ADR-012-bounded-model-assist-on-dialect-labelling.md)
