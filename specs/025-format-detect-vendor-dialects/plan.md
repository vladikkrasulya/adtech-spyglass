# Implementation Plan: Format Detection and Feed Dispatch Alignment

**Branch**: `main` (direct defect-repair workflow) | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/025-format-detect-vendor-dialects/spec.md`

## Summary

Four detection/dispatch defects, one theme: a payload the engine already validates or previews under
one set of field names was not recognized under an equivalent alias, or an array element was force-fit
through the wrong field contract. The fix aligns the three key-role tables (`detect.js`,
`format-detect.js`, `rules-feed.js`) and the Inspector's material finder on the `image_url`/`icon_url`
creative aliases and the `clickurl` click alias, dispatches a materials array per element so a
bid-price-shaped element is validated against its own contract, and tags a standalone Native `adm`
body from its own shape when `mtype` is absent. No finding id, level or message changes.

## Technical Context

**Language/Version**: Node.js >= 22.13.0, CommonJS (packages/core is the npm-workspace Core)

**Primary Dependencies**: none added

**Storage**: N/A

**Testing**: `node:test` — the 020 corpus at the Core, HTTP and browser layers is the regression net;
plus `tests/spec-refs.test.js`, `tests/i18n-audit.test.js`, `tests/format-detect.test.js` and
`tests/validator.test.js` for the no-change guarantees; then `npm run ci`

**Target Platform**: Linux server (hosted Inspector), browser bundle, CLI

**Project Type**: npm-workspace library consumed by app/CLI

**Performance Goals**: unaffected — the changes are constant-time key checks and one bounded JSON parse

**Constraints**: stable finding ids, levels and order (Constitution IV); regression coverage at the
public boundary in the same change (VII); only explicit authored paths staged (shared tree)

**Scale/Scope**: 3 Core files, 1 browser bundle, 6 corpus fixtures retired, 3 corpus fixtures
re-pinned (DEF-107 coupling), 2 empty ledger shards removed, the validator contract and this package

## Constitution Check

_GATE: evaluated against constitution v2.1.0 before research; re-checked after implementation._

- **I — Spec Kit is the working memory**: PASS. Package `specs/025-format-detect-vendor-dialects/`
  with spec/plan/research/contract/quickstart/checklist/tasks; the constitution, ROADMAP, the
  validator contract and the 020 records were read before authoring.
- **II — Truth is evidence-backed**: PASS. Each defect was a recorded expected-failure marker on the
  committed engine and is closed against the changed engine on the same corpus layers; the coupled
  DEF-107 signature drift was measured directly and re-pinned to the observed residual deviation.
- **III — Privacy/security boundaries**: PASS. No collection, retention, network or model surface;
  every fixture is synthetic; the Native `adm` sniff parses JSON without resolving any reference.
- **IV — Public contracts deterministic and compatible**: PASS with the explicit decision in
  [contracts/format-detection-boundary.md](./contracts/format-detection-boundary.md): no id added,
  removed or renamed; no level or message changed. Detection tags more payloads correctly and one
  array element is validated against the right contract — strict improvements, and why Core bumps.
- **V — Architecture explicit and bounded**: PASS. The alias sets are aligned in place; the bid-price
  field contract is extracted once and shared by the standalone object and the array element.
- **VI — Locales move together**: PASS. No message key added or changed; `tests/i18n-audit.test.js`
  passes unchanged.
- **VII — Verification proportional and reproducible**: PASS. The recorded deviations were the tests;
  they are retired only because the product now meets the spec expectation, and the coupled DEF-107
  cases are re-pinned to their measured residual. Commands and outcomes are in [tasks.md](./tasks.md).
- **VIII — Releases traceable**: PASS. Core takes a MINOR bump with the CLI range and lock in the same
  branch; commit and push are standing-authorized; deployment is a separate decision.

An ADR is not created: this feature changes no policy. The durable rules it establishes are recorded
in the validator contract, which the constitution names as the alternative to an ADR for this case.

## Project Structure

### Documentation (this feature)

```text
specs/025-format-detect-vendor-dialects/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
├── contracts/
│   └── format-detection-boundary.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/
├── format-detect.js   # image_url/icon_url creative aliases; standalone Native adm sniff
├── detect.js          # clickurl in the single-object classifier
├── rules-feed.js      # clickurl click check; per-element array dispatch; shared bid-price contract
└── package.json       # Core MINOR bump
public/ortbtools.app.js # clickurl + bid_price in the material finder and card link/price
packages/cli/package.json, package-lock.json
tests/corpus/
├── pairs/…            # 6 cases lose their knownGap; 3 DEF-107 Kadam cases re-pinned
└── known-gaps/…       # DEF-160/DEF-161/DEF-181/DEF-460 retired; two emptied shards removed
specs/000-platform-baseline/contracts/core-validator.md
```

**Structure Decision**: single-project workspace layout; all edits are in the files above.

## Complexity Tracking

No constitution violations to justify.
