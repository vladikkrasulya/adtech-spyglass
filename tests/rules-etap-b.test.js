'use strict';

/**
 * tests/rules-etap-b.test.js — Etap B: SChain + EIDs + AdPod plugins.
 *
 * Structure per plugin:
 *   - happy-path (valid input → no finding from that plugin)
 *   - missing required field
 *   - wrong type
 *   - boundary / edge cases
 *
 * Asserts on stable `id` and `path`, never on message text.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const schain = require('@kyivtech/spyglass-core/rules/schain');
const eids = require('@kyivtech/spyglass-core/rules/eids');
const adpod = require('@kyivtech/spyglass-core/rules/adpod');
const { listPlugins } = require('@kyivtech/spyglass-core/rules');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid SChain object */
const validSchain = () => ({
  ver: '1.0',
  complete: 1,
  nodes: [{ asi: 'openx.com', sid: 'pub-12345', hp: 1, rid: 'abc123', domain: 'openx.com' }],
});

/** Build a minimal valid request that carries a schain */
const reqWithSchain = (sc) => ({
  source: { ext: { schain: sc || validSchain() } },
});

/** Build a minimal valid EIDs array */
const validEids = () => [
  {
    source: 'liveramp.com',
    uids: [{ id: 'abc123', atype: 3 }],
  },
];

/** Build a request with EIDs */
const reqWithEids = (eidsArr) => ({
  user: { ext: { eids: eidsArr !== undefined ? eidsArr : validEids() } },
});

/** Build a valid imp.video with pod fields */
const validVideoWithPod = () => ({
  id: 'imp-1',
  video: {
    mimes: ['video/mp4'],
    podid: 'pod-a',
    podseq: 1,
    minduration: 5,
    maxduration: 30,
  },
});

// ─── SChain plugin registration ─────────────────────────────────────────────

test('schain: plugin is registered with correct metadata', () => {
  const meta = listPlugins().find((p) => p.id === 'schain');
  assert.ok(meta, 'schain plugin should appear in listPlugins()');
  assert.deepEqual(meta.appliesTo, ['ORTB_REQUEST']);
  assert.ok(meta.description && meta.description.length > 0);
});

// ─── SChain happy path ───────────────────────────────────────────────────────

test('schain: valid source.ext.schain → no schain findings', () => {
  const out = schain.validate(reqWithSchain(validSchain()));
  const ids = out
    .map((f) => f.id)
    .filter((id) => id.startsWith('err-schain') || id.startsWith('warn-schain'));
  assert.deepEqual(ids, []);
});

test('schain: valid ext.schain (oRTB 3.0 path) → no findings', () => {
  const req = { ext: { schain: validSchain() } };
  const out = schain.validate(req);
  assert.deepEqual(out, []);
});

test('schain: no schain present at all → no findings', () => {
  assert.deepEqual(schain.validate({ source: {} }), []);
  assert.deepEqual(schain.validate({}), []);
  assert.deepEqual(schain.validate(null), []);
});

// ─── SChain ver ─────────────────────────────────────────────────────────────

test('schain: ver missing → err-schain-version', () => {
  const sc = validSchain();
  delete sc.ver;
  const out = schain.validate(reqWithSchain(sc));
  const f = out.find((x) => x.id === 'err-schain-version');
  assert.ok(f, 'err-schain-version should fire');
  assert.equal(f.level, 'error');
  assert.equal(f.path, 'source.ext.schain.ver');
});

test('schain: ver = "2.0" → err-schain-version', () => {
  const sc = validSchain();
  sc.ver = '2.0';
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-version'));
});

test('schain: ver = 1 (number instead of string) → err-schain-version', () => {
  const sc = validSchain();
  sc.ver = 1;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-version'));
});

// ─── SChain complete ─────────────────────────────────────────────────────────

test('schain: complete missing → err-schain-complete', () => {
  const sc = validSchain();
  delete sc.complete;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-complete'));
});

test('schain: complete = 2 → err-schain-complete', () => {
  const sc = validSchain();
  sc.complete = 2;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-complete'));
});

test('schain: complete = 0 → no err-schain-complete', () => {
  const sc = validSchain();
  sc.complete = 0;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(!out.find((x) => x.id === 'err-schain-complete'));
});

// ─── SChain nodes ────────────────────────────────────────────────────────────

test('schain: nodes missing → err-schain-nodes-empty', () => {
  const sc = validSchain();
  delete sc.nodes;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-nodes-empty'));
});

test('schain: nodes = [] → err-schain-nodes-empty', () => {
  const sc = validSchain();
  sc.nodes = [];
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-nodes-empty'));
});

// ─── SChain node fields ──────────────────────────────────────────────────────

test('schain: node.asi missing → err-schain-node-asi, path includes index', () => {
  const sc = validSchain();
  delete sc.nodes[0].asi;
  const out = schain.validate(reqWithSchain(sc));
  const f = out.find((x) => x.id === 'err-schain-node-asi');
  assert.ok(f);
  assert.equal(f.path, 'source.ext.schain.nodes[0].asi');
});

test('schain: node.asi = "not_a_domain" → err-schain-node-asi', () => {
  const sc = validSchain();
  sc.nodes[0].asi = 'not_a_domain';
  assert.ok(schain.validate(reqWithSchain(sc)).find((x) => x.id === 'err-schain-node-asi'));
});

test('schain: node.sid missing → err-schain-node-sid', () => {
  const sc = validSchain();
  delete sc.nodes[0].sid;
  assert.ok(schain.validate(reqWithSchain(sc)).find((x) => x.id === 'err-schain-node-sid'));
});

test('schain: node.hp missing → err-schain-node-hp', () => {
  const sc = validSchain();
  delete sc.nodes[0].hp;
  assert.ok(schain.validate(reqWithSchain(sc)).find((x) => x.id === 'err-schain-node-hp'));
});

test('schain: node.hp = 2 → err-schain-node-hp (boundary)', () => {
  const sc = validSchain();
  sc.nodes[0].hp = 2;
  assert.ok(schain.validate(reqWithSchain(sc)).find((x) => x.id === 'err-schain-node-hp'));
});

test('schain: node.rid absent → warn-schain-node-rid-missing', () => {
  const sc = validSchain();
  delete sc.nodes[0].rid;
  const out = schain.validate(reqWithSchain(sc));
  const f = out.find((x) => x.id === 'warn-schain-node-rid-missing');
  assert.ok(f);
  assert.equal(f.level, 'warning');
});

test('schain: node.domain absent → warn-schain-node-domain-missing', () => {
  const sc = validSchain();
  delete sc.nodes[0].domain;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'warn-schain-node-domain-missing'));
});

test('schain: second node (idx=1) errors carry correct index in path', () => {
  const sc = validSchain();
  sc.nodes.push({
    asi: 'rubiconproject.com',
    sid: 'seller-1',
    hp: 1,
    rid: 'r1',
    domain: 'rubiconproject.com',
  });
  delete sc.nodes[1].sid; // corrupt second node
  const out = schain.validate(reqWithSchain(sc));
  const f = out.find((x) => x.id === 'err-schain-node-sid');
  assert.ok(f);
  assert.equal(f.path, 'source.ext.schain.nodes[1].sid');
});

// ─── SChain domain helper ────────────────────────────────────────────────────

test('schain _isValidDomain: valid domains', () => {
  assert.equal(schain._isValidDomain('example.com'), true);
  assert.equal(schain._isValidDomain('sub.example.co.uk'), true);
  assert.equal(schain._isValidDomain('openx.com'), true);
});

test('schain _isValidDomain: invalid domains', () => {
  assert.equal(schain._isValidDomain(''), false);
  assert.equal(schain._isValidDomain('no_dot'), false);
  assert.equal(schain._isValidDomain('http://example.com'), false);
  assert.equal(schain._isValidDomain(null), false);
  assert.equal(schain._isValidDomain(42), false);
});

// ─── EIDs plugin registration ────────────────────────────────────────────────

test('eids: plugin is registered with correct metadata', () => {
  const meta = listPlugins().find((p) => p.id === 'eids');
  assert.ok(meta, 'eids plugin should appear in listPlugins()');
  assert.deepEqual(meta.appliesTo, ['ORTB_REQUEST']);
});

// ─── EIDs happy path ─────────────────────────────────────────────────────────

test('eids: valid user.ext.eids → no findings', () => {
  const out = eids.validate(reqWithEids());
  assert.deepEqual(out, []);
});

test('eids: no user.ext.eids at all → no findings', () => {
  assert.deepEqual(eids.validate({}), []);
  assert.deepEqual(eids.validate({ user: {} }), []);
  assert.deepEqual(eids.validate({ user: { ext: {} } }), []);
});

// ─── EIDs not-array ──────────────────────────────────────────────────────────

test('eids: eids is an object, not array → err-eids-not-array', () => {
  const out = eids.validate(reqWithEids({ source: 'bad.com' }));
  const f = out.find((x) => x.id === 'err-eids-not-array');
  assert.ok(f);
  assert.equal(f.level, 'error');
  assert.equal(f.path, 'user.ext.eids');
});

test('eids: eids is a string → err-eids-not-array', () => {
  const out = eids.validate(reqWithEids('oops'));
  assert.ok(out.find((x) => x.id === 'err-eids-not-array'));
});

// ─── EIDs source ─────────────────────────────────────────────────────────────

test('eids: eid.source missing → err-eids-source-missing', () => {
  const e = validEids();
  delete e[0].source;
  const out = eids.validate(reqWithEids(e));
  const f = out.find((x) => x.id === 'err-eids-source-missing');
  assert.ok(f);
  assert.equal(f.path, 'user.ext.eids[0].source');
});

test('eids: eid.source empty string → err-eids-source-missing', () => {
  const e = validEids();
  e[0].source = '';
  assert.ok(eids.validate(reqWithEids(e)).find((x) => x.id === 'err-eids-source-missing'));
});

// ─── EIDs uids ───────────────────────────────────────────────────────────────

test('eids: uids missing → err-eids-uids-empty', () => {
  const e = validEids();
  delete e[0].uids;
  const out = eids.validate(reqWithEids(e));
  assert.ok(out.find((x) => x.id === 'err-eids-uids-empty'));
});

test('eids: uids = [] → err-eids-uids-empty', () => {
  const e = validEids();
  e[0].uids = [];
  assert.ok(eids.validate(reqWithEids(e)).find((x) => x.id === 'err-eids-uids-empty'));
});

// ─── EIDs uid.id ─────────────────────────────────────────────────────────────

test('eids: uid.id missing → err-eids-uid-id-missing', () => {
  const e = validEids();
  delete e[0].uids[0].id;
  const out = eids.validate(reqWithEids(e));
  const f = out.find((x) => x.id === 'err-eids-uid-id-missing');
  assert.ok(f);
  assert.equal(f.path, 'user.ext.eids[0].uids[0].id');
});

test('eids: uid.id empty string → err-eids-uid-id-missing', () => {
  const e = validEids();
  e[0].uids[0].id = '';
  assert.ok(eids.validate(reqWithEids(e)).find((x) => x.id === 'err-eids-uid-id-missing'));
});

// ─── EIDs uid.atype ──────────────────────────────────────────────────────────

test('eids: uid.atype = 1,2,3 → no error', () => {
  for (const atype of [1, 2, 3]) {
    const e = validEids();
    e[0].uids[0].atype = atype;
    const out = eids.validate(reqWithEids(e));
    assert.ok(
      !out.find((x) => x.id === 'err-eids-uid-atype-invalid'),
      `atype ${atype} should be valid`,
    );
  }
});

test('eids: uid.atype = 4 → err-eids-uid-atype-invalid (promoted to error)', () => {
  const e = validEids();
  e[0].uids[0].atype = 4;
  const f = eids.validate(reqWithEids(e)).find((x) => x.id === 'err-eids-uid-atype-invalid');
  assert.ok(f);
  assert.equal(f.level, 'error');
});

test('eids: uid.atype = 0 → err-eids-uid-atype-invalid', () => {
  const e = validEids();
  e[0].uids[0].atype = 0;
  assert.ok(eids.validate(reqWithEids(e)).find((x) => x.id === 'err-eids-uid-atype-invalid'));
});

test('eids: uid.atype = "1" (string) → err-eids-uid-atype-invalid', () => {
  const e = validEids();
  e[0].uids[0].atype = '1';
  assert.ok(eids.validate(reqWithEids(e)).find((x) => x.id === 'err-eids-uid-atype-invalid'));
});

test('eids: uid.atype absent → no error', () => {
  const e = validEids();
  delete e[0].uids[0].atype;
  const out = eids.validate(reqWithEids(e));
  assert.ok(!out.find((x) => x.id === 'err-eids-uid-atype-invalid'));
});

// ─── AdPod plugin registration ───────────────────────────────────────────────

test('adpod: plugin is registered with correct metadata', () => {
  const meta = listPlugins().find((p) => p.id === 'adpod');
  assert.ok(meta, 'adpod plugin should appear in listPlugins()');
  assert.deepEqual(meta.appliesTo, ['ORTB_REQUEST']);
});

// ─── AdPod happy paths ───────────────────────────────────────────────────────

test('adpod: valid imp.video with full pod fields → no pod findings', () => {
  const out = adpod.validate({ imp: [validVideoWithPod()] });
  assert.deepEqual(out, []);
});

test('adpod: imp.video with no pod fields → no findings', () => {
  const out = adpod.validate({ imp: [{ id: 'i1', video: { mimes: ['video/mp4'] } }] });
  assert.deepEqual(out, []);
});

test('adpod: request with no imp → no findings', () => {
  assert.deepEqual(adpod.validate({}), []);
  assert.deepEqual(adpod.validate(null), []);
});

// ─── AdPod podid/podseq coupling ────────────────────────────────────────────

test('adpod: podid present alone → no err-pod-id-seq-mismatch (removed)', () => {
  // err-pod-id-seq-mismatch removed per audit — IAB does not require podid/podseq pairing
  const req = { imp: [{ id: 'i1', video: { podid: 'pod-a' } }] };
  const out = adpod.validate(req);
  assert.ok(!out.find((x) => x.id === 'err-pod-id-seq-mismatch'));
});

test('adpod: podseq present alone → no err-pod-id-seq-mismatch (removed)', () => {
  // err-pod-id-seq-mismatch removed — podid/podseq are independent optional fields
  const req = { imp: [{ id: 'i1', video: { podseq: 2 } }] };
  const out = adpod.validate(req);
  assert.ok(!out.find((x) => x.id === 'err-pod-id-seq-mismatch'));
});

test('adpod: both podid and podseq present → no findings', () => {
  const req = { imp: [{ id: 'i1', video: { podid: 'pod-1', podseq: 1 } }] };
  assert.ok(!adpod.validate(req).find((x) => x.id === 'err-pod-id-seq-mismatch'));
});

// ─── AdPod podseq validity ───────────────────────────────────────────────────

test('adpod: podseq = 0 → no err-podseq-invalid (0 is valid)', () => {
  const req = { imp: [{ id: 'i1', video: { podid: 'pod-1', podseq: 0 } }] };
  assert.ok(!adpod.validate(req).find((x) => x.id === 'err-podseq-invalid'));
});

test('adpod: podseq = -1 → err-podseq-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { podid: 'pod-1', podseq: -1 } }] };
  assert.ok(adpod.validate(req).find((x) => x.id === 'err-podseq-invalid'));
});

test('adpod: podseq = "first" (string) → err-podseq-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { podid: 'pod-1', podseq: 'first' } }] };
  assert.ok(adpod.validate(req).find((x) => x.id === 'err-podseq-invalid'));
});

test('adpod: podseq = 1.5 (float) → err-podseq-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { podid: 'pod-1', podseq: 1.5 } }] };
  assert.ok(adpod.validate(req).find((x) => x.id === 'err-podseq-invalid'));
});

// ─── AdPod duration lengths ──────────────────────────────────────────────────

test('adpod: minduration > maxduration → err-pod-len-mismatch', () => {
  const req = { imp: [{ id: 'i1', video: { minduration: 30, maxduration: 15 } }] };
  const f = adpod.validate(req).find((x) => x.id === 'err-pod-len-mismatch');
  assert.ok(f);
  assert.equal(f.level, 'error');
  assert.equal(f.params.min, 30);
  assert.equal(f.params.max, 15);
});

test('adpod: minduration === maxduration → no mismatch (edge case)', () => {
  const req = { imp: [{ id: 'i1', video: { minduration: 15, maxduration: 15 } }] };
  assert.ok(!adpod.validate(req).find((x) => x.id === 'err-pod-len-mismatch'));
});

test('adpod: minduration < maxduration → no mismatch', () => {
  const req = { imp: [{ id: 'i1', video: { minduration: 5, maxduration: 30 } }] };
  assert.ok(!adpod.validate(req).find((x) => x.id === 'err-pod-len-mismatch'));
});

test('adpod: minduration = 0 → err-pod-len-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { minduration: 0 } }] };
  const f = adpod.validate(req).find((x) => x.id === 'err-pod-len-invalid');
  assert.ok(f);
  assert.equal(f.params.field, 'minduration');
});

test('adpod: maxduration = -5 → err-pod-len-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { maxduration: -5 } }] };
  assert.ok(adpod.validate(req).find((x) => x.id === 'err-pod-len-invalid'));
});

test('adpod: maxduration = "30" (string) → err-pod-len-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { maxduration: '30' } }] };
  assert.ok(adpod.validate(req).find((x) => x.id === 'err-pod-len-invalid'));
});

// ─── AdPod audio path ────────────────────────────────────────────────────────

test('adpod: imp.audio podid alone → no mismatch finding (coupling removed)', () => {
  const req = { imp: [{ id: 'i1', audio: { mimes: ['audio/mp4'], podid: 'p1' } }] };
  const out = adpod.validate(req);
  assert.ok(!out.find((x) => x.id === 'err-pod-id-seq-mismatch'));
});

test('adpod: imp.audio valid pod fields → no findings', () => {
  const req = {
    imp: [{ id: 'i1', audio: { podid: 'p1', podseq: 2, minduration: 10, maxduration: 60 } }],
  };
  assert.deepEqual(adpod.validate(req), []);
});

// ─── AdPod multi-imp path indexing ───────────────────────────────────────────

test('adpod: second imp[1].video with invalid minduration → path is correct in finding', () => {
  const req = {
    imp: [
      { id: 'i0', video: { mimes: ['video/mp4'] } }, // clean
      { id: 'i1', video: { minduration: 0 } }, // invalid (0 not allowed)
    ],
  };
  const f = adpod.validate(req).find((x) => x.id === 'err-pod-len-invalid');
  assert.ok(f);
  assert.ok(f.path.startsWith('imp[1].video'));
});

// ─── NEW: adpod poddur + maxseq coverage ────────────────────────────────────

test('adpod: poddur = 120 (positive int) → no findings', () => {
  const req = { imp: [{ id: 'i1', video: { poddur: 120 } }] };
  assert.deepEqual(adpod.validate(req), []);
});

test('adpod: poddur = 0 → err-pod-len-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { poddur: 0 } }] };
  const f = adpod.validate(req).find((x) => x.id === 'err-pod-len-invalid');
  assert.ok(f);
  assert.equal(f.params.field, 'poddur');
});

test('adpod: maxseq = 3 (positive int) → no findings', () => {
  const req = { imp: [{ id: 'i1', video: { maxseq: 3 } }] };
  assert.deepEqual(adpod.validate(req), []);
});

test('adpod: maxseq = -1 → err-pod-len-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { maxseq: -1 } }] };
  const f = adpod.validate(req).find((x) => x.id === 'err-pod-len-invalid');
  assert.ok(f);
  assert.equal(f.params.field, 'maxseq');
});

test('adpod: minduration=5, maxduration=30 → no findings (valid range)', () => {
  const req = { imp: [{ id: 'i1', video: { minduration: 5, maxduration: 30 } }] };
  assert.deepEqual(adpod.validate(req), []);
});

test('adpod: podid =  (empty string) → err-podid-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { podid: '' } }] };
  const f = adpod.validate(req).find((x) => x.id === 'err-podid-invalid');
  assert.ok(f, 'err-podid-invalid should fire for empty string');
});

test('adpod: podid = 0 (zero int) → err-podid-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { podid: 0 } }] };
  const f = adpod.validate(req).find((x) => x.id === 'err-podid-invalid');
  assert.ok(f, 'err-podid-invalid should fire for 0 (not positive)');
});

test('adpod: podid = 5 (positive int) → no err-podid-invalid', () => {
  const req = { imp: [{ id: 'i1', video: { podid: 5 } }] };
  assert.ok(!adpod.validate(req).find((x) => x.id === 'err-podid-invalid'));
});

// ─── NEW: schain native path (source.schain oRTB 2.6) ───────────────────────

test('schain: native source.schain (oRTB 2.6) → validates correctly', () => {
  const req = { source: { schain: validSchain() } };
  const out = schain.validate(req);
  const ids = out
    .map((f) => f.id)
    .filter((id) => id.startsWith('err-schain') || id.startsWith('warn-schain'));
  assert.deepEqual(ids, []);
});

test('schain: source.schain with bad ver → err-schain-version at source.schain.ver', () => {
  const sc = validSchain();
  sc.ver = '2.0';
  const req = { source: { schain: sc } };
  const out = schain.validate(req);
  const f = out.find((x) => x.id === 'err-schain-version');
  assert.ok(f);
  assert.equal(f.path, 'source.schain.ver');
});

test('schain: both source.schain and source.ext.schain → both validated', () => {
  const sc1 = validSchain();
  const sc2 = {
    ver: '2.0',
    complete: 1,
    nodes: [{ asi: 'openx.com', sid: 's1', hp: 1, rid: 'r', domain: 'openx.com' }],
  };
  const req = { source: { schain: sc1, ext: { schain: sc2 } } };
  const out = schain.validate(req);
  // sc1 is valid → no error from source.schain
  // sc2 has bad ver → err-schain-version from source.ext.schain
  const f = out.find((x) => x.id === 'err-schain-version' && x.path === 'source.ext.schain.ver');
  assert.ok(f, 'should find version error from legacy path');
  const nativeErrors = out.filter(
    (x) => x.id === 'err-schain-version' && x.path === 'source.schain.ver',
  );
  assert.equal(nativeErrors.length, 0, 'native schain should be clean');
});

// ─── NEW: schain type guards ─────────────────────────────────────────────────

test('schain: schain = false (boolean) → err-schain-invalid', () => {
  const req = { source: { schain: false } };
  const out = schain.validate(req);
  const f = out.find((x) => x.id === 'err-schain-invalid');
  assert.ok(f, 'err-schain-invalid should fire for non-object schain');
  assert.equal(f.level, 'error');
});

test('schain: schain = string → err-schain-invalid', () => {
  const req = { source: { ext: { schain: 'not-an-object' } } };
  const out = schain.validate(req);
  assert.ok(out.find((x) => x.id === 'err-schain-invalid'));
});

test('schain: nodes = [null] → err-schain-node-invalid', () => {
  const sc = { ver: '1.0', complete: 1, nodes: [null] };
  const out = schain.validate({ source: { ext: { schain: sc } } });
  const f = out.find((x) => x.id === 'err-schain-node-invalid');
  assert.ok(f, 'err-schain-node-invalid should fire for null node');
  assert.equal(f.level, 'error');
});

test('schain: nodes = [42] → err-schain-node-invalid', () => {
  const sc = { ver: '1.0', complete: 1, nodes: [42] };
  const out = schain.validate({ source: { ext: { schain: sc } } });
  assert.ok(out.find((x) => x.id === 'err-schain-node-invalid'));
});

// ─── NEW: eids native path (user.eids oRTB 2.6) ─────────────────────────────

test('eids: native user.eids (oRTB 2.6) → validates correctly', () => {
  const req = { user: { eids: validEids() } };
  const out = eids.validate(req);
  assert.deepEqual(out, []);
});

test('eids: user.eids with missing source → err-eids-source-missing at user.eids[0].source', () => {
  const e = validEids();
  delete e[0].source;
  const req = { user: { eids: e } };
  const out = eids.validate(req);
  const f = out.find((x) => x.id === 'err-eids-source-missing' && x.path === 'user.eids[0].source');
  assert.ok(f, 'should find source-missing at native user.eids path');
});

test('eids: both user.eids and user.ext.eids → both validated', () => {
  const goodEids = validEids();
  const badEids = [{ source: 42, uids: [{ id: 'x', atype: 1 }] }]; // source wrong type
  const req = { user: { eids: goodEids, ext: { eids: badEids } } };
  const out = eids.validate(req);
  // goodEids clean → no error from user.eids
  // badEids source wrong type → err-eids-source-invalid-type from user.ext.eids
  const f = out.find(
    (x) => x.id === 'err-eids-source-invalid-type' && x.path.includes('user.ext.eids'),
  );
  assert.ok(f, 'should find source-invalid-type from legacy ext path');
});

// ─── NEW: eids type guards ───────────────────────────────────────────────────

test('eids: eids = [null] → err-eids-entry-invalid', () => {
  const out = eids.validate(reqWithEids([null]));
  const f = out.find((x) => x.id === 'err-eids-entry-invalid');
  assert.ok(f, 'err-eids-entry-invalid should fire for null entry');
  assert.equal(f.level, 'error');
});

test('eids: eids = [42] → err-eids-entry-invalid', () => {
  const out = eids.validate(reqWithEids([42]));
  assert.ok(out.find((x) => x.id === 'err-eids-entry-invalid'));
});

test('eids: uids = [null] → err-eids-uid-invalid', () => {
  const e = validEids();
  e[0].uids = [null];
  const out = eids.validate(reqWithEids(e));
  const f = out.find((x) => x.id === 'err-eids-uid-invalid');
  assert.ok(f, 'err-eids-uid-invalid should fire for null uid');
  assert.equal(f.level, 'error');
});

// ─── NEW: eids mislabeling fixes ─────────────────────────────────────────────

test('eids: eid.source = 42 (number) → err-eids-source-invalid-type (NOT missing)', () => {
  const e = [{ source: 42, uids: [{ id: 'x', atype: 1 }] }];
  const out = eids.validate(reqWithEids(e));
  assert.ok(
    out.find((x) => x.id === 'err-eids-source-invalid-type'),
    'should find invalid-type, not missing',
  );
  assert.ok(
    !out.find((x) => x.id === 'err-eids-source-missing'),
    'should NOT find -missing for wrong-type source',
  );
});

test('eids: uid.id = 42 (number) → err-eids-uid-id-invalid-type (NOT missing)', () => {
  const e = validEids();
  e[0].uids[0].id = 42;
  const out = eids.validate(reqWithEids(e));
  assert.ok(
    out.find((x) => x.id === 'err-eids-uid-id-invalid-type'),
    'should find uid-id-invalid-type, not missing',
  );
  assert.ok(
    !out.find((x) => x.id === 'err-eids-uid-id-missing'),
    'should NOT find -missing for wrong-type id',
  );
});
