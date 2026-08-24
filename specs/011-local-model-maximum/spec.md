# Feature Specification: Local Model Maximum v3

**Feature Branch**: `011-local-model-maximum`

**Created**: 2026-08-23

**Status**: In Progress

**Input**: Handoff from [assessment decision](../../.specify/assessments/local-model-maximum/decision.md)
(verdict: go — Option B, two Definition-of-Done clauses reported-not-gated until the owner confirms
them). The owner's work package of 2026-08-23, "Завдання для Fable5: Local Model Maximum v3", is the
source text; its boundaries and Definition of Done are carried here verbatim in substance.

> **Scope note**: This package produces **no user-visible output**. It is research tooling on the
> same footing as feature 008 (research D2): artifacts live outside the repository under
> `~/.local/share/ortbtools-research/bench/`, `npm run ci` does not run them, and the canonical
> dialect corpus is mutated only through a human-reviewed migration proposal. What the repository
> tracks is this package, its decisions, and the operational fixes in the two sibling stacks.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — A number the owner can trust (Priority: P1)

The owner runs a benchmark and gets a number that can be re-derived from stored evidence: the
exact prompt, schema, options, model digest, raw response (including thinking), parse result,
latency split, token counts and scorer output are all on disk under an immutable run id with a
checksum manifest and a replay command.

**Why this priority**: every later claim rests on it. Without it the 2026-08-21…23 numbers
(e.g. "8B stable miss on t04") were artefacts of an unrecorded default.

**Independent Test**: run the same workload twice with the same inputs and model digest; both runs
carry identical hashes for prompt/schema/gold/source; the per-case raw responses exist; the second
run with the same id is refused.

**Acceptance Scenarios**:

1. **Given** a workload and model, **When** the runner completes, **Then** `manifest.json`,
   `cases/<id>/r<k>.json`, `summary.json` and `SHA256SUMS` exist and `sha256sum -c` passes.
2. **Given** an existing run id, **When** the runner is invoked with it, **Then** it refuses.
3. **Given** the shared GPU endpoint, **When** a workload passes `num_ctx` or a short `keep_alive`,
   **Then** the runner strips `num_ctx` and forces `keep_alive=-1`, and the manifest records
   `shared_gpu_ctx_guard: true`.

### User Story 2 — Labels the model cannot reasonably dispute (Priority: P1)

The model records observable facts; code projects the legacy disposition through a versioned
decision table and returns `unclassified` where two readings are equally lawful. Prompt fragment,
JSON Schema, documentation, classifier and boundary fixtures are generated from one taxonomy file
and cannot drift.

**Why this priority**: three of seven frozen disagreements and three of eight GumGum gold labels
are disputed by a pure function of facts; the old prompt scored the model wrong for defensible
readings.

**Independent Test**: `bench/taxonomy/check.py` passes — generation idempotent, every boundary
fixture projects to its expected disposition, schema enums equal taxonomy enums, schema and
classifier carry the same taxonomy hash.

**Acceptance Scenarios**:

1. **Given** taxonomy-v3.json, **When** `generate.py` runs twice, **Then** outputs are byte-identical.
2. **Given** the 15 adjudications (GumGum 8 + 7 disagreements), **When** classified by the
   generated classifier, **Then** each equals the adjudicated projection.
3. **Given** a fact with a Go identifier as a path, **When** the router checks it, **Then** it
   escalates with reason `path: … is not an oRTB path`.

### User Story 3 — Cost that scales with the rule, not the file (Priority: P2)

A Go AST/types miner narrows an adapter to candidate bundles of 2–8k tokens with stable ids and
numbered evidence slices; the model reads bundles, not whole files; `analysis_status=partial`
escalates.

**Why this priority**: whole-file reading costs ten minutes per adapter on the 31B and
concentrates error where the rule is not.

**Independent Test**: `bench/miner/recall.py` reports candidate recall against the 364 verified
rules; per-disposition recall is printed; partial adapters are listed.

**Acceptance Scenarios**:

1. **Given** the pinned prebid-server snapshot, **When** the miner runs with `-all`, **Then** one
   JSON per adapter exists with `analysis_status`, `candidates[]`, `bundles[]`, `stats`.
2. **Given** the verified rules, **When** recall is computed, **Then** overall ≥ 95% and every
   miss is named with file:line.

### User Story 4 — The slow tier used only where a cheap check says so (Priority: P2)

The 8B extracts facts per bundle; deterministic checks (schema, path validity, source/target
consistency, evidence resolvability, static-trace agreement, classifier ambiguity, critical/rare
class) decide per fact; escalated facts go to an independent 31B read of the same bundle without
the 8B label; disagreement goes to a human queue; results are cached by model digest + taxonomy +
prompt + candidate + options; the 31B is unloaded after a batch and verified absent from RAM.

**Independent Test**: router run on GumGum in `--no-deep` mode lists per-fact reasons; a second run
hits the cache with zero model calls; a run with deep ends with `deep_resident_after: []`.

**Acceptance Scenarios**:

1. **Given** a bundle where the 8B returns a `transform` without `source.path`, **When** routed,
   **Then** that fact is escalated with reason `consistency: …` and the others are accepted.
2. **Given** identical inputs and digests, **When** routed again, **Then** `calls.fast == 0`.

### User Story 5 — No retired tag in any executable default (Priority: P1, done)

`gemma4:e4b` was retired on 2026-08-23; `tg-llm-bot/bot.py`, `persona.txt`, the live README lines
and `claude-usage-display/scripts/music-sense.py` defaulted to it. Fixed and pinned by regression
tests in both stacks; retirement procedure recorded.

**Independent Test**: `uvx … pytest tests/ -q` in tg-llm-bot (77/77) and
`npm run test:model-default` in claude-usage-display pass; `gpunode/MODEL-RETIREMENT.md` exists.

### Edge Cases

- A thinking-capable model with `format` set returns an empty `response` after generating tokens
  (observed on north-mini-code and qwen3.6): the runner records `thinking` and `parse_error`;
  `think` is always explicit per workload.
- `temperature 0` on ollama is not bit-deterministic (15 vs 11 facts on the same bundle): accuracy
  is run three times; per-case consistency is reported.
- A candidate rule whose evidence lies outside the adapter directory (smartadserver →
  `openrtb_ext/`): out of miner scope by definition; named as a miss, not hidden.
- `dropped` by non-use (huaweiads whole-body rewrite): no AST node to point at; reported as a
  named miss; a whole-file fallback for that class is the owner's call.
- The hot model's resident context or keep-alive is changed by a runner call: blocked in runner
  and router for `:11434`; a maintenance-window flag exists and is off by default.
- The deep model remains resident after work (observed with qwen3.6 after `keep_alive: 5m`):
  every deep batch ends with `keep_alive: 0` and a check that `llama-server` is gone.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every benchmark run MUST persist, under an immutable run id: exact system prompt,
  user input, JSON Schema, options; raw Ollama response including `thinking`; parsed output or
  parse error; model tag and digest, Ollama version, endpoint, CPU/GPU layout; hashes of source,
  taxonomy, prompt, schema and gold; warm/cold latency separately with prefill/generation split and
  token counts; scorer output with FP/FN and an error category per miss; a SHA-256 manifest and a
  replay command. Runs MUST NOT be overwritten.
- **FR-002**: `think` MUST be explicit per workload; there is no default. Accuracy MUST be run
  three times; cold and warm latency MUST be measured separately.
- **FR-003**: On the shared GPU endpoint the runner and router MUST strip `num_ctx` and force
  `keep_alive=-1`; overriding this MUST require an explicit flag and MUST be recorded in the manifest.
- **FR-004**: Taxonomy v3 MUST be one machine-readable file from which prompt fragment, JSON
  Schema, documentation, deterministic classifier and boundary fixtures are generated
  idempotently; a check MUST fail if any artefact diverges, any fixture misprojects, or any schema
  enum differs from the taxonomy.
- **FR-005**: The classifier MUST execute the decision table literally (first matching rule wins)
  over derived predicates computed from facts; it MUST return `unclassified` with a reason when
  facts are insufficient, contradictory or uncertain, never a guess.
- **FR-006**: GumGum's 8 gold rules and the 7 frozen disagreements MUST be adjudicated as `old
rule → facts → projected disposition → rationale` without mutating the canonical corpus; the
  result is a migration proposal for human review.
- **FR-007**: The extraction benchmark MUST use adapter-disjoint tune/dev/sealed-holdout (≈60/20/20
  by adapter); no bidder in two splits; GumGum in tune; each legacy disposition present in every
  split where the corpus allows; empty adapters as negatives. The triage benchmark MUST have ≥100
  cases (~20 per class) with family-disjoint splits. Manifests MUST be frozen before tuning; holdout
  MUST be opened once, for the final candidate, and the opening recorded.
- **FR-008**: The miner MUST produce, per adapter, `analysis_status`, candidates with stable ids,
  kind, oRTB path guess, file/line, control path, use-def, reach-to-outbound, and evidence slices;
  bundles of 2–8k tokens; `partial` when typing fails. SSA MUST NOT be added unless measured recall
  demands it.
- **FR-009**: The router MUST decide per fact, with objective reasons only (schema, path validity,
  consistency, evidence resolvability, static trace, classifier ambiguity, critical/rare class,
  analysis partial); the 31B MUST read the same bundle without the 8B's output; results MUST be
  compared and disagreement queued for a human; cache key MUST be model digest + taxonomy hash +
  prompt hash + candidate hash + options; the 31B MUST be unloaded after a batch and its absence
  verified.
- **FR-010**: Prompt v3 MUST be generated from the taxonomy, request facts not dispositions, carry
  the rule "parsing itself is not a rule; a parsing failure that changes outbound inclusion, shape
  or request creation is a rule", use numbered source lines, and draw boundary examples only from
  tune.
- **FR-011**: Model experiments MUST change one variable at a time, three repeats, on tune only;
  promotion to dev requires ≥ 3 pp macro-F1 or a substantial compute reduction at equal quality,
  compared paired by adapter. Broad KV/schema/model-size sweeps MUST NOT be repeated; an old
  hypothesis MAY be re-run once now that the runner stores evidence.
- **FR-012**: No model MAY be downloaded or deleted before the baseline is complete; no external
  LLM/API MAY be used; no secrets MAY be printed and `.env` MUST NOT be scanned.
- **FR-013**: Executable defaults in sibling stacks MUST NOT name a retired model tag; fallback
  without env MUST be pinned by a regression test; the retirement procedure MUST be followed and
  recorded.

### Key Entities

- **Run**: immutable directory under `bench/runs/<id>/` (manifest, cases, summary, SHA256SUMS).
- **Taxonomy v3**: `bench/taxonomy/taxonomy-v3.json` (axes, derived predicates, decision table,
  precedence, open policies, boundary cases, migration classes) and its generated artefacts.
- **Fact record**: one observed adapter behaviour (effect, trigger, write_gate, write_mode, scope,
  source{kind,path,inputs,selection}, target{carrier,path,creates_container}, condition,
  constraint{kind,detail}, failure_behavior, on_empty_result, source_retained, error_surfaced,
  uncertain_axes, evidence[]).
- **Candidate / Bundle**: miner output per adapter (`bench/data/miner-out/<bidder>.json`).
- **Split**: `bench/data/split-extraction-v1.json`, `bench/data/triage-cases-v1.json` with
  `frozen` and `holdout_opened` fields.
- **Router result**: `bench/router/runs/<id>/router-result.json` with per-fact decisions, cache
  keys, agreement, `deep_resident_after`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

Carried from the owner's Definition of Done. Two are **reported, not gated** until the owner
confirms (decision.md): SC-005 macro-F1 (per-class support; `forbidden` may be unmeasurable) and
the `dropped` clause of SC-003 (42/45 with misses named, or whole-file fallback).

- **SC-001**: Accepted outputs 100% schema-valid.
- **SC-002**: Citations 100% resolvable to the bundle; ≥ 95% evidence-supported.
- **SC-003**: Candidate recall ≥ 95% on verified rules; critical `dropped`/`reject`/`forbidden`
  at 100% _(dropped: reported — 42/45 as of 2026-08-23)_.
- **SC-004**: Extraction micro precision and recall ≥ 0.90 on dev; holdout opened once.
- **SC-005**: Macro-F1 ≥ 0.85 over legacy dispositions and ≥ +10 pp over the prompt-v2 baseline
  _(reported with per-class support)_.
- **SC-006**: Zero critical false negatives on classes present.
- **SC-007**: _Withdrawn 2026-08-23 (owner: no 31B)._ Replaced by: share of 8B facts accepted by the deterministic checks vs sent to the human queue, reported per class.
- **SC-008**: Triage macro-F1 ≥ 0.95, schema-validity 100%, false-safe = 0 on the ≥100-case set.
- **SC-009**: Hot 8B p50 not worse than the `p0-*` baseline by more than 20%.
- **SC-010**: Executable defaults free of `gemma4:e4b`; fast and deep smoke green; deep runner
  absent from RAM after work _(met 2026-08-23; must not regress)_.
- **SC-011**: Production, Steam guard and canonical corpus unchanged by the work.
- **SC-012**: If any gate is not met, the report says so with an error taxonomy and the next
  verifiable step; no auto-apply; all runs kept.

## Assumptions

- The lab stays outside the repository (research D2); the repository tracks this package and the
  two sibling-stack fixes. Whether the taxonomy JSON should also be tracked in-repo is carried as an
  open question for the owner.
- The owner accepts the two reframed Definition-of-Done clauses; if not, the report labels them
  failed rather than reframed.
- The three GumGum migrations and the sovrn re-adjudication are accepted on reading
  `ADJUDICATION.md`; if not, v2-vs-v3 is reported under both gold readings.
- The 31B's remaining job may be rare; "rarely exercised" is an accepted outcome for SC-007.
