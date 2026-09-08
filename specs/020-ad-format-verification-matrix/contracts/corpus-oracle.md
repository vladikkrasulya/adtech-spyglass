# Test corpus and audit contract

This is a development interface, not a new public application API.

- Validate case structure and nonempty assertions before execution; unknown assertion keys fail.
- Match structured finding identifiers/paths/severity and requested parameter values, never translated message text. Side-specific assertions must survive HTTP normalization.
- Response validation receives the paired request when applicable. Vendor request/response pairs do not claim OpenRTB auction crosscheck applicability.
- Default HTTP success means status 200, success:true and expected response structure. Default browser completion means successful analysis, never a timeout or stale previous result.
- Known-gap signatures must be nonempty and anchored. Every failure must match an authorized signature; every required signature must still occur. A hard guard remains outside expected-failure marker and requires a ledger reference.
- Report nonapplicable or unsupported layers explicitly; do not claim Core evaluated malformed transport JSON.
- Preview assertions observe original bid identity, asset visibility and rendered state. Missing multi-bid selection is a gap, not simulated via payload reordering. Media playback requires advancing currentTime; readyState alone only means ready.
- Browser tests use the real Analyze action, enforce local/offline network boundaries, preserve sandbox/CSP and capture controlled failure/loading behavior separately from real analysis.
- Full audit starts from a clean result directory, runs without automatic retries, requires a usable Chromium, generates JSON/Markdown matrix and exits nonzero on unexpected failure or missing required execution.
- Test IDs, sources and outcome counts are stable report keys. Generated reports never include raw request/response bodies.

## Amendments — session continuation, 2026-09-07

- Ledger shards. Independent authors record deviations in `tests/corpus/known-gaps/<owner>.json` files that carry the same `{schemaVersion: 1, gaps: {…}}` shape as `tests/corpus/known-gaps.json`. The loader merges every shard with the main ledger; a gap id defined in two files is a load error, never a silent override. Case files reference gaps only by id; the loader refuses a case whose gap is absent from the merged ledger or whose id is missing from that gap's `cases` list.
- Deviation signatures. `knownGap.matches` holds regular expressions; the "deviation is still the recorded one" guard runs as an ordinary test outside the expected-failure marker and fails when no failure matches, when any failure falls outside every signature, or when the expectation now passes.
- Creative identity. `expect.preview.marker` must occur in visible frame/inert text or the exact source of an image that decoded with nonzero natural dimensions. A declared empty render records why identity does not apply; deliberately whitespace-only input must preserve the exact inert body and contain no frame, images or media. Each original bid has one observation record, including its identity explanation. No other missing marker is silently accepted.
- Controlled assets. `tests/corpus/assets/manifest.json` lists every fixture asset with URL, type, byte length and SHA-256. Entries with `stored: false` keep identity only; their bodies live in the private research archive named in `archive`. The browser interceptor answers 404 for an unstored asset and the measurement records it as unavailable, never as loaded. The preview frame policy forbids media, so no stored media body could change a rendered outcome; images that must load are data URIs or stored raster/vector fixtures.
- Coverage axes. `scripts/corpus-axes.js` derives the pairwise projections format × protocol, context, dialect, scenario, preview kind, rendered state and media state from case metadata and marks each cell covered, unverified (applicable, no case), unsupported (excluded by a product contract, reason stated) or not applicable (no such combination in the specification). Applicability rules come from the IAB specifications and the product contracts, never from corpus contents. The dedicated audit writes `coverage-axes.md` beside `coverage-matrix.md`.
- Filters. `CORPUS_CASE=<id|prefix*,…>` and `CORPUS_FORMAT=<format>` narrow every layer to one case or one format; a filter that matches nothing fails instead of passing vacuously. `CORPUS_REPORT_DIR` and `CORPUS_EVIDENCE_DIR` select where JSONL results and screenshots are written; without them tests still assert but write no evidence.

## Final acceptance — 2026-09-08

- Browser preflight. A declared JSON syntax or object-root rejection must explain the exact rejected input, leave no stale results and submit zero Analyze POSTs. Only the corresponding SyntaxError or derived object-root message is admitted. Unrelated console errors and null/undefined dereference TypeErrors remain failures.
- Accessibility/state report. `tests/corpus/lib/a11y-contract.js` owns the 19 stable scenario IDs and `ux-a11y-findings.json` envelope. Missing, unknown, duplicate, skipped and malformed scenario records fail the full audit. Findings separate observations from deviations; expected gaps require exact still-present signatures and cannot hide a missing iframe or unrelated failure. Scenario outcomes participate in `auditComplete` and `productConformant`.
- Measured axes. A cell's case count describes presence. Conformance requires exactly one result for Core, HTTP and browser, all applicable layers passing and any inapplicability explicitly justified. A reproduced gap is deviating; missing/duplicate/invalid results are incomplete; an all-inapplicable case cannot establish conformance.

- Pointer actionability. Before a physical click, the driver waits within a bounded timeout for stable geometry and an unobscured hit target, then uses coordinates from that measurement. A moving-target regression with protocol latency must pass; a delivered click with a broken handler must remain a failure. No repeated click or programmatic reveal may stand in for the original interaction.
