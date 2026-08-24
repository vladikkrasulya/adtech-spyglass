# Idea Research: Local Model Maximum v3

- **Slug**: local-model-maximum
- **Created**: 2026-08-23
- **Evidence confidence (overall)**: medium — the measurement evidence is first-party and
  reproducible from this date forward (runner with immutable runs), but everything before
  2026-08-23 was measured by one-off scripts without raw responses, and the gold itself was
  produced under the taxonomy this idea proposes to replace.

## Users & Demand

- The only user is the owner, acting as operator of the research corpus and the two local models.
  Demand is stated directly in the work package of 2026-08-23 and is a response to measured
  failure, not a wish: the prompt rewrite v1→v2 moved extraction from 1/8 to 4/8 on the 8B model
  and 2/8 to 5/8 on the 31B model on the GumGum adapter, while a 4× larger model (Qwen3.6-35B)
  scored the same 4/8 — [source: `~/.local/share/ortbtools-research/bench-results-2026-08-23.md`]
  (confidence: high, cited; caveat: one adapter, one run, recall-only scoring, no holdout).
- The external audit of 2026-08-23 (pasted into the session; verified claim by claim in the
  session record) located the remaining misses in the instruments, not the models: `imp/dropped`
  is contradicted by the prompt's own "parsing is boilerplate" instruction at `gumgum.go:34`;
  `imp.banner.w` from `banner.format[0].w` is simultaneously `defaulted`, `moved` and (per gold)
  `injected`; definitions live outside git in `audit/reader-sandbox/taxonomy.json` while
  `specs/008-…/data-model.md` only references the field — [source: session record 2026-08-23;
  `gumgum.go:34` read directly] (confidence: high, cited).

## Prior Art

- **Feature 008 (complete, deployed as v1.14.4)** established the research-lab footing this idea
  inherits: artifacts outside the repository (research D2), `npm run ci` does not run the lab,
  canonical corpus mutated only with provenance, bounded samples that do not extrapolate. Its
  named follow-up queue holds exactly **7 disposition disagreements**, all on the boundaries this
  idea targets: logan `injected`→`rewritten`; sovrn `conditional`→`validated`; insticator
  `injected`→`moved` (×2) and `validated`→`required-by-adapter` (×3) —
  [source: `audit/adjudication-b2.json` followUpQueue; `specs/008-…/tasks.md:294,300,349`]
  (confidence: high, cited).
- **ADR-012** bounds model assist in the _product_ to one path, suggestion-only, local-only. This
  idea has zero product surface and does not touch that path; it does not reopen ADR-003 either —
  [source: `specs/decisions/ADR-012-…md`] (confidence: high, cited).
- **Three days of measurement (2026-08-21…23)** are the immediate precedent, and they show both what
  was learned and why it cannot be trusted yet: the old bench had `think` defaulting to _on_ for
  triage and _off_ for extraction, saved no raw responses, and scored recall on (field,disposition)
  pairs only. The first runs under the new runner already overturned one conclusion: triage 8B with
  `think=false` is **10/10 ×3** (the "stable miss on t04" was an artifact of thinking — it recurs
  3/3 with `think=true` and 0/3 without) — [source: `bench/runs/p0-tri-v1-8b-gpu-tf`, `…-tt`,
  immutable, SHA256SUMS] (confidence: high, cited).
- **Outside this project**: fact-first extraction with deterministic projection to a legacy label,
  and AST-narrowed context windows for code LLMs, are standard practice; no specific external tool
  is adopted here and none was fetched — [ASSUMPTION: general practice; no URL consulted]
  (confidence: medium).

## Market & Context

- The alternative the owner relies on today is the v2 prompt on whole-adapter input with the 8B
  model, scored by hand against a corpus whose labels the model disputes for reasons that are often
  defensible. The cost of doing nothing is that every further "improvement" is unmeasurable: the
  31B tier costs 10 minutes per adapter on CPU (636 s measured) for one extra correct rule out of
  eight, and no one can say whether that rule is real — [source: `bench-results-2026-08-23.md`]
  (confidence: high, cited).
- Buying capacity instead is off the table for now by the owner's decision and by measurement:
  models were retired to two on 2026-08-23; the 80B-class candidates need ~12 min per case at
  5.7 tok/s prefill and 50 GB that does not fit the deep container's 32 GB limit —
  [source: session record 2026-08-22, research workflow on 70B candidates] (confidence: medium).

## Data & Constraints

- **Gold available**: 364 verified rules across **84 adapters** that have source in the pinned
  prebid-server snapshot (commit `0ba3523`, Apache-2.0, no NOTICE trap). Per-adapter rule counts:
  min 1, median 3, max 35. By legacy disposition: rewritten 99, required-by-adapter 74, moved 57,
  dropped 45, injected 39, conditional 18, defaulted 14, validated 13, **forbidden 5** —
  [source: `derived/adapter-rules-2026-08-20.json`, counted 2026-08-23] (confidence: high, cited).
- **Split arithmetic**: 84 adapters → ≈50/17/17 at 60/20/20. With 5 `forbidden` examples in total,
  a per-split presence of every class is possible only if `forbidden` is spread 3/1/1 or 2/2/1 —
  and macro-F1 over a class with one holdout example is a coin. This constrains which DoD gates are
  measurable — [source: counts above] (confidence: high, cited).
- **Gold provenance**: all 364 were verified under taxonomy v1; 824 more are `unverified` and by
  the package's own rule are not gold without re-reading — [source: corpus status counts]
  (confidence: high, cited).
- **Host**: 94 GB RAM, 6 GB VRAM (A2000), 16 cores; the hot model holds ~4.6 GB VRAM and serves
  four consumers, so runner-level `num_ctx`/`keep_alive` on `:11434` reload or shorten it (observed
  twice on 2026-08-23 and now blocked in the runner); the deep container is capped at 32 GB /
  12 CPUs; model weights are anonymous memory (RSS anon 22 GB, file 0) and are not reclaimable —
  [source: `gpunode/docker-compose.yml`, `ollama-deep/docker-compose.yml`, `/proc/<pid>/status`
  read 2026-08-22] (confidence: high, cited).
- **Toolchain**: Go 1.27 installed user-locally on 2026-08-23 with checksum; `go vet
./adapters/gumgum/` passes against the snapshot, so `go/types` resolution is available to a miner
  — [source: session record] (confidence: high, cited).
- **Latency floor**: 8B on GPU ~2 s/triage case, ~8 s/GumGum extraction; 31B on CPU ~190 s/triage
  case and ~636 s/GumGum extraction; 31B cold load ~23 s — [source: runs above] (confidence: high).

## Evidence Against the Idea

- **The gold may be the weakest link, and the idea cannot fix it from the inside.** Re-verifying
  364 rules under a fact schema is human work; a decision table that "projects" v1 labels can look
  right by construction. If the projected labels disagree with the corpus at scale, the corpus —
  not the model — is what moved, and the DoD gate "+10 pp over v2 baseline" compares against a
  moving target — [source: reasoning over the counts; the 7 disagreements already show corpus
  labels judged wrong in 3 of 7] (confidence: medium, partly cited).
- **Class imbalance makes several gates unmeasurable as written.** `forbidden` has five examples in
  the entire corpus; `validated` 13; `defaulted` 14. Macro-F1 ≥ 0.85 over nine classes with a
  sealed holdout of ~17 adapters will have one-example classes. The honest outcome may be
  "unmeasurable at this gold size", which the package's own failure clause permits but which means
  the headline gate cannot be declared passed — [source: counts] (confidence: high).
- **Candidate recall is an upstream ceiling that does not exist yet.** Everything downstream (8B
  facts, router, 31B review) can only see what the miner surfaces; a bounded call graph without SSA
  will miss cross-function and reflective flows, and the package defers SSA. If recall on
  `dropped`/`forbidden` is below 100%, the "zero critical false negatives" gate fails regardless of
  model quality — [ASSUMPTION until the miner is measured] (confidence: medium).
- **The 31B tier may have no job left.** With `think=false` the 8B already matches the 31B on the
  triage smoke set, and on extraction the 31B buys one rule per ten minutes. If taxonomy v3 and
  narrow bundles lift the 8B further, the escalation path could be exercised rarely enough that
  its own gates (≤1 pp behind always-31B) are untestable in practice — [source: p0 runs]
  (confidence: medium).
- **Scope is large for a paused direction.** The owner paused the dialect line on 2026-08-22; this
  package is research tooling in service of that paused line. Every hour here is an hour not on the
  inspector defect queue (Q1 immutable-cache risk still open) — [source: `specs/ROADMAP.md` pause
  note; `inspector-ui-consistency/intake.md`] (confidence: high, cited).

## Gaps & Open Questions

- [NEEDS CLARIFICATION: how many of the 364 verified rules survive re-verification under the fact
  schema — the adjudication of GumGum + 7 disagreements (in progress) is the first sample]
- [NEEDS CLARIFICATION: miner candidate recall on the 364 verified rules before SSA — being measured
  by the miner workflow; this number decides whether the 95%/100% gates are reachable]
- [NEEDS CLARIFICATION: whether the 31B think=true/false triage runs (in progress) change the
  picture of what the deep tier is for]
- [NEEDS CLARIFICATION: which DoD gates the owner wants held as hard gates versus reported as
  measured-but-unreachable-at-this-gold-size — macro-F1 over nine classes is the obvious case]
- [NEEDS CLARIFICATION: placement — the package says the lab lives outside the repository like 008;
  what, beyond this assessment and the feature package, should the repository track (a pointer
  file? the taxonomy JSON as the canonical source?)]

## Sources

- First-party, local filesystem only; no URLs fetched for this research.
  - `~/.local/share/ortbtools-research/bench/runs/p0-*` (immutable runs with `SHA256SUMS`)
  - `~/.local/share/ortbtools-research/bench-results-2026-08-23.md`
  - `~/.local/share/ortbtools-research/prebid-2026-08-20/derived/adapter-rules-2026-08-20.json`
  - `~/.local/share/ortbtools-research/prebid-2026-08-20/audit/adjudication-b2.json`
  - `~/.local/share/ortbtools-research/prebid-2026-08-20/prebid-server/adapters/gumgum/gumgum.go`
  - `specs/008-openrtb-dialect-verification/{plan,tasks,data-model}.md`, `specs/ROADMAP.md`
  - `specs/decisions/ADR-005-evidence-driven-dialects.md`, `ADR-012-bounded-model-assist-on-dialect-labelling.md`
  - `/srv/DATA/Stacks/gpunode/docker-compose.yml`, `/srv/DATA/Stacks/ollama-deep/docker-compose.yml`
  - Session record 2026-08-21…23 (external audit verified claim by claim)
