# Decision: Macro Evaluator

- **Slug**: macro-evaluator
- **Decided**: 2026-08-12
- **Verdict**: go
- **Artifacts reviewed**: intake.md, problem.md, concept.md, implementation_plan.md

## Scorecard

| Criterion              | Rating   | Justification                                                                                                                  |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Problem validity       | strong   | Practical AdOps and QA workflow bottleneck; currently only 3 macros in 1 creative string are replaced.                         |
| Evidence strength      | adequate | Grounded in OpenRTB 2.x §4.4 specification and exact lines in the existing codebase (`ortbtools.app.js:998`, `ext-rtb.js:20`). |
| Value vs. inaction     | strong   | Eliminates manual copy-paste macro checking and prevents live campaign tracking failures.                                      |
| Feasibility / appetite | strong   | Option A (Inspector Macro Panel) is a clean, small-appetite (2-3 days) extension with no backend DB migrations required.       |
| Strategic fit          | strong   | Aligns 100% with the project constitution: offline/client-side inspection without network dependencies.                        |
| Risk posture           | strong   | 100% inert design completely eliminates billing/fraud/network risks by strictly prohibiting HTTP/tracking pixel execution.     |

## Verdict & Rationale

**Verdict: GO.** The Macro Evaluator is a high-value, bounded, and safe improvement to the core Inspector workbench. It builds upon existing UI controls (`#simPrice`) and expands macro support across all bids and standard OpenRTB §4.4 macros without introducing any privacy or network liabilities.

## If go — Handoff to `$speckit-specify`

- **Problem**: Inability to inspect and simulate standard OpenRTB macro substitutions across all bids and notice/tracker URLs in a multi-bid `BidResponse` without external manual tools.
- **Chosen approach**: Option A — Inspector Macro Panel (Inert Tab with URL extraction table, simulation input form, and copy affordances).
- **In scope / out of scope**:
  - _In scope_: Parsing `seatbid[].bid[]` for `nurl`, `burl`, `lurl`, and `adm` trackers; supporting standard OpenRTB 2.x §4.4 macros; interactive simulation controls; safe URL copying; 3 locales (`en`, `uk`, `ru`).
  - _Out of scope_: Network calls (`fetch`/`Image`/`sendBeacon`); modifying raw editor JSON; price macro decryption.
- **Success metrics**: 100% standard macro coverage; per-bid organization; zero network calls.
- **Carried-forward open questions**:
  - UI layout: dedicated tab alongside "Findings / Preview / Behavior" vs embedded card.
  - Custom vendor macro input ergonomics.
