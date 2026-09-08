# Corpus data model

Pair: unique ID, seven-format classification, protocol/context/dialect, scenario, tags, attributed sanitized provenance, request/response, nonempty expectations, optional reference metadata and local asset references.

Mutation: unique ID, base pair, explicit category/spec reference, bounded RFC6902 patch or raw/replacement side, complete final expectations. Materialized cases are validated again. No prototype mutation or empty mutation is permitted.

Expectation: side type/version/status/severity and positive/negative structured finding references (id/path/level/side/params/ok/count); crosscheck/format/consistency; HTTP status; browser completion/verdict; preview kind/identity/rendering/readiness/playback and per-bid observations.

Known gap: case-layer attribution, stable DEF ID, explanation and evidence, anchored failure signatures; ledger reference required. Original assertions remain normative. A disappeared deviation or novel failure is a hard failure.

Result: run identifier, case ID, layer, outcome (pass/known-gap/fail/skip/not-applicable), failures, gap reference and observations. No full payload bodies in report artifacts. Coverage counts qualified/provisional/mutation cases and outcomes separately.

Asset: local file mapping to original synthetic URL, MIME type, content hash and attribution/generation notes. No external requests needed to execute the corpus.
