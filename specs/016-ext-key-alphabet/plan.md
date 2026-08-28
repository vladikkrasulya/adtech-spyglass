# Implementation Plan: Vendor Ext-Key Role Alphabet

**Branch**: `main` (direct defect-repair workflow, per the 012/013/014/015 precedent) | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-ext-key-alphabet/spec.md`

## Summary

Add a deterministic, exact-case **key-role layer** in front of the model on the dialect labelling
path, and correct the confidence contract so a number measures the claim its answer actually makes.

Three artifacts ship together and are separately versioned: a **frozen corpus snapshot** of 322
exact-case names with full provenance, a **reviewed adjudication manifest** assigning each name a
`resolved` / `ambiguous` / `abstain` state with a mechanically derived score, and a **named-rule
manifest** for the repo-backed and specification-frozen rules the oracles name. A **precedence
matrix** combines these with the existing resolver as classified evidence rather than as one
indivisible stage, so terminal format flags stay terminal, string-format verdicts are reconciled
rather than overruled, role evidence supersedes only broad legacy `ignore`/`informational`
heuristics, and an alphabet abstention never demotes a working deterministic answer into a model
call.

The savable label set gains exactly nine non-format role IDs, and the response gains one
discriminated `ambiguous` variant. Both are public contract changes and require an ADR.

**Verified before planning** (Principle II). Every frozen assertion in the spec reproduces exactly
against the out-of-tree corpus: Prebid commit `0ba3523…`, rules digest `73d067fa…`, 272 schemas,
697 occurrences, 289 names, 279 with descriptions, status histogram 364/824/42/2/1, 133 raw → 128
after exclusion, 95 intersection, the 194 + 33 + 95 = 322 partition, the aggregate schema-list digest
`8279e69f…`, the LICENSE/ATTRIBUTION/QUARANTINE digests, and the 297-bucket / 22-collision / 47-spelling
lowercase diagnostic. The snapshot construction rules are mechanically reproducible as written.

## Technical Context

**Language/Version**: Node.js `>=22.13.0`; CommonJS in Core and backend modules; dependency-free
vanilla ES in the browser (no bundler), per Constitution Principle V.

**Primary Dependencies**: None added. Core stays dependency-free. Existing `better-sqlite3` for the
dialect store, `puppeteer-core` for browser regression, `node:test` as the runner. The corpus
generator is a maintainer-run Node script using only the standard library.

**Storage**: The three manifests are committed JSON under `packages/core/dialects/data/`. The
`dialect_mappings` **schema is unchanged** — the nine new role IDs are new accepted values in the
existing `semantic_label TEXT NOT NULL` column, not a migration. No `/data` access is required.

**Testing**: `npm run ci` = `format:check && lint && typecheck && test:coverage`. `tsc --noEmit`
with `checkJs` is part of the gate, so every new exported function needs JSDoc types. The
calibration bench (`scripts/label-calibration.js`) needs a live host model and therefore cannot gate
CI — it stays a recorded maintainer operation, as ADR-012 already establishes.

**Target Platform**: Linux container serving the hosted Inspector; three browser locales; the
labelling model runs on the host via the shared `gemma4-prod` runner.

**Project Type**: Web service with an npm-workspace Core/CLI and lazily loaded vanilla SPA sections.

**Performance Goals**: Role lookup is an exact-case `Map` hit — O(1), no I/O, no allocation beyond
the returned record. The layer must _reduce_ model calls, never add one. The three manifests load
once at module scope; combined they are a few hundred KB of JSON and are `require`d, not fetched.

**Constraints**: Core remains a deterministic data-to-data function with no network call
(Principle IV). CI must verify the manifests' sets, digests and invariants **without** reading the
out-of-tree corpus (FR-017). The model stays local and bounded to this one path (ADR-012 §1, §5).
Exact code-point spelling is identity — the existing resolver's `toLowerCase()` key derivation
**cannot** be reused for the role layer.

**Scale/Scope**: 322 corpus names + a named-rule manifest; 9 new storable labels; 10 canonical
roles; one new response variant; 14 frozen regression scenarios plus a 2-fixture ceiling oracle;
3 locales; 7 files that enumerate the label set today.

## Constitution Check

_GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design._

| Principle                                | Verdict          | How this plan satisfies it                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Spec Kit is working memory**        | Pass             | Constitution, roadmap, baseline contracts and the feature package were read before authoring. `spec.md` → this `plan.md` → `tasks.md` next. Task state updates at phase boundaries.                                                                                                                                                                                                      |
| **II. Truth is evidence-backed**         | Pass             | Every frozen count and digest re-verified this session (see Summary). No unrun check is reported as passing. Repository state and deployed state are distinguished throughout.                                                                                                                                                                                                           |
| **III. Privacy and security**            | Pass             | **The model privacy allowlist does not expand** (spec assumption; R-08). FR-013's shape verdict is computed and surfaced locally, never added to the prompt — the model keeps receiving exactly what ADR-012 §6 enumerates, and `docs/PRIVACY.md` is unchanged. FR-012 forbids retaining the live payload: the two live observations enter the repo only as redacted synthetic replicas. |
| **IV. Deterministic, compatible**        | **ADR required** | Nine new storable labels and the `ambiguous` response variant are public contract changes. Requires ADR-015, boundary tests, and FR-021/SC-010 compatibility coverage. Finding IDs, dedup semantics and storage schema are untouched. Core stays network-free.                                                                                                                           |
| **V. Architecture explicit and bounded** | Pass             | No new framework, bundler, service or store. The role layer is a pure module beside `signal-lexicon.js` in the subsystem that already owns this vocabulary. Manifests are data, not code generation at runtime.                                                                                                                                                                          |
| **VI. Locales move together**            | Pass             | Nine new labels need display names and descriptions in en/uk/ru in the same change. Resolves the picker inconsistency in Phase 0 (see research R-06).                                                                                                                                                                                                                                    |
| **VII. Proportional verification**       | Pass             | Every behaviour change carries a regression test. The 14-scenario oracle and the 2-fixture ceiling oracle are executable. Bench is run before and after and recorded, and is explicitly not a CI gate.                                                                                                                                                                                   |
| **VIII. Traceable releases**             | Pass             | Core public contract changes → `@ortbtools/core` `0.37.0` → `0.38.0` (MINOR, additive). CLI dependency range and `package-lock.json` follow. App bump only if operator-visible copy changes — it does (FR-015, FR-023), so app `1.18.0` → `1.19.0` with `public/version.js`, the per-locale HTML, and baseline.                                                                          |

**No unjustified violations.** One obligation is recorded rather than waived: ADR-015 (IV). It is a
task, not an exception, so the Complexity Tracking table stays empty.

### Gate consequences carried into tasks

1. **ADR-015 is authored before any code change** that widens the accepted label set — Principle IV
   forbids silent contract changes, and Spec-Driven Delivery §6 requires the record when the reason
   behind an architecture boundary changes.
2. **`D0` is captured before any resolver change lands.** The routing matrix's pre-change baseline
   must be measured against current code and committed as data, or `D1 > D0` measures the new
   behaviour against itself (R-09).
3. **A privacy-boundary regression test** asserts the model prompt gains no new field — the shape
   verdict stays local. `docs/PRIVACY.md` is unchanged and must stay unchanged.
4. **`tests/model-free-contract.test.js`** must keep asserting ADR-003's surviving scope: the role
   layer is deterministic and adds no model reachability anywhere new.

## Project Structure

### Documentation (this feature)

```text
specs/016-ext-key-alphabet/
├── plan.md                     # This file
├── research.md                 # Phase 0 — eight resolved decisions
├── data-model.md               # Phase 1 — entities, states, invariants
├── quickstart.md               # Phase 1 — runnable validation guide
├── contracts/
│   ├── key-role-layer.md       # Core's pure resolution contract
│   ├── suggest-label-api.md    # HTTP response variants and compatibility
│   └── manifests.md            # The three JSON artifacts and their invariants
├── checklists/requirements.md  # Spec quality checklist (complete)
└── tasks.md                    # Phase 2 — NOT created by this command
```

### Source Code (repository root)

```text
packages/core/dialects/
├── key-role-vocabulary.js      # NEW closed role enum, projection to storable labels,
│                               #     suppression + format-recognition matrix
├── key-role-alphabet.js        # NEW exact-case lookup over the manifests; pure, no I/O
├── resolve-precedence.js       # NEW the FR-001 matrix; classifies the legacy resolver's
│                               #     result and combines it with the role layer
├── signal-lexicon.js           # CHANGED returns a classified verdict instead of a bare
│                               #     suggestion; existing behaviour preserved
├── user-dialect-runtime.js     # CHANGED format recognition uses an explicit allowlist
└── data/
    ├── key-role-corpus.v1.json         # NEW 322 entries, full provenance, digests
    ├── key-role-adjudication.v1.json   # NEW reviewed roles/states/scores, two review passes
    ├── key-role-named-rules.v1.json    # NEW repo-backed rules, with conditions and caps
    ├── key-role-routing-matrix.v1.json # NEW SC-002 fixtures: every partition, every collision
    │                                   #     group member, casing + absence controls, frozen D0
    └── ATTRIBUTION.md                  # NEW Apache-2.0 attribution shipped with the table

packages/core/
├── non-iab-formats.js          # CHANGED format-label allowlist made explicit
└── messages/{en,uk,ru}.json    # CHANGED role names, descriptions, ambiguity copy

modules/
├── ai-label/handler.js         # CHANGED routes through the precedence matrix; sends shape
└── dialects/handler.js         # CHANGED accepted label set widened

lib/
├── ollama.js                   # CHANGED response schema enum ONLY; prompt payload unchanged
└── label-persona.js            # CHANGED claim-aware ceiling; locale repair (Story 4)

public/core/
└── key-role-vocabulary.js      # NEW generated browser mirror of STORABLE_LABELS + catalog;
                                #     CI asserts set equality with Core (R-10)

public/modules/inspector/
├── dialect-label.js            # CHANGED role/value split, ambiguous variant, scope warning
└── dialect-label.i18n.js       # CHANGED three locales for the new vocabulary

scripts/
├── build-key-role-corpus.js    # NEW maintainer-only regeneration; never runs in CI
└── label-calibration.js        # CHANGED bands revised deliberately; hold-out extended

tests/
├── key-role-alphabet.test.js       # NEW lookup, exact-case identity, states
├── key-role-precedence.test.js     # NEW every row of the FR-001 matrix
├── key-role-manifests.test.js      # NEW set equality, digests, invariants — no corpus needed
├── key-role-oracle.test.js         # NEW the 14 frozen scenarios + 2 ceiling fixtures
├── key-role-routing-matrix.test.js # NEW D0/D1, five route counts, no-new-model-call
├── key-role-browser-mirror.test.js # NEW browser mirror equals Core's export
├── ai-label.test.js                # CHANGED new variant, widened label set
├── dialects.test.js                # CHANGED compatibility floor for pre-existing labels
└── model-free-contract.test.js     # CHANGED asserts the role layer adds no model reach

specs/decisions/ADR-015-*.md    # NEW storable roles + ambiguous response variant
                                #     docs/PRIVACY.md is deliberately UNCHANGED (R-08)
```

**Structure Decision**: The role layer lives in `packages/core/dialects/` beside `signal-lexicon.js`
because that directory already owns this vocabulary and ADR-005 places dialect semantics in Core.
Three modules rather than one: the **vocabulary** is a closed enum other layers import without
pulling in data; the **alphabet** is lookup over data; **precedence** is the combination rule. Each
is separately testable, and precedence is the piece most likely to change, so it does not sit inside
either of the other two. The manifests are `data/` rather than generated code so CI can verify their
digests and set equality directly, and so the maintainer-run generator has no runtime presence.

Two consequences of the review are structural, not cosmetic. **Core performs no mapping lookup**: it
has no database and Principle IV keeps it pure, so `modules/ai-label/handler.js` resolves the saved
mapping from the authenticated operator's default dialect and passes it in (R-11) — the request stays
unchanged and carries no dialect ID. And **the browser gets a generated mirror**
(`public/core/key-role-vocabulary.js`) with a CI equality gate, because FR-024's single-import rule
cannot be satisfied literally in a no-bundler IIFE loaded by script tag (R-10); `public/core/` already
exists for exactly this purpose.

## Complexity Tracking

> No Constitution Check violations require justification. The one recorded obligation (ADR-015) is a
> task within the existing rules, not an exception to it. `docs/PRIVACY.md` is deliberately
> unchanged — the model allowlist does not expand (R-08).

## Phase Outputs

- **Phase 0** → [research.md](./research.md): eleven decisions, each with rationale and rejected
  alternatives. Resolves the exact-case lookup conflict, manifest layout, generator/CI split, score
  double-entry, resolver classification, picker localization, persona editing strategy, the
  shape-context privacy boundary (R-08, reversed on review), the routing-matrix artifact (R-09), the
  browser mirror (R-10), and where a saved mapping comes from (R-11).
- **Phase 1** → [data-model.md](./data-model.md), [contracts/](./contracts/),
  [quickstart.md](./quickstart.md).
- **Phase 2** → `tasks.md`, produced by `/speckit-tasks`, not by this command.
