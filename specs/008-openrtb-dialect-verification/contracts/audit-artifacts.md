# Contract: Audit Artifacts

The audit's outward interface is its artifacts, not an API. Whoever consumes the corpus later
(a future surfaced-finding package) reads these.

## Guarantees

- Every result cites a frozen manifest generation and a frozen execution bundle; no result exists
  without both (FR-006).
- Every executed case appears exactly once, with outcome `pass`/`fail`/`inconclusive`; the three
  counts per adapter revision sum to the manifest's member count for that line (SC-001).
- A `pass` implies: triggering assertion held, the pre-registered same-adapter contrast held
  (conditional behaviour absent or unconditional projection isolated by collapsed output), and a
  separate valid adapter control reached the pinned mock. Any absence ⇒ the stored outcome is
  `inconclusive`, not `pass` (SC-002).
- Omissions are adjudicated counts against the named sample. **No artifact contains a corpus-wide
  precision or recall figure, and no field of any schema can express one** (FR-009 made structural:
  there is no denominator field).
- Every statement is attributable as adapter + commit + image digest (FR-003).
- No artifact contains payload bodies from any non-synthetic source; all witness inputs are
  synthetic and marked as such.
- The B1 preflight proves an internal Docker network, no published lab ports, denied direct egress
  and internal mock/PBS reachability. Every accepted wire observation carries its URI, which must
  match the mock allowlist (FR-013, SC-008).
- Blind-reader sandboxes cannot mount the corpus, repository, assessment, prior results or quarantine
  tree. Every source citation is recursively checked against the pinned adapter subtree (FR-005,
  SC-007).
- Blind readings are indexed, hashed and made immutable before unblinding (FR-012).
- An aborted or invalidated attempt is immutable and retained under its own run ID; canonical results
  never overwrite it (FR-014).

## Corpus feedback

The only data mutation this audit performs is on the research corpus file: schema-defined `status`
transitions (`verified`, `failed-witness`) and new rules from `confirmed-omission`, each carrying B2
provenance. The before/after files, hashes, validation output and summary-count delta are retained.
The product tree is untouched (FR-004, SC-006).

## Retention and retrieval

The audit bundle remains machine-local at the recorded absolute path, but it is content-addressed:
the tracked evidence summary lists the recursive bundle hash plus hashes for every frozen component
and for the corpus before/after states. A future package MUST verify those hashes before consuming
the evidence; a missing bundle is treated as unavailable evidence, never reconstructed proof.
