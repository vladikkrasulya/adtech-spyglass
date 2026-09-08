# Implementation Plan: The Analyze Boundary Survives Malformed and Oversized Input

**Branch**: `main` (direct defect-repair workflow) | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/024-analyze-input-robustness/spec.md`

## Summary

Four defects, one theme: the public analyze boundary crashed, dropped, or reset on JSON that parsed
but was malformed or oversized. The fix guards the category walk against non-array `imp`/`seatbid`/
`bid`, guards the Inspector's winning-bid selection against a null/non-array/non-object first bid,
teaches the analyze handler that a present scalar `bidRes` is a submitted response to validate, and
turns the oversized-body path from a socket reset into the documented `400 payload_too_large`
envelope. No finding id, level or message changes; the category-decode surface changes from throwing
to returning empty categories, which is the only behaviour change on the published API and is why
Core takes a minor bump.

## Technical Context

**Language/Version**: Node.js >= 22.13.0, CommonJS (packages/core is the npm-workspace Core)

**Primary Dependencies**: none added

**Storage**: N/A

**Testing**: `node:test` — the 020 corpus at the Core, HTTP and browser layers is the regression net;
plus `tests/validator.test.js`, `spec-refs.test.js`, `i18n-audit.test.js`, `cli.test.js` for the
no-change guarantees, and a live oversized-body HTTP probe; then `npm run ci`

**Target Platform**: Linux server (hosted Inspector), browser bundle, CLI

**Project Type**: npm-workspace library consumed by app/CLI, plus the server transport layer

**Performance Goals**: unaffected — the guards are constant-time type checks; the oversized-body drain
is O(bytes) with flat memory (measured ~44 ms for a 40 MiB body, ~20x the cap)

**Constraints**: stable finding ids, levels and order (Constitution IV); regression coverage at the
public boundary in the same change (VII); only explicit authored paths staged (shared tree)

**Scale/Scope**: 1 Core file, 1 server transport file, 1 handler, 1 browser bundle, 1 corpus harness
file, 6 corpus fixtures, 3 ledger/manifest edits, two platform contracts and this package

## Constitution Check

_GATE: evaluated against constitution v2.1.0 before research; re-checked after implementation._

- **I — Spec Kit is the working memory**: PASS. Package `specs/024-analyze-input-robustness/` with
  spec/plan/research/contract/quickstart/checklist/tasks; the constitution, ROADMAP, the HTTP and
  validator contracts and the 020 records were read before authoring.
- **II — Truth is evidence-backed**: PASS. Each defect was reproduced as a recorded expected-failure
  marker on the committed engine before any code changed, and closed against the changed engine on
  the same corpus layers; the reviewer re-ran all of it independently in real Chrome and a live HTTP
  probe.
- **III — Privacy/security boundaries**: PASS. No collection, retention, network or model surface;
  every fixture is synthetic. The oversized-body drain is bounded by the per-IP analyze limiter.
- **IV — Public contracts deterministic and compatible**: PASS with the explicit decision in
  [contracts/analyze-input-boundary.md](./contracts/analyze-input-boundary.md): no id added, removed
  or renamed; no level or message changed. The one published behaviour change — category decode
  returns empty categories where it used to throw — is a strict improvement and is why Core bumps.
- **V — Architecture explicit and bounded**: PASS. The guards live where the crash lived
  (`categories.js`, the Inspector selection, `readJson`, the handler's response detection); no new
  module boundary is introduced.
- **VI — Locales move together**: PASS. No message key added or changed; `tests/i18n-audit.test.js`
  passes unchanged.
- **VII — Verification proportional and reproducible**: PASS. The recorded deviations were the tests;
  they are retired only because the product now meets the spec expectation. Commands and outcomes are
  in [tasks.md](./tasks.md).
- **VIII — Releases traceable**: PASS. Core takes a MINOR bump with the CLI range and lock in the same
  branch; commit and push are standing-authorized; deployment is a separate decision.

An ADR is not created: this feature changes no policy. The durable rules it establishes are recorded
in the HTTP API and validator contracts, which the constitution names as the alternative to an ADR
for exactly this case.

## Project Structure

### Documentation (this feature)

```text
specs/024-analyze-input-robustness/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
├── contracts/
│   └── analyze-input-boundary.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/
├── categories.js                 # Array.isArray guards on imp / seatbid / bid
└── package.json                  # Core MINOR bump
modules/analyze/handler.js        # a present scalar bidRes counts as a submitted response
lib/http.js                       # oversized body drains and returns the 400 envelope
public/ortbtools.app.js           # winning-bid selection tolerates malformed first bid
packages/cli/package.json, package-lock.json
tests/corpus/
├── lib/http-run.js               # scalar response side represented; per-side invalid status
└── mutations/…                   # 6 cases lose their knownGap, 4 ledger records retired
specs/000-platform-baseline/contracts/http-api.md
specs/000-platform-baseline/contracts/core-validator.md
```

**Structure Decision**: single-project workspace layout; all edits are in the files above.

## Complexity Tracking

No constitution violations to justify.
