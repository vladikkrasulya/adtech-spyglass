# Tasks: Local Model Maximum v3

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)
**Convention**: `[X]` done and verified, or explicitly closed by the dated archive decision · `[ ]` active work. Paths under
`~/.local/share/ortbtools-research/bench/` unless stated. Every number cites an immutable run id.

**Archive closure (2026-09-05)**: the owner stopped further experiments and requested preserved
results. See [the final archive](./archive/README.md). Cancelled proposals below are not successful
experiments; historical unmet targets remain unmet.

## Phase P0 — Reproducibility

- [x] T001 [FR-001] Shared runner `runner.py` with workload plugins; immutable run ids; manifest with model digest, ollama version, endpoint, layout, hashes, options, replay; per-case raw response incl. `thinking`, parse error, latency split, tokens, scorer output; `summary.json`; `SHA256SUMS`.
- [x] T002 [FR-002] `think` explicit per run (`--think true|false` required); `--repeats 3` default; `--cold` for cold-load; `--final-keep-alive 0` for deep.
- [x] T003 [FR-003] Shared-GPU guard: strip `num_ctx`, force `keep_alive=-1` on `:11434`; manifest records `shared_gpu_ctx_guard`; `--allow-runner-ctx-on-shared` off by default. Observed before the guard: hot model reloaded to ctx 8192 and `Forever` shortened to 30 m — both restored.
- [x] T004 Workloads `workloads/triage.py` (cases and prompt in `data/`, label-enum schema, fabricated-`look_at` check tolerant of `:line`) and `workloads/extraction.py` (corpus gold, set scoring, error taxonomy wrong_disposition / missed_field / extra_field / evidence_unresolvable / evidence_unsupported).
- [x] T005 Baseline runs on tune/smoke: `p0-ext-v2-8b-gpu-tf` (P/R 0.67/0.50), `p0-tri-v1-8b-gpu-tf` (10/10 ×3), `p0-tri-v1-8b-gpu-tt` (9/10 ×3, t04 wrong 3/3), `p0-tri-v1-31b-cpu-tf` (10/10 ×3, p50 170.6 s, cold 20.1 s).
- [x] T006 Baseline complete: `p0-tri-v1-31b-cpu-tt` — 26/30 answered, all correct; **4 of 30 hit the 3600 s timeout** (t02 ×2, t04 ×2: the same two cases 8B-with-thinking mis-labels). `p0-ext-v2-31b-cpu-tf` — P/R/F1 0.62/0.62/0.62, p50 160.5 s. Both runs carry `final_keep_alive: 0`; `runs/baseline-p0.log` records `deep resident: none` and container RAM 44.15 MiB after the chain.

## Phase P0 — Operational debt

- [x] T007 [FR-013] Fix executable defaults: `claude-usage-display/scripts/music-sense.py:25,59`, `tg-llm-bot/bot.py:39,158`, `tg-llm-bot/persona.txt:1`, live README lines 5/28/154/204 → `gemma4-prod`. History, CHANGELOG, `.bak`, provenance untouched.
- [x] T008 [FR-013] Regression tests `tg-llm-bot/tests/test_model_default.py` (suite 77/77) and `claude-usage-display/tests/test_model_default.py` + `npm run test:model-default` (js suite 708/0).
- [x] T009 `docker compose config -q` in both stacks; fast smoke (`gemma4-prod` 100% GPU); deep smoke with `keep_alive:0` → `ollama ps` empty, `llama-server` 0, container RAM 64 MiB.
- [x] T010 [FR-013] `gpunode/MODEL-RETIREMENT.md` — six-step procedure; reports carry `Disk available`, `RAM available`, timestamp, node.
- [x] T011 [FR-012] No model downloaded or deleted since the 2026-08-23 retirement; no external LLM called by any bench code; no secrets in any artefact; `.env` unread — verified by inspection of runner, router and miner sources.
- [x] T012 Commits tg-llm-bot `b2d9b7b`, claude-usage-display `cf4797d`.

## Phase P1 — Taxonomy v3

- [x] T013 Three independent designs → judge → merged `taxonomy/taxonomy-v3.json` (14 axes, 24-rule decision table, 40 boundary cases, open policies R-PARSE / R-REPLACE / R-PRESENCE / R-TRANSPORT / R-EMPTY-RESULT, migration classes).
- [x] T014 [FR-004] `taxonomy/generate.py` → `generated/{prompt-fragment-v3.txt, facts-schema-v3.json, TAXONOMY-v3.md, classifier.py, fixtures/boundary-cases.json, MANIFEST.json}`; every artefact carries `taxonomy_sha256`.
- [x] T015 [FR-004] [FR-005] `taxonomy/check.py` gate — classifier executes the decision table literally and returns `unclassified` with a reason: idempotent ✓, fixtures 39/39 ✓, enums ✓, same hash ✓.
- [x] T016 [FR-006] Adjudication GumGum 8 + 7 disagreements → `adjudication-v3-gumgum-and-7.json`; generated classifier reproduces all 15 projections. 6/7 disagreements match `correctDisposition`; sovrn-010 is an inconsistency inside the 008 adjudication (identical guard to insticator-010 labelled differently) → re-adjudicate. GumGum 5/8 match gold; 3 migrations named (banner.w → defaulted; banner.ext → rewritten; imp dropped → required-by-adapter via parse_failure / omit_impression).
- [x] T017 [FR-006] `taxonomy/ADJUDICATION.md` — human report `old rule → facts → projected → rationale` and migration proposal; canonical corpus untouched.

## Phase P1 — Honest benchmark

- [x] T018 [FR-007] `data/make-split.py` → `split-extraction-v1.json` (50/17/17 adapters; 210/90/64 rules; all nine dispositions in every split; gumgum in tune; empty_pool 12/4/4) + `SPLIT-extraction-v1.md`.
- [x] T019 [FR-007] `data/make-triage-cases.py` → `triage-cases-v1.json` (101 cases, 21 families, family-disjoint 51/26/24, `blocks_release` per family).
- [x] T020 First dev run `p1-tri-v1-8b-gpu-tf-dev`: 81%; `POLICY_GATE` 0/5 (family `spec-refs-orphan`, unseen in tune) → 4 false-safe. Finding, not a fix.
- [x] T021 [FR-007] Freeze manifests (`frozen: true`, hashes) before any tuning; recorded in both split files. Triage holdout opening is recorded once for `t047`; extraction holdout remains sealed.
- [x] T022 [FR-007] **Closed as partial reporting, 2026-09-05**: existing extraction metrics and immutable scores are preserved in [the archive](./archive/README.md). Additional fact-axis, condition, citation-support and resource reporting is cancelled, not claimed implemented.
- [x] T023 [FR-007] **Closed by archival verification, 2026-09-05**: existing triage metrics, confusion matrices, false-safe definitions, calibration and latency exports are preserved; 75 offline benchmark tests pass. Further reporting expansion is cancelled.

## Phase P1 — Candidate miner

- [x] T024 [FR-008] `miner/` Go module (`go/packages` with types; entrypoints MakeRequests / Builder; kinds read, assign, struct_construct, marshal_sink, header_write, query_write, uri_write, filter, validation, error_branch, helper_call; `ortb_path_guess`; control path; use-def; reach-to-outbound; evidence slices; bundles 2–8k tokens; `-all`; `analysis_status=partial` on typing failure).
- [x] T025 Run `-all`: 271 adapters, 260 complete / 11 partial.
- [x] T026 `miner/recall.py`: 360/364 = 98.9%; forbidden 5/5, required 74/74, validated 13/13, moved 57/57, injected 39/39, conditional 18/18, defaulted 14/14, rewritten 98/99, dropped 42/45 (huaweiads ×2 partial-typed whole-body rewrite; smartadserver evidence in `openrtb_ext/`). SC-003 `dropped` clause reported, not gated — decision.md.
- [x] T027 **Closed by owner archive decision, 2026-09-05**: preserve measured `dropped` recall 42/45 and its named misses; cancel the proposed whole-file fallback. The critical-class target is still not met.

## Phase P1 — Router

- [x] T028 [FR-009] `router/router.py`: per-fact decisions; checks schema, oRTB-path validity, source-target consistency, evidence resolvability, static-trace agreement, classifier ambiguity, critical-rare class, analysis partial; cache key digest + taxonomy + prompt + candidate + options; independent 31B read; agreement → accepted_agree or human_queue; `keep_alive:0` and resident check after deep; shared-GPU guard.
- [x] T029 No-deep smoke on GumGum (`router/runs/smoke-gumgum-nodeep-5`): 11 facts, 2 accepted (incl. `imp.ext.prebid.adunitcode → imp.tagid` moved = gold), 9 escalated with named reasons; second run `calls.fast == 0` via cache.
- [x] T030 [FR-009] Deep comparison — **closed by owner decision 2026-08-23**: no 31B. Router is two-tier (8B → checks → human queue). One no-deep run exists (`router/runs/t030-nodeep-gumgum`); the 31B leg was stopped after overheating the package (86 °C at 12 CPUs) and queuing in front of the hot model.

## Phase P1 — Prompt v3

- [x] T031 [FR-010] Prompt fragment generated from taxonomy (parsing-failure rule; oRTB paths not Go identifiers; evidence mandatory; `uncertain_axes` instead of guessing).
- [x] T032 [FR-010] Few-shot from boundary fixtures (tune only) and numbered-line citation instruction; measure on tune ×3 against raw v3 — one variable. A (raw, `t032-a-raw-8b`, 12 tune adapters ×3): micro P/R 0.13/0.12, 95% of facts escalated, reason #1 `path` (207) — Go receivers (`request.Imp`, `request.Site`) and header names scored as bad paths. Router fixed (header/url carriers are names, not oRTB paths); taxonomy 3.0.1 adds an explicit receiver-stripping rule as the NEXT single variable (C), not mixed into B. B (`t032-b-fewshot-lines-8b`): micro F1 0.06 < A 0.12; paired by adapter better 0 / worse 4 / same 8 — few-shot raised fact volume (rubicon 16→27) with the same Go-receiver paths (`path` 207→330). **Rejected.** C (`t032-c-tax301-raw-8b`, taxonomy 3.0.1 receiver-stripping rule): F1 0.01 — `path` fell 207→135 but the model read the rule as "report every variable" (`copy always request.X → X` ×66) and drifted into response-side (`bid.ad_m`, `bidResp.cur`) — generator was not emitting `scope`/`exclusions`; fixed (hash unchanged). **Rejected as a prompt instruction.** Two-stage (model lists paths first): gumgum P 0.60 but stage 1 listed 3 of ~12 paths; asking for completeness gave duplicates and 0/8. **Rejected.** D (`miner_paths`): stage 1 = the miner's `ortb_path_guess` list (authoritative, no guessing); gumgum R 0.50 (best so far), parse-failure rule found (trigger mislabelled `present`). D (`t032-d-miner-paths-8b`, ×3 on 12): F1 0.04 vs A 0.12, paired better 2 / worse 4 / same 6 — but escalation 0.95→0.82, `path` 207→69, and for the first time `dropped` P=1.00 and (after polarity normalisation) `required-by-adapter` F1 0.17: D extracts the real semantics where A matched labels by accident (`transform imp.BidFloorCur → imp.BidFloorCur` ⇒ rewritten). D lost gumgum entirely: the long 24-path list + `format` grammar made the model close the array after ONE fact, ×3 deterministically (131 tokens; A gives 15 facts). Variable E = the same list as one short line (`miner_paths_short`, `t032-e-miner-paths-short-8b-gpu`, ×3): **F1 0.15 — first variant above raw (0.12)**; escalation 0.95→0.75; paired better 3 / worse 2 / same 7; gumgum early-stop gone (1→8 facts), bidscube 0→3/3 gold, nexx360 0→2/4; `required-by-adapter` F1 0.17 kept from D. +3 pp micro / +2.5 macro — at the promotion threshold, not over it. Direction confirmed: less context, better. pgamssp still early-stops (1 fact). Meanwhile, deterministic layer improved and measured by RESCORE (no model calls, `bench/rescore.py`): router canonicalises non-oRTB paths against the miner list (`gumgumExt.zone → imp.ext.bidder.zone`), path rule accepts wire-case ext keys (`pubId`, `placementId` — 32 verified corpus rules use them; taxonomy 3.0.2); on A's raw responses P 0.13→0.16 with R unchanged (fp 142→112) — canonicalisation fixes case, not misses. Gumgum facts from D-smoke: escalation 12→9 of 14, accepted = 3 gold `moved` rules. Router also normalises validate polarity (`trigger=present`+`constraint=presence` ⇒ `absent`, per taxonomy consistency) — measured by rescore on D: required-by-adapter 0 → F1 0.17.
- [x] T033 Whole-source vs candidate-bundle input (`t033-whole-raw-8b` vs `t032-a-raw-8b`, ×3, 12 tune): F1 0.09 vs 0.12, paired better 2 / worse 3 / same 7 — **but the variable barely exists**: for 10/12 adapters the miner emits ONE bundle = the whole file (prompt tokens differ only by line numbering, +300); only rubicon/smaato are truly bundled and there tp is equal. Bundles as built are not a context reduction yet. Second observation: rtbhouse on whole → 1 fact in 7 s at 9.7k prompt tokens — the same early-stop as D/gumgum; it tracks input length, not only list length. Real context reduction = per-candidate calls (T045).

## Phase P2 — Optimisation (one variable, ×3, tune only; promote on dev at ≥ 3 pp macro-F1)

- [x] T034 [FR-011] **Cancelled, 2026-09-05**: isolated parsing-failure rule on/off experiment was not run. Existing v2/v3 evidence is archived without pretending it isolates this variable.
- [x] T035 **Cancelled, 2026-09-05**: controlled fact-schema versus disposition-schema experiment was not run. Existing runs have different scopes and remain historical evidence.
- [x] T036 **Cancelled, 2026-09-05**: separate boundary-few-shot ablation was not run. The related combined few-shot-and-line-number experiment `t032-b-fewshot-lines-8b` already failed and is preserved.
- [x] T037 Extract → verify (`t037-verify-on-e-8b`, ×3): F1 0.16 vs E 0.15 — +1 pp for double the calls. **Not worth it.**
- [x] T038 Thinking on/off. Triage tune: 8B off 10/10 vs on 9/10; 31B (before retirement) off 30/30 vs on 26/30 + 4 one-hour timeouts. Facts (`t038-e-think-8b-x1.aborted`): the third call exceeded 12k generated tokens and was still going — the same runaway as 31B triage-with-thinking. **Thinking is off for every workload; closed.**
- [x] T039 **Cancelled, 2026-09-05**: retrieval-of-tune-examples proposal was not executed; no retrieval quality result is claimed.
- [x] T040 Triage prompt v2 (`t040-tri-v2-8b-gpu-tf-dev`, dev ×3): `POLICY_GATE` names the repo's real gate tests → **0/5 → 15/15, false-safe 4 → 0, blocks_release acc 1.00, acc 0.81 → 0.92**. New confusion: REAL_REGRESSION→POLICY_GATE ×6 (family `contract-value-changed`: `finding-catalog: served severity…` is a product contract, not a gate) — my list named the test, not the failure kind. Next variable v3: gate = artifact missing / file forbidden / registry record violates a rule; a wrong served VALUE is a regression even in a gate-named test. Control v1 ×3 completed as `t040-tri-v1-8b-gpu-tf-dev-x3`; the result is in the archive.

## Report

- [x] T041 [FR-007] Triage holdout opened once by the owner (2026-08-24, recorded in `triage-cases-v1.json.holdout_opened`) for candidate prompt v3 (`t047-tri-v3-8b-gpu-tf-holdout`, ×3): **acc 0.82, macro-F1 0.78, false-safe 0, blocks_release acc 1.00**; POLICY_GATE 15/15, REAL_REGRESSION 18/18, KNOWN_FLAKE 12/12. All misses are ONE unseen family, `missing-optional-binary` (ffprobe ENOENT on the runner): gold ENV_DEPENDENT vs predicted HARNESS_ERROR — a boundary humans would argue; operationally free (both are non-blocking). **SC-008 macro-F1 ≥ 0.95 NOT met** — reported per SC-012 with this error taxonomy; dev 1.00 was an overestimate, which is exactly what the sealed set is for. No further tuning against this holdout; next iteration needs a fresh sealed set or an owner ruling on the ENV-vs-HARNESS definition for optional binaries. The extraction holdout remains sealed. **Owner decision 2026-08-24: 0.82 is accepted as v3's final number** — SC-008 stands as reported-not-met-but-accepted; the first consumer is the watchman (built as host ops, see `/srv/DATA/Stacks/ortbtools-watchman/`).
- [x] T042 Final report: [report.md](./report.md) — before/after, confusion matrices, Pareto quality/latency/RAM, rejected hypotheses, migration proposal, rollback, exact host state; every unmet gate has an error taxonomy and next verifiable step.
- [x] T043 [FR-003] Shared-GPU bench guard widened after the 2026-08-23 incident (bench on `:11434` queued in front of four consumers; 31B at 12 CPUs hit 86 °C): runner and router refuse `:11434` without `--i-am-in-maintenance-window`; deep node capped at `cpus: 8`; one bench at a time. 8B benches run on the CPU node.
- [x] T044 [FR-012] `gemma4:31b` retired by `gpunode/MODEL-RETIREMENT.md` (refs checked, not resident, rm via :11434, smoke OK); `ollama-deep` stopped; research preserved and indexed (`bench/README.md`, `bench/RUNS-INDEX.md`).
