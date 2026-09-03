# Contract: Browser Vendor Integrity

## Owned Artifacts

The Blog browser renderer has two reviewed third-party source packages:

| Package   | Exact version | Public runtime asset            | Provenance rule                                                                      | License    |
| --------- | ------------- | ------------------------------- | ------------------------------------------------------------------------------------ | ---------- |
| Marked    | `18.0.11`     | `public/vendor/marked.es.js`    | Byte-identical to npm `lib/marked.esm.js`                                            | MIT        |
| DOMPurify | `3.4.14`      | `public/vendor/dompurify.es.js` | Byte-identical to npm `dist/purify.es.mjs`; release tag `3.4.14` at commit `4e6fe24` | Apache-2.0 |

Both package versions are exact root development dependencies. They provide lockfile integrity,
Dependabot/update visibility, full npm-audit coverage, and local source/license material. They are
not installed in the production-only Node dependency layer; Docker serves the reviewed checked-in
assets baked under `public/`.

The DOMPurify public filename intentionally ends in `.js`. The current server's MIME map and
transitive content-hash rewriting support `.js` imports; introducing `.mjs` would require a separate
static-server contract change.

## License and Notice

`public/vendor/NOTICE.txt` records for each asset:

- package and exact version;
- upstream repository, release/tag, and source artifact;
- checked-in target path and checksum/parity rule;
- selected license and copied license path;
- owning feature/contract; and
- the deterministic update/check commands.

DOMPurify is consumed under the Apache-2.0 option and its upstream Apache license is copied to
`public/vendor/licenses/DOMPurify-Apache-2.0.txt`. Marked's upstream MIT license is copied to
`public/vendor/licenses/Marked-MIT.txt`. License text is copied verbatim and is not reformatted. The
notice and licenses use `.txt` so they remain in the immutable-image context even though general
Markdown documentation is excluded.

## Sync and Check Behavior

`scripts/sync-browser-vendors.js` has two explicit modes:

- check mode performs no writes and exits nonzero on a missing package, version mismatch, byte/hash
  mismatch, missing or changed license, or incomplete notice;
- write mode copies only the two named reviewed ESM assets and their license files from the exact
  installed packages and refreshes deterministic notice/checksum data.

Write mode must reject unexpected versions and paths. It is a maintenance command, not an install
hook, build step, runtime downloader, or automatic upgrade. No lifecycle script fetches vendor code.

The tracked regression test invokes check behavior against `node_modules` after `npm ci`. It verifies
the package manifest and lockfile exact versions, byte equality for both public ESM assets, copied
licenses, notice fields/checksums, and absence of the superseded
`public/vendor/marked.esm.min.js`. A package update without reviewed public bytes—or public bytes
without the exact package update—fails CI. The repository formatter excludes only those exact two
vendor modules from rewriting; the test makes that exception auditable rather than implicit.

## Security Update Rule

DOMPurify is security-critical and must be reviewed promptly when upstream publishes a security
release. An update is one coherent change:

1. verify the official release/tag and advisory context;
2. change the exact development dependency and regenerate the lock normally;
3. run the explicit vendor write command and inspect every changed byte/license/notice;
4. rerun the full fixed security and compatibility corpora;
5. run full and production-only npm audits, full CI, and Docker smoke; and
6. record the new provenance and evidence without claiming deployment.

Marked remains pinned during this feature. A later Marked update must separately review token/renderer
API compatibility, replace or re-pin the browser asset, and pass the same complete corpora.

## Prohibited Paths

- no CDN or runtime network fetch;
- no serving files directly from `node_modules`;
- no caret/range that silently changes reviewed browser bytes;
- no hand-edited vendor source;
- no superseded or unowned browser-library copy left in `public/vendor/` or the immutable image;
- no unrecorded checksum or license drift;
- no DOMPurify hooks, `IN_PLACE`, broad profile, or post-sanitize HTML mutation introduced without a
  new reviewed contract; and
- no npm publication or deployment implied by a vendor sync.
