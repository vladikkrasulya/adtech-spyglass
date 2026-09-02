'use strict';

/**
 * build-routing-matrix — builds the SC-002 routing-matrix manifest and
 * freezes `D0`, the pre-change deterministic baseline (016 R-09, tasks
 * T010). Maintainer operation, never CI.
 *
 * Slice A (this script's default): fixtures for every named rule, every
 * member of the 22 case-collision groups (47 spellings), unlisted-casing
 * controls, and an opaque absent-key control in both namespaces.
 * Slice B (--slice-b, after the adjudication manifest exists): one fixture
 * per adjudication partition, appended with its own D0.
 *
 * D0 is computed by running each fixture through the CURRENT resolver
 * (packages/core/dialects/signal-lexicon.js resolveSignal) — the code as it
 * stands BEFORE the role layer lands. Run this before any resolver change;
 * regenerated later it proves nothing (the manifest test pins the file, so
 * a late regeneration shows up as a diff, not silently).
 */

const fs = require('node:fs');
const path = require('node:path');

const { resolveSignal } = require('../packages/core/dialects/signal-lexicon');

const DATA = path.join(__dirname, '..', 'packages', 'core', 'dialects', 'data');
const OUT = path.join(DATA, 'key-role-routing-matrix.v1.json');

const corpus = JSON.parse(fs.readFileSync(path.join(DATA, 'key-role-corpus.v1.json'), 'utf8'));
const named = JSON.parse(fs.readFileSync(path.join(DATA, 'key-role-named-rules.v1.json'), 'utf8'));

/** Representative test value per named key — from the frozen oracles. */
const NAMED_VALUES = {
  adtype: 8,
  ad_type: 30,
  adformat: 12,
  ad_format: 12,
  creative_type: 3,
  type: 5,
  format: 12,
  imp_count: 3,
  ttl: 300,
  build: '20260812',
  subage: 18,
  flag: 1,
  limit: 1,
  mode: 2,
  t: 1,
};

/** A neutral imp for imp-scoped fixtures — banner 300x250, nothing exotic. */
const IMP = { banner: { w: 300, h: 250 } };

/**
 * D0: the final deterministic answer of the CURRENT code, or 'model'.
 * @param {string} signalPath
 * @param {unknown} signalValue
 * @returns {{route: string, label?: string, confidence?: number}}
 */
function d0(signalPath, signalValue) {
  const imp = signalPath.startsWith('imp[]') ? IMP : null;
  const hit = resolveSignal({ signalPath, signalValue, imp, locale: 'en' });
  if (!hit) return { route: 'model' };
  return { route: 'legacy-deterministic', label: hit.label, confidence: hit.confidence };
}

function fixture(id, cls, signalPath, signalValue, extra = {}) {
  return { id, class: cls, signalPath, signalValue, ...extra, D0: d0(signalPath, signalValue) };
}

/**
 * Slice B (T010B): one fixture per adjudication record, appended AFTER the
 * adjudication manifest lands. D0 for these fixtures is still measured
 * against the LEGACY resolver only — the pre-016 baseline the no-demotion
 * guarantee is proved against — which stays honest because resolveSignal()
 * is a byte-identical projection of the unchanged legacy chain.
 */
function sliceB() {
  const adjPath = path.join(DATA, 'key-role-adjudication.v1.json');
  if (!fs.existsSync(adjPath)) {
    console.error('slice B needs the adjudication manifest first (T008 finalize)');
    process.exit(1);
  }
  const adj = JSON.parse(fs.readFileSync(adjPath, 'utf8'));
  const matrix = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (matrix.sliceB && matrix.sliceB.fixtures && matrix.sliceB.fixtures.length) {
    console.error('slice B already present — refusing to overwrite a frozen baseline');
    process.exit(1);
  }
  /** Representative value per state: resolved role fixtures use a numeric 7
   * (roles are value-independent in v1), ambiguous/abstain likewise. */
  const fixtures = [];
  let seq = 0;
  for (const r of adj.records) {
    seq += 1;
    const id = `fxB-${String(seq).padStart(3, '0')}-${r.name}`;
    const signalPath = `imp[].ext.${r.name}`;
    fixtures.push({
      id,
      class: 'partition',
      signalPath,
      signalValue: 7,
      partition: r.partition,
      adjState: r.state,
      D0: d0(signalPath, 7),
    });
  }
  matrix.sliceB = {
    capturedAgainst: 'legacy resolver only (the pre-016 baseline; projection is byte-identical)',
    note: 'One fixture per adjudication record (T010B). Appended after T008 finalize.',
    fixtures,
  };
  fs.writeFileSync(OUT, JSON.stringify(matrix, null, 2) + '\n');
  const routes = {};
  for (const f of fixtures) routes[f.D0.route] = (routes[f.D0.route] || 0) + 1;
  console.log(`slice B appended: ${fixtures.length} fixtures | D0 routes:`, routes);
}

function main() {
  if (process.argv.includes('--slice-b')) return sliceB();
  const fixtures = [];
  let seq = 0;
  const fid = (tag) => `fx-${String((seq += 1)).padStart(3, '0')}-${tag}`;

  // ── named rules, both namespaces ────────────────────────────────────
  for (const rule of named.rules) {
    const v = NAMED_VALUES[rule.key];
    if (v === undefined) throw new Error(`no test value for named key ${rule.key}`);
    for (const ns of ['ext', 'imp[].ext']) {
      fixtures.push(
        fixture(
          fid(`named-${rule.key}-${ns === 'ext' ? 'req' : 'imp'}`),
          'named-rule',
          `${ns}.${rule.key}`,
          v,
        ),
      );
    }
  }

  // ── every member of every case-collision group ──────────────────────
  const groups = corpus.lowercaseDiagnostic.collisionBuckets;
  const allNames = new Set(corpus.entries.map((e) => e.name));
  let spellings = 0;
  for (const members of Object.values(groups)) {
    for (const name of members) {
      spellings += 1;
      fixtures.push(fixture(fid(`collision-${name}`), 'collision-member', `imp[].ext.${name}`, 7));
    }
  }
  if (spellings !== 47) throw new Error(`expected 47 collision spellings, got ${spellings}`);

  // ── unlisted-casing controls: a spelling differing only by case from a
  //    present one, itself absent from corpus and named rules ────────────
  const unlisted = [];
  for (const name of allNames) {
    const flipped =
      name[0] === name[0].toUpperCase()
        ? name[0].toLowerCase() + name.slice(1)
        : name[0].toUpperCase() + name.slice(1);
    if (!allNames.has(flipped) && !named.rules.some((r) => r.key === flipped)) {
      unlisted.push(flipped);
      if (unlisted.length === 2) break;
    }
  }
  for (const name of unlisted) {
    fixtures.push(
      fixture(fid(`unlisted-casing-${name}`), 'unlisted-casing', `imp[].ext.${name}`, 7, {
        note: 'differs only by case from a listed spelling; must abstain, never inherit',
      }),
    );
  }

  // ── absent-key controls, both namespaces ────────────────────────────
  const absent = 'publisher_account_ref';
  if (allNames.has(absent) || named.rules.some((r) => r.key === absent)) {
    throw new Error('negative control key unexpectedly present');
  }
  fixtures.push(fixture(fid('absent-req'), 'absent-key', `ext.${absent}`, 42));
  fixtures.push(fixture(fid('absent-imp'), 'absent-key', `imp[].ext.${absent}`, 42));

  const manifest = {
    version: 1,
    sliceA: {
      capturedAgainst: 'pre-change resolver (v1.18.0 line, before the role layer)',
      note: 'D0 frozen per R-09. Slice B (adjudication partitions) is appended after the adjudication manifest exists and gates US2 only.',
    },
    sliceB: null,
    fixtures,
  };
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

  const routes = {};
  for (const f of fixtures) routes[f.D0.route] = (routes[f.D0.route] || 0) + 1;
  console.log(`written: ${OUT}`);
  console.log(`fixtures: ${fixtures.length} | D0 routes:`, routes);
}

main();
