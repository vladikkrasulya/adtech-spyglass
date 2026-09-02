# Research: Project Tail Reconciliation

## Decision 1 — Treat the inventory as 37 scanner records, not 37 unique defects

**Decision**: Deduplicate records that point to the same canonical line or task before changing
anything.

**Rationale**: R4/M-04, R13/R14/M-01, and D-WALKTHROUGH/M-05 overlap. Counting them independently
would manufacture work and could produce contradictory edits.

**Alternatives considered**: Apply all 37 records mechanically. Rejected because several records
explicitly identify themselves as duplicates or false positives.

## Decision 2 — Bound historical release creation to 27 proven mappings

**Decision**: Create or verify release metadata for the 27 semantic application releases from
`v1.6.1` through `v1.19.1` whose revisions are supported by release commits, deployment records, or
surviving OCI provenance. The interrupted regex extracted ten milestones, not the complete set.

**Rationale**: Each pair resolves to an existing commit and is documented in the canonical release
history. Starting at `v1.6.1` follows G1's explicit lower bound and the first canonical Spec Kit
deployment record; earlier versioning eras require a separate historical backfill.

**Alternatives considered**: Tag every version-like heading. Rejected because dependency and package
versions share the history and an inferred target could make false provenance permanent.

## Decision 3 — Order rollback retention by image creation timestamp

**Decision**: Resolve every `rollback-pre-*` tag to its image creation timestamp, sort newest first,
and remove only candidates after the first ten.

**Rationale**: The interrupted implementation sorted opaque SHA suffixes lexicographically. A SHA has
no chronological ordering, and live inspection proved that older images survived while newer tags
were removed.

**Alternatives considered**: Sort tag names; sort formatted human-readable relative ages; keep all
tags. Name sorting is incorrect, relative-age text is not safely sortable, and keeping all tags
preserves the original unbounded-growth defect.

## Decision 4 — Archive the WIP backup tree by rename, not deletion

**Decision**: Move the exact June 28 directory beneath `/srv/DATA/Backups/archive/` and verify source
absence plus destination inventory.

**Rationale**: The tree is outside the documented cron contract but may contain recovery evidence.
Moving it removes it from the unmanaged live directory while preserving every byte.

**Alternatives considered**: Delete it or leave it in place. Deletion is unnecessary and
irrecoverable; leaving it does not close the retention/inventory ambiguity.

## Decision 5 — Refresh dependency PR #4 before judging its old failure

**Decision**: Update the PR branch to current main and require all current checks. Merge only if the
full hosted gate is green.

**Rationale**: Its earlier run passed formatting, lint, types, tests, and package smoke but failed the
production Docker smoke on an older baseline. Current main contains later image fixes, so the old
failure neither validates nor rejects the dependency update.

**Alternatives considered**: Merge because non-Docker checks passed; close because one old check
failed. Both discard the current-baseline evidence required by the constitution.

## Decision 6 — Do not infer answers to owner-only findings

**Decision**: Preserve stashes, npm state, repository identity, Sentry/Telegram posture, unmerged
historical branches, CL-001 scope, and local-model research choices until the owner answers them.

**Rationale**: These choices change external identity, irreversible publication, operational posture,
or product/research scope. The user's continuation authorizes the enumerated mechanical work, not a
silent policy decision.

**Alternatives considered**: Apply all prior recommendations automatically. Rejected because the
original inventory deliberately placed these items in a separate owner-decision bucket.

## Source inventory reconciliation

The recovered classifier emitted exactly 37 raw records. The table preserves every identifier and
its original four-bucket result; duplicates retain their own row while pointing at one shared
closure. “Mechanical” means this feature may act, not that the action is already complete.

| ID                            | Original bucket | Final handling in this feature                                       |
| ----------------------------- | --------------- | -------------------------------------------------------------------- |
| R1                            | Owner decision  | Await repository-identity decision; unchanged                        |
| R2                            | Owner decision  | Await first npm-publication decision; unchanged                      |
| R3                            | Owner decision  | Await Telegram-only versus Sentry decision; unchanged                |
| R4                            | Already tracked | Duplicate of M-04; keep 005 T024–T026                                |
| R5                            | Already tracked | Keep the SChain assessment queue entry                               |
| R6                            | Already tracked | Keep the deliberately unscheduled product/refactor queue entry       |
| R7                            | Already tracked | Keep the four fleet-standard assessment entries                      |
| R8-CL001                      | Owner decision  | Await value-independent-mapping scope decision; unchanged            |
| R9                            | Already tracked | Keep 011's seven named follow-up research tasks                      |
| R10                           | Mechanical      | Close stale 009 release checkbox                                     |
| R11                           | Mechanical      | Close stale 010 release checkbox                                     |
| R12                           | Mechanical      | Remove resolved “partial” annotations from 016                       |
| R13                           | Mechanical      | Duplicate date portion of M-01                                       |
| R14                           | Mechanical      | Duplicate gate portion of M-01; leave CHANGELOG convention intact    |
| C-001                         | Mechanical      | Replace obsolete adjudication next-step output                       |
| C-002                         | Already tracked | Keep the ten explicit event-log test TODOs                           |
| C-003                         | Not a tail      | Preserve intentional behavior-rule boundary comment                  |
| D-LOCALE-FALLBACK-CORE-README | Mechanical      | Correct Core fallback order                                          |
| D-LOCALE-FALLBACK-CLI-README  | Mechanical      | Correct CLI fallback order                                           |
| D-USERGUIDE-LOCALE-STALE      | Mechanical      | Correct locale list, toggle, and fallback order                      |
| D-WALKTHROUGH-STALE           | Mechanical      | Mark the pre-Spec-Kit handoff historical                             |
| G1                            | Mechanical      | Create and verify the bounded annotated tags                         |
| G2                            | Mechanical      | Create and verify the bounded public releases                        |
| G4                            | Mechanical      | Refresh PR #4 and judge it only through current gates                |
| G5                            | Owner decision  | Preserve all four stashes                                            |
| G6                            | Owner decision  | Remove three proven merged refs; preserve unmerged refs for decision |
| I-1                           | Mechanical      | Install chronological newest-ten rollback retention                  |
| I-2                           | Owner decision  | Preserve backup ownership and documentation pending owner answer     |
| I-3                           | Mechanical      | Move the exact WIP tree intact to the archive namespace              |
| I-4                           | Not a tail      | Preserve intentional committed adjudication evidence                 |
| M-01                          | Mechanical      | Reconcile ROADMAP date and completed 016 gate                        |
| M-02                          | Mechanical      | Mark 016 complete                                                    |
| M-03                          | Mechanical      | Correct the stale out-of-repository ADR-012 memory note              |
| M-04                          | Already tracked | Same open 005 work as R4                                             |
| M-05                          | Mechanical      | Same historical-handoff correction as D-WALKTHROUGH-STALE            |
| M-06                          | Already tracked | Preserve the explicit vendor-attribution implementation hold         |
| M-07                          | Owner decision  | Await the four local-model research choices                          |

Count check: 19 mechanical records, 8 owner decisions, 8 already-tracked records, and 2 records
that are not tails. The I-2 record remains an owner decision: evidence that an agent invoked the
backup as `vk` explains the write, but does not authorize changing the ownership contract. G6 also
bundled two states: remote absence made the three proven merged-ref cleanups mechanical, while every
unmerged historical branch remains the original owner choice.

## Baseline and action evidence

- **Repository**: the interrupted sweep began on `main` revision `85e41c4` with no application
  behavior change intended. Its tracked edits addressed R10–R14, C-001, the four documentation
  records, M-01, and M-02; M-03 lives in the external Claude memory directory.
- **GitHub releases**: the initial scan found no tags or release records. The interrupted run created
  nine of ten regex-extracted tags, skipping `v1.7.0` because its input lacked a final newline. A
  second evidence audit found 17 more releases omitted by that extraction, including the differently
  worded `v1.17.0` record. The continuation reads back all 27 annotated local/remote tag objects and
  peeled revisions; every public release records the matching full `target_commitish`, begins with
  its exact CHANGELOG section, and is neither draft nor prerelease; `v1.19.1` is designated latest.
- **Branches and stashes**: G6 named `chore/dependencies-sentry`, `fix/button-flash-overflow`, and
  `fix/inspector-defects-1145` as merged branch targets. Remote readback proves all three absent; the
  latter two stale local tracking refs were pruned. The remaining unmerged remote branches and all
  four stashes are unchanged.
- **Docker host**: the scan found 51 named `rollback-pre-*` references. The interrupted lexical prune
  was corrected using Docker image creation timestamps; the provable newest set now contains
  `89d9ec9`, `b729505`, `adde7f5`, `d854ae2`, `17945d6`, `1bccb56`, `1b41d5b`, `9fdabf2`,
  `bfe754a`, and `b412778`. The installed scheduler now delegates that policy to the tracked helper;
  isolated regression tests cover misleading tag order, uninspectable and malformed timestamps,
  removal races, a failed candidate listing, and the at-most-ten case.
- **Backup archive**: the named tree was renamed intact to
  `/srv/DATA/Backups/archive/ortbtools-wip-backups-2026-06-28`. Source and destination resolved to
  device/inode `66306:6029631`; the archived tree has 16 files, 5 directories, 6,533,879 bytes, and
  content-manifest SHA-256 `bcff9e6f7da070b9a11cf4777dde4aba943bfbbed4f8c82ecd0e54d9c1651487`.
- **Dependency PR**: refreshed head `d46a0bc65eeb298b0e2a17e92cbe2b10749c01d3` passed its actual
  native module loads and every non-Docker gate. Hosted run `33620307675` failed only because the
  smoke script still asserted `better-sqlite3` 11.10.0 while the PR image correctly contained
  13.0.3. The lockfile-derived gate fix reached `main` in `a0859de` after complete local, package,
  and production-image gates; push run `33628332708` passed every hosted step. Refreshed PR head
  `f39268afbab556a73d73ea6b18333859c9561eb2` has that exact base as an ancestor, changes only
  `package.json` and `package-lock.json`, and passed every step in hosted run `33628862161`, including
  the lockfile-matched `better-sqlite3` 13.0.3 production-image load. Ordinary merge completed as
  `ff97d1c61ed0bc077e702fac0e5abe5b2879e02a`; GitHub readback reports PR #4 `MERGED`, preserves the
  successful check, and confirms the merged dependency branch was deleted.
- **Final dependency state**: local `main` fast-forwarded to `ff97d1c`, `npm ci` installed
  `better-sqlite3` 13.0.3 and reported zero vulnerabilities, and a direct in-memory SQLite query
  returned 42. `npm run ci` passed 151 non-browser plus 19 browser files; package smoke passed; the
  production Docker smoke derived and loaded 13.0.3 and removed its image, container, and volume.
  Hosted merge run `33629453571` independently passed format, lint, typecheck, tests, package smoke,
  and production Docker smoke.
