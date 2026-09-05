# Local Model Maximum v3 — archived results

**Closed**: 2026-09-05, by the owner's instruction to retain the existing results and stop further experiments.

The research cycle is complete and archived. The unchecked items in the old task list were
follow-up experiments and reporting extensions, not an unfinished production rollout. They are
now explicitly disposed of below. Closing the cycle does not turn unmet quality targets into passes.

## Preserved evidence

- [Run inventory](./run-inventory.json): all **47 complete runs**, their original manifests and
  summaries, and the digest of each original checksum inventory. Every complete run passed exact
  file-inventory and SHA-256 verification on 2026-09-05.
- [Metrics export](./metrics-replay.json): the existing metrics module applied offline to those
  immutable records. No model was called. Triage records use the current validator; extraction
  metrics use historical stored scores, including their known limitations.
- [Raw archive descriptor](./archive.json): path, size and SHA-256 for the independent full archive
  on `vkbox`. It contains the benchmark inputs, prompts, taxonomy, router, miner, replay code,
  original run files and incomplete evidence. Every archived run file was compared against the
  source by SHA-256. The original research tree is retained as well.
- [Historical report](../report.md): point-in-time decisions and findings; its older inventory and
  operational-state statements are historical. This archive is the final disposition.

The independent archive is
`/home/vk/.local/share/ortbtools-research/archive/2026-09-05/bench-results-and-replay-code.tgz`
on `vkbox` (28,700,578 bytes). Its SHA-256 is
`a78e5d1ea98cb567f2fce96020ecda5e0b0437d3561de8dc588142dd0415f27d`.
It is outside the production checkout and data volume. The three incomplete directories are
`t032-e-miner-paths-short-8b`, `t038-e-think-8b-x1.aborted`, and the quarantined
`t050-tri-v3-contract-8b-cpu-tf-holdout`; they are preserved but excluded from conclusions.

## Final decision and metric boundaries

Keep `gemma4-prod` (digest `112b5e266519…`) as the only production model. Keep prompt v5 and
the existing fail-closed output validator. Do not restore 31B or promote the QAT candidate.
The final frozen A/B runs were completed on **2026-08-26**, after the initial report cut-off:

| Evidence                                            | Incumbent / result                | Candidate / comparison                          | Disposition                                                                   |
| --------------------------------------------------- | --------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `t059` / `t060`, new frozen triage set, 23 cases ×3 | 44/69 exact; 10 schema-invalid    | 44/69 exact; 13 schema-invalid                  | Exact tie defaults to incumbent; candidate also loses the schema-invalid gate |
| `t047`, earlier legacy label-only holdout           | 59/72 labels; macro-F1 0.777      | No exact-contract quality claim                 | Retain historical result and owner's earlier acceptance                       |
| `t045-percand-8b-r3`, extraction tune               | P/R 0.179/0.293                   | Far below 0.90/0.90 target                      | No extraction promotion; extraction holdout stays sealed                      |
| Static miner                                        | 360/364 candidates; dropped 42/45 | Three dropped misses named in historical report | Preserve measured limitation; no fallback experiment                          |

The QAT model was retired on 2026-08-26. Live inspection on 2026-09-05 confirmed only
`gemma4-prod` resident on the shared GPU; no research inference was started during this closure.

**Do not conflate raw model failures and guarded production decisions.** The earlier final A/B
note reported zero false-safe decisions after the fail-closed guard. The current metrics export
counts an invalid answer to a blocking case as unsafe even when the guard rejects it: `t060`
therefore has `false_safe_n=3`, while `t059` has zero. The raw schema-invalid totals remain
13 versus 10. Preserve both definitions; this does not reverse the rejection of QAT.
The extraction export is a historical scorer view, not new adjudication: for per-candidate r3 it
reports micro-F1 0.222 and legacy macro-F1 0.214, while the older narrative reported 0.221/0.223.
Do not silently substitute one aggregation for the other or claim that missing fact-axis gold,
condition accuracy, or complete citation-support metrics have been reconstructed.

## Disposition of the seven stale task entries

| Task | Preserved result                                                        | Final disposition                                                                                                 |
| ---- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| T022 | Extraction metrics code and existing run scores                         | Archive the partial reporting implementation; unimplemented axes and support metrics remain explicitly unmeasured |
| T023 | Triage metrics, confusion matrices, confidence bins and contract checks | Preserve implementation and exports; 75 offline benchmark tests passed; no reporting expansion                    |
| T027 | Miner recall 360/364, including dropped 42/45                           | Keep the measured limitation; cancel the proposed whole-file fallback                                             |
| T034 | Existing v2 and v3 runs                                                 | Cancel the unperformed isolated parsing-failure ablation; the old runs do not isolate this variable               |
| T035 | Existing disposition and fact-schema runs                               | Cancel the proposed controlled schema comparison; their historical scopes differ                                  |
| T036 | `t032-b-fewshot-lines-8b` reduced F1 and was rejected                   | Preserve that combined experiment; cancel a separate boundary-few-shot-only ablation                              |
| T039 | No retrieval experiment                                                 | Cancel the proposal; record no result for an experiment that did not run                                          |

These cancellations implement the owner's 2026-09-05 decision. They are not successful experiments.
Any new research cycle needs its own scope and fresh evaluation protocol; this package has no
active experiment queue. No model was downloaded, restored, deleted or reconfigured by this closure.

## Reading or replaying the archive

The compact evidence above is versioned in SpecKit. To verify the independent raw copy on `vkbox`:

```bash
cd /home/vk/.local/share/ortbtools-research/archive/2026-09-05
sha256sum -c SHA256SUMS
tar -tzf bench-results-and-replay-code.tgz >/dev/null
```

After extraction into a separate directory, `bench/metrics.py RUN_ID --json` reads a sealed run
without inference. The original scorer, integrity checker and 75-test offline suite are inside
the archive. Do not edit the original run records or reopen a consumed holdout.
