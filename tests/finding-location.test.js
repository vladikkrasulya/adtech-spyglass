'use strict';

/**
 * finding-location.js — the additive location contract. Side comes ONLY from
 * call context; crosscheck declares primary/related explicitly.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const FL = require('../packages/core/finding-location');
const { buildSourceMap } = require('../packages/core/source-map');

test('path ↔ pointer conversion (incl. 3.0 envelope + escaping)', () => {
  assert.equal(FL.pathToPointer('imp[0].banner'), '/imp/0/banner');
  assert.equal(FL.pathToPointer('seatbid[0].bid[0].price'), '/seatbid/0/bid/0/price');
  assert.equal(FL.pathToPointer('openrtb.request.item[0].id'), '/openrtb/request/item/0/id');
  assert.equal(FL.pathToPointer(''), '');
  assert.equal(FL.pathToPointer('weird path with spaces'), null);
  assert.equal(FL.pointerToDisplay('/seatbid/0/bid/0/price'), 'seatbid[0].bid[0].price');
});

test('normal finding: side from ctx (request), exact ortb-json', () => {
  const l = FL.buildNormalLocation(
    { id: 'imp.banner.size_required', path: 'imp[0].banner' },
    { side: 'request', kind: 'ortb' },
  );
  assert.equal(l.dialect, 'ortb-json');
  assert.equal(l.precision, 'exact');
  assert.equal(l.primary.side, 'request');
  assert.equal(l.primary.pointer, '/imp/0/banner');
  assert.equal(l.primary.target, 'value');
});

test('side is NEVER inferred from id — a "response."-looking id on the request pane stays request', () => {
  const l = FL.buildNormalLocation(
    { id: 'response.bogus', path: 'imp[0].id' },
    { side: 'request', kind: 'ortb' },
  );
  assert.equal(l.primary.side, 'request');
});

test('VAST finding → container precision, adm value, dialect vast', () => {
  const l = FL.buildNormalLocation(
    { id: 'vast.version_missing', path: 'seatbid[0].bid[0].adm' },
    { side: 'response', kind: 'ortb' },
  );
  assert.equal(l.dialect, 'vast');
  assert.equal(l.precision, 'container');
  assert.equal(l.primary.pointer, '/seatbid/0/bid/0/adm');
});

test('envelope finding (empty path) → precision none, no primary', () => {
  const l = FL.buildNormalLocation(
    { id: 'version.mismatch', path: '' },
    { side: 'request', kind: 'ortb' },
  );
  assert.equal(l.precision, 'none');
  assert.equal(l.primary, null);
  assert.equal(l.dialect, 'envelope');
});

test('URL: enabled only with provenance (raw param present); else disabled', () => {
  const canonical = { _raw: { 'ch-model': '', url: 'http://x?' } };
  const ok = FL.buildNormalLocation(
    { id: 'request.url.ch_field_empty', path: 'ch-model' },
    { side: 'request', kind: 'url', canonical },
  );
  assert.equal(ok.dialect, 'url');
  assert.equal(ok.precision, 'exact');
  assert.equal(ok.primary.pointer, 'ch-model');
  const disabled = FL.buildNormalLocation(
    { id: 'request.url.user_ip_ipv6', path: 'device.ipv6' },
    { side: 'request', kind: 'url', canonical },
  );
  assert.equal(disabled.precision, 'none'); // canonical field, raw param unknown → disabled
  assert.equal(disabled.primary, null);
});

// ── crosscheck families (multi-location) ──────────────────────────────────
const REQ = {
  id: 'r1',
  cur: ['EUR'],
  bcat: ['IAB1'],
  badv: ['evil.com'],
  imp: [
    { id: 'i1', bidfloor: 0.5, banner: { format: [{ w: 300, h: 250 }] }, native: {}, video: {} },
  ],
};
const RES = {
  id: 'r2',
  cur: 'USD',
  seatbid: [
    {
      bid: [
        {
          impid: 'i1',
          price: 0.2,
          w: 728,
          h: 90,
          cat: ['IAB1'],
          adomain: ['evil.com'],
          adm: '<VAST/>',
        },
      ],
    },
  ],
};
const xc = (id, path) => FL.buildCrosscheckLocation({ id, path }, REQ, RES);

test('crosscheck.id_mismatch → primary response /id, related request /id', () => {
  const l = xc('crosscheck.id_mismatch', 'id');
  assert.equal(l.primary.side, 'response');
  assert.equal(l.primary.pointer, '/id');
  assert.equal(l.related[0].side, 'request');
  assert.equal(l.related[0].role, 'request-id');
});

test('crosscheck currency → primary RESPONSE /cur (the OpenRTB fix), related request /cur', () => {
  const l = xc('crosscheck.cur_not_in_request', 'cur');
  assert.equal(l.primary.side, 'response');
  assert.equal(l.primary.pointer, '/cur');
  assert.equal(l.related[0].side, 'request');
  assert.equal(l.related[0].pointer, '/cur');
  assert.equal(l.related[0].precision, 'container');
});

test('crosscheck price↔floor → primary response price, related request imp[k].bidfloor', () => {
  const l = xc('crosscheck.bid.below_floor', 'seatbid[0].bid[0].price');
  assert.equal(l.primary.pointer, '/seatbid/0/bid/0/price');
  assert.equal(l.related[0].pointer, '/imp/0/bidfloor');
  assert.equal(l.related[0].role, 'floor');
});

test('crosscheck impid_unresolved → primary response impid, related request /imp container', () => {
  const l = xc('crosscheck.bid.impid_unresolved', 'seatbid[0].bid[0].impid');
  assert.equal(l.primary.pointer, '/seatbid/0/bid/0/impid');
  assert.equal(l.related[0].pointer, '/imp');
  assert.equal(l.related[0].precision, 'container');
});

test('crosscheck size → primary response /w, related /h + request banner.format (NO bogus .size node)', () => {
  const l = xc('crosscheck.bid.size_mismatch', 'seatbid[0].bid[0].size');
  assert.equal(l.primary.pointer, '/seatbid/0/bid/0/w');
  assert.equal(l.related[0].pointer, '/seatbid/0/bid/0/h');
  assert.equal(l.related[1].pointer, '/imp/0/banner/format');
  assert.ok(!JSON.stringify(l).includes('/size'), 'must not emit a non-existent /size node');
});

test('crosscheck categories/adomain → related request blocklists', () => {
  assert.equal(
    xc('crosscheck.bid.cat_blocked', 'seatbid[0].bid[0].cat').related[0].pointer,
    '/bcat',
  );
  assert.equal(
    xc('crosscheck.bid.adomain_blocked', 'seatbid[0].bid[0].adomain').related[0].pointer,
    '/badv',
  );
});

test('crosscheck native/VAST → primary adm container, related request asset/video spec', () => {
  const nat = xc('crosscheck.bid.native_missing_assets', 'seatbid[0].bid[0].adm');
  assert.equal(nat.primary.precision, 'container');
  assert.equal(nat.related[0].pointer, '/imp/0/native');
  const vid = xc('crosscheck.bid.video_not_vast', 'seatbid[0].bid[0].adm');
  assert.equal(vid.dialect, 'vast');
  assert.equal(vid.related[0].pointer, '/imp/0/video');
});

test('every crosscheck primary/related pointer resolves against the real pretty JSON', () => {
  const reqText = JSON.stringify(REQ, null, 2);
  const resText = JSON.stringify(RES, null, 2);
  const reqMap = buildSourceMap(reqText);
  const resMap = buildSourceMap(resText);
  const ids = [
    'crosscheck.id_mismatch',
    'crosscheck.cur_not_in_request',
    'crosscheck.bid.below_floor',
    'crosscheck.bid.size_mismatch',
    'crosscheck.bid.cat_blocked',
    'crosscheck.bid.adomain_blocked',
    'crosscheck.bid.native_missing_assets',
  ];
  const pathFor = (id) =>
    id.indexOf('cur') >= 0
      ? 'cur'
      : id.indexOf('mismatch') >= 0 && id.indexOf('size') < 0
        ? 'id'
        : id.indexOf('size') >= 0
          ? 'seatbid[0].bid[0].size'
          : id.indexOf('below') >= 0
            ? 'seatbid[0].bid[0].price'
            : id.indexOf('cat') >= 0
              ? 'seatbid[0].bid[0].cat'
              : id.indexOf('adomain') >= 0
                ? 'seatbid[0].bid[0].adomain'
                : 'seatbid[0].bid[0].adm';
  for (const id of ids) {
    const l = xc(id, pathFor(id));
    for (const loc of [l.primary].concat(l.related).filter(Boolean)) {
      const map = loc.side === 'request' ? reqMap : resMap;
      assert.ok(map.resolve(loc.pointer), `${id} ${loc.side} ${loc.pointer} must resolve`);
    }
  }
});

test('attachLocations is additive and never mutates id/level/path/params', () => {
  const f = { id: 'imp.id_required', level: 'error', path: 'imp[0].id', params: { x: 1 } };
  FL.attachLocations([f], { side: 'request', kind: 'ortb' });
  assert.equal(f.id, 'imp.id_required');
  assert.equal(f.level, 'error');
  assert.equal(f.path, 'imp[0].id');
  assert.deepEqual(f.params, { x: 1 });
  assert.ok(f.location && f.location.primary.side === 'request');
});
