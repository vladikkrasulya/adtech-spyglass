'use strict';

/**
 * The committed key-role manifests' internal invariants (016 FR-017,
 * contracts/manifests.md). Runs against the committed artifacts alone — no
 * out-of-tree corpus, no network, no live model. Regeneration is a
 * maintainer operation (scripts/build-key-role-corpus.js --check).
 *
 * Staged delivery: the adjudication manifest lands with the US2 increment
 * (tasks T008/T010 slice B). Until then data/README.md carries the explicit
 * marker `STAGING: adjudication=pending`, and this suite asserts that state
 * rather than passing silently or failing blind.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'packages', 'core', 'dialects', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const corpus = read('key-role-corpus.v1.json');
const named = read('key-role-named-rules.v1.json');
const matrix = read('key-role-routing-matrix.v1.json');
const readme = fs.readFileSync(path.join(DATA, 'README.md'), 'utf8');

const {
  CANONICAL_ROLES,
  STORABLE_LABELS,
  FORMAT_LABELS,
} = require('../packages/core/dialects/key-role-vocabulary');
const { deriveScore, EXACT_SCORES } = require('../packages/core/dialects/key-role-authority');

// ── Group 1: corpus ──────────────────────────────────────────────────────

test('corpus: exactly 322 exact-case entries in the 194+33+95 partition, byte-order sorted, unique', () => {
  assert.equal(corpus.entries.length, 322);
  const counts = { 'schema-only': 0, 'extension-only': 0, both: 0 };
  for (const e of corpus.entries) counts[e.coverage] += 1;
  assert.deepEqual(counts, { 'schema-only': 194, 'extension-only': 33, both: 95 });
  const names = corpus.entries.map((e) => e.name);
  assert.equal(new Set(names).size, 322, 'no duplicates under exact comparison');
  assert.deepEqual(names, [...names].sort(), 'sorted by byte order');
});

test('corpus: every entry retains evidence matching its coverage; no ineligible status supports one', () => {
  for (const e of corpus.entries) {
    const hasS = e.schemaEvidence.length > 0;
    const hasA = e.adapterEvidence.length > 0;
    const expected = hasS && hasA ? 'both' : hasS ? 'schema-only' : 'extension-only';
    assert.equal(e.coverage, expected, e.name);
    for (const a of e.adapterEvidence) {
      assert.ok(
        ['verified', 'unverified', 'confirmed-omission'].includes(a.status),
        `${e.name}: ineligible status ${a.status}`,
      );
    }
  }
});

test('corpus: pins are present and well-formed; the lowercase diagnostic is advisory and matches 22/47', () => {
  const src = corpus.source;
  assert.equal(src.commit, '0ba352315253f6692af6497d553cfb12909a1b8b');
  for (const key of [
    'schemaListDigest',
    'rulesDigest',
    'licenseDigest',
    'attributionDigest',
    'quarantineDigest',
  ]) {
    assert.match(src[key], /^[0-9a-f]{64}$/, key);
  }
  const groups = Object.values(corpus.lowercaseDiagnostic.collisionBuckets);
  assert.equal(groups.length, 22);
  assert.equal(
    groups.reduce((s, g) => s + g.length, 0),
    47,
  );
  assert.equal(corpus.lowercaseDiagnostic.buckets, 297);
});

// ── Group 2: adjudication (staged) ───────────────────────────────────────

const adjPath = path.join(DATA, 'key-role-adjudication.v1.json');

test('adjudication: present and complete, or explicitly staged — never silently absent', () => {
  if (!fs.existsSync(adjPath)) {
    assert.match(
      readme,
      /STAGING: adjudication=pending/,
      'adjudication manifest missing without the staging marker in data/README.md',
    );
    return;
  }
  const adj = read('key-role-adjudication.v1.json');
  assert.doesNotMatch(
    readme,
    /STAGING: adjudication=pending/,
    'marker must be dropped when the manifest lands',
  );
  const corpusNames = new Set(corpus.entries.map((e) => e.name));
  const adjNames = new Set(adj.records.map((r) => r.name));
  assert.deepEqual(
    [...adjNames].sort(),
    [...corpusNames].sort(),
    'covers exactly the 322 corpus names',
  );
  for (const r of adj.records) {
    assert.ok(['resolved', 'ambiguous', 'abstain'].includes(r.state), r.name);
    assert.equal(r.reviews.length, 2, `${r.name}: two review passes`);
    assert.notEqual(r.reviews[0].reviewer, r.reviews[1].reviewer, `${r.name}: distinct reviewers`);
    if (r.state === 'resolved') {
      assert.equal(r.roleCandidates.length, 1, r.name);
      assert.ok(CANONICAL_ROLES.includes(r.roleCandidates[0]), r.name);
      assert.ok(EXACT_SCORES.includes(r.score), `${r.name}: score ${r.score}`);
      // Score double-entry (R-04): recompute from stored evidence.
      const recomputed = deriveScore(r.attestations, { genericKey: !!r.genericKey });
      assert.equal(recomputed, r.score, `${r.name}: stored score must reproduce`);
    }
    if (r.state === 'ambiguous') assert.ok(r.roleCandidates.length >= 2, r.name);
    if (r.state === 'abstain') assert.equal((r.roleCandidates || []).length, 0, r.name);
  }
});

// ── Group 3: named rules ─────────────────────────────────────────────────

test('named rules: match the frozen oracles exactly, with valid outcome kinds and roles', () => {
  const byKey = Object.fromEntries(named.rules.map((r) => [r.key, r]));
  const expectResolved = {
    adtype: ['format-declaration', 0.9],
    ad_type: ['format-declaration', 0.9],
    adformat: ['format-declaration', 0.9],
    ad_format: ['format-declaration', 0.9],
    creative_type: ['format-declaration', 0.7],
    imp_count: ['measurement', 0.7],
    ttl: ['delivery-control', 0.7],
    build: ['metadata', 0.7],
    subage: ['measurement', 0.9],
  };
  for (const [key, [role, score]] of Object.entries(expectResolved)) {
    const r = byKey[key];
    assert.ok(r, key);
    assert.equal(r.outcome.kind, 'resolved', key);
    assert.equal(r.outcome.role, role, key);
    assert.equal(r.outcome.score, score, key);
  }
  for (const key of ['type', 'format']) {
    assert.equal(byKey[key].outcome.kind, 'cap', key);
    assert.equal(byKey[key].outcome.maxScore, 0.4, key);
  }
  for (const key of ['flag', 'limit']) {
    assert.equal(byKey[key].outcome.kind, 'ambiguous', key);
    assert.ok(byKey[key].outcome.roleCandidates.length >= 2, key);
  }
  for (const key of ['mode', 't']) assert.equal(byKey[key].outcome.kind, 'abstain', key);
  assert.equal(byKey.build.condition.valueForm, 'digit-only', 'build is conditional');
  for (const r of named.rules) {
    if (r.outcome.kind === 'resolved') {
      assert.ok(CANONICAL_ROLES.includes(r.outcome.role), r.key);
      assert.ok(EXACT_SCORES.includes(r.outcome.score), r.key);
    }
    assert.ok(['repo-grounded', 'specification-rule'].includes(r.provenance), r.key);
    assert.ok(r.citation && r.citation.length > 10, `${r.key}: citation`);
  }
});

// ── Group 4: routing matrix (slice A now; slice B checked when present) ──

test('routing matrix slice A: full named-rule/collision/casing/absence coverage, D0 on every fixture', () => {
  const fx = matrix.fixtures;
  for (const f of fx) {
    assert.ok(f.D0 && typeof f.D0.route === 'string', `${f.id}: D0 present`);
    assert.match(f.signalPath, /^(ext|imp\[\]\.ext)\./, f.id);
  }
  // Every named rule in both namespaces.
  for (const r of named.rules) {
    for (const ns of ['ext', 'imp[].ext']) {
      assert.ok(
        fx.some((f) => f.class === 'named-rule' && f.signalPath === `${ns}.${r.key}`),
        `named-rule fixture missing: ${ns}.${r.key}`,
      );
    }
  }
  // Every one of the 47 collision spellings.
  const spellings = Object.values(corpus.lowercaseDiagnostic.collisionBuckets).flat();
  assert.equal(spellings.length, 47);
  for (const name of spellings) {
    assert.ok(
      fx.some((f) => f.class === 'collision-member' && f.signalPath === `imp[].ext.${name}`),
      `collision fixture missing: ${name}`,
    );
  }
  // Casing and absence controls.
  assert.ok(fx.filter((f) => f.class === 'unlisted-casing').length >= 1);
  const absents = fx.filter((f) => f.class === 'absent-key');
  assert.deepEqual(absents.map((f) => f.signalPath).sort(), [
    'ext.publisher_account_ref',
    'imp[].ext.publisher_account_ref',
  ]);
  // The negative control is genuinely absent everywhere (exact case).
  const corpusNames = new Set(corpus.entries.map((e) => e.name));
  assert.ok(!corpusNames.has('publisher_account_ref'));
  assert.ok(!named.rules.some((r) => r.key === 'publisher_account_ref'));
  // Slice B is either pending (null) alongside the staging marker, or an array of partition fixtures.
  if (matrix.sliceB === null) {
    assert.match(readme, /STAGING: adjudication=pending/);
  } else {
    assert.ok(Array.isArray(matrix.sliceB.fixtures) && matrix.sliceB.fixtures.length > 0);
  }
});

// ── Group 5: vocabulary cross-check & attribution ────────────────────────

test('vocabulary cross-check: named-rule roles are canonical, none storable-forbidden leaks into labels', () => {
  for (const r of named.rules) {
    if (r.outcome.kind === 'resolved') {
      const role = r.outcome.role;
      if (role !== 'format-declaration') {
        assert.ok(STORABLE_LABELS.includes(role), `${r.key}: ${role} must be storable`);
        assert.ok(!FORMAT_LABELS.includes(role), `${r.key}: ${role} must be format-inert`);
      }
    }
  }
});

test('attribution ships with the data (FR-005)', () => {
  const attribution = fs.readFileSync(path.join(DATA, 'ATTRIBUTION.md'), 'utf8');
  assert.match(attribution, /Apache-2.0|Apache 2.0/i);
  assert.match(attribution, /prebid/i);
});
