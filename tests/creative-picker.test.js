'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pickCreative, BANK, hashString } = require('../samples/creative-picker');

const CREATIVES_DIR = path.join(__dirname, '..', 'public', 'assets', 'creatives');

test('every BANK ref maps to an existing SVG on disk', () => {
  const refs = [...BANK.mainstream, ...BANK.adult, ...BANK.app, ...BANK.video, ...BANK.native];
  for (const ref of refs) {
    const p = path.join(CREATIVES_DIR, ref + '.svg');
    assert.ok(fs.existsSync(p), 'missing creative file: ' + ref + '.svg');
  }
});

test('video imp routes to video bank', () => {
  const ref = pickCreative({ id: 'r1', imp: [{ video: { w: 640, h: 360 } }], site: {} });
  assert.ok(BANK.video.includes(ref), 'expected video ref, got ' + ref);
});

test('native imp routes to native bank', () => {
  const ref = pickCreative({ id: 'r2', imp: [{ native: { request: '{}' } }], site: {} });
  assert.ok(BANK.native.includes(ref), 'expected native ref, got ' + ref);
});

test('IAB25 (adult) category routes to adult bank', () => {
  const ref = pickCreative({
    id: 'r3',
    imp: [{ banner: { w: 300, h: 250 } }],
    site: { domain: 'example.com', cat: ['IAB25-3'] },
  });
  assert.ok(BANK.adult.includes(ref), 'expected adult ref, got ' + ref);
});

test('adult-flavored bundle routes to adult bank', () => {
  const ref = pickCreative({
    id: 'r4',
    imp: [{ banner: { w: 300, h: 250 } }],
    app: { bundle: 'com.hotdating.app' },
  });
  assert.ok(BANK.adult.includes(ref), 'expected adult ref, got ' + ref);
});

test('app context (non-adult) routes to app bank', () => {
  const ref = pickCreative({
    id: 'r5',
    imp: [{ banner: { w: 320, h: 50 } }],
    app: { bundle: 'com.publisher.news', cat: ['IAB12'] },
  });
  assert.ok(BANK.app.includes(ref), 'expected app ref, got ' + ref);
});

test('plain web banner routes to mainstream bank', () => {
  const ref = pickCreative({
    id: 'r6',
    imp: [{ banner: { w: 728, h: 90 } }],
    site: { domain: 'news.example.com', cat: ['IAB12'] },
  });
  assert.ok(BANK.mainstream.includes(ref), 'expected mainstream ref, got ' + ref);
});

test('picker is deterministic for the same specimen.id', () => {
  const sp = { id: 'stable-id', imp: [{ banner: {} }], site: {} };
  const a = pickCreative(sp);
  const b = pickCreative(sp);
  const c = pickCreative(sp);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('picker rotates across different specimen.ids', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const refs = new Set(ids.map((id) => pickCreative({ id, imp: [{ banner: {} }], site: {} })));
  // 6 mainstream creatives in the bank — 10 hashed ids should hit at least 3 different ones
  assert.ok(refs.size >= 3, 'expected ≥3 distinct refs across 10 ids, got ' + refs.size);
});

test('null / malformed input returns null', () => {
  assert.equal(pickCreative(null), null);
  assert.equal(pickCreative('not an object'), null);
});

test('BidResponse with VAST adm routes to video bank', () => {
  const ref = pickCreative({
    id: 'resp-1',
    seatbid: [{ bid: [{ adm: '<?xml version="1.0"?><VAST version="4.0"></VAST>' }] }],
  });
  assert.ok(BANK.video.includes(ref), 'expected video ref, got ' + ref);
});

test('BidResponse with native JSON adm routes to native bank', () => {
  const ref = pickCreative({
    id: 'resp-2',
    seatbid: [{ bid: [{ adm: '{"native":{"assets":[]}}' }] }],
  });
  assert.ok(BANK.native.includes(ref), 'expected native ref, got ' + ref);
});

test('BidResponse with HTML adm routes to banner (mainstream)', () => {
  const ref = pickCreative({
    id: 'resp-3',
    seatbid: [{ bid: [{ adm: '<!DOCTYPE html><html>...</html>' }] }],
  });
  assert.ok(BANK.mainstream.includes(ref), 'expected mainstream banner ref, got ' + ref);
});

test('hashString is stable', () => {
  assert.equal(hashString('test'), hashString('test'));
  assert.notEqual(hashString('test'), hashString('test2'));
});
