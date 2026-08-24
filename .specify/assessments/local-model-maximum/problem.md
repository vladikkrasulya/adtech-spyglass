# Problem Definition: Local Model Maximum v3

- **Slug**: local-model-maximum
- **Created**: 2026-08-23
- **Inputs used**: intake.md · research.md

## Problem Statement

The owner cannot tell whether a change to the local-model setup (prompt, model, context, tier) made
dialect-rule extraction better or worse, because the instrument that measures it is unreliable in
three independent ways: the gold labels sit on a taxonomy whose categories overlap (so the model is
scored wrong for defensible readings), the bench saved no raw evidence and no holdout (so every
number is unrepeatable and tuned on what it is scored on), and the model reads whole adapters when
the rule lives in ten lines (so cost and error both scale with file size). Until the instrument is
trustworthy, every further hour spent on "improving the model" is spent blind — and the retired-tag
defaults left in two executable scripts on 2026-08-23 show the operational side has the same
problem in miniature.

## Affected Users & Stakeholders

- **Users**: the owner as operator of the research corpus — decides, on numbers, whether a prompt,
  a model, or a tier change is worth keeping; today those numbers can flip from one run to the
  next (triage 8B: 9/10 with thinking on, 10/10 with thinking off — the "stable miss" was the
  bench's own default) [research: Prior Art].
- **Users**: the owner as future consumer of the dialect corpus — relies on the 364 verified rules
  being right; 3 of the 7 known disagreements already conclude the corpus label was the wrong one
  [research: Prior Art].
- **Stakeholders**: the owner as host operator — four production services depend on the hot
  `gemma4-prod` model on `:11434`; any measurement that reloads or shortens it (observed twice on
  2026-08-23) is a production incident, not a research artefact [research: Data & Constraints].
- **Stakeholders**: feature 008's closed record and the paused dialect direction — must not be
  rewritten or silently reopened; this problem lives beside them, not inside them
  [research: Prior Art; ROADMAP pause note].

## Goals

- A measurement the owner can repeat and trust: the same inputs, model digest and options give the
  same stored evidence; a number can be traced to the raw response that produced it.
- Labels the model is scored against that it cannot reasonably dispute: categories defined by
  observable facts with one correct projection, and an explicit "cannot decide" outcome where the
  facts genuinely admit two.
- Measurement that cannot be tuned on what it is scored on: adapter-disjoint tune/dev/sealed
  holdout, with the holdout opened once.
- Cost that scales with the rule, not the file: the model sees the lines that bear on a candidate,
  not the whole adapter.
- The slow tier (31B, ~10 min per adapter on CPU) used only where a cheap deterministic check says
  the fast tier's answer is not trustworthy — and a human queue for what neither settles.
- No retired model tag in any executable default; a retirement procedure that is followed, with
  RAM release verified, so the 2026-08-23 incidents (hot model evicted; retired weights still
  resident) do not recur.

## Non-Goals

- Reopening feature 008, rewriting its artifacts, or applying the 7 disagreements to the canonical
  corpus by automation — corpus changes remain a human-reviewed migration proposal.
- Any product surface: no Inspector, API, CLI or UI change; ADR-003/ADR-012 boundaries unchanged.
- Downloading, evaluating or fine-tuning any model before the baseline above exists; the two
  installed models are the fixed subject of measurement.
- Remote or external LLM/API use for any part of the pipeline.
- Estimating corpus-wide precision or recall from the bounded splits — results describe their split.
- Runner-level `num_ctx`/`keep_alive` on the shared GPU node outside a maintenance window.

## Success Metrics

Carried verbatim from the owner's Definition of Done; each is tagged by whether the current gold
size makes it measurable (research: Data & Constraints — 84 adapters, 364 rules, `forbidden`=5).

- Accepted outputs 100% schema-valid (baseline: not enforced; v2 schema-valid only because `format`
  grammar forces it) — _measurable_.
- Citations 100% resolvable to the bundle, ≥95% evidence-supported (baseline: not measured before
  2026-08-23; the new scorer reports `evidence_unresolvable`/`evidence_unsupported`) — _measurable_.
- Candidate-miner recall ≥95% on verified rules; `dropped`/`reject`/`forbidden` 100% (baseline:
  no miner exists; whole-file input = 100% trivially) — _measurable_.
- Extraction micro precision/recall ≥0.90 (baseline: 8B v2 on GumGum 0.67/0.50, 31B 0.63/0.63, one
  adapter) — _measurable on dev; holdout once_.
- Macro-F1 ≥0.85 over legacy dispositions and ≥+10 pp over the v2 baseline (baseline: not
  computable — v2 runs cover one adapter) — _partly measurable: `forbidden` (5), `validated` (13),
  `defaulted` (14) give one-example classes in a 17-adapter holdout; the macro figure must be
  reported with per-class support and may be "unmeasurable at this gold size"_.
- Zero critical false negatives on `dropped`/`reject`/`forbidden` (baseline: unknown) — _measurable
  on the classes present_.
- Router within 1 pp of always-31B at ≤20–25% escalation and ≤30% compute (baseline: no router;
  always-8B vs always-31B differ by one rule on GumGum) — _measurable on dev; may be untestable if
  escalation is rare_.
- Triage macro-F1 ≥0.95, schema-validity 100%, false-safe 0 (baseline: 10/10 on the ten smoke cases
  with `think=false`, which are tune, not holdout) — _measurable once ≥100 family-disjoint cases
  exist_.
- Hot 8B p50 not worse than current by more than 20% (baseline: 2.1 s triage, 7.6 s GumGum
  extraction, immutable runs `p0-*`) — _measurable_.
- Executable defaults free of `gemma4:e4b`; fast and deep smoke green; deep runner absent from RAM
  after work (baseline: fixed and verified 2026-08-23; pinned by two regression tests) — _met,
  must not regress_.
- Production, Steam guard and canonical corpus unchanged by the work (baseline: as of 2026-08-23) —
  _verifiable by inspection_.

## Cost of Inaction

The 31B tier keeps costing ten minutes per adapter for one disputed rule; the 8B keeps being scored
against labels it can argue with; any future prompt or model comparison is one-run, whole-file,
recall-only and tuned on the adapter it is measured on — so the next "improvement" is as likely to
be an artefact (as the `think` default was) as a gain. The seven 008 disagreements stay open with no
instrument to settle them, and the next model retirement repeats the 2026-08-23 incidents unless
someone remembers the procedure.

## Open Questions

- [NEEDS CLARIFICATION: how many of the 364 verified rules survive re-verification under the fact
  schema — the GumGum + 7-disagreement adjudication (in progress) is the first sample]
- [NEEDS CLARIFICATION: miner candidate recall before SSA — being measured; decides whether the
  95%/100% gates are reachable]
- [NEEDS CLARIFICATION: which DoD gates the owner holds as hard gates versus "report as measured";
  macro-F1 over nine classes with `forbidden`=5 is the obvious candidate for the second kind]
- [NEEDS CLARIFICATION: placement of the lab artifacts — outside the repository as in 008, with
  what repository-tracked pointer or canonical file (the taxonomy JSON is the natural candidate)]
- [NEEDS CLARIFICATION: whether the 31B tier's remaining job — after `think=false` closed the
  triage gap and narrow bundles are in play — justifies the router's own gates, or whether "31B
  escalation rarely exercised" is itself the acceptable answer]
