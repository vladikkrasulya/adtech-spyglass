# Contract: The Four Manifests

**Owner**: `packages/core/dialects/data/` | **Feature**: [016](../spec.md) | **Date**: 2026-08-28

Committed JSON, separately versioned, verified in CI **without** the out-of-tree corpus (FR-017).
Regeneration is a maintainer operation via `scripts/build-key-role-corpus.js`, never a CI step.

---

## Pinned sources — verified 2026-08-28

Every value below was reproduced from the corpus during planning.

| Pin                          | Value                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| Prebid Server commit         | `0ba352315253f6692af6497d553cfb12909a1b8b`                         |
| Schema files                 | 272 matching `static/bidder-params/*.json`                         |
| Aggregate schema-list digest | `8279e69f439f91b1e9d44274db139f2a3bd38261776b248b4b020d225767a3d5` |
| Adapter rules digest         | `73d067fa6ea9689b09167104db7bb1a72ff950446db8275b41bd54e32193598b` |
| LICENSE digest               | `9d130cc11efd232f041473f0cd62c43806b9389d63b599c8ee0862b699e8bc58` |
| ATTRIBUTION digest           | `06ab88a60ff471b4dfb9592fdcbaaeea773ba8e82ed2504a25cddaea5b481e1d` |
| Quarantine digest            | `4e5bb17122c8a592ef1f8559ef1dcae446cda0acb1ea15e099e21b0737c7ea88` |

The aggregate schema-list digest is SHA-256 over the UTF-8 byte stream of lexicographically sorted
`<file-sha256><two spaces><basename><newline>` rows.

---

## Construction rules — reproduced exactly during planning

**Schema side.** Exact names under each document's top-level `properties`; nested properties are not
traversed. Frozen assertions: **697** occurrences, **289** exact names, **279** names with at least
one non-empty description.

**Adapter side.** Eligible statuses are `verified`, `unverified`, `confirmed-omission`.
`evidence-unresolvable` and `deleted-by-verification` records stay in the audit report but **must
not** support an entry. Status histogram: **364** verified, **824** unverified, **42** confirmed
omissions, **2** evidence-unresolvable, **1** deleted-by-verification.

For each eligible rule, split `field` on literal `.`, find the **leftmost** segment exactly equal to
`ext`, emit its immediate child; when that child is exactly `bidder` and another segment follows,
emit that next parameter too. A path ending at `ext` emits nothing. After exact deduplication,
remove exactly `data`, `dsa`, `eids`, `gpid`, `schain`. Assertions: **133** raw → **128** after
exclusion, **95** shared spellings.

**Partition**: 194 `schema-only` + 33 `extension-only` + 95 `both` = **322**.

**Identity**: exact code-point spelling. Generation, adjudication and runtime lookup must not
lowercase, trim, separator-fold or merge. Entries sorted by UTF-8 byte order. The ASCII-lowercase
diagnostic index (**297** buckets, **22** collision buckets, **47** spellings) is advisory only — it
never selects a role or merges provenance.

---

## CI assertions — `tests/key-role-manifests.test.js`

Runs against the committed manifests alone. No corpus, no network, no live model.

1. **Corpus**: exactly 322 records; the 194/33/95 partition; byte-order sorting; no duplicates; no
   ineligible-status evidence; all pinned digests present and well-formed.
2. **Adjudication**: covers exactly the same 322 names plus every declared partition; no missing,
   extra, duplicate or unreviewed record; two independent review passes recorded; `resolved` has
   reviewer agreement or a recorded maintainer resolution with rationale.
3. **Score double-entry**: recomputing each `resolved` score from its `sourceRecordIds` via the
   authority oracle reproduces the stored value (R-04). Unverified-only support never exceeds `0.40`.
   Single-vendor repetition adds no breadth.
4. **Named rules**: contents match the confidence and 14-scenario oracles exactly; a named key
   outside the corpus is excluded from every 322-count assertion; an overlapping key keeps both
   provenance classes but one runtime identity.
5. **Vocabulary**: `STORABLE_LABELS` has exactly 20 members; the nine new IDs are absent from
   `FORMAT_LABELS`; `format-declaration` / `unknown` / `ambiguous` / `other` are not storable. The
   generated browser mirror `public/core/key-role-vocabulary.js` is set-equal to Core's export
   (R-10) — the no-bundler picker cannot `require` Core, so equality is gated instead of assumed.
6. **Routing matrix**: a fixture exists for every adjudication partition across all 322 names, every
   named rule, **every one of the 47 spellings** in the 22 collision groups, an unlisted-casing
   control, and an absent-key control in both namespaces. Every fixture carries a frozen `D0`. The
   run reports `D1` and the five route counts separately, asserts `D1 > D0`, and asserts that **no
   fixture deterministic in `D0` reaches the model in `D1`**.
7. **Attribution ships**: the Apache-2.0 attribution file is present next to the data and is
   referenced from the product, not only from the research directory (FR-005).

---

## Generator — `scripts/build-key-role-corpus.js`

Maintainer-only. Reads the out-of-tree corpus, writes the four manifests, and **rejects** rather
than repairs: missing, extra, duplicate, unreviewed, score-mismatched or silently flattened records
are hard failures. It reproduces every assertion above before writing, so a corpus change that moves
a count fails loudly instead of quietly re-baselining.

The generator never invents a role. The corpus supplies evidence; the reviewed adjudication manifest
supplies role truth. Majority voting, lexical plausibility alone and generator inference cannot
establish a role — the recorded independent review is the semantic acceptance oracle that digests
alone cannot provide.

---

## `D0` is captured once, before the change

The routing matrix's `D0` column must be measured against **pre-change** code and committed as data.
It is the baseline the no-demotion guarantee is proved against; capturing it after the resolver
changes would compare the new behaviour with itself and prove nothing. This ordering is a task
dependency, not a preference: `D0` capture blocks every subsequent implementation task.
