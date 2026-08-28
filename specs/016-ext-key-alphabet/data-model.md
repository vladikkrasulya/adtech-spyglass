# Phase 1 Data Model: Vendor Ext-Key Role Alphabet

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-28

Entities, their fields, the states they move through, and the invariants CI asserts. Nothing here is
persisted to SQLite except the widened accepted value set on an existing column.

---

## 1. CanonicalRole (closed enum)

Ten IDs, frozen by the spec's role-vocabulary table. Nine are storable; `format-declaration` is
neutral and projects to a storable label.

| ID                   | Storable | Projects to                                                                                               |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `format-declaration` | No       | `custom` while value unknown; a specific format label only when independent value evidence establishes it |
| `identifier`         | Yes      | `identifier`                                                                                              |
| `credential`         | Yes      | `credential`                                                                                              |
| `metadata`           | Yes      | `metadata`                                                                                                |
| `media-property`     | Yes      | `media-property`                                                                                          |
| `pricing`            | Yes      | `pricing`                                                                                                 |
| `targeting`          | Yes      | `targeting`                                                                                               |
| `privacy-consent`    | Yes      | `privacy-consent`                                                                                         |
| `delivery-control`   | Yes      | `delivery-control`                                                                                        |
| `measurement`        | Yes      | `measurement`                                                                                             |

**Invariants**

- `format-declaration`, `unknown`, `ambiguous` and `other` are never valid `semantic_label` values
  (FR-019).
- The storable set is exactly the eleven pre-existing labels plus the nine above = **20**.
- Every consumer that enumerates the storable set imports it from one module; no literal array is
  duplicated (FR-024).

---

## 2. StorableLabel

The eleven pre-existing (`pop`, `native`, `banner`, `video`, `audio`, `in-page-push`, `push`,
`interstitial-banner`, `ignore`, `informational`, `custom`) plus the nine new role IDs.

| Field           | Type   | Notes                                                    |
| --------------- | ------ | -------------------------------------------------------- |
| `id`            | string | Stored verbatim in `dialect_mappings.semantic_label`     |
| `displayName`   | i18n   | en/uk/ru — new in this feature for **all twenty** (R-06) |
| `description`   | i18n   | en/uk/ru one-liner shown in the picker                   |
| `isFormatLabel` | bool   | True only for the pre-existing specific format labels    |

**Invariants**

- `isFormatLabel` is an explicit allowlist. Format recognition tests membership of that allowlist,
  never "is an accepted stored label" (FR-022, suppression matrix).
- All twenty carry all three locales; key-parity tests cover them (Principle VI).
- Pre-existing labels retain their current `isFormatLabel`, suppression and runtime behaviour
  exactly (FR-021, SC-010).

---

## 3. CorpusEntry — `key-role-corpus.v1.json`

One record per exact-case name. Evidence only; carries no role.

| Field               | Type     | Notes                                                                                                  |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `name`              | string   | Exact code-point spelling. **Canonical identity.**                                                     |
| `coverage`          | enum     | `schema-only` \| `extension-only` \| `both`                                                            |
| `schemaEvidence[]`  | object[] | relative file, escaped `/properties/<name>` JSON pointer, source commit, description-presence flag     |
| `adapterEvidence[]` | object[] | bidder, original rule field, disposition, exact citation, literal status, source commit, corpus digest |

**Invariants** (asserted by `key-role-manifests.test.js`, no corpus needed)

- Exactly **322** records; partition **194** `schema-only` + **33** `extension-only` + **95** `both`.
- Names sorted by UTF-8 byte order; no duplicates after exact comparison.
- No `adapterEvidence` entry carries status `evidence-unresolvable` or `deleted-by-verification`.
- Every entry retains **all** contributing attestations — no source overwrites another (FR-003).
- Coverage and verification status are independent dimensions; neither is derived from the other.
- Manifest header pins: Prebid commit `0ba3523…`, rules digest `73d067fa…`, aggregate schema-list
  digest `8279e69f…`, LICENSE / ATTRIBUTION / QUARANTINE digests.
- A diagnostic lowercase index records 297 buckets and the 22 collision buckets holding 47
  spellings. It is **advisory** — it never selects a role or merges provenance.

---

## 4. AdjudicationRecord — `key-role-adjudication.v1.json`

One record per corpus name per declared context partition. This is where role truth lives, because
the corpus does not supply it.

| Field               | Type     | Notes                                                                                        |
| ------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `name`              | string   | Exact spelling; joins to `CorpusEntry.name`                                                  |
| `partition`         | object   | Applicable namespaces / vendor / path constraints, or `null` for the general case            |
| `state`             | enum     | `resolved` \| `ambiguous` \| `abstain`                                                       |
| `roleCandidates[]`  | enum[]   | One when `resolved`; two or more when `ambiguous`; empty on `abstain`                        |
| `score`             | number?  | Present only when `resolved`; one of `0.90`, `0.80`, `0.70`, `0.60`, `0.40`                  |
| `sourceRecordIds[]` | string[] | Joins back to specific evidence records                                                      |
| `rationale`         | string   | Concise: why the evidence establishes, conflicts on, or fails to establish the role          |
| `reviews[]`         | object[] | Two independent passes: reviewer ID, decision; plus any maintainer resolution with rationale |

**State semantics**

- **`resolved`** — exactly one role supported by semantically explicit evidence, no applicable
  conflict. Returns role + exact score + all provenance. No model call.
- **`ambiguous`** — two or more credible roles, or allowlisted payload context contradicts the
  otherwise applicable role. Returns candidates + evidence; **no** singular role, **no** overall
  confidence, **no** preselected label. No model call.
- **`abstain`** — the row proves the name exists but not its role here. No table role; routing
  resumes at the precedence matrix.

**Invariants**

- Covers **exactly** the 322 corpus names and every declared partition — no missing, extra,
  duplicate or unreviewed records; the generator rejects all four.
- `score` recomputed from `sourceRecordIds` via the authority oracle equals the stored `score`
  (R-04).
- `resolved` requires reviewer agreement, or an explicit maintainer resolution of a recorded
  disagreement with rationale. Source or reviewer disagreement ⇒ `ambiguous`. Absent citable
  semantic evidence ⇒ `abstain`.
- Majority voting, lexical plausibility alone, and generator inference never establish a role.
- Unverified evidence may support a candidate but cannot lift `score` above `0.40`.
- Repeated attestations from one vendor do not add breadth.

---

## 5. NamedRule — `key-role-named-rules.v1.json`

The separately sourced rules the confidence and 14-scenario oracles name. Distinct provenance class.

| Field        | Type   | Notes                                                                     |
| ------------ | ------ | ------------------------------------------------------------------------- |
| `key`        | string | Exact spelling                                                            |
| `provenance` | enum   | `repo-grounded` \| `specification-rule`                                   |
| `citation`   | string | Repository citation, or explicit "specification-frozen adjudication"      |
| `outcome`    | object | Role + required exact score, or `ambiguous` with candidates, or `abstain` |

Frozen contents: `adtype` / `ad_type` / `adformat` / `ad_format` → `format-declaration @ 0.90`;
`creative_type` → `0.70`; `type` / `format` capped at `0.40`; `imp_count` → `measurement @ 0.70`;
`ttl` → `delivery-control @ 0.70`; digit-only `build` → `metadata @ 0.70`; `subage` →
`measurement @ 0.90`; `flag` and `limit` → `ambiguous`; `mode` and `t` → `abstain`.

**Invariants**

- A named key overlapping the 322 corpus names keeps **both** provenance classes but exactly **one**
  runtime identity.
- A named key outside the corpus stays outside every 322-count assertion (FR-025).
- `ttl → delivery-control @ 0.70` is labelled a specification rule, not a corpus fact.

---

## 6. LegacyVerdict — the classified existing resolver (R-05)

| `kind`                  | Meaning                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `terminal-flag`         | Accepted format-naming truthy flag or established shape flag (`popunder`, `push`, `allowShock`, `sizeID=[0]`) |
| `specific-format`       | A format word corroborated or uncontradicted by the impression                                                |
| `guarded-contradiction` | A format word rejected by contradictory shape                                                                 |
| `broad-heuristic`       | A broad legacy `ignore` / `informational` key-pattern answer                                                  |
| `abstain`               | The resolver declines                                                                                         |

---

## 7. SignalAnswer — the response the operator receives

Discriminated on `resolutionStatus`.

**`resolved`** (role layer): `resolutionStatus`, `role`, `roleConfidence`, `valueStatus`
(`resolved` \| `unknown` \| `not-applicable`), projected `label`, `evidence[]`, `source`. The
pre-existing `confidence` field remains and **equals** `roleConfidence`, because the projected label
makes no specific value claim.

**`ambiguous`** (new variant, the contract extension): `resolutionStatus`, `roleCandidates[]`,
`evidence[]`. No singular role, no confidence, no preselected label.

**Model answer**: existing `label` / `confidence` / `source` shape unchanged; may additionally carry
routing evidence that a table abstention preceded it.

**Invariants**

- Only `valueStatus: resolved` may carry a specific `valueLabel` (FR-010).
- Existing model success / unavailable / timeout / error required fields and semantics are unchanged.
- `label` is a **projection**, never an alias of `role`.

---

## 8. Unchanged: DialectMapping

`dialect_mappings` keeps its columns, its `(dialect_id, signal_path, signal_value)` identity, and its
`signal_value TEXT NOT NULL` constraint. **No migration.** Only the accepted value set for
`semantic_label` widens. The value-independent mapping deferred by CL-001 would change this entity
and is explicitly out of scope.

---

## State flow

```text
signal
  └─ exact saved mapping? ──────────────── yes ─→ saved mapping (stop)
       │ no
       ├─ legacy verdict classified (§6)
       ├─ role layer state resolved (§4/§5, exact-case §3)
       └─ precedence matrix (FR-001)
            ├─ resolved   → SignalAnswer.resolved     (no model)
            ├─ ambiguous  → SignalAnswer.ambiguous    (no model)
            ├─ legacy preserved → existing answer     (no model)
            └─ all abstain → model                    (existing contract)
```

Suppression is not on this path. A suggestion suppresses nothing; suppression begins only after an
explicit operator save, and then only for the exact matching `question`.
