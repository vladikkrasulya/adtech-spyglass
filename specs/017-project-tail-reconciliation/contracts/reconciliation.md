# Reconciliation Contract

## Repository truth

- A documentation finding is closed only when the edited claim matches its canonical implementation,
  release, or runtime evidence and formatting checks pass.
- The bounded maintenance commit contains only the interrupted sweep, its Docker-gate correction,
  regression coverage, and this feature package.
- Owner-decision items and unrelated working-tree content are not staged.

## Release truth

- In-scope versions and their verified revisions are exactly:

  | Version   | Revision  |
  | --------- | --------- |
  | `v1.6.1`  | `d6c873d` |
  | `v1.7.0`  | `77f774e` |
  | `v1.8.0`  | `d6f9c57` |
  | `v1.9.0`  | `ead30e0` |
  | `v1.10.0` | `79a5ad0` |
  | `v1.10.1` | `5767b6c` |
  | `v1.11.0` | `0ea8f46` |
  | `v1.11.1` | `52e058b` |
  | `v1.11.2` | `278f7b4` |
  | `v1.11.3` | `4c150d1` |
  | `v1.12.0` | `faa2a63` |
  | `v1.12.1` | `0e6a647` |
  | `v1.13.0` | `774fb8c` |
  | `v1.13.1` | `26aa95e` |
  | `v1.14.0` | `50c5799` |
  | `v1.14.1` | `cb5e6ff` |
  | `v1.14.2` | `84cc6ea` |
  | `v1.14.3` | `9d1b883` |
  | `v1.14.4` | `bfe754a` |
  | `v1.14.5` | `1c60c75` |
  | `v1.14.6` | `9fdabf2` |
  | `v1.15.0` | `1b41d5b` |
  | `v1.16.0` | `17945d6` |
  | `v1.17.0` | `d854ae2` |
  | `v1.18.0` | `adde7f5` |
  | `v1.19.0` | `b729505` |
  | `v1.19.1` | `85e41c4` |

- Each annotated tag peels to the revision in this table.
- The immutable tag records the canonical semantic release revision; a later deploy under unchanged
  SemVer does not move it. Recorded same-version deploys are `v1.6.1` at `646a48a`, `v1.14.4` at
  `b412778`, and `v1.19.0` at `89d9ec9`.
- `v1.11.0` was co-deployed with `v1.11.1`; `v1.14.5` had no separate production image and first
  reached users through a later live ancestor. They remain semantic releases with their own Git
  revisions.
- Each GitHub Release records the matching full revision in `target_commitish`, begins with its exact
  corresponding `CHANGELOG.md` section, is neither draft nor prerelease, and is created idempotently.

## Host cleanup truth

- The rollback candidates are ranked by the referenced image's machine-readable creation timestamp.
- Exactly the newest ten timestamped candidates are retained when more than ten timestamped
  candidates exist; all are retained when ten or fewer exist.
- A candidate whose timestamp cannot be inspected or parsed is quarantined by retention and logged,
  so the total may temporarily exceed ten rather than deleting an unranked rollback target.
- An inspection or removal race is logged and does not prevent later candidates from being handled.
- The installed cleanup script delegates this policy to the repository-owned, regression-tested
  `scripts/cleanup-rollback-tags.sh`; an unavailable helper retains every rollback tag and warns.
- The named WIP backup directory is moved intact to the archive path. No file contents are read into
  tracked artifacts, restored, or deleted.

## Dependency proposal truth

- PR #4 is evaluated only after its head contains current main.
- Formatting, lint, type, test, package, and production-image gates must all pass before merge.
- A pending, cancelled, skipped, timed-out, or failed required check is not green.
- The dependency proposal is merged separately from the maintenance documentation commit.

## Explicit exclusions

This feature does not answer or mutate repository identity, npm publication, alert-delivery posture,
stashes, unmerged historical branches, CL-001 product scope, or local-model research policy. It does
not deploy production.
