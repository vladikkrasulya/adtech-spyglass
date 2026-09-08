'use strict';

/**
 * Self-checks for the verification-corpus runner library (tests/corpus/lib).
 *
 * The corpus tests trust this library to load cases, apply mutations and judge
 * results. A library that silently accepted a malformed case or missed a
 * forbidden finding would make every corpus run a false green, so the library
 * is tested on its own with inline fixtures — including the two Core
 * contradictions reproduced on 2026-09-07 (deal floor vs crosscheck; non-numeric
 * price coerced to a numeric verdict), which the oracle must be able to catch.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCase } = require('./corpus/lib/schema');
const { applyPatch } = require('./corpus/lib/patch');
const { evaluate, evaluatePreview, CONSISTENCY_RULES } = require('./corpus/lib/oracle');
const { runCore, coreApplicability } = require('./corpus/lib/core-run');
const { loadCorpus, materializeMutation } = require('./corpus/lib/load');
const { gapFor, deviationVerdict } = require('./corpus/lib/report');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** @returns {any} */
const basePair = () => ({
  kind: 'pair',
  id: 'lib-self-test-pair',
  title: 'Minimal banner pair used only by the library self-test',
  format: 'banner',
  protocol: 'ortb-2.6',
  context: 'web',
  dialect: 'iab',
  scenario: 'pair',
  provenance: {
    synthetic: true,
    source: { name: 'synthetic', license: 'MIT (ortbtools)' },
    modifications: [],
    sanitized: 'no identifiers present',
  },
  request: {
    id: 'r',
    imp: [{ id: 'i1', banner: { w: 300, h: 250 } }],
    site: { domain: 'example.com' },
  },
  response: {
    id: 'r',
    seatbid: [{ bid: [{ id: 'b1', impid: 'i1', price: 1, adm: '<div>x</div>' }] }],
  },
  expect: {
    request: { type: 'oRTB BidRequest' },
    response: { type: 'oRTB BidResponse' },
    crosscheck: { must: ['crosscheck.id_match'] },
  },
});

test('schema: accepts a well-formed pair and rejects the common authoring mistakes', () => {
  assert.deepEqual(validateCase(basePair()), []);
  const bad = basePair();
  bad.format = 'display';
  bad.provenance.sanitized = '';
  bad.expect.preview = { kind: 'iframe', rendered: 'full', mediaPlays: 'n/a' };
  bad.knownGap = { id: 'BUG-1', layers: [], note: 1 };
  const problems = validateCase(bad);
  for (const needle of [
    'format:',
    'provenance.sanitized',
    'expect.preview.kind',
    'knownGap.id',
    'knownGap.layers',
    'knownGap.note',
  ]) {
    assert.ok(
      problems.some((p) => p.includes(needle)),
      `expected a problem mentioning ${needle}, got ${problems.join(' | ')}`,
    );
  }
  assert.ok(validateCase({ kind: 'mutation', id: 'x-1' }).some((p) => p.startsWith('base:')));
});

test('patch: add/replace/remove on objects and arrays, escapes and append', () => {
  const doc = { a: { 'b/c': [1, 2], '~t': 3 }, list: [{ id: 'x' }] };
  const out = /** @type {any} */ (
    applyPatch(doc, [
      { op: 'replace', path: '/a/b~1c/0', value: 9 },
      { op: 'add', path: '/a/b~1c/-', value: 7 },
      { op: 'remove', path: '/a/~0t' },
      { op: 'add', path: '/list/0/id2', value: 'y' },
      { op: 'add', path: '/list/0', value: { id: 'first' } },
    ])
  );
  assert.deepEqual(out, {
    a: { 'b/c': [9, 2, 7] },
    list: [{ id: 'first' }, { id: 'x', id2: 'y' }],
  });
  assert.deepEqual(doc.a['b/c'], [1, 2], 'the input document must not be mutated');
  assert.throws(
    () => applyPatch(doc, [{ op: 'replace', path: '/missing', value: 1 }]),
    /missing member/,
  );
  assert.throws(() => applyPatch(doc, [{ op: 'remove', path: '/a/zzz' }]), /missing member/);
});

test('schema: empty expectations, typoed finding refs, and unanchored deviations fail closed', () => {
  for (const edit of [
    (c) => {
      c.expect = {};
    },
    (c) => {
      c.expect = { browser: {} };
    },
    (c) => {
      c.expect.request.must = [{ id: 'x', paht: 'imp[0]' }];
    },
    (c) => {
      c.expect.request.must = [''];
    },
    (c) => {
      c.expect.request.must = [{ id: 'x', count: 0 }];
    },
    (c) => {
      c.knownGap = { id: 'DEF-001', layers: ['core'], note: 'test' };
    },
    (c) => {
      c.knownGap = {
        id: 'DEF-001',
        layers: ['core'],
        note: 'test',
        matches: { core: ['anything'] },
      };
    },
    (c) => {
      c.knownGap = {
        id: 'DEF-001',
        layers: ['core', 'http'],
        note: 'test',
        matches: { core: ['^x$'] },
      };
    },
    (c) => {
      c.expect.crosscheck.mustIssueAt = [''];
    },
  ]) {
    const c = basePair();
    edit(c);
    assert.ok(validateCase(c).length, JSON.stringify(c.expect));
  }
  const c = basePair();
  c.knownGap = {
    id: 'DEF-001',
    layers: ['core', 'http'],
    note: 'test',
    matches: { core: ['^core missing$'], http: ['^http missing$'] },
  };
  c.expect.preview = {
    kind: 'markup',
    rendered: 'full',
    mediaPlays: 'n/a',
    bids: [{ seatIndex: 0, bidIndex: 1, marker: 'second' }],
  };
  assert.deepEqual(validateCase(c), []);
});

test('patch: invalid pointers, inherited traversal, root operations, and array aliases are rejected', () => {
  for (const pointer of ['/list/01', '/list/1e0', '/list/-', '/list/', '/bad~2key']) {
    assert.throws(() => applyPatch({ list: [1, 2] }, [{ op: 'replace', path: pointer, value: 3 }]));
  }
  assert.throws(
    () => applyPatch({}, [{ op: 'add', path: '/__proto__/corpusPolluted', value: true }]),
    /path not found/,
  );
  assert.equal(Object.prototype['corpusPolluted'], undefined);
  assert.throws(
    () => applyPatch({}, [{ op: 'replace', path: '/constructor', value: 1 }]),
    /missing member/,
  );
  assert.throws(() => applyPatch({}, [{ op: 'copy', path: '', value: 1 }]), /unsupported op/);
  const literal = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { safe: true } }]);
  assert.equal(Object.getPrototypeOf(literal), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(literal, '__proto__').value, { safe: true });
});

test('oracle: exact bid path, side, params, ok, count and negative issue severity are independently checked', () => {
  const finding = {
    id: 'crosscheck.bid.size_match',
    path: 'seatbid[1].bid[2].w',
    level: 'ok',
    ok: true,
    params: { width: 300, extra: 1 },
    location: { primary: { side: 'response' } },
  };
  const actual = { crosscheck: [finding] };
  const ref = {
    id: finding.id,
    path: finding.path,
    level: 'ok',
    side: 'response',
    ok: true,
    params: { width: 300 },
    count: 1,
  };
  assert.deepEqual(evaluate(actual, { crosscheck: { must: [ref] } }).failures, []);
  for (const override of [
    { path: 'seatbid[0].bid[0].w' },
    { side: 'request' },
    { ok: false },
    { params: { width: 320 } },
    { count: 2 },
  ]) {
    assert.equal(
      evaluate(actual, { crosscheck: { must: [{ ...ref, ...override }] } }).failures.length,
      1,
    );
  }
  assert.equal(
    evaluate({ crosscheck: [finding, finding] }, { crosscheck: { must: [ref] } }).failures.length,
    1,
  );
  assert.equal(
    evaluate(actual, { crosscheck: { mustIssueAt: [finding.path] } }).failures.length,
    1,
  );
  assert.equal(
    evaluate(
      { crosscheck: [{ ...finding, level: 'warn', ok: true }] },
      { crosscheck: { mustIssueAt: [finding.path] } },
    ).failures.length,
    1,
  );
  assert.deepEqual(
    evaluate(
      { crosscheck: [{ ...finding, level: 'warn', ok: false }] },
      { crosscheck: { mustIssueAt: [finding.path] } },
    ).failures,
    [],
  );
  assert.equal(
    evaluate(
      { request: { findings: [{ id: 'x', path: 'imp[0]', level: 'info' }] } },
      { request: { mustIssueAt: ['imp[0]'] } },
    ).failures.length,
    1,
  );
});

test('known gaps: each layer and every required signature remains independently guarded', () => {
  const c = {
    meta: {
      knownGap: {
        id: 'DEF-001',
        layers: ['core', 'http'],
        matches: { core: ['^missing A$', '^missing B$'], http: ['^HTTP failure$'] },
      },
    },
  };
  const gap = gapFor(c, 'core');
  assert.equal(deviationVerdict(['missing A', 'missing B'], gap).stillPresent, true);
  assert.equal(deviationVerdict(['missing A'], gap).stillPresent, false);
  assert.equal(deviationVerdict(['missing A', 'missing B', 'unrelated'], gap).stillPresent, false);
  assert.equal(deviationVerdict([], gap).stillPresent, false);
  assert.equal(deviationVerdict(['missing A', 'missing B'], gapFor(c, 'http')).stillPresent, false);
});

test('Core adapter: raw JSON validates with rawText and vendor pairs do not crosscheck', () => {
  const base = basePair();
  const calls = [];
  const core = {
    validate: (value, opts) => {
      calls.push({ op: 'validate', value, opts });
      return {
        type: 'x',
        findings: [],
        urlRequest: typeof value === 'string' ? { canonical: true } : undefined,
      };
    },
    crosscheck: (req, res) => {
      calls.push({ op: 'crosscheck', req, res });
      return [];
    },
    detectFormat: (value) => {
      calls.push({ op: 'format', value });
      return { formats: value.canonical ? ['push'] : [] };
    },
  };
  const raw = '{ "id":"r", "id":"r" }';
  const c = {
    id: 'raw',
    kind: /** @type {'mutation'} */ ('mutation'),
    meta: base,
    rawRequest: raw,
    response: base.response,
    file: 'inline',
  };
  runCore(c, { core });
  assert.equal(calls[0].opts.rawText, raw);
  assert.ok(calls.some((call) => call.op === 'crosscheck'));
  calls.length = 0;
  const vendor = {
    ...c,
    meta: { ...base, reference: { pairApplicability: { kind: 'vendor-request-response' } } },
  };
  runCore(vendor, { core });
  assert.ok(!calls.some((call) => call.op === 'crosscheck'));
  assert.equal(
    calls.find((call) => call.op === 'validate' && call.value === base.response).opts.pairReq,
    undefined,
  );
  calls.length = 0;
  const url = { ...c, rawRequest: undefined, request: 'https://example.test/?zone=1' };
  assert.deepEqual(runCore(url, { core }).format.formats, ['push']);
  const malformed = { ...c, rawRequest: '{' };
  assert.equal(coreApplicability(malformed).applicable, false);
  assert.throws(() => runCore(malformed, { core }), /Core not applicable/);
  assert.equal(
    coreApplicability({ ...c, meta: { expect: { browser: { state: 'failed' } } } }).applicable,
    false,
  );
});

test('materialization: ineffective mutations, scenario drift and false parse expectations fail', () => {
  const base = basePair();
  const bases = new Map([[base.id, base]]);
  const mutation = {
    ...base,
    kind: 'mutation',
    id: 'self-mutation',
    base: base.id,
    patch: { request: [{ op: 'replace', path: '/id', value: 'r' }] },
  };
  assert.throws(() => materializeMutation(mutation, bases, 'inline'), /does not change/);
  assert.throws(
    () => materializeMutation({ ...mutation, patch: { request: null } }, bases, 'inline'),
    /scenario/,
  );
  assert.throws(
    () =>
      materializeMutation(
        {
          ...mutation,
          patch: { rawRequest: '{}' },
          expect: { request: { parse: 'invalid-json' }, response: base.expect.response },
        },
        bases,
        'inline',
      ),
    /input parses/,
  );
  const valid = materializeMutation(
    { ...mutation, patch: { request: [{ op: 'replace', path: '/id', value: 'different' }] } },
    bases,
    'inline',
  );
  assert.equal(valid.request.id, 'different');
  assert.equal(base.request.id, 'r');
});

test('loader: a known gap requires a matching ledger entry and explicit case membership', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-loader-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'pairs'));
  const c = basePair();
  c.knownGap = {
    id: 'DEF-001',
    layers: ['core'],
    note: 'fixture gap',
    matches: { core: ['^missing$'] },
  };
  fs.writeFileSync(path.join(dir, 'pairs', `${c.id}.json`), JSON.stringify(c));
  const opts = { corpusDir: dir, caseFilter: '', formatFilter: '' };
  assert.throws(() => loadCorpus(opts), /not recorded/);
  const ledger = {
    schemaVersion: 1,
    gaps: { 'DEF-001': { id: 'DEF-001', title: 'Fixture gap', cases: [] } },
  };
  fs.writeFileSync(path.join(dir, 'known-gaps.json'), JSON.stringify(ledger));
  assert.throws(() => loadCorpus(opts), /does not list case/);
  ledger.gaps['DEF-001'].cases.push(c.id);
  fs.writeFileSync(path.join(dir, 'known-gaps.json'), JSON.stringify(ledger));
  assert.equal(loadCorpus(opts).all.length, 1);
});

test('oracle: must/mustNot/prefix/status/maxLevel/format are all enforced', () => {
  const actual = {
    request: {
      type: 'oRTB BidRequest',
      version: { version: '2.6' },
      status: 'warnings',
      findings: [
        { id: 'a.b', level: 'warning', path: 'x' },
        { id: 'c.d', level: 'info', path: 'y' },
      ],
    },
    crosscheck: [{ id: 'crosscheck.id_match', level: 'ok', ok: true, path: 'id' }],
    format: { formats: ['banner'], contexts: ['web'], protocols: [] },
  };
  assert.deepEqual(
    evaluate(actual, {
      request: {
        type: 'oRTB BidRequest',
        version: '2.6',
        status: 'warnings',
        maxLevel: 'warning',
        must: [{ id: 'a.b', path: 'x', level: 'warning' }, 'c.d'],
        mustNot: ['z.z'],
        mustNotPrefix: ['q.'],
      },
      crosscheck: { must: ['crosscheck.id_match'], mustNot: ['crosscheck.id_mismatch'] },
      format: { formats: ['banner'], contexts: ['web'], protocols: [] },
    }).failures,
    [],
  );
  const { failures } = evaluate(actual, {
    request: {
      status: 'clean',
      maxLevel: 'info',
      must: [{ id: 'a.b', path: 'other' }],
      mustNot: ['c.d'],
      mustNotPrefix: ['a.'],
    },
    crosscheck: { mustNot: [{ id: 'crosscheck.id_match', level: 'ok' }] },
    format: { formats: ['banner', 'video'] },
  });
  assert.equal(failures.length, 7, failures.join('\n'));
});

test('oracle: consistency checks detect contradictions without requiring product defects to persist', () => {
  const pricePath = 'seatbid[1].bid[2].price';
  const actual = {
    response: {
      findings: [
        { id: 'err-bid-price-below-floor', path: pricePath, level: 'error', params: { floor: 2 } },
        { id: 'response.bid.price_invalid', path: pricePath, level: 'error' },
      ],
    },
    crosscheck: [{ id: 'crosscheck.bid.above_floor', path: pricePath, level: 'ok', ok: true }],
  };
  assert.equal(evaluate(actual, { consistency: ['deal-floor-governs'] }).failures.length, 2);
  assert.equal(
    evaluate(actual, { consistency: ['price-invalid-blocks-floor-verdict'] }).failures.length,
    2,
  );
  const repaired = { response: { findings: [] }, crosscheck: [] };
  assert.deepEqual(
    evaluate(repaired, { consistency: Object.keys(CONSISTENCY_RULES) }).failures,
    [],
  );
  const unresolved = {
    crosscheck: [
      { id: 'crosscheck.bid.impid_unresolved', path: 'seatbid[1].bid[2].item' },
      { id: 'crosscheck.bid.above_floor', path: pricePath, ok: true },
      { id: 'crosscheck.bid.above_floor', path: 'seatbid[1].bid[1].price', ok: true },
    ],
  };
  const failures = evaluate(unresolved, { consistency: ['unresolved-impid-not-filled'] }).failures;
  assert.equal(failures.length, 1);
  assert.ok(
    !failures[0].includes('bid[1].price'),
    'another bid must not be attributed to the unresolved bid',
  );
});

test('oracle: preview expectations compare kind/rendered/mediaPlays/assets and demand a visible limitation', () => {
  const expect = {
    kind: 'markup',
    rendered: 'partial',
    mediaPlays: 'n/a',
    assets: { dataImagesLoaded: 1 },
    limitation: 'remote images refused by the frame policy',
  };
  assert.deepEqual(
    evaluatePreview(
      {
        kind: 'markup',
        rendered: 'partial',
        mediaPlays: 'n/a',
        assets: { dataImagesLoaded: 1 },
        limitationShown: true,
      },
      expect,
    ).failures,
    [],
  );
  const { failures } = evaluatePreview(
    {
      kind: 'markup',
      rendered: 'empty',
      mediaPlays: 'n/a',
      assets: { dataImagesLoaded: 0 },
      limitationShown: false,
    },
    expect,
  );
  assert.equal(failures.length, 3, failures.join('\n'));
});

test('load: the committed corpus is schema-valid, ids are unique and file names match ids', () => {
  const corpus = loadCorpus({ caseFilter: '', formatFilter: '' });
  assert.ok(Array.isArray(corpus.pairs));
  const ids = new Set();
  for (const c of corpus.all) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
  }
});

test('browser: declared sandbox refusals tolerate only the built-in Chrome refusal messages', () => {
  const { classifySandboxRefusal, SANDBOX_REFUSALS } = require('./corpus/lib/browser');
  assert.deepEqual(Object.keys(SANDBOX_REFUSALS).sort(), ['navigation', 'popup']);
  const popup =
    "Blocked opening 'https://advertiser.example.test/offers/x' in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set.";
  const nav =
    "SecurityError: Failed to set a named property 'href' on 'Location': The current window does not have permission to navigate the target frame to 'https://advertiser.example.test/offers/x'.";
  assert.equal(classifySandboxRefusal(popup, ['popup']), 'popup');
  assert.equal(
    classifySandboxRefusal(popup, ['navigation']),
    null,
    'a popup refusal is not a navigation refusal',
  );
  assert.equal(classifySandboxRefusal(nav, ['navigation']), 'navigation');
  assert.equal(
    classifySandboxRefusal(popup, []),
    null,
    'nothing is tolerated without a declaration',
  );
  assert.equal(
    classifySandboxRefusal("TypeError: Cannot read properties of null (reading 'cur')", [
      'popup',
      'navigation',
    ]),
    null,
    'an unrelated runtime error is never tolerated',
  );
  assert.equal(
    classifySandboxRefusal(popup + ' extra', ['popup']),
    null,
    'the shape is exact, not a prefix',
  );
  const { validateCase } = require('./corpus/lib/schema');
  const c = basePair();
  c.expect.browser = { sandboxRefusals: ['popup'] };
  assert.deepEqual(validateCase(c), []);
  c.expect.browser = { sandboxRefusals: ['.*'] };
  assert.ok(
    validateCase(c).some((p) => p.includes('sandboxRefusals')),
    'free-form patterns are rejected',
  );
  c.expect.browser = { allowConsole: ['x'] };
  assert.ok(
    validateCase(c).some((p) => p.includes('unknown key')),
    'no unrestricted console allowlist exists',
  );
});
