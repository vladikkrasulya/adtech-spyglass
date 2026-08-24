# Implementation Plan: Local Model Maximum v3

**Branch**: `011-local-model-maximum` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification and the owner's work package of 2026-08-23

## Summary

Research tooling, zero product surface. A reproducible benchmark runner with immutable runs; a
fact-based taxonomy v3 generating prompt, schema, docs, classifier and fixtures from one file; a Go
AST/types candidate miner; a deterministic per-fact router between the hot 8B and the deep 31B;
adapter-disjoint and family-disjoint benchmarks; one-variable-at-a-time tuning; a report that
labels every unmet gate. Plus the operational fixes in two sibling stacks (done).

## Technical Context

**Language/Version**: Python 3.13 (runner, taxonomy generator, router, scorers); Go 1.27 (miner,
user-local toolchain at `~/.local/go-toolchain`, checksum-verified 2026-08-23)
**Primary Dependencies**: stdlib only on the Python side; `golang.org/x/tools/go/packages` for the
miner; ollama 0.32.9 on `:11434` (GPU, shared, four consumers) and `:11435` (CPU, deep, capped
32 GB / 12 CPUs)
**Storage**: `~/.local/share/ortbtools-research/bench/` — `runs/` (immutable), `taxonomy/`,
`miner/`, `router/`, `data/`; research corpus snapshot `prebid-2026-08-20/` (Apache-2.0, commit
`0ba3523`)
**Testing**: `bench/taxonomy/check.py` (idempotency, fixtures, enums); `bench/miner/recall.py`;
runner smoke runs; sibling-stack suites (`uvx … pytest` 77/77; `npm test` 708/0)
**Target Platform**: vkbox only
**Project Type**: Research audit tooling; no product coupling; `npm run ci` does not run it
**Performance Goals**: hot 8B p50 within +20% of `p0-*`; 31B escalation ≤ 20–25%; compute ≤ 30%
of always-31B
**Constraints**: no `num_ctx`/`keep_alive` on `:11434` (guarded in code); no model download/delete
before baseline; no external LLM; runs immutable; secrets never printed; `.env` never scanned
**Scale/Scope**: 84 adapters / 364 verified rules (50/17/17 split); 101 triage cases (51/26/24)

## Constitution Check

- **I — Spec Kit as working memory**: assessment intake → research → problem → concept → decision
  (go) precede this package; ROADMAP row added; decisions recorded in research.md here.
- **II — Evidence-backed truth**: every number carries a raw response, a digest and a hash under an
  immutable run; gold disputes are adjudicated `old → facts → projection → rationale`.
- **III — Privacy/security**: inputs are Apache-2.0 source and synthetic logs; no bidstream; no
  secrets; `.env` untouched.
- **IV — Public contracts**: none touched.
- **V — Bounded architecture**: lab outside the repository (research D2 inherited from 008); the
  only in-repo changes are this package and the two sibling-stack default fixes.
- **VI — Locales**: n/a.
- **VII — Proportional, reproducible verification**: runner manifests, SHA256SUMS, replay commands,
  three repeats, cold/warm split; `check.py` and `recall.py` are the gates.
- **VIII — Traceable releases**: no release; sibling-stack commits `b2d9b7b` (tg-llm-bot) and
  `cf4797d` (claude-usage-display) carry the fixes.

## Research decisions

- **D1 — Placement**: lab under `~/.local/share/ortbtools-research/bench/`, outside git, exactly
  as 008 D2; the repository tracks the package. Open to the owner: whether `taxonomy-v3.json`
  should also be tracked in-repo as the canonical definition (it is referenced by hash everywhere).
- **D2 — Taxonomy source of truth**: `taxonomy-v3.json` (judge-merged from three independent
  designs; `build.py` that produced it is kept beside it as provenance). `generate.py` reads the
  JSON and writes every artefact; `check.py` fails on drift. The classifier executes the decision
  table literally over derived predicates whose semantics match the reference implementation
  one-for-one (verified: 39/39 fixtures, 15/15 adjudications).
- **D3 — Miner before SSA**: `go/packages` with types, bounded call graph depth 3; recall
  360/364 = 98.9% on first measurement; SSA deferred per the package.
- **D4 — Router decides per fact**, not per bundle; a bundle escalates if any fact does, but
  accepted facts keep 8B provenance. Objective reasons only. Cache key per the package.
- **D5 — Shared-GPU guard in code**: `:11434` strips `num_ctx`, forces `keep_alive=-1`; observed
  twice before the guard (hot model reloaded to 8192; `Forever` shortened to 30 m).
- **D6 — `think` explicit everywhere**; first honest runs showed the triage "stable miss" was the
  thinking default.
- **D7 — Two DoD clauses reported-not-gated** (macro-F1 per-class support; `dropped` 42/45) until
  the owner confirms — see decision.md.

## Project Structure

```text
~/.local/share/ortbtools-research/bench/
├── runner.py                 # shared runner; workloads/{triage,extraction}.py
├── data/                     # prompts, cases, splits, miner-out/, disagreements
├── runs/<run-id>/            # immutable: manifest, cases/, summary, SHA256SUMS
├── taxonomy/                 # taxonomy-v3.json, generate.py, check.py, generated/, adjudication
├── miner/                    # Go module ortbtools-miner, recall.py
└── router/                   # router.py, cache/, runs/

specs/011-local-model-maximum/   # this package (spec, plan, tasks, checklists, research notes)
```

## Phases (as executed)

- **P0 reproducibility** — runner + workloads; baseline x3 for extraction (8B, 31B, v2,
  think=false) and triage (8B, 31B, think=false/true). _Done except the last 31B runs in flight._
- **P0 operational debt** — defaults fixed, regression tests, retirement procedure, fast/deep
  smoke with RAM verification. _Done; committed in both stacks._
- **P1 taxonomy v3** — merged taxonomy, generator, gate, adjudication of GumGum + 7. _Done; gates
  pass._
- **P1 honest benchmark** — splits (50/17/17; 101 triage cases family-disjoint); first dev run
  (triage 8B 81%, `POLICY_GATE` 0/5 on an unseen family). _Built; manifests not yet frozen._
- **P1 prompt v3 + miner** — miner built and measured (98.9%); prompt-fragment generated; raw 8B
  fact extraction on GumGum escalates 9/11 facts. _Miner done; prompt tuning next._
- **P1 router** — per-fact, cached, guarded. _Built; no-deep smoke passes; deep comparison next._
- **P2 optimisation** — one variable at a time on tune; promotion on dev; holdout once. _Next._
- **Report** — before/after, confusion matrices, Pareto, rejected hypotheses, migration proposal,
  rollback, exact host state. _Last._
