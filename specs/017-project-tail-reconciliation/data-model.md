# Data Model: Project Tail Reconciliation

This maintenance feature introduces no application database entities. It reconciles the following
operational records.

## Inventory Finding

- **Identity**: stable scanner id from the completed inventory
- **Attributes**: evidence location, observed contradiction or unfinished work, classification,
  bounded action, verification result
- **States**: `raw` → `deduplicated` → `closed` or `owner-decision` / `already-tracked` /
  `not-a-tail`; a failed external gate remains `blocked-by-evidence`, never `closed`
- **Rule**: duplicate ids may share one closure, but each raw id must map to a final state

## Release Reference

- **Identity**: semantic version
- **Attributes**: verified commit revision, annotated immutable reference, release record, publication
  flags
- **Relationship**: one release record corresponds to one immutable version reference and one proven
  revision
- **Rule**: no reference exists without a repository-backed version/revision mapping

## Rollback Reference

- **Identity**: `rollback-pre-*` image tag
- **Attributes**: image id, image creation timestamp, retention rank
- **States**: timestamped `candidate` → `retained` for ranks 1–10 or `removed` for older ranks;
  unrankable `candidate` → `quarantined-retained` with a warning
- **Rule**: rank derives from creation time, never from the opaque revision suffix; lack of a rank
  fails safe by retaining the candidate

## Archived Backup Tree

- **Identity**: `ortbtools-wip-backups-2026-06-28`
- **Attributes**: source path, archive path, entry inventory, ownership and modes
- **State transition**: `cron-tree` → `archived`; no `deleted` transition belongs to this feature
- **Rule**: destination must be readable to the authorized operator and source must be absent only
  after the move succeeds

## Owner Decision

- **Identity**: one of the eight owner-decision inventory records
- **Attributes**: question, evidence, recommendation, current tracking location
- **State**: `awaiting-owner`; this feature performs no transition on it

## Dependency Proposal

- **Identity**: pull request number and head revision
- **Attributes**: base revision, dependency delta, required check results, merge state
- **States**: `stale` → `refreshed` → `green-and-merged` or `failed-and-open`
- **Rule**: a failed or pending required check prohibits the merge transition
