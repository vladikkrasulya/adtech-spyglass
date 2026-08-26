# Final evidence report: Local Model Maximum v3

**Core verdict cut-off**: 2026-08-25 18:46 UTC · **evidence ledger synchronized**: 20:21 UTC  
**Node**: `vkbox`  
**Evidence root**: `/home/vk/.local/share/ortbtools-research/bench/`  
**Model under decision**: `gemma4-prod`, digest
`112b5e266519c958d490400f9f038669147246cb1654a05b51ea3d1ed882e68b`

## Verdict

The research infrastructure is reproducible and the current model-selection decision is supported:
**keep `gemma4-prod` as the sole production resident; do not restore the 31B tier; do not promote
the QAT candidate on present evidence**. The 31B matched 8B on the small triage baseline, improved
GumGum extraction by only one of eight rules, and cost ~21–75× more wall time. With operational
prompt v5, QAT falls behind current on the exact-contract dev diagnostic (20/26 vs 21/26). It
improves the three-case real-CI probe from 3/9 to 6/9, but that non-sealed set is not promotion
evidence and QAT still emits an invalid SQLite policy verdict. The model stays installed for
reproducibility but non-resident and without a production consumer.

Prompt v5 is deployed as a **prompt-only operational improvement**, with immutable v3 retained as
rollback. On current digest `112b…`, v5 exactly preserves corrected v3 dev quality (21/26,
paired better/worse/same 0/0/26) and improves the frozen non-sealed real-CI probes from 0/9 to 3/9.
This decision is not a fresh sealed quality acceptance and does not promote QAT.

The owner's earlier acceptance of 0.82 refers specifically to the legacy label-only `t047` result,
where false-safe was 0 and derived blocks-release accuracy was 1.00. Prospective exact-contract
evidence now shows that model JSON alone does not preserve those properties on every real probe;
production safety depends on the newly tested fail-closed validator. This narrows the claim rather
than rewriting the historical run.

This is **not** a claim that all original quality gates passed. Triage SC-008 macro-F1 ≥ 0.95 was
not met (0.777). Extraction did not produce a dev-promotable candidate: best tune micro-F1 was
0.221 and the extraction holdout remains sealed. The AST miner and taxonomy are strong; the 8B
fact extractor is the limiting component.

## Evidence integrity

- 47 run directories currently exist: **45 complete immutable runs** and 2 explicitly
  incomplete/aborted directories. Every complete run has `manifest.json`, per-case raw responses,
  `summary.json` and `SHA256SUMS`; all **45/45** checksum sets, exact-inventory integrity checks and
  metrics replays passed on 2026-08-25. The eleven runs
  after the core cut-off are separated in the remediation addendum rather than folded into the
  original verdict.
- The two incomplete directories are not counted as runs: `t032-e-miner-paths-short-8b` has 14/36
  responses and was replaced by a complete GPU run; `t038-e-think-8b-x1.aborted` has 2/12 responses
  and records the thinking runaway.
- Split manifests are frozen. Triage holdout was opened once for `t047`; extraction holdout was not
  opened.
- No canonical corpus migration was applied. `taxonomy/ADJUDICATION.md` remains a proposal.
- The complete inventory is `bench/RUNS-INDEX.md`; each number below names its run id.

One evidence caveat is load-bearing: triage prompt v3 asks for `confidence` as an enum,
`look_at` as a string, and the fields `one_line`, `blocks_release`, `why_not_other`; the schema
attached to `t046`/`t047` instead forces numeric `confidence`, array `look_at`, and `why`. Label
accuracy and its confusion matrix remain reproducible, but the runs do **not** validate the full
prompt output contract. A corrected contract requires a fresh sealed evaluation; the consumed
holdout must not be tuned or reopened to make that claim.

This contract drift was fixed prospectively on 2026-08-25: production watchman and the research
runner now share the exact six-field schema (SHA-256 `76296ac2180…`) and validate required/extras,
types, enums, single-line output and label↔`blocks_release` consistency without trusting Ollama's
grammar alone. After the real-CI probes, prompt-only v4 remediation added generalized precedence
rules while leaving that schema unchanged. `t054` then measured a dev regression (21/26 → 16/26),
so v4 is rejected. Minimal v5 preserves the v3 prefix/shots exactly and appends three clarification
bullets. `t055` preserved all 26 corrected v3 dev outcomes and `t056` fixed one of three real-CI
families, so Watchman now uses v5 operationally; v3 remains the rollback prompt. The research v5
hash is `bea7de8e79fd70a33f1ece08bcef89adb109cc04fd755a9749503fe123faf894` and the deployed
production artifact is `ee4bde5f9fcfaf9b0adf06a5f7ee64617f92cfb278d5fb61378b1d74a6061ef1`.
Offline suites pass 25/25 (watchman) and 75/75 (benchmark runner, integrity, split, contract and
metrics). No immutable response was rewritten and `t047` remains explicitly legacy/label-only
evidence.

## Model Pareto decision

| Workload                              |                                                   8B GPU |                                                                   31B CPU | Decision                            |
| ------------------------------------- | -------------------------------------------------------: | ------------------------------------------------------------------------: | ----------------------------------- |
| Triage v1, `think=false`, 10 cases ×3 |                 30/30, p50 2.1 s (`p0-tri-v1-8b-gpu-tf`) |                               30/30, p50 170.6 s (`p0-tri-v1-31b-cpu-tf`) | 31B adds no quality, ~81× p50       |
| GumGum extraction v2, ×3              | P/R/F1 0.67/0.50/0.57, p50 7.6 s (`p0-ext-v2-8b-gpu-tf`) |                      0.62/0.62/0.62, p50 160.5 s (`p0-ext-v2-31b-cpu-tf`) | +1/8 rule is not worth ~21× p50     |
| Triage v1, thinking                   |         27/30 correct, p50 2.2 s (`p0-tri-v1-8b-gpu-tt`) | 26/30 answered; 4 one-hour timeouts, p50 206.7 s (`p0-tri-v1-31b-cpu-tt`) | thinking rejected for schema triage |

The 31B was unloaded after its batch (`deep resident: none`, container 44.15 MiB in
`runs/baseline-p0.log`) and retired on 2026-08-23. The production runtime keeps only
`gemma4-prod` resident. A QAT candidate is installed but non-resident and has no consumer;
restoring a large model is a new decision, not rollback.

## Triage: before, after, and sealed result

All rows use family-disjoint data and three repeats.

| Candidate                          | Split   |  Accuracy |  Macro-F1 |           False-safe | Blocks-release |       p50 / p95 | Confusions                                       |
| ---------------------------------- | ------- | --------: | --------: | -------------------: | -------------: | --------------: | ------------------------------------------------ |
| v1 `t040-tri-v1-8b-gpu-tf-dev-x3`  | dev     |     0.808 |     0.726 | 11/33 blocking cases |          0.859 |     2.3 / 2.6 s | POLICY_GATE→HARNESS_ERROR 11; →REAL_REGRESSION 4 |
| v2 `t040-tri-v2-8b-gpu-tf-dev`     | dev     |     0.923 |     0.927 |                    0 |           1.00 |     2.3 / 2.8 s | REAL_REGRESSION→POLICY_GATE 6                    |
| v3 `t046-tri-v3-8b-gpu-tf-dev`     | dev     |     1.000 |     1.000 |                    0 |           1.00 |     2.3 / 2.8 s | none                                             |
| v3 `t047-tri-v3-8b-gpu-tf-holdout` | holdout | **0.819** | **0.777** |                **0** |       **1.00** | **2.0 / 3.0 s** | ENV_DEPENDENT→HARNESS_ERROR 13                   |

The 13 holdout misses are one unseen family, `missing-optional-binary`: optional `ffprobe`/
`wkhtmltopdf` missing on the runner. Gold calls it environment-dependent; v3 calls it a harness
error. Both are non-blocking, which explains perfect release safety despite the lower macro-F1.
The owner accepted 0.82 as the final v3 number on 2026-08-24. This acceptance does not rewrite the
SC-008 threshold.

## Extraction and deterministic layer

The extraction-v2 and facts-v3 rows have different schemas and scopes; their F1 values must not be
treated as a direct before/after series. Within facts-v3, comparisons are paired on the same 12
tune adapters.

| Run                               | Change                         |      Micro P/R/F1 | Macro-F1 | Escalated |             p50 | Result                                    |
| --------------------------------- | ------------------------------ | ----------------: | -------: | --------: | --------------: | ----------------------------------------- |
| `t032-a-raw-8b`                   | raw facts v3                   | 0.129/0.121/0.125 |    0.073 |      0.95 |          44.8 s | baseline                                  |
| `t032-b-fewshot-lines-8b`         | few-shot + numbered lines      |    0.06/0.06/0.06 |        — |         — |          56.1 s | reject                                    |
| `t032-c-tax301-raw-8b`            | receiver-stripping instruction |    0.01/0.01/0.01 |        — |         — |          48.4 s | reject                                    |
| `t032-d-miner-paths-8b`           | long miner path list           |    0.05/0.03/0.04 |        — |      0.82 |          47.9 s | reject; early-stop                        |
| `t032-e-miner-paths-short-8b-gpu` | short miner path list          | 0.174/0.138/0.154 |    0.098 |      0.75 |          46.0 s | improvement, below promotion gate         |
| `t037-verify-on-e-8b`             | extract then verify            |    0.17/0.15/0.16 |        — |         — |          32.3 s | +1 pp for double calls; reject            |
| `t045-percand-8b-r3`              | one candidate per call         | 0.179/0.293/0.221 |    0.223 |      0.69 | 4.8 s/candidate | best tune direction, still far below gate |

The deterministic layer is useful but cannot recover omitted facts: path canonicalisation raised
precision on stored A responses from 0.13 to 0.16 without raising recall; validate-polarity
normalisation raised `required-by-adapter` F1 from 0 to 0.17 on D. The Go miner itself passes:
360/364 candidate recall = 98.9%; all classes except `dropped` are at their stated critical recall,
while `dropped` is 42/45 with all misses named.

## Rejected hypotheses

- **Larger model**: 31B brought no triage gain and a very small extraction gain at 21–81× p50.
- **Thinking for structured workloads**: reduced 8B triage accuracy; caused four one-hour 31B
  timeouts and a >12k-token facts runaway.
- **More prompt instruction / few-shot**: F1 0.12 → 0.06; the receiver rule drove it to 0.01.
- **Long authoritative path list**: reduced bad-path escalations but triggered deterministic
  early-stop after one fact on long inputs.
- **Whole file instead of bundles**: 0.09 vs 0.12, and 10/12 current bundles were effectively the
  whole file, so this did not yet test real context reduction.
- **Extract then verify**: 0.15 → 0.16 for approximately twice the model work.
- **KV/schema/layout sweeps as a quality cure**: prior evidence and current model comparison show
  placement changes latency, not the missing-fact semantics; they were not repeated blindly.

## Taxonomy and migration proposal

Taxonomy 3.0.2 is generated from one source; generation is idempotent, 39/39 boundary fixtures and
15/15 adjudication projections pass. Six of seven frozen 008 disagreements match their adjudicated
answer. The seventh exposes inconsistent gold: the same presence guard is `required-by-adapter` for
Insticator and `validated` for Sovrn.

No migration is automatic. The proposal for human review is:

1. Sovrn `imp.video.mimes`: `validated` → `required-by-adapter`.
2. GumGum `imp.banner.w`: `injected` → `defaulted`.
3. GumGum `imp.banner.ext`: `injected` → `rewritten` (requires the named witness).
4. GumGum parse-failure rule: re-key from `imp` to `imp.ext`, `dropped` →
   `required-by-adapter`.

Full fact/evidence/rationale rows are in
`/home/vk/.local/share/ortbtools-research/bench/taxonomy/ADJUDICATION.md`.

## Success-criteria disposition

| Criterion                                        | Status                                    | Evidence / error taxonomy                                                                                                                                                                                                             | Next verifiable step                                                                                            |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| SC-001 schema-valid accepted outputs             | **partial, remediation shipped**          | Historical `t047` is label-only because its attached schema differed. Production and runner now share exact schema `76296ac2180…`; v5 dev diagnostics are current 21/26 and QAT 20/26 exact, but neither is a new sealed quality run. | Evaluate the fixed contract on a new frozen family-disjoint set; do not reopen t047.                            |
| SC-002 citations resolvable/support ≥0.95        | **not met**                               | Facts candidate still escalates 15 evidence and 74 classifier checks in per-candidate r3; complete citation-support metrics are missing.                                                                                              | Finish T022 metrics; run on dev before opening extraction holdout.                                              |
| SC-003 miner recall ≥0.95; critical classes 1.00 | **reported exception**                    | Overall 360/364 = 0.989; `dropped` 42/45. Misses: Huawei Ads ×2 partial typing, Smartadserver evidence outside adapter.                                                                                                               | Owner chooses T027: accept named 42/45 or implement measured whole-file fallback for `dropped`.                 |
| SC-004 extraction P/R ≥0.90 on dev               | **not met**                               | Best tune candidate r3 is P/R 0.179/0.293; no candidate promoted to dev.                                                                                                                                                              | Continue isolated tune experiments T034–T036/T039; promote only after threshold.                                |
| SC-005 macro-F1 ≥0.85 and +10 pp                 | **not met**                               | Best tune macro-F1 0.223; short-path E improves raw by only +2.5 pp macro.                                                                                                                                                            | Same as SC-004; finish per-class metrics before promotion.                                                      |
| SC-006 zero critical false negatives             | **not demonstrated**                      | No extraction candidate reached dev/holdout; `dropped` recall is zero in the tune model rows.                                                                                                                                         | Meet SC-004 on dev, then report critical per-class FN before the one holdout opening.                           |
| SC-007 31B routing                               | **withdrawn/replaced**                    | Owner retired 31B. E accepts ~25% and escalates ~75% overall, but the required per-class report is incomplete.                                                                                                                        | Complete T022 per-class acceptance/human-queue report; do not restore 31B.                                      |
| SC-008 triage macro-F1 ≥0.95                     | **not met, owner accepted**               | Holdout macro-F1 0.777, accuracy 0.819; 13 ENV→HARNESS errors in one unseen optional-binary family. False-safe 0.                                                                                                                     | Freeze this result; if semantics are revised, create a new family-disjoint sealed set rather than tune on t047. |
| SC-009 hot p50 ≤ baseline +20%                   | **met**                                   | v3 holdout p50 2.0 s vs p0 2.1 s; dev p50 2.3 s.                                                                                                                                                                                      | Regression-check on future prompt/model changes.                                                                |
| SC-010 retired defaults/deep absent              | **met**                                   | Sibling tests passed; 31B unloaded and removed; deep is stopped outside isolated benchmarks. `gemma4-prod` is the sole production resident; the QAT candidate is installed but non-resident.                                          | Preserve default-tag tests, benchmark isolation and retirement procedure.                                       |
| SC-011 prod/Steam/corpus unchanged               | **met within declared operational fixes** | Canonical corpus untouched; Steam guard preserved; shared-GPU guard prevents unscheduled bench use.                                                                                                                                   | Keep maintenance-window guard mandatory.                                                                        |
| SC-012 report unmet gates honestly               | **met by this report**                    | Every unmet/partial gate above has an error taxonomy and next step; all raw runs retained.                                                                                                                                            | Keep this report and index synchronized after any new complete run.                                             |

## Rollback and operational state

- Research runs and taxonomy proposal have no product-side auto-apply; rollback is selecting the
  previous prompt/config while retaining all immutable evidence. Never delete or overwrite runs.
- Watchman prompt rollback is the preserved, immutable v3 artifact. V4 remains rejected; rollback
  does not mean reopening `t047` or deleting v5 evidence.
- Sibling default fixes are commits `b2d9b7b` (`tg-llm-bot`) and `cf4797d`
  (`claude-usage-display`). Reverting them would restore a retired tag and is not a safe routine
  rollback; use the tested `gemma4-prod` defaults.
- 31B retirement is intentionally not reversible as an incident response. Restoring it requires a
  new spec, resource window, pull and full smoke sequence.
- Taxonomy/corpus rollback is unnecessary because the proposal was not applied.

Exact host snapshot at report cut-off:

| Field                        | Value                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| timestamp / node             | `2026-08-25T18:46:51Z` / `vkbox`                                                                                                                                    |
| disk available (`/srv/DATA`) | `136046809088` bytes (~126.7 GiB)                                                                                                                                   |
| RAM total / available        | `100980948992` / `81823227904` bytes (~94.0 / 76.2 GiB)                                                                                                             |
| swap total / used            | `16903041024` / `40976384` bytes                                                                                                                                    |
| GPU                          | RTX A2000, 6138 MiB total, 5252 MiB used at snapshot; installed in `SLOT1` at Gen3 x4 under load (`current_link_width=4`, max 16); `SLOT2` electrical x16 available |
| Ollama                       | 0.32.9; container image id `sha256:1685741456770df6e3cceb2a945a5f75e020f658d1701509668d6f4688f1dd3f`                                                                |
| resident model               | `gemma4-prod:latest`, 100% GPU, context 32768, keep-alive Forever                                                                                                   |

## Remaining formal work

Seven tasks remain open: T022, T023, T027, T034, T035, T036 and T039. They are follow-up research,
not missing evidence for the one-model decision. Any further triage tuning needs a new sealed set;
the extraction holdout remains available for exactly one final candidate.

One host-level maximum remains manual rather than a model task: physically moving the A2000 from
the occupied PCIe3 x4 slot to the available electrical x16 slot, then repeating the same
cold/prefill/decode measurement. It must not be automated; the power-off, acceptance and rollback
procedure is recorded in
`/srv/DATA/Stacks/gpunode/specs/000-gpunode-baseline/contracts/pcie-slot-remediation.md`.

## 2026-08-25 remediation addendum

Eleven post-cut-off immutable runs raise the inventory to **45 complete runs plus 2 explicitly
incomplete directories**; 45/45 checksum, exact-inventory integrity and metrics replays pass. The
first two are smoke comparisons; the next
two are contract-plumbing diagnostics on an already-open split; the remaining rows are prompt/model
regression diagnostics on already-open dev or frozen non-sealed real-CI probes, not a sealed quality
holdout:

| Run                                          | Model / placement                                         |                                        Result |    p50 | Cold load | Interpretation                                               |
| -------------------------------------------- | --------------------------------------------------------- | --------------------------------------------: | -----: | --------: | ------------------------------------------------------------ |
| `t048-tri-v1-8b-cpu-tf-smoke10`              | current `112b…`, isolated 8-core CPU                      |                                         30/30 |  9.9 s |     6.4 s | comparison baseline                                          |
| `t049-tri-v1-e4b-qat-cpu-tf-smoke10`         | official QAT `ee665637…`, same CPU                        |                                         30/30 | 10.5 s |     4.7 s | smoke parity only; no promotion                              |
| `t050-tri-v3-contract-8b-cpu-tf-dev-x1`      | current `112b…`, exact schema `76296a…`, CPU, 32K, dev ×1 | raw labels 26/26; exact contract/source 21/26 | 15.5 s |     6.4 s | checksum-valid diagnostic; not sealed promotion evidence     |
| `t051-tri-v3-contract-e4b-qat-cpu-tf-dev-x1` | QAT `ee665…`, exact schema, same CPU/32K/dev ×1           |                   exact contract/source 18/26 | 15.3 s |     4.7 s | three extra blocking contradictions vs current; no promotion |
| `t052-tri-v3-real-ci-8b-gpu-tf-x3`           | current `112b…`, GPU, 32K, real-CI ×3                     |                                           0/9 |  2.9 s |     5.8 s | fails all three probe families                               |
| `t053-tri-v3-real-ci-e4b-qat-gpu-tf-x3`      | QAT `ee665…`, GPU, 32K, real-CI ×3                        |                                           3/9 |  2.7 s |     5.9 s | fixes one family; both models fail two blocking families     |
| `t054-tri-v4-contract-8b-gpu-tf-dev-x1`      | current `112b…`, GPU, 32K, dev ×1, prompt v4              |                                         16/26 |  2.9 s |     5.8 s | reject v4: five POLICY_GATE→REAL_REGRESSION regressions      |
| `t055-tri-v5-contract-8b-gpu-tf-dev-x1`      | current `112b…`, GPU, 32K, dev ×1, prompt v5              |                                         21/26 |  3.0 s |     5.7 s | exact tie with corrected v3; operational prompt evidence     |
| `t056-tri-v5-real-ci-8b-gpu-tf-x3`           | current `112b…`, GPU, 32K, real-CI ×3, prompt v5          |                                           3/9 |  3.2 s |     5.6 s | fixes theme family; two families remain inexact              |
| `t057-tri-v5-contract-e4b-qat-gpu-tf-dev-x1` | QAT `ee665…`, GPU, 32K, dev ×1, prompt v5                 |                                         20/26 |  2.9 s |     5.9 s | one exact case behind current; no model promotion            |
| `t058-tri-v5-real-ci-e4b-qat-gpu-tf-x3`      | QAT `ee665…`, GPU, 32K, real-CI ×3, prompt v5             |                                           6/9 |  2.7 s |     5.1 s | TS/theme correct; SQLite remains schema-invalid              |

The 6.1 GB QAT tag is installed but not resident and has no production consumer. Smoke and the
non-sealed A/B rows above are diagnostic evidence, not a promotion set. QAT loses one exact dev
case under v5 and has no fresh sealed result, so the 6/9 real-CI improvement is insufficient for
promotion. A promotion claim still requires the exact deployed contract on a **new frozen
family-disjoint set** and the same placement. The existing holdout was consumed by `t047` and must
not be reopened; `gemma4-prod` remains the sole production resident.

An attempted diagnostic replay was stopped after five calls and moved to
`bench/aborted-runs/t050-tri-v3-contract-8b-cpu-tf-holdout/`. Its `ABORTED.md` records three reasons:
the holdout was already consumed, that runner hash did not score the full six-field contract, and
the CPU/8K/unlimited-generation profile did not match production. It has no summary/checksums and
is deliberately absent from the run count and index.

The completed `t050-…dev-x1` is distinct from that aborted directory. Its raw summary's 26/26 is a
legacy label score, not full-contract acceptance. Corrected deterministic scoring over its sealed
case records gives exact-contract/source-evidence 21/26, macro-F1 0.80, blocks-release accuracy
0.808 and false-safe 0. All five rejects are `KNOWN_FLAKE` gold logs that lack the literal
`ПОВТОР → ok → # fail 0` sequence demanded by the production contract: a dataset/contract mismatch.
The old detector's nine `fabricated_look_at` flags were false positives for free-form areas, and
the summary also had an aggregation bug; read-only recomputation gives 0/26. Reproduce with
`python3 metrics.py t050-tri-v3-contract-8b-cpu-tf-dev-x1 --triage-cases
data/triage-cases-v1.json --json`. No immutable record was edited.

The QAT dev replay `t051` falls further to 18/26 exact, macro-F1 0.714: it shares the five invalid
legacy flake sources and emits `blocks_release:true` with non-blocking `ENV_DEPENDENT` on three
additional cases. On the separately frozen real-CI probes, current `t052` labels none of the three
families correctly across three repeats; QAT `t053` fixes only the TS5108 harness family and scores
3/9. Both consistently mis-handle the SQLite policy pin and the real theme regression. Six of nine
raw outputs per model are unsafe/invalid for blocking semantics; the production validator turns
invalid outputs into blockers, so operational fail-closed behaviour is preserved, but that safety
net is not counted as model quality. The set is a regression probe, not a replacement holdout.

Prompt v4 remediates those three precedence patterns without copying evaluation text into its
examples: research SHA-256 `f4fb3ad414927…`, parent v3 `7881ec49089a…`, production prompt
`8d924248d160…`; the six-field schema remains `76296ac2180…`. GPU dev diagnostic `t054` scores
16/26 exact, macro-F1 0.541, versus corrected v3 `t050` at 21/26/0.80: all five policy-gate cases
become real regressions. Corrected fail-closed paired metrics are better/worse/same 0/5/21, mean
exact delta −0.1923; a prior paired path using stored legacy scores was fixed and covered by the
suite. V4 is rejected; no frozen dataset, gold or prior response changed. Minimal v5 is derived
directly from v3; automated checks prove the v3 system prefix and all five shots are preserved
exactly, with only three generalized bullets appended. Research SHA-256 is `bea7de8e79fd…`; after
provenance activation the deployed production artifact is
`ee4bde5f9fcfaf9b0adf06a5f7ee64617f92cfb278d5fb61378b1d74a6061ef1`.

Current+v5 `t055` is 21/26 exact, macro-F1 0.80, blocks-release accuracy 0.808 and false-safe 0;
paired against corrected v3 `t050`, every outcome is the same. Its non-sealed real-CI `t056` is
3/9: theme is correct on all repeats, TS is mislabeled `POLICY_GATE`, and SQLite outputs are
schema-invalid. This measured dev preservation plus one-family real-probe improvement supports an
operational v5 default, with v3 retained as rollback, but not a sealed quality claim.

QAT+v5 `t057` is 20/26 exact, macro-F1 0.778, blocks-release accuracy 0.769 and false-safe 0: the
same five source-invalid flake records plus one schema-invalid ENV output. `t058` is 6/9,
macro-F1/blocks-release accuracy 0.667: TS and theme are correct, SQLite remains schema-invalid.
The raw scorer therefore records false-safe 3/6 on both v5 real-CI model runs where SQLite is
invalid. Production validation converts invalid output to a blocker; this safety mechanism is not
credited as model accuracy and does not justify QAT promotion.

Runtime remediation is live and verified: Ollama image pinned to digest `168574…`; raw Ollama and
proxy host ports are loopback-only (`127.0.0.1:11434`, `127.0.0.1:8990`), with negative
LAN/Tailscale/bridge/IPv6 probes and internal-alias semantic canaries passing; json logs rotate
10 MiB ×5; semantic health is green; production is restored to `gemma4-prod` 100% GPU, 32K,
Forever. After `t051`–`t053`, the isolated CPU contour is stopped. `ollama list` has exactly two
installed tags (production plus QAT candidate), while `ollama ps` has only production resident.
The current-digest context ladder
and exact restore evidence live in
`/srv/DATA/Stacks/gpunode/specs/000-gpunode-baseline/contracts/context-ladder-2026-08-25.md`.

An end-to-end production canary through deployed v5/current and the exact
`extract_failure_blocks → triage_blocks` path blocked all three real-CI failures. Only one label is
actionable-exact: TS→`POLICY_GATE`, SQLite contradiction→fail-closed `TRIAGE_ERROR`, and
theme→`REAL_REGRESSION`. Thus operational blocker safety is 3/3 while exact actionable labeling is
1/3; this residual is explicit rather than hidden behind the validator.

One non-live compose source remains deliberately stale: the dedicated watchman clone may display
its old host URL until the canonical ortbtools change is committed upstream and the clone is
refreshed. That compose is not the running path. The host Watchman service uses the updated v5
script; canonical compose/tests and every running container consumer use the internal aliases.

Schema/scorer remediation is prospective and verified without reusing the holdout: 25/25
production watchman tests and 75/75 benchmark tests cover the exact contract, fail-closed
runner/integrity, split and metrics paths; schema SHA-256 is `76296ac2180…`. `metrics.py` now uses emitted v3
`blocks_release`, categorical confidence and recomputed path-like fabrication checks, which exposed
the five source-evidence-invalid dev cases above. T023 remains open: there is still no complete,
promotion-grade full-contract evaluation/report on a valid frozen set.
