# Phase 0 Research: Vendor Ext-Key Role Alphabet

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-28

Eight decisions. Each was an unknown in the plan's Technical Context or an unresolved consequence of
a frozen contract in the specification. Everything below is settled; no `NEEDS CLARIFICATION`
remains.

---

## R-01 — Exact-case identity cannot reuse the existing key derivation

**Decision**: The role layer gets its own lookup that takes the **last path segment verbatim**, with
no case folding, trimming or separator normalisation. `signal-lexicon.js` keeps its lowercased
derivation for its own legacy rules, unchanged.

**Rationale**: The existing resolver opens with
`String(signalPath).split('.').pop().toLowerCase()`. The spec makes exact code-point spelling
canonical identity, and the corpus proves the two are incompatible: lowercasing the 322-name universe
collapses it to 297 buckets, with 22 collision buckets holding 47 distinct spellings — verified
this session. Reusing the lowercased key would silently merge provenance across names the corpus
treats as distinct, which FR-003 forbids ("Generation MUST NOT discard conflicts or let one source
overwrite another"). V1 has no case-fold alias fallback, so an unlisted casing must reach `abstain`,
not inherit a neighbour's role.

**Alternatives considered**:

- _Normalise the whole path in one place and share it._ Rejected: it would change the legacy
  resolver's matching behaviour, which FR-021 and the precedence matrix require to stay identical.
- _Lowercase in the role layer and disambiguate by provenance._ Rejected: the collision buckets are
  real distinct names with distinct evidence; disambiguating after merging re-invents the identity
  the merge destroyed.
- _Ship a case-fold alias table for the 22 buckets._ Rejected for v1 by the spec's explicit "V1 has
  no case-fold alias fallback". It remains a clean v2 addition once operator traffic shows demand.

---

## R-02 — Three manifests, not one, and data rather than generated code

**Decision**: Ship `key-role-corpus.v1.json` (evidence), `key-role-adjudication.v1.json` (reviewed
roles/states/scores) and `key-role-named-rules.v1.json` (repo-backed and specification-frozen rules)
as separate committed JSON files under `packages/core/dialects/data/`, each independently versioned.

**Rationale**: The spec requires the adjudication manifest to be "separately versioned and reviewed"
and the named-rule manifest to use "a separate provenance class … never inflate the corpus count".
Separate files make those boundaries mechanical instead of conventional: CI can assert the corpus
manifest contains exactly 322 names, that adjudication covers exactly the same set, and that named
rules outside the corpus are excluded from the 322-count assertions. It also lets evidence be
regenerated from a new corpus snapshot without invalidating human review, and lets review be revised
without touching evidence.

**Alternatives considered**:

- _One merged file._ Rejected: it makes the "count only corpus names" invariant a code convention
  rather than a checkable property, and couples regeneration to re-review.
- _Generate a JS module at build time._ Rejected: Constitution V forbids inventing a build pipeline;
  the repo has no bundler, and JSON is directly digestible by the CI checks FR-017 demands.
- _Store the alphabet in SQLite._ Rejected: Core must stay a pure data-to-data function
  (Principle IV) and the CLI uses Core without a database.

---

## R-03 — The generator is a maintainer operation; CI verifies without the corpus

**Decision**: `scripts/build-key-role-corpus.js` regenerates the manifests from the out-of-tree
corpus and is never invoked by `npm run ci`. CI instead runs `tests/key-role-manifests.test.js`,
which verifies the committed manifests' internal invariants: exact set equality, the
194 + 33 + 95 = 322 partition, digest fields, score derivation, review completeness, and that no
`evidence-unresolvable` or `deleted-by-verification` record supports an entry.

**Rationale**: FR-017 states the requirement directly, and the precedent already exists — the
calibration bench depends on a live host model and is deliberately excluded from CI for the same
reason (ADR-012). The research corpus is 113 MB, lives outside the git tree by explicit decision, and
is licence-audited separately; making the gate depend on it would break CI on any clone.

**Alternatives considered**:

- _Vendor the corpus subset into the repo._ Rejected: it re-imports an Apache-2.0 corpus into the
  product tree for no verification benefit the digests do not already provide, and the research
  README places the material outside the tree deliberately.
- _Regenerate in CI from a network fetch._ Rejected: Principle VII forbids external network
  dependencies in tests.

---

## R-04 — Score derivation is executable, not transcribed

**Decision**: The authority oracle is implemented as a pure function over an adjudication record's
evidence, and the generator writes the derived score into the manifest. CI asserts that recomputing
the score from the stored evidence reproduces the stored value for every record.

**Rationale**: The spec calls the score "mechanically derived" and "required, not a maximum the
adjudicator may lower arbitrarily". A transcribed number would drift the first time evidence is
revised. Storing _and_ recomputing gives both a readable manifest and a guarantee that the manifest
agrees with the rule.

**Alternatives considered**:

- _Compute at runtime only._ Rejected: the manifest becomes unreadable as a review artifact, and
  reviewers must agree on the score under the spec's two-pass rule.
- _Store only, trust the generator._ Rejected: it is precisely the silent-drift failure the
  double-entry check is cheap to prevent.

---

## R-05 — The legacy resolver returns a classified verdict

**Decision**: `resolveSignal()` gains a sibling that returns
`{ kind, suggestion }` where `kind` is one of `terminal-flag`, `specific-format`,
`guarded-contradiction`, `broad-heuristic`, or `abstain`. The existing `resolveSignal()` signature
and return value stay exactly as they are, implemented as a thin projection of the classified form.

**Rationale**: FR-001 requires the existing resolver to be "evaluated as evidence, not treated as one
indivisible stage", and the precedence matrix keys every row on that classification. But
`resolveSignal` is exported from Core, used by `scripts/label-calibration.js`, and covered by
existing tests — changing its shape would be a contract break for no gain. A sibling export keeps the
public surface additive.

**Alternatives considered**:

- _Infer the class from the returned `evidence[]` strings._ Rejected: it makes the matrix depend on
  string parsing of a field intended for humans, and would break silently when an evidence string is
  reworded.
- _Change `resolveSignal`'s return shape._ Rejected: needless public contract break (Principle IV).

---

## R-06 — Localize display names for all twenty labels, keep stored IDs

**Decision**: Add localized display names and one-line descriptions for **all** storable labels — the
eleven pre-existing plus the nine new — in en/uk/ru. The stored value stays the raw ID; only the
presentation changes.

**Rationale**: The picker today renders the raw ID as both `value` and visible text
(`dialect-label.js`, `esc(l)` twice). FR-023 requires the extended set to be "presented identically
wherever an operator meets it" and to "carry its meaning in all three supported languages". Nine
translated names sitting beside eleven raw identifiers is not identical presentation. Localizing
display only is compatible with FR-021, because nothing about a stored mapping's value or meaning
changes — a mapping stored as `ignore` is still `ignore`.

**Alternatives considered**:

- _Localize only the nine new labels._ Rejected: produces the mixed picker FR-023 rules out.
- _Localize nothing and rely on the ID._ Rejected: nine role IDs such as `delivery-control` and
  `privacy-consent` are exactly the vocabulary an operator needs explained, and Principle VI treats
  user-visible meaning as a contract.
- _Rename the stored IDs to localized strings._ Rejected outright: it would rewrite stored data and
  violate FR-021.

---

## R-07 — Persona edited once, calibrated once, with the locale repair folded in

**Decision**: Make the FR-008 claim-aware ceiling change and the Story 4 locale repair in a single
edit to `lib/label-persona.js`, then run the bench before and after that one edit.

**Rationale**: The file's own header requires the bench to be run around any edit, and warns that a
change improving TUNE alone is overfitting. Two sequential edits would mean two full bench cycles
against a shared host model for a change whose halves do not interact — the ceiling change concerns
the confidence scale, the locale repair concerns which language the prose comes back in. The spec
already assigns Story 4 P3 on exactly this reasoning ("Repairing it here avoids editing and
re-calibrating that artifact twice").

**Alternatives considered**:

- _Repair the locale in a separate follow-up feature._ Rejected: it is a live Principle VI breach and
  the artifact is open anyway.
- _Edit twice with two bench runs._ Rejected: doubles a GPU-bound maintainer operation for no
  isolation benefit, since the bench does not measure locale at all.

**Consequence to record**: because the bench does not check locale, the locale repair needs its own
regression coverage (spec Story 4, scenario 2). The bench's green result is not evidence for it —
this is exactly how the 015 change reported "identical before/after" while the breach survived.

---

## R-08 — Shape context on the egress path is a privacy-contract change

**Decision**: FR-013's impression-shape context is added to `docs/PRIVACY.md`'s enumeration of what
travels to the local model, in the same commit, with its regression test updated. Only the
**derived** verdict travels — the recommended family and its score — never the raw shape inputs
beyond what `redactImp()` already allows.

**Rationale**: Constitution III requires any change to external model use to update the
privacy/security contract and its regression tests in the same change. ADR-012 §6 makes the
travelling context an **allowlist**: "What may travel is enumerated, not filtered." Adding a field to
what is sent without adding it to the enumeration would break that condition, whether or not the
field is derived from data already permitted.

**Alternatives considered**:

- _Treat it as already covered because it derives from the allowlisted sketch._ Rejected: the
  allowlist enumerates what is sent, not what it is computed from; a derived verdict is a new item.
- _Send the full candidate list._ Rejected: `recommendedFormat()`'s single verdict is what FR-013
  needs for the explanation, and a narrower payload is the better default on an egress path.

---

## Cross-cutting note: what the bench cannot see

Three of this feature's obligations are invisible to `scripts/label-calibration.js` and therefore
need their own tests, or they will be reported as passing on evidence that does not cover them:

1. **Locale** (R-07) — the bench prompts in one language and never inspects the answer's language.
2. **Determinism across restarts and locales** (FR-007's "same exact score") — the bench runs one
   process, one locale.
3. **The precedence matrix** — the bench skips every case the deterministic layer resolves
   (`reachesModel()`), so growing the table _removes_ cases from the bench rather than testing them.

Point 3 is the important one for `tasks.md`: as the alphabet resolves more signals, the bench's
population shrinks. The 14-scenario oracle is the artifact that must carry those cases, and it lives
in CI where the bench cannot.
