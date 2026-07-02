'use strict';

/**
 * tests/native-request.test.js — imp.native.request parsing (Native 1.0 wrapped
 * vs 1.1/1.2 bare root) and per-asset subtype validation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('@kyivtech/spyglass-core');

const findById = (findings, id) => findings.find((f) => f.id === id);
const findAllById = (findings, id) => findings.filter((f) => f.id === id);

function bidRequest(impOrImps) {
  const imps = Array.isArray(impOrImps) ? impOrImps : [impOrImps];
  return {
    id: 'req-native',
    imp: imps,
    site: { domain: 'native.example.com' },
    device: { ip: '198.51.100.1', ua: 'Mozilla/5.0', language: 'en' },
  };
}

function nativeImp(requestBody, { ver = '1.2', stringify = false, id = 'imp-1' } = {}) {
  return {
    id,
    native: {
      ver,
      request: stringify ? JSON.stringify(requestBody) : requestBody,
    },
  };
}

// ── Valid shapes ────────────────────────────────────────────────────────────

test('native request: valid wrapped Native 1.0 shape', () => {
  const req = bidRequest(
    nativeImp({
      native: {
        assets: [
          { id: 1, title: { len: 90 } },
          { id: 2, img: { type: 3, w: 300, h: 250 } },
        ],
      },
    }),
  );
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.native.assets_required'), undefined);
  assert.equal(findById(findings, 'imp.native.asset_type_required'), undefined);
});

test('native request: valid bare Native 1.1/1.2 root', () => {
  const req = bidRequest(
    nativeImp({
      assets: [
        { id: 1, title: { len: 90 } },
        { id: 2, data: { type: 2 } },
      ],
    }),
  );
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.native.assets_required'), undefined);
  assert.equal(findById(findings, 'imp.native.asset_type_required'), undefined);
});

test('native request: valid bare shape as JSON string', () => {
  const req = bidRequest(
    nativeImp(
      { assets: [{ id: 1, video: { mimes: ['video/mp4'], minduration: 5 } }] },
      {
        stringify: true,
      },
    ),
  );
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.native.assets_required'), undefined);
  assert.equal(findById(findings, 'imp.native.asset_type_required'), undefined);
});

// ── assets_required ─────────────────────────────────────────────────────────

test('native request: missing assets → assets_required', () => {
  const req = bidRequest(nativeImp({ native: { ver: '1.2' } }));
  const { findings } = validate(req);
  const f = findById(findings, 'imp.native.assets_required');
  assert.ok(f);
  assert.equal(f.path, 'imp[0].native.request');
});

test('native request: non-array assets → assets_required', () => {
  const req = bidRequest(nativeImp({ assets: { id: 1, title: { len: 90 } } }));
  const { findings } = validate(req);
  assert.ok(findById(findings, 'imp.native.assets_required'));
});

test('native request: empty assets → assets_required', () => {
  const req = bidRequest(nativeImp({ assets: [] }));
  const { findings } = validate(req);
  assert.ok(findById(findings, 'imp.native.assets_required'));
});

// ── Valid subtypes ──────────────────────────────────────────────────────────

for (const [subtype, body] of [
  ['title', { title: { len: 90 } }],
  ['img', { img: { type: 3, w: 300, h: 250 } }],
  ['video', { video: { mimes: ['video/mp4'], minduration: 5 } }],
  ['data', { data: { type: 2 } }],
]) {
  test(`native request: valid ${subtype} asset`, () => {
    const req = bidRequest(nativeImp({ assets: [Object.assign({ id: 1 }, body)] }));
    const { findings } = validate(req);
    assert.equal(findById(findings, 'imp.native.asset_type_required'), undefined);
  });
}

// ── asset_type_required ─────────────────────────────────────────────────────

test('native request: asset without subtype → asset_type_required', () => {
  const req = bidRequest(nativeImp({ assets: [{ id: 1, required: 1 }] }));
  const { findings } = validate(req);
  const f = findById(findings, 'imp.native.asset_type_required');
  assert.ok(f);
  assert.equal(f.path, 'imp[0].native.request.assets[0]');
});

test('native request: asset with two subtypes → asset_type_required', () => {
  const req = bidRequest(
    nativeImp({
      assets: [{ id: 1, title: { len: 90 }, img: { type: 3, w: 300, h: 250 } }],
    }),
  );
  const { findings } = validate(req);
  const f = findById(findings, 'imp.native.asset_type_required');
  assert.ok(f);
  assert.equal(f.path, 'imp[0].native.request.assets[0]');
});

test('native request: primitive asset → asset_type_required', () => {
  const req = bidRequest(nativeImp({ assets: ['not-an-object'] }));
  const { findings } = validate(req);
  const f = findById(findings, 'imp.native.asset_type_required');
  assert.ok(f);
  assert.equal(f.path, 'imp[0].native.request.assets[0]');
});

test('native request: null asset → asset_type_required', () => {
  const req = bidRequest(nativeImp({ assets: [null] }));
  const { findings } = validate(req);
  assert.ok(findById(findings, 'imp.native.asset_type_required'));
});

test('native request: subtype not an object → asset_type_required', () => {
  const req = bidRequest(nativeImp({ assets: [{ id: 1, title: 'plain string' }] }));
  const { findings } = validate(req);
  const f = findById(findings, 'imp.native.asset_type_required');
  assert.ok(f);
  assert.equal(f.path, 'imp[0].native.request.assets[0]');
});

test('native request: second imp/asset uses correct path', () => {
  const req = bidRequest([
    nativeImp({ assets: [{ id: 1, title: { len: 90 } }] }, { id: 'imp-1' }),
    nativeImp({ assets: [{ id: 2 }] }, { id: 'imp-2' }),
  ]);
  const { findings } = validate(req);
  const hits = findAllById(findings, 'imp.native.asset_type_required');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'imp[1].native.request.assets[0]');
  assert.equal(hits[0].params.num, 2);
  assert.equal(hits[0].params.asset, 0);
});

// ── validate() integration ──────────────────────────────────────────────────

test('validate(): native request findings surface on public API', () => {
  const req = bidRequest(nativeImp({ assets: [] }));
  const result = validate(req);
  assert.equal(result.status, 'errors');
  const f = result.findings.find((x) => x.id === 'imp.native.assets_required');
  assert.ok(f);
  assert.equal(typeof f.msg, 'string');
  assert.ok(f.msg.length > 0);
});
