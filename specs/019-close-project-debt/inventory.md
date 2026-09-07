# Audited debt inventory — 2026-09-07

Each row needs evidence for its disposition. Pending is not closed.

| ID  | Item                                                             | Required outcome                                                                                                  | Disposition                                                                           |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| D01 | Q1 resource identity and cross-deploy mismatch                   | Complete HTTP and browser correction                                                                              | Implemented and independently reviewed; async-mount correction verified               |
| D02 | Q5 inconsistent selection popups                                 | Accessible themed selection component                                                                             | Closed implementation; browser and accessibility checks passed                        |
| D03 | Q6 tabs and count alignment                                      | Three-locale/two-theme regression                                                                                 | Closed implementation; populated locale/theme/width matrix passed                     |
| D04 | Q7 unlock autofill                                               | Scoped credential form, single submit, browser regression                                                         | Closed implementation; form, duplicate-submit and cancellation checks passed          |
| D05 | Registration/resend email locale coverage                        | All three email entry points tested                                                                               | Closed; 98 auth/locale checks passed                                                  |
| D06 | Dependency PR 78                                                 | Reviewed integration and hosted/native/package gates                                                              | Integrated; complete local gates pass; remote disposition pending                     |
| D07 | Dependency PR 79                                                 | Reviewed integration and hosted/native/package gates                                                              | Integrated; complete local gates pass; remote disposition pending                     |
| D08 | Dependency PR 80                                                 | Correct floor guard and reviewed integration                                                                      | Integrated; corrected guard and complete local gates pass; remote disposition pending |
| D09 | GitHub Releases 1.19.2 and 1.19.3                                | Exact tag revision and changelog readback                                                                         | Closed; exact Release metadata read back                                              |
| D10 | Stale feature/intake/roadmap status                              | Reconcile 005/009/010/015/017/018 and Q2-Q4/Q8                                                                    | Closed; canonical records reconciled                                                  |
| D11 | Four stashes                                                     | Inspect metadata, preserve unique work, record disposition                                                        | Closed; all stashes preserved and reconciled                                          |
| D12 | Five local task branches and four worktrees                      | Preserve uncommitted/unique work before cleanup                                                                   | Closed; complete verified archives precede local cleanup                              |
| D13 | GitHub repository identity                                       | Owner choice and canonical record                                                                                 | Baseline retained under stated maintenance assumption                                 |
| D14 | First npm publication                                            | Owner choice; publication remains explicit action                                                                 | Baseline retained: local workspaces; no publication authorized                        |
| D15 | Telegram/Sentry monitoring                                       | Owner choice and coverage/configuration outcome                                                                   | Baseline retained: Telegram configured and locally tested; optional Sentry off        |
| D16 | CL-001 value-independent mappings                                | Owner choice: new feature or separate future plan                                                                 | Separate future development plan                                                      |
| D17 | Creative preview wave 2 / push inlining                          | Owner choice and privacy-scoped follow-up                                                                         | Separate future development plan                                                      |
| D18 | SChain cross-field checks                                        | Owner choice and bounded assessment                                                                               | Separate future development assessment                                                |
| D19 | 008 seven disagreements / twelve oracle limits / route relevance | Preserve evidence and owner pause unless explicitly resumed                                                       | Evidence and existing pause preserved; separate future plan                           |
| D20 | 011 Local Model Maximum                                          | Preserve final archive and cancelled experiments                                                                  | Closed existing; 47 archived complete runs, new experiments cancelled 2026-09-05      |
| D21 | Backup ownership I-2                                             | Reconcile old pending count with repaired contract                                                                | Closed existing; docs/OPERATIONS.md decision 2026-09-02                               |
| D22 | Fleet/process and adjacent blog proposals                        | Explicitly distinguish future assessment from accepted debt; verify any claimed runtime defect before adding work | Future process proposals separated; Blog defects fixed and independently reviewed     |
| D23 | Three existing unused lint-disable warnings                      | Remove obsolete directives if still present                                                                       | Closed implementation; obsolete directives removed                                    |
| D24 | Final complete release and closure                               | All required gates, fresh backup, exact deploy and evidence                                                       | Pending integration                                                                   |
| D25 | Ten skipped retired SQLite event-log tests                       | Replace with active ClickHouse HTTP-contract coverage                                                             | Closed; 22 active HTTP tests, no retired-backend skips                                |

## Owner-choice questions

Sent before implementation: scope of deferred product features; repository/npm end state; monitoring end state. No reply has been recorded. After independent work and a stated assumption, this maintenance retains the existing baseline; no external change is inferred. Prior research cancellation and private-data boundaries remain in force.

## Local-work reconciliation completed

All four stashes, five task branches and four linked worktrees are now preserved in the private archive `/home/vk/.local/share/ortbtools-reconciliation/2026-09-07-090946/`. Its verified Git bundle retains nine named archive refs; four complete worktree tarballs were verified against 3492 file digests and then checked again before cleanup. Symlinks and current Git status were compared before removal. `manifest.json`, `cleanup.json` and `RESTORE.txt` document exact recovery; no private draft content is tracked here. Main is the only active worktree and the active stash list is empty. Archive refs remain local under `refs/archive/019/`.

- stash0: UI already delivered in 1b262f3/9d1b883; assessment recovered in 3446273. Archived duplicate.
- stash1: obsolete host-document draft; valid stale-address concern repaired by runtime discovery instructions. Invalid alternate stack/container names were not adopted.
- stash2: archived unaccepted news prototype; depends on removed model bridge and conflicts with current scheduling, locale and content-processing contracts.
- stash3: URL/feed and stream work superseded by ede7d1b and stronger current guards.
- zen-murdock test changes: already delivered locale tests, with later main vocabulary/type/calibration corrections.
- 4d4f060 shortcut prototype: archived unaccepted design; existing current shortcut claims remain authoritative.

These are recoverable archival dispositions, not a claim that unaccepted prototypes shipped. Current ai-label/format/validator tests passed 180/180; stream-demand/model-boundary tests passed 37/37 during comparison.

## Maintenance scope default

The owner authorized closing the audited project debt. Optional clarification questions received no answer during independent implementation, so the operator stated the conservative default in the session: retain the reachable repository identity, unpublished workspace distribution and configured Telegram channel; keep future capabilities in a separate development plan. This is an operator maintenance assumption, not a fabricated owner selection or authorization to rename, publish, reconfigure or send alert messages. Any later answer overrides it.

The current baseline is operationally valid: GitHub confirms the reachable public repository; both registry lookups return E404; local notifier tests pass and both Telegram configuration fields are present. Upstream alert delivery was not exercised. New product work and paused research remain explicitly future scope, with their known limits retained in the roadmap.
