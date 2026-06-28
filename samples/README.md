# Spyglass Synthetic Samples — Phase 1 Corpus

This directory holds base JSON fixtures used by the synthetic generator that powers the public Stream surface (per `docs/stream-platform-pivot-2026-05-05.md`, Phase 1).

## Corpus naming contract (Live stream)

The synthetic generator (`synthetic-generator.js`) loads **only** files named
`synthetic-*.json` or `iab-*.json` from this directory — these are the eligible
stream fixtures. Any other JSON here is **not** a specimen and is deliberately
ignored by the generator (it never reaches `/api/v1/stream`, the stream buffer,
or the SQLite specimen cache). In particular `behavior-scenarios.json` is UI
metadata for the `/behavior` section, not an OpenRTB payload.

The gate is the **filename**, not the payload shape: a valid stream fixture may
legitimately have a JSON **array** at its root (e.g. a pop/feed response), so the
generator does not require an object root. Invalid JSON in an _eligible_ fixture
still fails fast at load.

These samples are **not** copied verbatim from anywhere — they are constructed to match IAB OpenRTB 2.6 spec patterns, with field values invented (publisher names, IDs, IPs from RFC 5737 documentation range `192.0.2.0/24`, test IFAs).

## Files in this directory

| File                          | Format                             | oRTB version | Status                     | Purpose                                               |
| ----------------------------- | ---------------------------------- | ------------ | -------------------------- | ----------------------------------------------------- |
| `iab-banner-valid.json`       | display banner (300×250 + 300×600) | 2.6          | clean, all required fields | baseline well-formed example                          |
| `iab-video-valid.json`        | VAST preroll (mobile app)          | 2.6          | clean, all required fields | baseline well-formed video/app example                |
| `iab-banner-with-issues.json` | display banner (300×600)           | 2.6          | deliberate spec violations | demonstrates 3 typical findings the validator catches |

## Issues encoded in `iab-banner-with-issues.json`

Constructed to surface real-world findings without piling on trivia:

1. **Missing `at` (auction type)** — required field per oRTB 2.6 §3.2.1. Common partner oversight.
2. **`bidfloor` set without `bidfloorcur`** — currency assumed USD, but ambiguous. Common pre-integration mistake.
3. **`regs.ext.gdpr=1` without `user.consent`** — GDPR opt-in flag set, but no TCF consent string provided. Compliance-relevant. Geography (`device.geo.country = DEU`) makes this pointed.

Additional secondary signals likely flagged by validator:

- Missing `source.tid` (recommended in 2.5+, required by some partners)
- Missing `cur` array on root (defaults to `USD` but should be explicit)
- Banner uses legacy `w/h` instead of `format[]` array (deprecated 2.6 pattern)

## How these are used

Phase 1 (Step 1.1, see `docs/stream-platform-pivot-2026-05-05.md`):

- `samples/synthetic-generator.js` loads the eligible `synthetic-*.json` /
  `iab-*.json` fixtures at startup (see "Corpus naming contract" above)
- Apply controlled mutations (vary `id`, `imp[].id`, `device.geo`, timestamp) to generate variants
- Emit a stream of variants via in-process EventEmitter
- Each emitted variant becomes a row in the public `/stream` view

Phase 2+:

- More samples to be added under `samples/iab/` (organized by spec version) and `samples/opensource/` (community fixtures)
- This README updated with index per addition

## Adding new samples

1. Place the file at `samples/synthetic-<descriptive-name>.json` (or
   `samples/iab-<descriptive-name>.json`). The generator only picks up files
   matching the `synthetic-*.json` / `iab-*.json` naming contract above — a
   file named anything else is ignored by the Live stream.
2. Validate it parses as JSON (`node -e "JSON.parse(require('fs').readFileSync('samples/<name>.json','utf8'))"`).
3. For valid samples — run `npm test` after generator integration to ensure the validator agrees.
4. For deliberate-issue samples — document the issues encoded, like the table above.
5. Update this README with the new entry.

## Attribution

Samples constructed in-house against IAB OpenRTB 2.6 spec (<https://iabtechlab.com/standards/openrtb/>). No proprietary or copyrighted data. Safe for public distribution under the project's license.
