# Implementation Plan: Validation Semantics and Media Crosscheck

**Branch**: `codex/026-validation-crosscheck` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Accepted feature specification in `specs/026-validation-crosscheck/spec.md`.

## Summary

Complete the fourteen supplied defect groups in two ordered increments. Wave A fixes selected-media, media-constraint, seat-restriction and NonLinear VAST semantics. Wave B fixes response representations, declaration/identity fields and bounded vendor completeness. Preserve feature 022's price/floor ownership and feature 023's bounded XML evidence. Add findings only through the existing deterministic pipeline, complete all three locales and release as Core 0.45.0.

## Technical Context

**Language/Version**: Node.js >=22.13.0, existing CommonJS Core and JavaScript consumers.

**Primary Dependencies**: Existing workspace modules; no new runtime dependency or framework.

**Storage**: Transient in-memory inputs; no application persistence changes.

**Testing**: Public `validate()`/`crosscheck()` boundaries, HTTP/CLI regressions, existing 256-case corpus across applicable Core/HTTP/browser layers; `node:test`, current lint/format/type/spec-reference checks; complete `npm run ci`, npm package and Docker smoke, hosted CI.

**Target Platform**: Existing Node server and CLI; current Inspector consumes unchanged analysis shapes.

**Project Type**: Library semantic repair in the existing npm workspace.

**Performance Goals**: Finite deterministic analysis; scan only supplied content, avoid remote resolution and unbounded malformed-XML loops. No new latency claim is made.

**Constraints**: Stable IDs/order/deduplication/API shapes; no numeric price coercion; severities inline for static extraction; supplied invalid types retain errors; en/uk/ru parity; no harness/oracle relaxation.

**Scale/Scope**: Fourteen groups, twenty-five linked cases; two waves with one reviewed branch push per wave. Initial ledger has 34 groups; a count of 20 after this work applies only to the original baseline and does not claim peer work integration.

## Constitution Check

Evaluated against constitution 2.1.0 before research and re-evaluated after design. These are design gates, not claims that delivery tests have run.

| Principle                               | Design result and implementation obligation                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I — Spec Kit working memory             | PASS: constitution, roadmap, owning contracts and accepted 026 context read before decisions; complete active package, checklists and preimplementation analysis; update tasks at each wave.                             |
| II — Evidence-backed truth              | PASS: existing pinned protocol/corpus sources and a recorded baseline guide the repair; verification records distinguish planned, executed, committed, pushed and deployed states.                                       |
| III — Privacy/security                  | PASS: synthetic fixtures only; no payload logging, external model, persistence, fetch, entity expansion or sandbox change; evidence files contain no private production records.                                         |
| IV — Deterministic compatible contracts | PASS: preserve IDs/order/deduplication/shapes and CLI policy, add source-mapped findings with public-boundary regression evidence; document the additive verdict change in the contract.                                 |
| V — Explicit bounded architecture       | PASS: existing Core owners remain; extract shared behavior from its owner and import it instead of adding parallel implementations; no global framework or service.                                                      |
| VI — Locales together                   | PASS: every new finding moves in en/uk/ru with matching interpolation parameters and reference coverage.                                                                                                                 |
| VII — Proportional verification         | PASS: focused failing regressions precede implementation; current full gate and relevant package/container/browser gates follow settled waves; private Chrome isolation preserves peer processes.                        |
| VIII — Traceable releases               | PASS: reserved Core 0.45.0, CLI dependency and lock agree; app/CLI independent versions remain unless their own contract changes; user authorizes branch pushes and retains main integration; no publication/deployment. |

No constitution exception or architecture ADR is required. The stable semantic additions belong in the owning Core contract.

## Project Structure

### Documentation (this feature)

```text
specs/026-validation-crosscheck/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
├── contracts/validation-semantics.md
└── checklists/
    ├── requirements.md
    └── semantic-boundaries.md
```

### Source Code (repository root)

```text
packages/core/
├── crosscheck.js
├── rules-vast.js
├── rules-response.js
├── rules-response-30.js
├── rules-request.js
├── helpers.js
├── rules/pop-response/
├── messages/{en,uk,ru}.json
├── spec-refs.json
└── package.json
packages/cli/package.json
package-lock.json
tests/validation-semantics-crosscheck.test.js
tests/corpus/{pairs,mutations,known-gaps,known-gaps.json}
specs/000-platform-baseline/contracts/{core-validator,locales-versioning}.md
specs/020-ad-format-verification-matrix/defects.md
specs/{README,ROADMAP}.md
```

**Structure Decision**: The implementation stays in assigned Core owners. Additional focused test files may separate HTTP/CLI checks from the named regression file. Existing detector/scanner and Native helpers are consumed through current exports. `rules-vast.js` owns the exported `inspectVastMedia` helper shared with crosscheck, covering actual XML-root protocol and per-Linear MIME alternatives/duration while ignoring fake markup and extensions. If an assigned owner needs shared semantic behavior, extract it in that owner and import it. Do not broaden 3.0 response-plugin request projection beyond its established `{cur}` contract.

## Delivery Phases

1. Record baseline, exact scoped case/signature inventory and pinned source evidence; complete requirements quality and read-only cross-artifact analysis before runtime edits.
2. Implement US1 wave A with negative/positive public-boundary controls. Review exact signature retirement for its five groups, run settled local gates, commit the scoped increment, push once and observe its hosted result.
3. Implement US2 wave B after wave A's semantic seam is settled. Preserve peer ownership and all wave A checks; review exact retirement of nine groups and the full corpus's unaffected signatures.
4. Reconcile Core 0.45.0, CLI dependency and lock after any baseline reconciliation; preserve both sides' removed ledger records and chronological resolutions. Run settled local/package/container gates, converge to no remaining buildable tasks, commit and push the second wave, wait for hosted CI and record exact evidence. The maintainer integrates main.

## Complexity Tracking

No constitution violations or new architecture abstractions are planned.

## Isolated parallel implementation

Wave B may be authored in the separate `2026-09-08-026-validation-crosscheck/wave-b-worktree` while wave A runs, with its own test file and no mutation of wave A gate inputs. Root applies only the reviewed bounded patch after the wave A commit/push. Fixture `expected.*` values are unbound symbols; bind only selected affected IDs, preserve payloads/levels/paths/parameters, and leave the harness/oracle unchanged. DEF-151 recognition/preview observations require explicit peer-owner coordination and passing existing expectations before retirement.
