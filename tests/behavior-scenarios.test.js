'use strict';

/**
 * samples/behavior-scenarios.json is the metadata behind the /behavior page.
 * Each card advertises the finding ids a sample is expected to produce and a
 * one-line severity summary. This contract keeps the card honest: every
 * advertised id must be a finding the product can actually emit, and for the
 * validator-tier scenarios the advertised ids and the error/warning counts must
 * be what the validator really returns for the linked sample.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../packages/core');

const SAMPLES = path.join(__dirname, '..', 'samples');
const scenarios = JSON.parse(
  fs.readFileSync(path.join(SAMPLES, 'behavior-scenarios.json'), 'utf8'),
);
const readSample = (name) =>
  JSON.parse(fs.readFileSync(path.join(SAMPLES, `${name}.json`), 'utf8'));

// Findings emitted by the in-browser behavior engine are not produced by
// core.validate(); they are declared in the engine's rule modules.
const BEHAVIOR_RULES = fs
  .readdirSync(path.join(__dirname, '..', 'packages', 'core', 'behavior', 'rules'))
  .filter((f) => f.endsWith('.js'))
  .map((f) =>
    fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'behavior', 'rules', f), 'utf8'),
  )
  .join('\n');

function findingsFor(scenario) {
  const sample = readSample(scenario.sample);
  if (sample.seatbid) return core.validate(sample, { locale: 'en' }).findings;
  const out = core.validate(sample, { locale: 'en' }).findings.slice();
  if (scenario.id === 'floor-price-violation') {
    // The scenario asks the reader to drop the bid below the request's floor.
    const imp = sample.imp[0];
    const res = {
      id: sample.id,
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: '1',
              impid: imp.id,
              price: imp.bidfloor / 2,
              adm: '<div></div>',
              adomain: ['example.com'],
            },
          ],
        },
      ],
    };
    out.push(...core.crosscheck(sample, res, { locale: 'en' }));
  }
  return out;
}

function levelCount(findings, wanted) {
  return findings.filter((f) => wanted.includes(f.level)).length;
}

test('scenario ids are unique and every sample file exists', () => {
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of scenarios) {
    assert.ok(
      fs.existsSync(path.join(SAMPLES, `${s.sample}.json`)),
      `${s.id}: missing ${s.sample}`,
    );
  }
});

test('every advertised key finding is an id the product can emit', () => {
  for (const s of scenarios) {
    const keys = s.expected.key_findings;
    assert.ok(Array.isArray(keys), `${s.id}: key_findings must be an array`);
    for (const id of keys) {
      if (id.startsWith('behavior.')) {
        assert.ok(BEHAVIOR_RULES.includes(`'${id}'`), `${s.id}: unknown behavior finding ${id}`);
      } else {
        const produced = findingsFor(s).map((f) => f.id);
        assert.ok(produced.includes(id), `${s.id}: ${id} is not produced for ${s.sample}`);
      }
    }
  }
});

test('validator-tier summaries state the real error and warning counts', () => {
  const token = /^(\d+)\s+(error|warning)s?$/;
  for (const s of scenarios) {
    if (s.expected.key_findings.some((id) => id.startsWith('behavior.'))) continue;
    const head = s.expected.severity_summary.replace(/\s+if\s+.*$/i, '');
    const stated = { error: 0, warning: 0 };
    for (const piece of head.split(',')) {
      const m = token.exec(piece.trim());
      assert.ok(m, `${s.id}: unsupported summary token "${piece.trim()}"`);
      stated[m[2]] = Number(m[1]);
    }
    const findings = findingsFor(s);
    assert.equal(stated.error, levelCount(findings, ['error']), `${s.id}: error count`);
    // Crosscheck reports a below-floor bid as level "warn".
    assert.equal(
      stated.warning,
      levelCount(findings, ['warning', 'warn']),
      `${s.id}: warning count`,
    );
  }
});
