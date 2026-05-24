'use strict';

/**
 * tests/spec-refs.test.js — packages/core/spec-refs.json coverage gate.
 *
 * Every finding id emitted by rules code must have an entry in
 * spec-refs.json. The value can be either:
 *   - a string URL (IAB spec anchor or vendor doc), or
 *   - null / "" (explicit "no spec ref" — used for Spyglass-own
 *     checks like behavior.* and dialect-specific findings)
 *
 * Missing entries are a fail: when someone adds a new finding to
 * rules-*.js or a plugin, they must also record it here. Forces the
 * "every finding has a documented disposition" invariant.
 *
 * Discovery: greps source files in packages/core/ for two emission
 * shapes used across rules + plugins + dialects:
 *   F('id.…', LEVELS.X, …)               — alias from makeFinding
 *   makeFinding('id.…', LEVELS.X, …)     — direct call
 *
 * Anything that doesn't match these literal patterns is invisible to
 * this test. If you add a new emission style (e.g. helper that
 * wraps makeFinding), extend EMISSION_REGEXES below.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE_DIR = path.join(__dirname, '..', 'packages', 'core');
const SPEC_REFS_PATH = path.join(CORE_DIR, 'spec-refs.json');

const EMISSION_REGEXES = [
  /\bF\(\s*['"]([a-zA-Z0-9._-]+)['"]/g,
  /\bmakeFinding\(\s*['"]([a-zA-Z0-9._-]+)['"]/g,
];

// `_comment` / `_base` are metadata in spec-refs.json, not finding ids.
const METADATA_KEYS = new Set(['_comment', '_base']);

function walkJsFiles(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
}

function collectEmittedIds() {
  const files = [];
  walkJsFiles(CORE_DIR, files);
  const ids = new Set();
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const re of EMISSION_REGEXES) {
      // Reset lastIndex defensively for /g regex reuse across files.
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt))) ids.add(m[1]);
    }
  }
  return ids;
}

test('spec-refs: every finding id emitted by rules code has an entry', () => {
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  const known = new Set(Object.keys(specRefs).filter((k) => !METADATA_KEYS.has(k)));
  const emitted = collectEmittedIds();
  const missing = [...emitted].filter((id) => !known.has(id)).sort();
  assert.equal(
    missing.length,
    0,
    `Finding ids missing from spec-refs.json — add an entry (URL or null) for each:\n  ${missing.join('\n  ')}`,
  );
});

test('spec-refs: every entry value is a string URL or null/empty', () => {
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  const badValues = [];
  for (const [k, v] of Object.entries(specRefs)) {
    if (METADATA_KEYS.has(k)) continue;
    if (v === null || v === '') continue;
    if (typeof v === 'string' && /^https?:\/\//.test(v)) continue;
    badValues.push(`${k}: ${JSON.stringify(v)}`);
  }
  assert.equal(
    badValues.length,
    0,
    `spec-refs entries must be a URL string or null/empty:\n  ${badValues.join('\n  ')}`,
  );
});

test('spec-refs: _base + _comment metadata keys are still present', () => {
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  assert.ok(specRefs._base, 'spec-refs.json should declare _base URL');
  assert.ok(/^https?:\/\//.test(specRefs._base), '_base should be an absolute URL');
  assert.ok(specRefs._comment, 'spec-refs.json should declare _comment');
});

test('spec-refs: no orphan entries (entry without matching emission)', () => {
  // This is a softer assertion — emitted IDs found in code. If an entry
  // sits in spec-refs.json but no rule file emits it, it's likely a
  // stale id from a removed rule. WARN-style: a list, but not a fail.
  // We DO fail if the orphan list is implausibly large (>20% of total)
  // — that suggests a refactor missed cleanup.
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  const known = new Set(Object.keys(specRefs).filter((k) => !METADATA_KEYS.has(k)));
  const emitted = collectEmittedIds();
  const orphans = [...known].filter((id) => !emitted.has(id));
  const ratio = orphans.length / known.size;
  assert.ok(
    ratio < 0.2,
    `>=20% of spec-refs entries are orphaned (${orphans.length} / ${known.size}) — possibly stale after a refactor:\n  ${orphans.slice(0, 15).join('\n  ')}${orphans.length > 15 ? '\n  ...' : ''}`,
  );
});
