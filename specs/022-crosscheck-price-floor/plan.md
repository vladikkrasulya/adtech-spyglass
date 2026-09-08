# Implementation Plan: Crosscheck Tells the Truth About Price and Floor

**Branch**: `main` (direct defect-repair workflow) | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/022-crosscheck-price-floor/spec.md`

## Summary

Three defects, one theme: the crosscheck engine answered a question about money that the payload did
not support, and disagreed with the validation engine while doing it. The fix removes the numeric
coercion from the price test so it mirrors the validator's own predicate, routes both engines through
one extracted deal-floor resolver so a matched deal's floor governs identically on both sides, and
corrects two OpenRTB 3.0 misreads — the item projection's `flrcu`/`flrcur` typo and the raw request
envelope handed to the response rules. No finding id, level or message changes.

## Technical Context

**Language/Version**: Node.js >= 22.13.0, CommonJS (packages/core is the npm-workspace Core)

**Primary Dependencies**: none added

**Storage**: N/A

**Testing**: `node:test` — a new `tests/crosscheck-price-floor.test.js` written first, plus
`tests/validator.test.js`, `crosscheck-audit.test.js`, `rules-etap-b-2.test.js`, `floor-audit.test.js`,
`ortb30.test.js`, `spec-refs.test.js`, `i18n-audit.test.js`, `cli.test.js`; then the 020 corpus
layers; then `npm run ci`

**Target Platform**: Linux server (hosted Inspector), browser bundle, CLI

**Project Type**: npm-workspace library consumed by app/CLI

**Performance Goals**: unaffected — one extra function call per bid

**Constraints**: stable finding ids, levels and order (Constitution IV); regression tests in the same
change (VII); a peer session held the main checkout throughout, so all work was done in an isolated
git worktree and integrated afterwards

**Scale/Scope**: 3 Core files, 1 new test file, 1 amended test, 10 corpus files, 3 manifests, the
platform validator contract and this package

## Constitution Check

_GATE: evaluated against constitution v2.1.0 before research; re-checked after implementation._

- **I — Spec Kit is the working memory**: PASS. Package `specs/022-crosscheck-price-floor/` with
  spec/plan/research/contract/quickstart/checklist/tasks; the constitution, ROADMAP, validator
  contract and the 020 defect records were read before authoring.
- **II — Truth is evidence-backed**: PASS. Every rule is grounded in the pinned specification copies
  quoted with line numbers in [research.md](./research.md); the three defects were reproduced against
  the committed engine before any code changed, and the corrected behaviour was reproduced again by
  three independent verifiers.
- **III — Privacy/security boundaries**: PASS. No collection, retention, network or model surface;
  every fixture is synthetic.
- **IV — Public contracts deterministic and compatible**: PASS with the explicit decision in
  [contracts/price-floor-resolution.md](./contracts/price-floor-resolution.md): no id added, removed
  or renamed; no level or message changed; the set of findings emitted changes only for payloads
  that were previously answered wrongly. Boundary tests pin every case.
- **V — Architecture explicit and bounded**: PASS. The deal-floor rule stays owned by the rule plugin
  that already documented it; crosscheck imports the extracted function instead of copying it. The
  require edge is one-directional and cycle-free.
- **VI — Locales move together**: PASS. No message key added or changed; `tests/i18n-audit.test.js`
  passes unchanged.
- **VII — Verification proportional and reproducible**: PASS. Regression tests were written before
  the product change and recorded failing for the named reasons; commands and outcomes are in
  [tasks.md](./tasks.md).
- **VIII — Releases traceable**: PASS. Core takes a MINOR bump with the CLI range and lock in the same
  commit; commit and push are standing-authorized; deployment is a separate decision.

An ADR is not created: this feature changes no policy. The durable rules it does establish — which
floor governs, and that one resolver serves both engines — are recorded in the platform validator
contract, which the constitution names as the alternative to an ADR for exactly this case.

## Project Structure

### Documentation (this feature)

```text
specs/022-crosscheck-price-floor/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
├── contracts/
│   └── price-floor-resolution.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/
├── crosscheck.js                 # price predicate, deal-floor resolution, 3.0 flrcur
├── rules/price-floor/index.js    # resolveDealFloor() extracted and exported
├── index.js                      # 3.0 paired request projected for the response rules
└── package.json                  # Core MINOR bump
packages/cli/package.json, package-lock.json
tests/
├── crosscheck-price-floor.test.js  # new boundary regressions
├── crosscheck-audit.test.js        # 3.0 fixture field name corrected
└── corpus/                         # 9 cases lose their knownGap, 3 ledger records retired
specs/000-platform-baseline/contracts/core-validator.md
```

**Structure Decision**: single-project workspace layout; all edits are in the files above.

## Complexity Tracking

No constitution violations to justify.
