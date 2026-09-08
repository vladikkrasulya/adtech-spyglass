# Implementation Plan: Recommended Fields Are Guidance, Not Errors

**Branch**: `main` (direct defect-repair workflow, per the 012/013 precedent) | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-recommended-fields-guidance/spec.md`

## Summary

Four Core rules answer a specification-permitted omission with an ERROR: the 2.x distribution
channel (`request.no_site_or_app`), the 2.x device object and its `ip`/`ua`
(`request.device_required`, `request.device.ip_required`, `request.device.ua_required`), the 3.0
mirrors of both under `request.30.context.*`, and the empty-seatbid no-bid
(`response.seatbid_empty_no_nbr`, `response.30.seatbid_empty_no_nbr`), which crosscheck compounds
into `crosscheck.no_response`. The fix moves each level to the grade the specification supports —
warning for recommended, info for optional-on-DOOH and for a no-bid — keeps every id, rewrites the
ten messages in three locales so they cite the basis, collapses the absent-device cascade to one
finding, and retires the four ledger groups the audit recorded for this class while re-pinning the
eight signatures that carried the device lines alongside other deviations.

## Technical Context

**Language/Version**: Node.js >= 22.13.0, CommonJS (packages/core is the npm-workspace Core)

**Primary Dependencies**: none added — Core stays a deterministic data-to-data library
(Constitution IV)

**Storage**: N/A

**Testing**: `node:test` — `tests/validator.test.js`, `tests/rules-25-audit.test.js`,
`tests/ortb30.test.js`, `tests/cli.test.js`, `tests/crosscheck-audit.test.js`,
`tests/i18n-audit.test.js` first; then the 020 corpus layers (`tests/corpus-core.test.js`,
`tests/corpus-http.test.js`, `tests/corpus-browser.test.js` with `CORPUS_CASE`); then `npm run ci`

**Target Platform**: Linux server (hosted Inspector), browser bundle through the same Core API,
CLI through `@ortbtools/cli`

**Project Type**: npm-workspace library (Core) consumed by app/CLI

**Performance Goals**: none affected — level constants and one early return

**Constraints**: stable finding ids and order (Constitution IV); en/uk/ru move together (VI);
regression tests in the same change (VII); shared worktree — stage only authored paths

**Scale/Scope**: 5 Core rule files, 3 message catalogs, 5 test files, 29 corpus case files, 2
ledger shards, 3 package manifests, 1 contract, 1 ADR, roadmap/README/defect-report pointers

## Constitution Check

_GATE: evaluated against constitution v2.1.0 before research; re-checked after design._

- **I — Spec Kit is the working memory**: PASS. Package `specs/021-recommended-fields-guidance/`
  with spec/plan/research/contract/tasks/checklist; constitution, ROADMAP, the validator contract
  and the 020 package were read before authoring. Entered as accepted work (an owner instruction on
  a reproduced audit defect), not as an uncertain idea.
- **II — Truth is evidence-backed**: PASS. Every level is grounded in the pinned OpenRTB 2.6
  markdown (commit `403cbba`), AdCOM 1.0 (`df8ba06`) and OpenRTB 3.0 FINAL, quoted with line
  numbers in [research.md](./research.md); the defect was reproduced by the 020 corpus before the
  package was opened.
- **III — Privacy/security boundaries**: PASS. No collection, retention, network or model surface;
  fixtures are the synthetic 020 corpus.
- **IV — Public contracts deterministic and compatible**: PASS with the explicit compatibility
  decision in [contracts/finding-levels.md](./contracts/finding-levels.md): no id added, removed
  or renamed; levels change for ten ids; the absent-device cascade shrinks to one finding; the
  status rollup and the CLI's default exit code change for inputs that were previously false
  errors. Boundary tests pin every changed level.
- **V — Architecture explicit and bounded**: PASS. Edits stay inside the owning rule files and
  `crosscheck.js`; no new abstraction.
- **VI — Locales move together**: PASS. Ten existing keys rewritten in en/uk/ru, no key added;
  `tests/i18n-audit.test.js` enforces parity.
- **VII — Verification proportional and reproducible**: PASS. Narrowest suites first, then the
  corpus layers for the affected cases, then `npm run ci`; commands and outcomes are recorded in
  [tasks.md](./tasks.md).
- **VIII — Releases traceable**: PASS. Core 0.38.0 → 0.39.0 (public level contract changes) with
  the CLI range and lock in the same commit; commit and push are standing-authorized; deployment
  is a separate decision and is not performed by this feature.

## Project Structure

### Documentation (this feature)

```text
specs/021-recommended-fields-guidance/
├── spec.md
├── plan.md
├── research.md              # pinned citations and the level-mapping decision
├── quickstart.md            # before/after reproduction commands
├── contracts/
│   └── finding-levels.md    # public-boundary compatibility decision
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/
├── rules-request.js         # channel + device block (levels, single finding on absent device)
├── rules-request-30.js      # context channel + device parity, DOOH-only INFO
├── rules-response.js        # empty seatbid without nbr → INFO
├── rules-response-30.js     # same for 3.0
├── crosscheck.js            # empty seatbid array is a no-bid: id check only
├── messages/{en,uk,ru}.json # ten texts rewritten
└── package.json             # 0.39.0
packages/cli/package.json    # ^0.39.0
package-lock.json
tests/
├── validator.test.js, rules-25-audit.test.js, ortb30.test.js, cli.test.js
└── corpus/                  # 21 cases without knownGap, 8 re-pinned, 2 ledger files
specs/000-platform-baseline/contracts/core-validator.md   # level policy section
specs/decisions/ADR-016-recommended-fields-are-guidance.md
```

**Structure Decision**: single-project workspace layout; all edits are in the files listed above.

## Complexity Tracking

No constitution violations to justify.
