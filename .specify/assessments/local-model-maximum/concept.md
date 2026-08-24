# Concept: Local Model Maximum v3

- **Slug**: local-model-maximum
- **Created**: 2026-08-23
- **Recommended option**: B — fact pipeline with gated router, measured on a sealed holdout

## Options

### Option A — Instrument only (smallest thing that could work)

- **Sketch**: Keep the v2 prompt and whole-adapter input. Ship only the reproducible runner with
  immutable runs, the adapter-disjoint split, the ≥100-case triage set, and the operational fixes
  (retired-tag defaults, retirement procedure). The owner gains trustworthy, repeatable numbers for
  the _current_ setup and nothing else changes in how the model is asked or scored.
- **Appetite**: small (the runner, splits and fixes exist as of 2026-08-23 and already produced
  their first honest numbers).
- **Trade-offs**: Wins: every later comparison becomes repeatable; the `think` artefact and the
  tune-set overestimate (10/10 on ten smoke cases vs 81% on dev, 0/5 on `POLICY_GATE`) are already
  caught by this alone. Sacrifices: the model keeps being scored against labels it can dispute (the
  7 disagreements stay unresolved; GumGum's three mislabels stay in gold), cost keeps scaling with
  file size, and the 31B tier has no principled job. None of the quality gates of the Definition
  of Done move.
- **Rabbit holes**: none of consequence — this is mostly done.

### Option B — Fact pipeline with gated router (recommended)

- **Sketch**: Replace the nine-word guess with taxonomy v3 — the model records observable facts
  (effect, trigger, write gate/mode, source, target, scope, failure behaviour, evidence) and code
  projects the legacy disposition through a versioned decision table, returning `unclassified`
  where two readings are equally lawful. A Go miner narrows each adapter to 2–8k-token candidate
  bundles with stable IDs and numbered evidence slices. The hot 8B extracts facts per bundle; a
  deterministic router checks schema, oRTB-path validity, source/target consistency, evidence
  resolvability and static-trace agreement, projects the disposition, and escalates only facts that
  fail a check — to an _independent_ 31B read of the same bundle (no 8B label shown), then to a
  human queue on disagreement. Everything is measured on tune, promoted on dev, and the sealed
  holdout is opened once for the final candidate. Corpus changes remain a migration proposal.
- **Appetite**: medium — the instruments already exist and are gated (taxonomy 39/39 fixtures,
  idempotent, 15/15 adjudications; miner candidate recall 98.9% with `forbidden`/`required`/
  `validated` at 100%; router running end-to-end on GumGum with per-fact reasons); what remains is
  prompt v3 tuning one variable at a time, the dev/holdout runs, and the report. Weeks, not months,
  and most of it is model time, not engineering.
- **Trade-offs**: Wins: labels the model cannot reasonably dispute; cost per rule instead of per
  file (GumGum bundle 1.9k tokens vs 2.5k whole-file — and large adapters shrink far more); the 31B
  gets a principled, rare job; every number has a raw response behind it. Sacrifices: the raw v3
  prompt is worse than v2 on day one (8B fact extraction on GumGum escalates 9/11 facts, mostly Go
  identifiers in paths and missing `source.path`) and needs tuning before it beats the v2 baseline;
  three known mislabels in gold and the sovrn adjudication must be re-read by a human before the
  "+10 pp over v2" gate means anything; `dropped`-by-non-use has no AST node, so miner recall on
  `dropped` is 42/45 and the "critical 100%" gate is honestly unreachable without whole-file
  fallback for that class. Risk: the 31B's remaining job may be so rare that its router gates are
  untestable — which would itself be an acceptable answer.
- **Rabbit holes**: SSA for the miner (explicitly deferred by the package; only if recall demands
  it); re-verifying all 364 rules under the fact schema by hand (out of appetite — do GumGum + 7 +
  whatever dev/holdout disagreements surface, and leave the rest as a migration proposal); prompt
  tuning without the one-variable-at-a-time rule (the package forbids broad sweeps and the runner
  makes each sweep visible, so this is a discipline risk, not a design one); chasing macro-F1 over
  one-example classes.

### Option C — Buy capacity instead (larger model / fine-tune)

- **Sketch**: Skip the taxonomy and miner; download a larger or newer model (or fine-tune the 8B)
  and hope the headline accuracy moves.
- **Appetite**: medium to large (a fine-tune needs ≥1000 human-reviewed windows; a larger model
  needs a deep-container limit raise on a host that OOM'd on 2026-08-20).
- **Trade-offs**: Already measured against on 2026-08-22/23: a 4× model scored the same 4/8 as
  the 8B on GumGum; the 80B-class candidates cost ~12 min/case and 50 GB; model retirement to two
  was the owner's decision. The package itself gates fine-tuning behind a pipeline plateau and a
  frozen taxonomy, neither of which exists. This option buys with hardware what Option B gets with
  a paragraph of definitions.
- **Rabbit holes**: everything — disk, RAM, the hot-tier reload incidents, and a training set that
  does not exist.

## Recommendation

**Option B.** It is the only option that moves the Definition-of-Done gates, and its riskiest
parts are already built and gated rather than promised: taxonomy v3 resolves 6 of 7 frozen
disagreements by a pure function of observable facts (the seventh is an inconsistency inside the
008 adjudication, not in the table); the miner reaches 98.9% candidate recall before SSA with every
critical class at 100% except `dropped`-by-non-use; the router rejects Go identifiers and missing
paths deterministically and caches by model digest + taxonomy + prompt + candidate + options. What
remains is disciplined tuning and honest reporting, which the runner now enforces. Option A is
subsumed (it is Option B's P0 and is done). Option C was measured and declined.

The recommendation is conditional on the owner accepting two reframings of the Definition of Done:
(1) macro-F1 over nine legacy classes is reported with per-class support and may be declared
unmeasurable for `forbidden` at this gold size; (2) "critical 100%" on `dropped` is reachable only
with a whole-file fallback for that class, or is reported as 42/45 with the three misses named.

## Out of Scope (for the recommended option)

- Feature 008 artifacts, the canonical corpus file, and the 7-disagreement queue are not edited;
  this option produces `ADJUDICATION.md` and a migration proposal for human review.
- Any product surface; ADR-003 and ADR-012 unchanged.
- Model download, deletion, or fine-tuning; the two installed models are the fixed subject.
- External LLM/API use.
- Runner-level `num_ctx`/`keep_alive` on `:11434` (blocked in the runner and router).
- SSA in the miner (deferred until recall demands it).
- Corpus-wide precision/recall claims; results describe their split.
- Re-verifying all 364 rules under the fact schema by hand.

## Assumptions to Validate

- Prompt v3 can be tuned on tune (few-shot from boundary fixtures, numbered lines, explicit
  "oRTB paths not Go identifiers") to bring 8B fact escalation from ~82% to a level where the 31B is
  rare — to be measured one variable at a time on tune, promoted on dev.
- The three GumGum migrations and the sovrn re-adjudication will be accepted by the owner on
  reading `ADJUDICATION.md`; if not, the v2-vs-v3 comparison must be reported under both gold
  readings.
- 31B fact extraction on the same bundle is materially better than 8B's on the _escalated_ facts
  (not measured yet; if it is not, the router's job collapses to "flag for human", which is still a
  valid outcome).
- `temperature 0` is not bit-deterministic on ollama (observed 15 vs 11 facts on the same bundle);
  three repeats and per-case consistency are the honest reading, and the runner already records
  them.
- The sealed holdout stays sealed until the final candidate; the runner and split file record
  `holdout_opened`.
