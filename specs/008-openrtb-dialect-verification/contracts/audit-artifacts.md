# Contract: Audit Artifacts

The audit's outward interface is its artifacts, not an API. Whoever consumes the corpus later
(a future surfaced-finding package) reads these.

## Guarantees

- Every result cites a frozen manifest; no result exists without one (FR-006).
- Every executed case appears exactly once, with outcome `pass`/`fail`/`inconclusive`; the three
  counts per adapter revision sum to the manifest's member count for that line (SC-001).
- A `pass` implies: triggering assertion held, minimal-pair assertion held, execution control
  present. Any absence ⇒ the stored outcome is `inconclusive`, not `pass` (SC-002).
- Omissions are adjudicated counts against the named sample. **No artifact contains a corpus-wide
  precision or recall figure, and no field of any schema can express one** (FR-009 made structural:
  there is no denominator field).
- Every statement is attributable as adapter + commit + image digest (FR-003).
- No artifact contains payload bodies from any non-synthetic source; all witness inputs are
  synthetic and marked as such.
- The quarantined documentation set is uncited; a citation scanner over artifacts proves SC-007.

## Corpus feedback

The only mutation this audit performs anywhere is on the research corpus file:
`status` transitions (`verified`, `failed-witness`) and new rules from `confirmed-omission`, each
carrying B2 provenance. The product tree is untouched (FR-004, SC-006).
