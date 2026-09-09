# Transient models

No new schema or retained payload data.

- Auction view: original input/version, normalized item/bid facts, original indices/paths, matched item and explicit consumer eligibility. Inputs remain immutable.
- Analysis run: generation, editor revision, captured lexical/input snapshot, abort owner, selected source and idle/loading/success/error state. Only current ownership permits observable writes.
- Analysis sides: located unprefixed request/response validation results or null; legacy combined result retained.
- Completeness: caught faults add `{complete:false,failedFamilies:[...]}`, unfiltered, stable and sorted, without exception/input text.
- Verification attempt: private roots, exact owned profiles/PIDs, original output/exit and retry index.
- Cleanup evidence: original claim, current proof, acceptance, changed owners, assertion/static rationale, result and release references.
