'use strict';

/**
 * tests/synthetic-generator-corpus.test.js
 *
 * The Live stream generator must only emit real OpenRTB specimens. It loads
 * fixtures from samples/ by a NAMING CONTRACT — `synthetic-*.json` or
 * `iab-*.json` — so non-specimen JSON (e.g. `behavior-scenarios.json`, which
 * is UI metadata for the /behavior section) never reaches the stream, the
 * buffer, or the SQLite specimen cache. Regression guard for the production
 * defect where that metadata array was emitted as a "specimen" and the
 * Inspector mis-analysed it as a Vendor Feed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SyntheticGenerator = require('../samples/synthetic-generator');

function tmpCorpus(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyglass-corpus-'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(dir, name),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );
  }
  return dir;
}

const REQ = {
  id: 'x',
  imp: [{ id: '1', banner: { w: 300, h: 250 } }],
  site: { page: 'https://e.x' },
};

test('loadCorpus: synthetic-*.json and iab-*.json are eligible fixtures', () => {
  const dir = tmpCorpus({ 'synthetic-clean.json': REQ, 'iab-banner.json': REQ });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  const n = gen.loadCorpus();
  assert.equal(n, 2);
  assert.deepEqual(gen.corpus.map((c) => c.name).sort(), [
    'iab-banner.json',
    'synthetic-clean.json',
  ]);
});

test('loadCorpus: behavior-scenarios.json is excluded', () => {
  const dir = tmpCorpus({
    'synthetic-clean.json': REQ,
    'behavior-scenarios.json': [{ id: 's1', name: 'scenario', sample: 'x' }],
  });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  gen.loadCorpus();
  const names = gen.corpus.map((c) => c.name);
  assert.deepEqual(names, ['synthetic-clean.json']);
  assert.ok(!names.includes('behavior-scenarios.json'));
});

test('loadCorpus: arbitrary metadata/config JSON is excluded', () => {
  const dir = tmpCorpus({
    'synthetic-clean.json': REQ,
    'config.json': { feature: true },
    'manifest.json': { version: 1 },
    'creative-index.json': [{ id: 'a' }],
  });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  gen.loadCorpus();
  assert.deepEqual(
    gen.corpus.map((c) => c.name),
    ['synthetic-clean.json'],
  );
});

test('loadCorpus: array-root fixtures are allowed (gate is the name, not the shape)', () => {
  const dir = tmpCorpus({ 'synthetic-feed-array.json': [{ url: 'https://lp.x', bid: 0.2 }] });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  assert.equal(gen.loadCorpus(), 1);
  assert.ok(Array.isArray(gen.corpus[0].base));
});

test('loadCorpus: only-metadata directory throws a clear no-eligible-fixtures error', () => {
  const dir = tmpCorpus({ 'behavior-scenarios.json': [{ id: 's1' }], 'config.json': { x: 1 } });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  assert.throws(() => gen.loadCorpus(), /no eligible stream fixtures/i);
});

test('loadCorpus: invalid JSON in an ELIGIBLE fixture still fails fast', () => {
  const dir = tmpCorpus({
    'synthetic-clean.json': REQ,
    'synthetic-broken.json': '{ not valid json',
  });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  assert.throws(() => gen.loadCorpus(), /JSON|Unexpected|token/i);
});

test('loadCorpus: invalid JSON in an INELIGIBLE file is ignored (never parsed)', () => {
  const dir = tmpCorpus({
    'synthetic-clean.json': REQ,
    'behavior-scenarios.json': '{ not valid json',
  });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  assert.equal(gen.loadCorpus(), 1);
});

test('real samples/ corpus: behavior-scenarios.json on disk but excluded from corpus', () => {
  const samplesDir = path.join(__dirname, '..', 'samples');
  assert.ok(
    fs.existsSync(path.join(samplesDir, 'behavior-scenarios.json')),
    'metadata file exists on disk',
  );
  const gen = new SyntheticGenerator({ corpusDir: samplesDir });
  gen.loadCorpus();
  const names = gen.corpus.map((c) => c.name);
  assert.ok(names.length > 0);
  assert.ok(!names.includes('behavior-scenarios.json'), 'metadata excluded from corpus');
  assert.ok(
    names.every((n) => /^(synthetic|iab)-.+\.json$/.test(n)),
    'every corpus file matches the contract',
  );
});

test('next(): never emits an excluded metadata file as a specimen', () => {
  const dir = tmpCorpus({
    'synthetic-a.json': REQ,
    'synthetic-b.json': REQ,
    'behavior-scenarios.json': [{ id: 's1', name: 'scenario' }],
  });
  const gen = new SyntheticGenerator({ corpusDir: dir });
  gen.loadCorpus();
  const emitted = [];
  gen.on('specimen', (e) => emitted.push(e.source));
  for (let i = 0; i < 10; i++) gen.next();
  assert.equal(emitted.length, 10);
  assert.ok(!emitted.includes('behavior-scenarios.json'));
  assert.deepEqual([...new Set(emitted)].sort(), ['synthetic-a.json', 'synthetic-b.json']);
});
