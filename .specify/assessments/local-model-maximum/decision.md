# Decision: Local Model Maximum v3

- **Slug**: local-model-maximum
- **Decided**: 2026-08-23
- **Verdict**: go — Option B, with two Definition-of-Done clauses reframed as reported-not-gated
  until the owner confirms them
- **Artifacts reviewed**: intake.md · research.md · problem.md · concept.md

## Scorecard

| Criterion              | Rating   | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem validity       | strong   | Three independent instrument failures are each shown by a concrete artefact: the `think` default flipped a triage verdict 3/3 (runs `p0-tri-v1-8b-gpu-tf` vs `-tt`); the ten-case smoke set read 10/10 where the disjoint dev split reads 81% with 0/5 on `POLICY_GATE`; 3 of 7 frozen disagreements and 3 of 8 GumGum gold labels are disputed by a pure function of observable facts.                                                                                                                                                                                                                 |
| Evidence strength      | adequate | First-party, reproducible from 2026-08-23 onward (immutable runs with SHA256SUMS and replay). Weakened by: gold produced under taxonomy v1; pre-2026-08-23 numbers unrepeatable; no external source consulted. Not weak — every load-bearing number has a raw response behind it.                                                                                                                                                                                                                                                                                                                       |
| Value vs. inaction     | strong   | Inaction leaves every future comparison one-run, whole-file, recall-only and tuned on the adapter it is scored on; the 31B keeps costing ten minutes per adapter for one disputed rule; the next retirement repeats the 2026-08-23 incidents.                                                                                                                                                                                                                                                                                                                                                           |
| Feasibility / appetite | strong   | Option B's riskiest parts are already built and gated, not promised: taxonomy v3 39/39 fixtures, idempotent, 15/15 adjudications through the generated classifier; miner candidate recall 360/364 = 98.9% before SSA, `forbidden`/`required`/`validated` at 100%; router end-to-end on GumGum with per-fact reasons and digest-keyed cache; split 50/17/17 with all nine classes in every split; 101 family-disjoint triage cases. Appetite medium and mostly model time.                                                                                                                               |
| Strategic fit          | adequate | Same footing as feature 008 research D2 (lab outside the repository, zero product surface, corpus mutated only by human-reviewed proposal); ADR-003/ADR-012 untouched. Tension: the dialect direction is paused by the owner since 2026-08-22 and this is tooling in its service — fit is with the owner's explicit 2026-08-23 work package, not with the paused roadmap line.                                                                                                                                                                                                                          |
| Risk posture           | adequate | Known and bounded: `dropped`-by-non-use has no AST node (42/45, three misses named); `forbidden` has five examples so macro-F1 over nine classes may be unmeasurable; raw prompt v3 is worse than v2 on day one (9/11 facts escalate on GumGum) and must be tuned one variable at a time; 31B's job may be too rare to test its router gates. Mitigations are in place (per-class support reported, whole-file fallback possible for `dropped`, runner enforces one-variable discipline, "rarely exercised" is an accepted outcome). Two mitigations need the owner's word — hence the reframing below. |

## Verdict & Rationale

**Go.** Problem validity and value are strong and evidenced; feasibility is demonstrated rather
than argued, because the instruments that carry the risk exist and pass their gates; evidence is
adequate and improving with every immutable run. The concept recommends Option B with Option A
subsumed and Option C measured and declined.

The go carries one condition, stated so it cannot be glossed later: two Definition-of-Done
clauses are **reported, not gated**, until the owner confirms them — (1) macro-F1 ≥ 0.85 over nine
legacy classes is reported with per-class support and may be declared unmeasurable for `forbidden`
(5 examples corpus-wide; 1 in holdout); (2) "critical 100%" candidate recall on `dropped` is
reported as 42/45 with the three misses named (huaweiads ×2 partial-typed whole-body rewrite,
smartadserver evidence outside the adapter), or met via a whole-file fallback for that class if
the owner prefers. Every other gate stands as written. This is not a `needs-clarification` because
nothing in the build depends on the answer — only how two lines of the final report are labelled.

## If go — Handoff to `/speckit-specify`

- **Problem**: the owner cannot tell whether a local-model change helped, because the taxonomy
  overlaps, the bench is unrepeatable and holdout-free, and the model reads whole files; the
  2026-08-23 retirement left retired-tag defaults in executable code.
- **Chosen approach**: Option B — fact-based taxonomy v3 with a versioned decision table and
  `unclassified/escalate`; a Go AST/types candidate miner producing 2–8k-token bundles; a
  deterministic router (schema, oRTB-path validity, source/target consistency, evidence
  resolvability, static-trace agreement, classifier ambiguity, critical/rare class) escalating
  per-fact to an independent 31B read and then a human queue; a reproducible runner with
  immutable runs; adapter-disjoint tune/dev/sealed-holdout; ≥100 family-disjoint triage cases;
  one-variable-at-a-time tuning on tune, promotion on dev, holdout opened once.
- **In scope / out of scope**: in — the lab under `~/.local/share/ortbtools-research/bench/`
  (runner, taxonomy + generator + gate, miner, router, splits, runs), the operational fixes and
  retirement procedure (done), `ADJUDICATION.md` and a migration proposal for the corpus, the
  final report with before/after, confusion matrices, Pareto quality/latency/RAM, rejected
  hypotheses, rollback and exact host state. Out — feature 008 history, the canonical corpus file,
  any product surface, model download/delete/fine-tune, external LLMs, runner-level `num_ctx`/
  `keep_alive` on `:11434`, SSA, corpus-wide claims, hand re-verification of all 364 rules.
- **Success metrics**: the owner's Definition of Done verbatim (problem.md), with the two
  reframed clauses above labelled as such in every report.
- **Carried-forward open questions**: (a) owner's confirmation of the two reframings; (b) owner's
  reading of the three GumGum migrations and the sovrn re-adjudication in `ADJUDICATION.md` — if
  rejected, v2-vs-v3 is reported under both gold readings; (c) whether a whole-file fallback for
  `dropped` is wanted; (d) placement of the canonical taxonomy JSON — lab-only (as now) or
  tracked in the repository beside the feature package; (e) what the 31B tier is for if tuned 8B
  fact extraction leaves it rarely exercised.
