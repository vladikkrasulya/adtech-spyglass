'use strict';
/**
 * gen-browser-core.js — deterministically vendor the canonical core module(s)
 * into public/ for the browser. The browser has NO bundler, so it loads the
 * SAME source verbatim via a classic <script>. There is exactly ONE canonical
 * source; this script produces a byte-identical copy and the CI parity guard
 * (tests/browser-core-parity.test.js) fails the build on any drift.
 *
 *   node scripts/gen-browser-core.js          # write the copies
 *   node scripts/gen-browser-core.js --check  # exit 1 if any copy is stale
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// canonical → browser copy (verbatim; the UMD-lite wrapper runs in both envs).
const PAIRS = [
  ['packages/core/source-map.js', 'public/core/source-map.js'],
  // The Diff tab must apply exactly the rules tests/semantic-diff.test.js pins,
  // so the engine is mirrored rather than reimplemented. registry.js first:
  // index.js reads it from the browser global, and HTML must load it first too.
  ['packages/core/diff/registry.js', 'public/core/diff-registry.js'],
  ['packages/core/diff/index.js', 'public/core/diff.js'],
  // Migration advisor. Same reason as the diff engine: the tab must propose
  // exactly what tests/migration-rules.test.js pins. rules.js first — index.js
  // reads it from the browser global, and the HTML must load it in that order.
  ['packages/core/migrate/rules.js', 'public/core/migrate-rules.js'],
  ['packages/core/migrate/index.js', 'public/core/migrate.js'],
  // VAST. vast-shape.js is the two sniffing helpers only — the timeline
  // extractor reads them from the browser global, so it must load first.
  ['packages/core/vast-shape.js', 'public/core/vast-shape.js'],
];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const check = process.argv.includes('--check');

let drift = 0;
for (const [src, dst] of PAIRS) {
  const srcBuf = fs.readFileSync(path.join(ROOT, src));
  const dstPath = path.join(ROOT, dst);
  const dstBuf = fs.existsSync(dstPath) ? fs.readFileSync(dstPath) : null;
  const same = dstBuf && sha(srcBuf) === sha(dstBuf);
  if (check) {
    if (!same) {
      drift++;
      console.error(`DRIFT: ${dst} != ${src} (run: node scripts/gen-browser-core.js)`);
    } else {
      console.log(`ok: ${dst} == ${src} (${sha(srcBuf).slice(0, 12)})`);
    }
  } else if (!same) {
    fs.writeFileSync(dstPath, srcBuf);
    console.log(`wrote ${dst} (${sha(srcBuf).slice(0, 12)})`);
  } else {
    console.log(`unchanged ${dst}`);
  }
}
process.exit(check && drift ? 1 : 0);
