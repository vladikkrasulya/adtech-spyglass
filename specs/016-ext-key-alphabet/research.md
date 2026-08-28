# Phase 0 Research: Vendor Ext-Key Role Alphabet

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-28

Ten decisions. Each was an unknown in the plan's Technical Context or an unresolved consequence of a
frozen contract in the specification. Everything below is settled; no `NEEDS CLARIFICATION` remains.

> **Revision 2026-08-28 (post-review).** R-08 previously concluded that the impression-shape verdict
> travels to the model and that `docs/PRIVACY.md` must therefore change. That was wrong: it was
> derived from an earlier draft of FR-013. The hardened specification states plainly that "the model
> privacy allowlist does not expand". R-08 is reversed below. R-09 and R-10 were added to close two
> gaps the same review found.

---

## R-01 — Exact-case identity cannot reuse the existing key derivation

**Decision**: The role layer gets its own lookup that takes the **last path segment verbatim**, with
no case folding, trimming or separator normalisation. `signal-lexicon.js` keeps its lowercased
derivation for its own legacy rules, unchanged.

**Rationale**: The existing resolver opens with
`String(signalPath).split('.').pop().toLowerCase()`. The spec makes exact code-point spelling
canonical identity, and the corpus proves the two incompatible: lowercasing the 322-name universe
collapses it to 297 buckets, with 22 collision buckets holding 47 distinct spellings — verified this
session. Reusing the lowercased key would silently merge provenance across names the corpus treats as
distinct, which FR-003 forbids. V1 has no case-fold alias fallback, so an unlisted casing must reach
`abstain`, not inherit a neighbour's role.

**Alternatives considered**:

- _Normalise the whole path in one place and share it._ Rejected: it would change the legacy
  resolver's matching behaviour, which FR-021 and the precedence matrix require to stay identical.
- _Lowercase in the role layer and disambiguate by provenance._ Rejected: the collision buckets are
  real distinct names with distinct evidence; disambiguating after merging re-invents the identity
  the merge destroyed.
- _Ship a case-fold alias table for the 22 buckets._ Rejected for v1 by the spec's explicit "V1 has
  no case-fold alias fallback". A clean v2 addition once operator traffic shows demand.

---

## R-02 — Four manifests, not one, and data rather than generated code

**Decision**: Ship `key-role-corpus.v1.json` (evidence), `key-role-adjudication.v1.json` (reviewed
roles/states/scores), `key-role-named-rules.v1.json` (repo-backed and specification-frozen rules) and
`key-role-routing-matrix.v1.json` (the SC-002 routing fixtures, see R-09) as separate committed JSON
files under `packages/core/dialects/data/`, each independently versioned.

**Rationale**: The spec requires the adjudication manifest to be "separately versioned and reviewed"
and the named-rule manifest to use "a separate provenance class … never inflate the corpus count".
Separate files make those boundaries mechanical instead of conventional: CI can assert the corpus
manifest contains exactly 322 names, that adjudication covers exactly the same set, that named rules
outside the corpus are excluded from the 322-count assertions, and that the routing matrix carries a
fixture for every partition. It also lets evidence be regenerated from a new snapshot without
invalidating human review.

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
corpus and is never invoked by `npm run ci`. CI instead runs `tests/key-role-manifests.test.js`
against the committed artifacts: exact set equality, the 194 + 33 + 95 = 322 partition, digest
fields, score derivation, review completeness, routing-fixture coverage, and that no
`evidence-unresolvable` or `deleted-by-verification` record supports an entry.

**Rationale**: FR-017 and SC-011 both state it. The precedent exists — the calibration bench depends
on a live host model and is excluded from CI for the same reason (ADR-012). The research corpus is
113 MB, lives outside the git tree by explicit decision, and is licence-audited separately.

**Alternatives considered**:

- _Vendor the corpus subset into the repo._ Rejected: re-imports an Apache-2.0 corpus into the
  product tree for no verification benefit the digests do not already provide.
- _Regenerate in CI from a network fetch._ Rejected: Principle VII forbids external network
  dependencies in tests.

---

## R-04 — Score derivation is executable, not transcribed

**Decision**: The authority oracle is a pure function over an adjudication record's evidence. The
generator writes the derived score into the manifest; CI asserts that recomputing it from the stored
evidence reproduces the stored value for every record.

**Rationale**: The spec calls the score "mechanically derived" and "required, not a maximum the
adjudicator may lower arbitrarily". A transcribed number drifts the first time evidence is revised.
Storing _and_ recomputing gives a readable review artifact plus a guarantee it agrees with the rule.

**Alternatives considered**:

- _Compute at runtime only._ Rejected: the manifest becomes unreadable as a review artifact, and
  reviewers must agree on the score under the two-pass rule.
- _Store only, trust the generator._ Rejected: the silent-drift failure a double-entry check
  prevents cheaply.

---

## R-05 — The legacy resolver returns a classified verdict

**Decision**: `signal-lexicon.js` gains a sibling returning `{ kind, suggestion }` where `kind` is
`terminal-flag`, `specific-format`, `guarded-contradiction`, `broad-heuristic` or `abstain`.
`resolveSignal()` keeps its exact signature and return value, implemented as a thin projection.

**Rationale**: FR-001 requires the existing resolver to be "evaluated as evidence, not treated as one
indivisible stage", and every precedence row keys on that classification. But `resolveSignal` is a
Core export used by `scripts/label-calibration.js` and covered by existing tests; changing its shape
would be a contract break for no gain.

**Alternatives considered**:

- _Infer the class from the returned `evidence[]` strings._ Rejected: makes the matrix depend on
  parsing a human-facing field; breaks silently on a rewording.
- _Change `resolveSignal`'s return shape._ Rejected: needless public contract break (Principle IV).

---

## R-06 — Localize display names for all twenty labels, keep stored IDs

**Decision**: Add localized display names and one-line descriptions for **all** storable labels — the
eleven pre-existing plus the nine new — in en/uk/ru. The stored value stays the raw ID.

**Rationale**: The picker renders the raw ID as both `value` and visible text (`dialect-label.js`,
`esc(l)` twice). FR-023 requires the extended set to be "presented identically wherever an operator
meets it" and to carry its meaning in all three languages. Nine translated names beside eleven raw
identifiers is not identical presentation. Localizing display only is compatible with FR-021: nothing
about a stored mapping's value or meaning changes.

**Alternatives considered**:

- _Localize only the nine new labels._ Rejected: produces the mixed picker FR-023 rules out.
- _Localize nothing._ Rejected: `delivery-control` and `privacy-consent` are exactly the vocabulary
  an operator needs explained; Principle VI treats user-visible meaning as a contract.
- _Rename the stored IDs._ Rejected outright: rewrites stored data, violates FR-021.

---

## R-07 — Persona edited once, calibrated once, with the locale repair folded in

**Decision**: Make the FR-008 claim-aware ceiling change and the Story 4 locale repair in a single
edit to `lib/label-persona.js`, then run the bench before and after that one edit.

**Rationale**: The file's header requires the bench around any edit and warns that improving TUNE
alone is overfitting. Two sequential edits mean two full bench cycles against a shared host model for
a change whose halves do not interact. The spec assigns Story 4 P3 on exactly this reasoning.

**Alternatives considered**:

- _Repair the locale in a follow-up feature._ Rejected: a live Principle VI breach, artifact open
  anyway.
- _Edit twice with two bench runs._ Rejected: doubles a GPU-bound operation for no isolation benefit,
  since the bench does not measure locale at all.

**Consequence to record**: the bench does not check locale, so the locale repair needs its own
regression coverage. A green bench is not evidence for it — that is exactly how the 015 change
reported "identical before/after" while the breach survived.

---

## R-08 — The model privacy allowlist does not expand _(reversed on review)_

**Decision**: **No new data reaches the model.** The impression-shape verdict FR-013 permits is
computed and surfaced **locally** — in the deterministic explanation the operator reads and in the
role layer's `evidence[]`. It is never added to the model prompt. `docs/PRIVACY.md` is therefore
**unchanged** by this feature, and the model continues to receive exactly what ADR-012 §6 already
enumerates: the signal path and value, the redacted impression sketch, and sibling extension key
names.

**Rationale**: The specification states it directly — "The model privacy allowlist does not expand.
Alphabet lookup and provenance rendering are local; when the alphabet abstains, the model receives
only the already accepted signal path/value, allowlisted impression sketch and sibling key names."
Hardened FR-013 governs how allowlisted context behaves inside deterministic resolution — it may be
_surfaced_ as explanation, must not change role/state, must not raise confidence, must not decode the
value. "Surfaced as context" means shown to the operator, not shipped to the model.

**What this reverses**: an earlier revision of this document concluded the opposite, from a
pre-hardening draft of FR-013 that read "MUST be available to the model as context". That draft no
longer exists. The plan's Constitution Check, its file tree, and its gate consequences are corrected
to match.

**Alternatives considered**:

- _Send the derived verdict anyway and enumerate it._ Rejected: contradicts an explicit specification
  assumption. ADR-012 §6 makes the travelling context an allowlist, and widening it needs its own
  decision — which this feature does not seek.
- _Send it only when the alphabet abstains._ Rejected for the same reason; a conditional expansion is
  still an expansion.

---

## R-09 — The routing matrix is a fourth committed manifest

**Decision**: `key-role-routing-matrix.v1.json` is generated, committed and asserted in CI. It
carries one fixture for **every** adjudication namespace/vendor/path partition across all 322 exact
names, every separately named repo-backed rule, **every member** of each of the 22 case-collision
groups, unlisted-casing controls, and an opaque absent-key control in **both** supported namespaces
(`ext.<key>` and `imp[].ext.<key>`). Each fixture records the frozen pre-change deterministic answer
`D0`; the test run measures `D1`. Reported route counts are five, separately: exact-format,
role-resolved, role-ambiguous, preserved-legacy, and model.

**Rationale**: SC-002 and SC-011 require this artifact by name and it was missing from the first
plan. It is also the only mechanism that can prove the two guarantees the precedence matrix exists
for — `D1 > D0`, and **no fixture answered deterministically before may newly reach the model**. A
per-test assertion cannot show that; only a closed matrix with a frozen baseline can.

`D0` must be captured **before** any resolver change lands, against the current code, and committed
as data. Capturing it afterwards would measure the new behaviour against itself.

**Alternatives considered**:

- _Derive coverage from the adjudication manifest at test time._ Rejected: coverage would then be
  computed by the same code under test, and `D0` would have no frozen home.
- _Sample the partitions._ Rejected: SC-002 says "every", and the collision groups are precisely
  where sampling would hide a regression.
- _Keep it in the test file._ Rejected: `D0` is evidence with a provenance date, not test scaffolding;
  and the generator must be able to reject an incomplete matrix.

---

## R-10 — The browser gets a generated mirror, guarded by a CI equality test

**Decision**: `STORABLE_LABELS` and the label display catalog are generated into
`public/core/key-role-vocabulary.js` as a plain IIFE mirror, loaded by `<script defer>` like every
other browser module. A CI test asserts byte-level set equality between the mirror and Core's
authoritative export.

**Rationale**: FR-024's "one module, no consumer declares its own array" cannot be satisfied
literally in the browser: `public/modules/inspector/dialect-label.js` is a no-bundler IIFE with zero
`require` calls, loaded by script tag. The repo already solves this shape of problem — `public/core/`
exists precisely as a browser-side mirror directory. A generated mirror plus an equality gate keeps
one **source** of truth while accepting two **copies**, and makes divergence a build failure rather
than a silent drift.

**Alternatives considered**:

- _Serve the catalog from an API endpoint._ Rejected for v1: it adds a network dependency to render a
  static picker, and a fetch failure would leave the picker empty — worse than a mirror whose
  staleness CI catches.
- _Introduce a bundler._ Rejected: Constitution V requires measured need and an ADR; a 20-item enum
  is not that need.
- _Hand-maintain the browser array._ Rejected: exactly the drift FR-024 exists to prevent.

---

## R-11 — Saved-mapping precedence resolves server-side from the operator's default dialect

**Decision**: The request stays **unchanged** — `signal_path`, `signal_value`, `imp`, `locale`. The
handler resolves the mapping itself: `getDefaultDialectForUser(db, user.id)`, then `loadUserDialect`,
then `lookupMapping(normalizedPath, stringifiedValue)` using the same index-collapsed path form
(`imp[].ext.<key>`) and the same value serialization the save route and question rule already use.
When the operator has no default dialect, no saved-mapping precedence applies and routing proceeds at
the next matrix row.

**Rationale**: `combine()` takes `savedMapping`, but nothing in the current request carries a dialect
ID, and the first plan did not say where it comes from — a real hole. The specification keeps the
request unchanged, so the dialect must be derived server-side. `getDefaultDialectForUser` already
exists in `user-dialect-runtime.js`, the route is already authenticated, and the save route is
already user-scoped, so no new identity or data flows.

**Recorded limitation**: the picker lets an operator save into a _chosen_ dialect, which may not be
their default. Precedence therefore covers the default dialect only. This is strictly better than
today (where the suggest route consults no mapping at all) and never wrong in the dangerous
direction: a missed mapping yields a suggestion the operator can still override, while a _wrong_
dialect's mapping is never applied.

**Alternatives considered**:

- _Add `dialect_id` to the request._ Rejected for v1: the spec says the request is unchanged, and the
  client would have to resolve a dialect before the operator has chosen one.
- _Consult every dialect the user owns._ Rejected: two dialects may map the same signal differently;
  picking between them is a guess, and FR-016 scopes precedence to one dialect.

---

## Cross-cutting note: what the bench cannot see

Three obligations are invisible to `scripts/label-calibration.js` and need their own tests, or they
will be reported as passing on evidence that does not cover them:

1. **Locale** (R-07) — the bench prompts in one language and never inspects the answer's language.
2. **Determinism across restarts and locales** (FR-007) — the bench runs one process, one locale.
3. **The precedence matrix** — the bench skips every case the deterministic layer resolves
   (`reachesModel()`), so growing the table _removes_ cases from the bench rather than testing them.

Point 3 is why R-09 exists. As the alphabet resolves more signals the bench's population shrinks; the
routing matrix and the 14-scenario oracle carry those cases, and both live in CI where the bench
cannot.
