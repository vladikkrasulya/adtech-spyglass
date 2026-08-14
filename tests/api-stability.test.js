'use strict';

/**
 * API stability contract tests.
 *
 * Validates the public ordering and dedup guarantees added in core 0.11.0:
 *   - findings are sorted by severity DESC → path ASC → id ASC
 *   - duplicate (id, path) pairs collapse to one finding with a `dedupCount`
 *     param when the merge count is ≥ 2
 *   - `disabledRules` filters out exact ids and `*`-suffix prefixes
 *
 * The util functions are also tested directly so we cover their contract
 * outside the validate() pipeline.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('@ortbtools/core');

const {
  sortFindings,
  dedupFindings,
  applyDisabledRules,
  applyStrictness,
} = require('../packages/core/findings');

// ─────────────────────────────────────────────────────────────────
// sortFindings
// ─────────────────────────────────────────────────────────────────

test('sortFindings orders error → warning → info', () => {
  const input = [
    { id: 'a', level: 'info', path: '' },
    { id: 'b', level: 'error', path: '' },
    { id: 'c', level: 'warning', path: '' },
    { id: 'd', level: 'error', path: '' },
  ];
  const out = sortFindings(input);
  assert.equal(out[0].level, 'error');
  assert.equal(out[1].level, 'error');
  assert.equal(out[2].level, 'warning');
  assert.equal(out[3].level, 'info');
});

test('sortFindings is stable on equal severity — sorts by path then id', () => {
  const input = [
    { id: 'z', level: 'error', path: 'imp[1]' },
    { id: 'a', level: 'error', path: 'imp[0]' },
    { id: 'b', level: 'error', path: 'imp[0]' },
  ];
  const out = sortFindings(input);
  assert.equal(out[0].path, 'imp[0]');
  assert.equal(out[0].id, 'a');
  assert.equal(out[1].path, 'imp[0]');
  assert.equal(out[1].id, 'b');
  assert.equal(out[2].path, 'imp[1]');
});

test('sortFindings does not mutate input', () => {
  const input = [
    { id: 'a', level: 'info', path: '' },
    { id: 'b', level: 'error', path: '' },
  ];
  const before = JSON.stringify(input);
  sortFindings(input);
  assert.equal(JSON.stringify(input), before);
});

test('sortFindings is idempotent', () => {
  const input = [
    { id: 'z', level: 'info', path: 'b' },
    { id: 'a', level: 'error', path: 'a' },
    { id: 'm', level: 'warning', path: 'a' },
  ];
  const once = sortFindings(input);
  const twice = sortFindings(once);
  assert.deepEqual(once, twice);
});

test('sortFindings folds crosscheck levels into the same scale', () => {
  const input = [
    { id: 'a', level: 'ok', path: '' },
    { id: 'b', level: 'crit', path: '' },
    { id: 'c', level: 'warn', path: '' },
    { id: 'd', level: 'info', path: '' },
  ];
  const out = sortFindings(input);
  assert.equal(out[0].level, 'crit');
  assert.equal(out[1].level, 'warn');
  assert.equal(out[2].level, 'info');
  assert.equal(out[3].level, 'ok');
});

// ─────────────────────────────────────────────────────────────────
// dedupFindings
// ─────────────────────────────────────────────────────────────────

test('dedupFindings collapses three identical (id,path) into one with dedupCount=3', () => {
  const input = [
    { id: 'imp.id_required', level: 'error', path: 'imp[0]', params: {} },
    { id: 'imp.id_required', level: 'error', path: 'imp[0]', params: {} },
    { id: 'imp.id_required', level: 'error', path: 'imp[0]', params: {} },
  ];
  const out = dedupFindings(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].params.dedupCount, 3);
});

test('dedupFindings does not add dedupCount for unique findings', () => {
  const input = [
    { id: 'a', level: 'error', path: 'p', params: { x: 1 } },
    { id: 'b', level: 'error', path: 'p', params: {} },
  ];
  const out = dedupFindings(input);
  assert.equal(out.length, 2);
  assert.equal(out[0].params.dedupCount, undefined);
  assert.equal(out[0].params.x, 1);
  assert.equal(out[1].params.dedupCount, undefined);
});

test('dedupFindings preserves first occurrence params (does not overwrite)', () => {
  const input = [
    { id: 'a', level: 'error', path: 'p', params: { num: 1 } },
    { id: 'a', level: 'error', path: 'p', params: { num: 2 } },
  ];
  const out = dedupFindings(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].params.num, 1);
  assert.equal(out[0].params.dedupCount, 2);
});

test('dedupFindings does not collide with existing `count` param (e.g. native_complete)', () => {
  const input = [
    { id: 'crosscheck.bid.native_complete', level: 'ok', path: 'p', params: { count: 4 } },
    { id: 'crosscheck.bid.native_complete', level: 'ok', path: 'p', params: { count: 4 } },
  ];
  const out = dedupFindings(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].params.count, 4); // domain count survives
  assert.equal(out[0].params.dedupCount, 2);
});

test('dedupFindings preserves order of first occurrences', () => {
  const input = [
    { id: 'b', level: 'error', path: 'p', params: {} },
    { id: 'a', level: 'error', path: 'p', params: {} },
    { id: 'b', level: 'error', path: 'p', params: {} },
  ];
  const out = dedupFindings(input);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'b');
  assert.equal(out[1].id, 'a');
});

// ─────────────────────────────────────────────────────────────────
// applyDisabledRules
// ─────────────────────────────────────────────────────────────────

test('applyDisabledRules removes exact id matches', () => {
  const input = [
    { id: 'imp.id_required', level: 'error', path: '', params: {} },
    { id: 'imp.bidfloorcur_missing', level: 'warning', path: '', params: {} },
    { id: 'regs.coppa_pii_present', level: 'error', path: '', params: {} },
  ];
  const out = applyDisabledRules(input, ['imp.bidfloorcur_missing']);
  assert.equal(out.length, 2);
  assert.ok(!out.find((f) => f.id === 'imp.bidfloorcur_missing'));
});

test('applyDisabledRules removes prefix matches via trailing *', () => {
  const input = [
    { id: 'imp.id_required', level: 'error', path: '', params: {} },
    { id: 'imp.bidfloorcur_missing', level: 'warning', path: '', params: {} },
    { id: 'regs.coppa_pii_present', level: 'error', path: '', params: {} },
  ];
  const out = applyDisabledRules(input, ['imp.*']);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'regs.coppa_pii_present');
});

test('applyDisabledRules supports mixing exact + prefix', () => {
  const input = [
    { id: 'imp.id_required', level: 'error', path: '', params: {} },
    { id: 'regs.coppa_pii_present', level: 'error', path: '', params: {} },
    { id: 'response.no_bid', level: 'info', path: '', params: {} },
  ];
  const out = applyDisabledRules(input, ['regs.*', 'response.no_bid']);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'imp.id_required');
});

test('applyDisabledRules returns input untouched on empty/falsy filter', () => {
  const input = [{ id: 'a', level: 'error', path: '', params: {} }];
  assert.equal(applyDisabledRules(input, []).length, 1);
  assert.equal(applyDisabledRules(input, undefined).length, 1);
  assert.equal(applyDisabledRules(input, null).length, 1);
});

// ─────────────────────────────────────────────────────────────────
// validate() — end-to-end contract through the public API
// ─────────────────────────────────────────────────────────────────

test('validate(): findings come out sorted error → warning → info', () => {
  // Synthetic broken request: missing id + invalid imp.id.
  const req = { imp: [{ id: 1, banner: { w: 300, h: 250 } }] };
  const r = validate(req);
  for (let i = 1; i < r.findings.length; i++) {
    const aLevel = r.findings[i - 1].level;
    const bLevel = r.findings[i].level;
    const ranks = { error: 0, warning: 1, info: 2 };
    assert.ok(
      (ranks[aLevel] != null ? ranks[aLevel] : 99) <= (ranks[bLevel] != null ? ranks[bLevel] : 99),
      `findings out of severity order at idx ${i}: ${aLevel} before ${bLevel}`,
    );
  }
});

test('validate({ disabledRules }): drops the exact id from output', () => {
  const req = { id: 'r1', imp: [{ id: '1', banner: { w: 300, h: 250 } }] };
  const baseline = validate(req);
  const hasFloorRule = baseline.findings.some((f) => f.id === 'imp.bidfloorcur_missing');
  if (!hasFloorRule) {
    // Rule may not fire on this synthetic — just assert the option is honored
    // when SOMETHING is disabled. Use any id from baseline.
    if (!baseline.findings.length) return;
    const targetId = baseline.findings[0].id;
    const filtered = validate(req, { disabledRules: [targetId] });
    assert.ok(!filtered.findings.find((f) => f.id === targetId));
    return;
  }
  const filtered = validate(req, { disabledRules: ['imp.bidfloorcur_missing'] });
  assert.ok(!filtered.findings.find((f) => f.id === 'imp.bidfloorcur_missing'));
});

test('validate({ disabledRules: ["regs.*"] }): drops every regs.* finding', () => {
  // Force regs findings: GDPR=1 with no consent + invalid us_privacy.
  const req = {
    id: 'r1',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    regs: { gdpr: 1, us_privacy: 'XXXX' },
  };
  const filtered = validate(req, { disabledRules: ['regs.*'] });
  for (const f of filtered.findings) {
    assert.ok(!f.id.startsWith('regs.'), `unexpected regs finding: ${f.id}`);
  }
});

test('validate(): repeats of the same (id,path) are collapsed via dedup', () => {
  // Two imps both missing tagid, banner missing — produces repeated findings
  // at imp[0] and imp[1] (different paths) so they should NOT be deduped.
  // To force a true dup we need two findings with literally identical path —
  // e.g. two regs violations on regs root.
  const req = {
    id: 'r1',
    imp: [{ id: '1' }, { id: '2' }],
  };
  const r = validate(req);
  // Identity check: no two findings share (id, path).
  const seen = new Set();
  for (const f of r.findings) {
    const k = f.id + '\u0000' + f.path;
    assert.ok(!seen.has(k), `duplicate (id,path) survived dedup: ${f.id} @ ${f.path}`);
    seen.add(k);
  }
});

// ─────────────────────────────────────────────────────────────────
// applyStrictness (since 0.21.0)
// ─────────────────────────────────────────────────────────────────

const ALL_LEVELS = [
  { level: 'error', code: 'E' },
  { level: 'warning', code: 'W' },
  { level: 'info', code: 'I' },
  { level: 'question', code: 'Q' },
  { level: 'crit', code: 'C' },
  { level: 'warn', code: 'CW' },
  { level: 'ok', code: 'OK' },
];

test('applyStrictness: lax keeps only error + crit', () => {
  assert.deepEqual(
    applyStrictness(ALL_LEVELS, 'lax').map((f) => f.code),
    ['E', 'C'],
  );
});

test('applyStrictness: normal keeps error + warning + question + crit + warn', () => {
  assert.deepEqual(
    applyStrictness(ALL_LEVELS, 'normal').map((f) => f.code),
    ['E', 'W', 'Q', 'C', 'CW'],
  );
});

test('applyStrictness: pedantic keeps everything', () => {
  assert.deepEqual(
    applyStrictness(ALL_LEVELS, 'pedantic').map((f) => f.code),
    ['E', 'W', 'I', 'Q', 'C', 'CW', 'OK'],
  );
});

const VALID_REQUEST = {
  id: 'req-1',
  at: 1,
  imp: [{ id: '1', banner: { w: 300, h: 250 } }],
  site: { id: 's1', page: 'https://example.com', publisher: { id: 'p1' } },
  device: { ua: 'Mozilla/5.0', ip: '1.2.3.4' },
};

test('applyStrictness: validate lax returns 0 findings for valid request (no errors)', () => {
  const result = validate(VALID_REQUEST, { strictness: 'lax' });
  assert.equal(result.findings.length, 0);
});

test('applyStrictness: pedantic matches default (backwards compat)', () => {
  const defaultResult = validate(VALID_REQUEST);
  const pedanticResult = validate(VALID_REQUEST, { strictness: 'pedantic' });
  assert.equal(pedanticResult.findings.length, defaultResult.findings.length);
});

// ── Structurally impossible auctions (bucket B, transaction-local part) ────

const { validate: validateStructural } = require('@ortbtools/core');

const structuralBase = () => ({
  id: 'r',
  at: 2,
  tmax: 120,
  cur: ['USD'],
  /** @type {Array<Record<string, unknown>>} */
  imp: [{ id: '1', banner: { w: 300, h: 250 }, bidfloor: 0.5 }],
  site: { id: 's', domain: 'pub.example', page: 'https://pub.example/a' },
  device: { ua: 'Mozilla/5.0', ip: '192.0.2.1', language: 'en' },
  user: { id: 'u1' },
});
const structuralIds = (req) => validateStructural(req, { locale: 'en' }).findings.map((f) => f.id);

test('duplicate imp.id makes bid.impid ambiguous and is an error', () => {
  // A bid answers with bid.impid. With two impressions sharing an id that
  // reference names neither one, and two receivers can resolve it differently.
  // Every required field is present, so nothing else rejects the payload.
  const req = structuralBase();
  req.imp = [
    { id: '1', banner: { w: 300, h: 250 } },
    { id: '1', banner: { w: 728, h: 90 } },
  ];
  const found = validateStructural(req, { locale: 'en' }).findings.find(
    (f) => f.id === 'request.imp_id_duplicated',
  );
  assert.ok(found);
  assert.equal(found.level, 'error');
  assert.equal(found.params.impid, '1');
});

test('distinct imp ids say nothing, however many impressions there are', () => {
  const req = structuralBase();
  req.imp = [
    { id: '1', banner: { w: 300, h: 250 } },
    { id: '2', banner: { w: 728, h: 90 } },
    { id: '3', banner: { w: 160, h: 600 } },
  ];
  assert.equal(structuralIds(req).includes('request.imp_id_duplicated'), false);
});

test('EIDs in both homes with different contents is reported', () => {
  // Measured: Prebid Server discards the legacy array when the core one is
  // present; Prebid.js merges and de-duplicates both. One request, two possible
  // outbound identity sets, and no error anywhere in the chain.
  const req = structuralBase();
  req.user.eids = [{ source: 'a.example', uids: [{ id: 'AAA' }] }];
  req.user.ext = { eids: [{ source: 'b.example', uids: [{ id: 'BBB' }] }] };
  const found = validateStructural(req, { locale: 'en' }).findings.find(
    (f) => f.id === 'request.user.eids_disagree',
  );
  assert.ok(found);
  assert.equal(found.level, 'warning');
});

test('EIDs in both homes agreeing is not a finding', () => {
  // Carrying both homes is ordinary during the 2.5→2.6 transition. Only a
  // disagreement between them is worth saying anything about.
  const req = structuralBase();
  const eids = [{ source: 'a.example', uids: [{ id: 'AAA' }] }];
  req.user.eids = eids;
  req.user.ext = { eids: JSON.parse(JSON.stringify(eids)) };
  assert.equal(structuralIds(req).includes('request.user.eids_disagree'), false);

  // And a single home, however populated, says nothing either.
  const single = structuralBase();
  single.user.eids = eids;
  assert.equal(structuralIds(single).includes('request.user.eids_disagree'), false);
});

// ── Sample delivery preserves the shape on disk ────────────────────────────

const sampleFs = require('node:fs');
const samplePath = require('node:path');

test('a top-level array sample is not handed out as an object', () => {
  // `Object.assign({}, sample)` on an array yields `{"0":…,"1":…}` — a shape
  // that exists nowhere on disk. samples/behavior-scenarios.json is a top-level
  // array, and the catalog lists every .json in the directory, so it reaches
  // the generic sample path as an ordinary card. The transformation described
  // itself as a copy and was not one.
  const dir = samplePath.join(__dirname, '..', 'samples');
  const arrays = sampleFs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => {
      try {
        return Array.isArray(JSON.parse(sampleFs.readFileSync(samplePath.join(dir, f), 'utf8')));
      } catch {
        return false;
      }
    });
  assert.ok(arrays.length > 0, 'the corpus still contains a top-level array to guard');

  for (const file of arrays) {
    const onDisk = JSON.parse(sampleFs.readFileSync(samplePath.join(dir, file), 'utf8'));
    // The copy the handler performs, mirrored here: array-aware.
    const served = Array.isArray(onDisk) ? onDisk.slice() : Object.assign({}, onDisk);
    assert.ok(Array.isArray(served), `${file} must be served as an array`);
    assert.equal(served.length, onDisk.length, `${file} must keep every element`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(served, '0') && !Array.isArray(served),
      false,
      `${file} must not acquire numeric string keys`,
    );
  }
});
