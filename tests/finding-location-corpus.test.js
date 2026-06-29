'use strict';

/**
 * Corpus regression for the location contract. Runs the REAL validator over
 * the synthetic corpus, stamps side from the detected call-context (mirroring
 * the handler), and asserts STRUCTURAL invariants — not hard-coded counts, so
 * the suite survives corpus growth. Metrics are printed for the CP report.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../packages/core');
const FL = require('../packages/core/finding-location');
const { buildSourceMap } = require('../packages/core/source-map');

const SAMPLES = path.join(__dirname, '..', 'samples');
const CORPUS_RE = /^(?:synthetic|iab)-.+\.json$/;

function load() {
  const out = [];
  for (const f of fs
    .readdirSync(SAMPLES)
    .filter((n) => CORPUS_RE.test(n))
    .sort()) {
    const raw = fs.readFileSync(path.join(SAMPLES, f), 'utf8');
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
    out.push({ f, payload });
  }
  return out;
}

// side from detected type = the standalone-payload call context (no regex).
function sideAndKind(r) {
  if (r.type === core.TYPES.URL_REQUEST) return { side: 'request', kind: 'url' };
  if (r.type === core.TYPES.ORTB_RESPONSE || r.type === core.TYPES.VENDOR_FEED)
    return { side: 'response', kind: 'ortb' };
  return { side: 'request', kind: 'ortb' };
}

function collect() {
  const findings = [];
  for (const { f, payload } of load()) {
    let r;
    try {
      r = core.validate(payload, { locale: 'en' });
    } catch (e) {
      throw new Error(`validate threw on ${f}: ${e.message}`);
    }
    const { side, kind } = sideAndKind(r);
    FL.attachLocations(r.findings, { side, kind, canonical: r.urlRequest });
    for (const fd of r.findings) findings.push({ file: f, fd });
  }
  return findings;
}

test('corpus: side present on every locatable finding; clean exact/container/none partition; 100% JSON grammar', () => {
  const all = collect();
  assert.ok(all.length > 0, 'corpus produced no findings');

  let exact = 0;
  let container = 0;
  let none = 0;
  let jsonPaths = 0;
  let jsonPathsWithPointer = 0;

  for (const { file, fd } of all) {
    const loc = fd.location;
    assert.ok(loc, `${file} ${fd.id}: missing location`);
    assert.ok(
      ['exact', 'container', 'none'].includes(loc.precision),
      `${file} ${fd.id}: bad precision`,
    );

    if (loc.precision === 'none') {
      none++;
      assert.equal(loc.primary, null, `${file} ${fd.id}: precision none must have null primary`);
    } else {
      // INVARIANT: every locatable finding carries an explicit side.
      assert.ok(
        loc.primary && (loc.primary.side === 'request' || loc.primary.side === 'response'),
        `${file} ${fd.id}: locatable finding must have an explicit side`,
      );
      if (loc.precision === 'exact') exact++;
      else container++;
    }

    // dialect invariants
    if (loc.dialect === 'envelope')
      assert.equal(loc.precision, 'none', `${file} ${fd.id}: envelope→none`);
    if (loc.dialect === 'vast' && loc.primary)
      assert.equal(loc.primary.precision, 'container', `${file} ${fd.id}: vast→container`);

    // 100% JSON-path grammar coverage: any ortb-json finding with a path must
    // produce a pointer (never an unparseable display path).
    if (loc.dialect === 'ortb-json' && fd.path) {
      jsonPaths++;
      if (FL.pathToPointer(fd.path) !== null) jsonPathsWithPointer++;
    }

    // each location object carries its OWN precision
    for (const l of [loc.primary].concat(loc.related || []).filter(Boolean)) {
      assert.ok(['exact', 'container'].includes(l.precision), `${file} ${fd.id}: loc precision`);
      assert.ok(typeof l.pointer === 'string', `${file} ${fd.id}: loc pointer`);
    }
  }

  assert.equal(jsonPathsWithPointer, jsonPaths, '100% of ortb-json paths must parse to a pointer');
  assert.equal(exact + container + none, all.length, 'partition must sum to total');
  assert.ok(exact > 0 && none > 0, 'expected a mix of exact and none');

  const pc = (x) => ((100 * x) / all.length).toFixed(1) + '%';
  console.log(
    `[corpus] findings=${all.length} exact=${exact}(${pc(exact)}) container=${container}(${pc(container)}) none=${none}(${pc(none)}) jsonPaths=${jsonPaths}`,
  );
});

test('corpus: exact-precision pointers resolve against a clean payload (end-to-end)', () => {
  // A clean request whose findings all reference present fields.
  const payload = JSON.parse(
    fs.readFileSync(path.join(SAMPLES, 'iab-banner-with-issues.json'), 'utf8'),
  );
  const r = core.validate(payload, { locale: 'en' });
  const { side, kind } = sideAndKind(r);
  FL.attachLocations(r.findings, { side, kind });
  const text = JSON.stringify(payload, null, 2); // what the UI would show
  const map = buildSourceMap(text);
  assert.ok(map.ok);
  let resolved = 0;
  for (const fd of r.findings) {
    const p = fd.location.primary;
    if (!p || p.precision !== 'exact') continue;
    const entry = map.resolve(p.pointer);
    // unresolved is legitimate (missing-field finding → honest client fallback);
    // resolved pointers must slice to a real source token.
    if (entry) {
      resolved++;
      assert.ok(text.slice(entry.valueStart, entry.valueEnd).length > 0);
    }
  }
  assert.ok(resolved > 0, 'at least some exact pointers should resolve in a populated payload');
});

test('crosscheck corpus: pop pair yields locations whose pointers resolve', () => {
  const req = JSON.parse(
    fs.readFileSync(path.join(SAMPLES, 'synthetic-pop-clean-request.json'), 'utf8'),
  );
  const res = JSON.parse(
    fs.readFileSync(path.join(SAMPLES, 'synthetic-pop-clean-response.json'), 'utf8'),
  );
  const cross = core.crosscheck(req, res, { locale: 'en' });
  FL.attachLocations(cross, { crosscheck: true, req, res });
  const reqMap = buildSourceMap(JSON.stringify(req, null, 2));
  const resMap = buildSourceMap(JSON.stringify(res, null, 2));
  for (const fd of cross) {
    const loc = fd.location;
    if (loc.precision === 'none') continue;
    for (const l of [loc.primary].concat(loc.related || []).filter(Boolean)) {
      const map = l.side === 'request' ? reqMap : resMap;
      // must be a syntactically valid RFC 6901 pointer
      assert.ok(
        typeof l.pointer === 'string' && (l.pointer === '' || l.pointer[0] === '/'),
        `${fd.id} pointer ${l.pointer}`,
      );
      // when it resolves, the range slices to a real source token
      const entry = map.resolve(l.pointer);
      if (entry) assert.ok(map.length >= entry.valueEnd && entry.valueEnd > entry.valueStart);
    }
  }
});
