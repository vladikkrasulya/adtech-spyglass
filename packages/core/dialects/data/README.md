# Key-role data — committed manifests

Four manifests, separately versioned, verified in CI **without** the out-of-tree research corpus
(FR-017). Regeneration is a maintainer operation via `scripts/build-key-role-corpus.js` and never
runs in CI.

| File                              | What it is                                                       |
| --------------------------------- | ---------------------------------------------------------------- |
| `key-role-corpus.v1.json`         | Evidence: 322 exact-case names, full provenance, pinned digests  |
| `key-role-adjudication.v1.json`   | Reviewed role truth: state + score per name/partition, 2 reviews |
| `key-role-named-rules.v1.json`    | Repo-backed and specification-frozen rules (separate provenance) |
| `key-role-routing-matrix.v1.json` | SC-002 fixtures with frozen `D0` (slice A now, slice B at US2)   |

Versioning: a new corpus snapshot is a new `vN` file plus a recorded regeneration run; the old file
is deleted in the same change, never silently overwritten. Identity is exact code-point spelling —
no lowercasing anywhere (R-01).

Staged delivery (per tasks.md T010): the adjudication manifest lands with the US2 increment once
both review passes exist; until then its absence is the expected state and
`tests/key-role-manifests.test.js` asserts the staging marker below rather than failing blind.

STAGING: adjudication=pending
