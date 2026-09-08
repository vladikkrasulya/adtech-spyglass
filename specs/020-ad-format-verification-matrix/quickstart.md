# Repeat the audit

Use Node >=22.13 and npm dependencies already declared by the repository. Install or provide a Chromium executable supported by the existing browser harness. No production service, ad network credentials or external ad requests are required.

1. Run `node --test tests/corpus-lib.test.js` to validate the oracle and corpus contracts.
2. Run `npm run test:corpus` for the eight-phase serial harness, Core, real HTTP, creative, UX and accessibility/state audit. This command must fail if required Chromium execution is unavailable. Its output identifies the report directory and counts known gaps separately.
3. Run `npm run ci` for repository formatting, lint, typecheck and coverage checks.
4. Review coverage-matrix.md, coverage-axes.md, verification.md, defects.md and cleanup-backlog.md in this feature directory. A successful harness run with known gaps is not a claim that all product behavior conforms.

Single case or single format, any layer:

```sh
CORPUS_CASE=bn-banner-25-fixed node --test tests/corpus-core.test.js
CORPUS_CASE='video-x-*' node --test tests/corpus-http.test.js
CORPUS_FORMAT=native node --test tests/corpus-browser.test.js
```

The dedicated command always creates a fresh report directory and prints its location. For focused test files, evidence directories are opt-in: `CORPUS_REPORT_DIR` receives per-layer JSONL rows, `report.json`, `coverage-matrix.md` and `coverage-axes.md`; `CORPUS_EVIDENCE_DIR` receives screenshots. `node scripts/corpus-axes.js` prints the pairwise axis view for the committed corpus without running anything.

The complete portable file is `/home/vk/.local/share/ortbtools-research/2026-09-08-final-corpus/ad-format-corpus.json`: all 184 materialized scenarios, expectations, provenance, ledger and 77 embedded assets. The earlier 38-case source archive is retained at `/home/vk/.local/share/ortbtools-research/2026-09-07-codex-corpus/ad-format-corpus.json`. Normal audit runs use committed normalized fixtures and local assets. Twelve media bodies live only in the private archive, with `stored: false` manifest entries; the offline browser driver reports them unavailable and never fetches them externally. No playback claim depends on them. See verification.md for hashes and final run evidence.
