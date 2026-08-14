'use strict';

/**
 * tests/native-request.test.js — imp.native.request parsing (Native 1.0 wrapped
 * vs 1.1/1.2 bare root) and per-asset subtype validation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('@ortbtools/core');

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

// ── Asset fitness, not just presence (crosscheck) ───────────────────────────

const { crosscheck: xcheck } = require('@ortbtools/core');

// Prebid validates a native response by intersecting asset ids and testing that
// link.url is truthy — measured identical across 9.53.5 through 11.29.0. So a
// bid whose assets are bare ids passes every check in the chain and renders as
// an empty unit, because the renderer interpolates a missing value as ''.
const FITNESS_REQ = {
  ver: '1.2',
  assets: [
    { id: 1, required: 1, title: { len: 25 } },
    { id: 2, required: 1, img: { type: 3, w: 300, h: 250 } },
    { id: 3, required: 1, data: { type: 1, len: 25 } },
  ],
};

const fitnessPair = (assets, link) => {
  const req = {
    id: 'r',
    imp: [{ id: '1', native: { request: JSON.stringify(FITNESS_REQ), ver: '1.2' } }],
  };
  const res = {
    id: 'r',
    seatbid: [
      {
        seat: 's',
        bid: [
          {
            id: 'b',
            impid: '1',
            price: 1,
            adm: JSON.stringify({
              native: { ver: '1.2', link: link || { url: 'https://adv.example/c' }, assets },
            }),
          },
        ],
      },
    ],
  };
  return xcheck(req, res, { locale: 'en' })
    .filter((f) => f.id.startsWith('crosscheck.bid.native_'))
    .map((f) => f.id);
};

const GOOD = [
  { id: 1, title: { text: 'A short title' } },
  { id: 2, img: { url: 'https://cdn.example/i.png', w: 300, h: 250 } },
  { id: 3, data: { value: 'Brand' } },
];

test('native fitness: a bid that satisfies the request is still complete', () => {
  // The gating property. A warning on a correct bid gets the rule switched off.
  assert.deepEqual(fitnessPair(GOOD), ['crosscheck.bid.native_complete']);
});

test('native fitness: an id with no payload is not a delivered asset', () => {
  const ids = fitnessPair([{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.ok(ids.includes('crosscheck.bid.native_asset_empty'));
  assert.equal(ids.includes('crosscheck.bid.native_complete'), false, 'no green tick beside it');
});

test('native fitness: text longer than the requested len is reported', () => {
  const ids = fitnessPair([{ id: 1, title: { text: 'x'.repeat(200) } }, GOOD[1], GOOD[2]]);
  assert.ok(ids.includes('crosscheck.bid.native_over_length'));
});

test('native fitness: an image of the wrong size is reported', () => {
  const ids = fitnessPair([
    GOOD[0],
    { id: 2, img: { url: 'https://cdn.example/i.png', w: 1, h: 1 } },
    GOOD[2],
  ]);
  assert.ok(ids.includes('crosscheck.bid.native_img_size'));
});

test('native fitness: an asset returned as the wrong kind is reported', () => {
  const ids = fitnessPair([
    { id: 1, img: { url: 'https://cdn.example/i.png', w: 300, h: 250 } },
    GOOD[1],
    GOOD[2],
  ]);
  assert.ok(ids.includes('crosscheck.bid.native_asset_kind'));
});

test('native fitness: a non-fetchable scheme is critical, in either url', () => {
  const inImg = fitnessPair([
    GOOD[0],
    { id: 2, img: { url: 'javascript:alert(1)', w: 300, h: 250 } },
    GOOD[2],
  ]);
  assert.ok(inImg.includes('crosscheck.bid.native_unsafe_scheme'));

  const inLink = fitnessPair(GOOD, { url: 'javascript:alert(1)' });
  assert.ok(inLink.includes('crosscheck.bid.native_unsafe_scheme'));
});

test('native fitness: wmin/hmin is a floor, not an exact demand', () => {
  const req = {
    ver: '1.2',
    assets: [{ id: 1, required: 1, img: { type: 3, wmin: 200, hmin: 100 } }],
  };
  const pair = (w, h) => {
    const rq = {
      id: 'r',
      imp: [{ id: '1', native: { request: JSON.stringify(req), ver: '1.2' } }],
    };
    const rs = {
      id: 'r',
      seatbid: [
        {
          seat: 's',
          bid: [
            {
              id: 'b',
              impid: '1',
              price: 1,
              adm: JSON.stringify({
                native: {
                  ver: '1.2',
                  link: { url: 'https://adv.example/c' },
                  assets: [{ id: 1, img: { url: 'https://cdn.example/i.png', w, h } }],
                },
              }),
            },
          ],
        },
      ],
    };
    return xcheck(rq, rs, { locale: 'en' }).map((f) => f.id);
  };
  assert.ok(pair(400, 300).includes('crosscheck.bid.native_complete'), 'above the floor is fine');
  assert.ok(pair(100, 50).includes('crosscheck.bid.native_img_size'), 'below the floor is not');
});
