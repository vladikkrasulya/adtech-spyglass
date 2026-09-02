'use strict';

/**
 * build-key-role-corpus — maintainer-only generator for the key-role corpus
 * manifest (016 FR-017/FR-025, contracts/manifests.md, R-03).
 *
 * Reads the out-of-tree research corpus, reproduces EVERY frozen assertion
 * of the v1 snapshot contract, and writes
 * packages/core/dialects/data/key-role-corpus.v1.json. On any mismatch it
 * REJECTS — a corpus change that moves a count fails loudly instead of
 * quietly re-baselining.
 *
 * Never runs in CI. CI verifies the committed manifest's internal
 * invariants without this script or the corpus
 * (tests/key-role-manifests.test.js).
 *
 * Usage:  node scripts/build-key-role-corpus.js [--corpus <dir>] [--check]
 *   --check  reproduce and compare against the committed manifest, write nothing
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ── Frozen v1 snapshot contract (016 §Frozen snapshot construction) ──────
const FROZEN = {
  commit: '0ba352315253f6692af6497d553cfb12909a1b8b',
  schemaFiles: 272,
  schemaListDigest: '8279e69f439f91b1e9d44274db139f2a3bd38261776b248b4b020d225767a3d5',
  rulesDigest: '73d067fa6ea9689b09167104db7bb1a72ff950446db8275b41bd54e32193598b',
  licenseDigest: '9d130cc11efd232f041473f0cd62c43806b9389d63b599c8ee0862b699e8bc58',
  attributionDigest: '06ab88a60ff471b4dfb9592fdcbaaeea773ba8e82ed2504a25cddaea5b481e1d',
  quarantineDigest: '4e5bb17122c8a592ef1f8559ef1dcae446cda0acb1ea15e099e21b0737c7ea88',
  occurrences: 697,
  schemaNames: 291 - 2, // 289 exact names
  describedNames: 279,
  statusHistogram: {
    verified: 364,
    unverified: 824,
    'confirmed-omission': 42,
    'evidence-unresolvable': 2,
    'deleted-by-verification': 1,
  },
  rawAdapterNames: 133,
  adapterNamesAfterExclusion: 128,
  intersection: 95,
  partition: { 'schema-only': 194, 'extension-only': 33, both: 95 },
  total: 322,
  lowercaseBuckets: 297,
  collisionBuckets: 22,
  collisionSpellings: 47,
  excluded: ['data', 'dsa', 'eids', 'gpid', 'schain'],
  eligibleStatuses: ['verified', 'unverified', 'confirmed-omission'],
};

const OUT = path.join(
  __dirname,
  '..',
  'packages',
  'core',
  'dialects',
  'data',
  'key-role-corpus.v1.json',
);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** @param {string} msg */
function reject(msg) {
  console.error(`REJECT: ${msg}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const ci = args.indexOf('--corpus');
  const corpusDir =
    ci >= 0
      ? args[ci + 1]
      : path.join(
          process.env.HOME || '',
          '.local',
          'share',
          'ortbtools-research',
          'prebid-2026-08-20',
        );

  const serverDir = path.join(corpusDir, 'prebid-server');
  const rulesPath = path.join(corpusDir, 'derived', 'adapter-rules-2026-08-20.json');
  if (!fs.existsSync(serverDir)) reject(`corpus not found at ${serverDir}`);

  // ── Pins ────────────────────────────────────────────────────────────
  const rulesBuf = fs.readFileSync(rulesPath);
  if (sha256(rulesBuf) !== FROZEN.rulesDigest) reject('adapter-rules digest mismatch');
  const license = fs.readFileSync(path.join(serverDir, 'LICENSE'));
  if (sha256(license) !== FROZEN.licenseDigest) reject('LICENSE digest mismatch');
  const attribution = fs.readFileSync(path.join(corpusDir, 'ATTRIBUTION.md'));
  if (sha256(attribution) !== FROZEN.attributionDigest) reject('ATTRIBUTION digest mismatch');
  const quarantine = fs.readFileSync(path.join(corpusDir, '..', 'QUARANTINE.json'));
  if (sha256(quarantine) !== FROZEN.quarantineDigest) reject('QUARANTINE digest mismatch');

  // ── Schema side ─────────────────────────────────────────────────────
  const paramsDir = path.join(serverDir, 'static', 'bidder-params');
  const files = fs
    .readdirSync(paramsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length !== FROZEN.schemaFiles)
    reject(`schema file count ${files.length} != ${FROZEN.schemaFiles}`);

  /** @type {Map<string, Array<object>>} name -> schema evidence */
  const schemaEvidence = new Map();
  let occurrences = 0;
  const digestRows = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(paramsDir, f));
    digestRows.push(`${sha256(buf)}  ${f}\n`);
    let doc;
    try {
      doc = JSON.parse(buf.toString('utf8'));
    } catch {
      continue;
    }
    const props = doc && typeof doc.properties === 'object' ? doc.properties : null;
    if (!props) continue;
    for (const [name, def] of Object.entries(props)) {
      occurrences += 1;
      const described =
        !!def &&
        typeof def === 'object' &&
        typeof def.description === 'string' &&
        def.description.trim() !== '';
      if (!schemaEvidence.has(name)) schemaEvidence.set(name, []);
      schemaEvidence.get(name).push({
        file: `static/bidder-params/${f}`,
        pointer: `/properties/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        commit: FROZEN.commit,
        described,
      });
    }
  }
  const aggDigest = sha256(Buffer.from(digestRows.sort().join(''), 'utf8'));
  if (aggDigest !== FROZEN.schemaListDigest) reject('aggregate schema-list digest mismatch');
  if (occurrences !== FROZEN.occurrences)
    reject(`occurrences ${occurrences} != ${FROZEN.occurrences}`);
  if (schemaEvidence.size !== 289) reject(`schema names ${schemaEvidence.size} != 289`);
  const described = [...schemaEvidence.values()].filter((l) => l.some((e) => e.described)).length;
  if (described !== FROZEN.describedNames)
    reject(`described ${described} != ${FROZEN.describedNames}`);

  // ── Adapter side ────────────────────────────────────────────────────
  const rulesDoc = JSON.parse(rulesBuf.toString('utf8'));
  if (rulesDoc.commit !== FROZEN.commit) reject('derived rules declare a different source commit');
  /** @type {Record<string, number>} */
  const histogram = {};
  /** @type {Map<string, Array<object>>} name -> adapter evidence */
  const adapterEvidence = new Map();
  for (const bidder of rulesDoc.bidders || []) {
    for (const rule of bidder.rules || []) {
      const status = rule.status;
      histogram[status] = (histogram[status] || 0) + 1;
      if (!FROZEN.eligibleStatuses.includes(status)) continue;
      const segs = String(rule.field || '').split('.');
      const i = segs.indexOf('ext');
      if (i < 0 || i + 1 >= segs.length) continue;
      const emit = [segs[i + 1]];
      if (segs[i + 1] === 'bidder' && i + 2 < segs.length) emit.push(segs[i + 2]);
      for (const name of emit) {
        if (!adapterEvidence.has(name)) adapterEvidence.set(name, []);
        adapterEvidence.get(name).push({
          bidder: bidder.bidder,
          field: rule.field,
          disposition: rule.disposition,
          citation: rule.evidence,
          status,
          commit: FROZEN.commit,
          rulesDigest: FROZEN.rulesDigest,
        });
      }
    }
  }
  for (const [k, v] of Object.entries(FROZEN.statusHistogram)) {
    if ((histogram[k] || 0) !== v) reject(`status histogram ${k}: ${histogram[k]} != ${v}`);
  }
  if (adapterEvidence.size !== FROZEN.rawAdapterNames)
    reject(`raw adapter names ${adapterEvidence.size} != ${FROZEN.rawAdapterNames}`);
  for (const name of FROZEN.excluded) adapterEvidence.delete(name);
  if (adapterEvidence.size !== FROZEN.adapterNamesAfterExclusion)
    reject(
      `adapter names after exclusion ${adapterEvidence.size} != ${FROZEN.adapterNamesAfterExclusion}`,
    );

  // ── Union, partition, collisions ────────────────────────────────────
  const all = new Set([...schemaEvidence.keys(), ...adapterEvidence.keys()]);
  if (all.size !== FROZEN.total) reject(`total names ${all.size} != ${FROZEN.total}`);
  let both = 0;
  const entries = [];
  for (const name of [...all].sort()) {
    const hasS = schemaEvidence.has(name);
    const hasA = adapterEvidence.has(name);
    if (hasS && hasA) both += 1;
    entries.push({
      name,
      coverage: hasS && hasA ? 'both' : hasS ? 'schema-only' : 'extension-only',
      schemaEvidence: schemaEvidence.get(name) || [],
      adapterEvidence: adapterEvidence.get(name) || [],
    });
  }
  if (both !== FROZEN.intersection) reject(`intersection ${both} != ${FROZEN.intersection}`);
  const counts = { 'schema-only': 0, 'extension-only': 0, both: 0 };
  for (const e of entries) counts[e.coverage] += 1;
  for (const [k, v] of Object.entries(FROZEN.partition)) {
    if (counts[k] !== v) reject(`partition ${k}: ${counts[k]} != ${v}`);
  }

  /** @type {Record<string, string[]>} advisory only — never selects a role */
  const lcIndex = {};
  for (const name of all) {
    const lc = name.toLowerCase();
    (lcIndex[lc] = lcIndex[lc] || []).push(name);
  }
  const buckets = Object.keys(lcIndex).length;
  const collisions = Object.values(lcIndex).filter((v) => v.length > 1);
  const spellings = collisions.reduce((s, v) => s + v.length, 0);
  if (buckets !== FROZEN.lowercaseBuckets)
    reject(`lowercase buckets ${buckets} != ${FROZEN.lowercaseBuckets}`);
  if (collisions.length !== FROZEN.collisionBuckets)
    reject(`collision buckets ${collisions.length} != ${FROZEN.collisionBuckets}`);
  if (spellings !== FROZEN.collisionSpellings)
    reject(`collision spellings ${spellings} != ${FROZEN.collisionSpellings}`);

  const manifest = {
    version: 1,
    source: {
      repository: 'github.com/prebid/prebid-server',
      commit: FROZEN.commit,
      licence: 'Apache-2.0',
      schemaFiles: FROZEN.schemaFiles,
      schemaListDigest: FROZEN.schemaListDigest,
      rulesFile: 'derived/adapter-rules-2026-08-20.json',
      rulesDigest: FROZEN.rulesDigest,
      licenseDigest: FROZEN.licenseDigest,
      attributionDigest: FROZEN.attributionDigest,
      quarantineDigest: FROZEN.quarantineDigest,
    },
    assertions: {
      occurrences: FROZEN.occurrences,
      schemaNames: 289,
      describedNames: FROZEN.describedNames,
      statusHistogram: FROZEN.statusHistogram,
      rawAdapterNames: FROZEN.rawAdapterNames,
      adapterNamesAfterExclusion: FROZEN.adapterNamesAfterExclusion,
      excluded: FROZEN.excluded,
      intersection: FROZEN.intersection,
      partition: FROZEN.partition,
      total: FROZEN.total,
    },
    lowercaseDiagnostic: {
      note: 'Advisory only: never selects a role, never merges provenance (R-01).',
      buckets,
      collisionBuckets: Object.fromEntries(collisions.map((v) => [v[0].toLowerCase(), v.sort()])),
    },
    entries,
  };

  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (checkOnly) {
    const committed = fs.readFileSync(OUT, 'utf8');
    if (committed !== json) reject('committed manifest differs from regeneration');
    console.log('OK: committed manifest reproduces exactly');
    return;
  }
  fs.writeFileSync(OUT, json);
  console.log(`written: ${OUT} (${entries.length} entries, ${(json.length / 1024).toFixed(0)} KB)`);
}

main();
