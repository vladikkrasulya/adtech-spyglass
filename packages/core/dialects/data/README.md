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

The adjudication manifest landed 2026-09-02 with both review passes recorded
(agent pass 1, adversarially self-checked; maintainer pass 2). The staged-delivery
marker is gone deliberately — its absence plus the manifest's presence is what
`tests/key-role-manifests.test.js` now asserts.
