# Implementation Plan: Single-Object Push Response Recognition

**Branch**: `main` (direct defect-repair workflow, per the 012 precedent) | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-single-push-recognition/spec.md`

## Summary

A single JSON object carrying a push material (creative text, icon/image, click destination,
cpc, identifiers) is a mainstream push-auction response, but `detectType()` only recognizes
push feeds in array form; the single object falls through to `unknown` and the Inspector
reports a blocking `payload.unknown_type`. The fix is three narrow extensions along the
existing seams: a conservative single-object push signature in `detect.js` (after every
existing branch, so all current classifications keep precedence), a single-object path through
the existing push-materials validator in `rules-feed.js` with alias acceptance (`id`/`tId`,
`click_url`/`link`, `cpc`/`price`, `image_url`/`image`, `icon_url`/`icon`) shared with the
array form, and push format-tagging in `format-detect.js` for plain feed objects and for the
`link` click-key alias. No new finding IDs, no message changes, no network/storage surface.

## Technical Context

**Language/Version**: Node.js >= 22.13.0, CommonJS (packages/core is the npm-workspace Core)

**Primary Dependencies**: none added — vanilla Node; Core stays a deterministic
data-to-data library with no network calls (Constitution IV)

**Storage**: N/A — detection/validation only; no persistence touched

**Testing**: `node:test` via existing suites — `tests/detection-mechanism.test.js` (detectType
matrix), `tests/validator.test.js` (feed rules through the public `validate()` boundary),
`tests/i18n-audit.test.js` (locale parity, unchanged keys); narrowest-first, then `npm run ci`

**Target Platform**: Linux server (hosted Inspector) + browser bundle (`public/ortbtools.app.js`
consumes Core through the same public API; source changes go live only via image rebuild)

**Project Type**: npm-workspace library (Core) consumed by app/CLI — single-project layout

**Performance Goals**: negligible — a handful of `in` checks on one object per analysis; no
new traversals

**Constraints**: deterministic findings with stable IDs and order (Constitution IV); no
production payload bodies in tracked artifacts or tests (III, VII); en/ru/uk parity (VI);
peer sessions share this worktree — stage only authored paths, never `git add -A`

**Scale/Scope**: 3 Core files touched (`detect.js`, `rules-feed.js`, `format-detect.js`),
2 test files extended, 0 message keys added; single-digit new branch conditions

## Constitution Check

_GATE: evaluated against constitution v2.1.0 before Phase 0; re-checked after Phase 1._

- **I — Spec Kit is the working memory**: PASS. Active package `specs/013-single-push-recognition/`
  with spec/plan/tasks; constitution, ROADMAP, and baseline read before authoring; the owner's
  go decision (2026-08-26) is recorded in the spec Input. Entered via `speckit.specify` (a
  reproduced production defect with an owner ruling, not an uncertain idea needing assessment).
- **II — Truth is evidence-backed**: PASS. The defect was reproduced against the live engine
  before the package was opened (single object → `unknown`; same object in an array →
  push-materials feed). All claims below cite the exact code seams.
- **III — Privacy/security boundaries**: PASS. No collection/retention/encryption/SSRF/model
  surface is touched. The reported payload body is NOT copied into any tracked artifact or
  test; tests use a synthetic replica (same keys and value shapes, synthetic values). The
  spec was amended to say so explicitly.
- **IV — Public contracts deterministic and compatible**: PASS with an explicit compatibility
  decision recorded in [contracts/feed-push-single.md](./contracts/feed-push-single.md):
  no finding ID changes; one additive result-type string
  `Push-Materials Feed Response (single)` following the existing
  `Link-Feed Response (single)` convention; `payload.unknown_type` narrows _when_ it fires
  (strictly fewer payloads), text and severity unchanged; alias acceptance strictly removes
  false-positive findings for materials that carry a documented alias. Boundary tests cover
  every changed behavior.
- **V — Architecture explicit and bounded**: PASS. All three changes extend the owning
  modules' existing contracts (signature list, validator, tagger); no new abstraction.
- **VI — Locales move together**: PASS. Zero new or changed message keys — the single-object
  path reuses the existing `feed.push.*` messages (with `num` = 1) and the existing type
  strings are not localized. `tests/i18n-audit.test.js` continues to enforce parity.
- **VII — Verification proportional and reproducible**: PASS. Regression tests are part of the
  same change (detectType matrix, alias matrix, precedence matrix, synthetic-replica
  end-to-end); narrowest tests first, `npm run ci` before commit. No live production data.
- **VIII — Releases traceable**: PASS with a named stop condition. Core's public behavior
  changes → Core SemVer minor bump (additive recognition). Commit is standing-authorized
  (authored, in-scope paths only). **Push and deploy are blocked right now**: the shared
  worktree carries peer-session modifications (`docker-compose.yml`, `docs/OPERATIONS.md`,
  `specs/011-*`, `tests/model-free-contract.test.js`), and a dirty tree blocks push/deploy by
  design — the block is cleared by its author, not worked around. Deployment follows later
  through the standing path once the tree settles.

**Post-Phase-1 re-check**: design added no violations — no new dependencies, no new finding
IDs, no message changes; the compatibility decision is written in the contract artifact.

## Project Structure

### Documentation (this feature)

```text
specs/013-single-push-recognition/
├── spec.md              # What/why + owner decision ($speckit-specify)
├── plan.md              # This file ($speckit-plan)
├── research.md          # Phase 0: decisions with rationale ($speckit-plan)
├── data-model.md        # Phase 1: entities, aliases, signature, precedence ($speckit-plan)
├── quickstart.md        # Phase 1: validation guide ($speckit-plan)
├── contracts/
│   └── feed-push-single.md  # Phase 1: public-boundary compatibility contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 ($speckit-tasks — not created by plan)
```

### Source Code (repository root)

```text
packages/core/
├── detect.js            # + single-object push signature in looksLikeJsonFeedSingle()
│                        #   (called at the existing detectType() seam, after all
│                        #   structural/wrapper/unique-key branches)
├── rules-feed.js        # validatePushMaterialsFeed(): per-material body extracted and
│                        #   shared; + detectSingleBidShape() 'push' branch AFTER the
│                        #   unique-key vendors; + alias acceptance (tId/image/icon)
├── format-detect.js     # detectFeedFormat(): `link` joins the click-key set; plain
│                        #   non-oRTB objects get the same feed tagging as array items
└── (messages/*.json     # unchanged — parity preserved by reuse)

tests/
├── detection-mechanism.test.js  # detectType matrix: claim + precedence + non-claims
└── validator.test.js            # feed rules: alias matrix, single-vs-array parity,
                                 #   synthetic replica end-to-end, format tags
```

**Structure Decision**: single-project npm workspace, all changes inside `packages/core` plus
its existing top-level test suites — the layout the owning subsystem already uses.

## Complexity Tracking

No constitution violations to justify; table intentionally empty.
