'use strict';

/**
 * tests/detection-mechanism.test.js — mechanism-audit 2026-06-11 regression
 * suite (Claude + DeepSeek crossfire). Pins the detection layer's behavior
 * on ambiguous/hostile payloads: silent guesses must either be eliminated
 * or surfaced as findings.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const core = require('../packages/core');

const ids = (r) => r.findings.map((f) => f.id);

test('hybrid imp[]+seatbid[] payload surfaces payload.ambiguous_both_sides', () => {
  const r = core.validate({
    id: '1',
    imp: [{ id: '1' }],
    seatbid: [{ bid: [{ id: 'b', impid: '1', price: 1 }] }],
  });
  assert.strictEqual(r.type, core.TYPES.ORTB_REQUEST);
  assert.ok(ids(r).includes('payload.ambiguous_both_sides'));
  const f = r.findings.find((x) => x.id === 'payload.ambiguous_both_sides');
  assert.strictEqual(f.level, core.LEVELS.WARNING);
  assert.strictEqual(f.params.validated, 'BidRequest');
});

test('bare item[] of primitives is NOT a 3.0 envelope (DS-1)', () => {
  const r = core.validate({ item: ['x'] });
  assert.strictEqual(r.type, core.TYPES.UNKNOWN);
  assert.ok(ids(r).includes('payload.unknown_type'));
  assert.strictEqual(r.version.version, core.VERSIONS.UNKNOWN);
});

test('item[] of objects without 2.x markers still counts as 3.0', () => {
  const r = core.validate({ item: [{ id: '1' }] });
  assert.strictEqual(r.type, core.TYPES.ORTB_REQUEST);
  assert.strictEqual(r.version.version, core.VERSIONS.V_3_0);
});

test('empty openrtb key does not outweigh root imp[] (DS-5)', () => {
  const r = core.validate({ openrtb: {}, imp: [{ id: '1' }] });
  assert.strictEqual(r.version.version, core.VERSIONS.V_2_5); // 2.x path, not 3.0
  assert.ok(ids(r).includes('payload.ambiguous_envelope'));
});

test('bare broken envelope (openrtb:{} alone) is still a 3.0 attempt', () => {
  const r = core.validate({ openrtb: {} });
  assert.strictEqual(r.version.version, core.VERSIONS.V_3_0);
});

test('real 3.0 envelope + stray root imp[] validates as 3.0 and flags the mix', () => {
  const r = core.validate({ openrtb: { ver: '3.0', request: {} }, imp: [{ id: '1' }] });
  assert.strictEqual(r.version.version, core.VERSIONS.V_3_0);
  const f = r.findings.find((x) => x.id === 'payload.ambiguous_envelope');
  assert.ok(f);
  assert.strictEqual(f.params.validated, '3.0');
});

test('signal-less payload surfaces version.assumed (INFO), suppressed by pinning', () => {
  const payload = { id: '1', imp: [{ id: '1', banner: { w: 1, h: 1 } }], at: 1 };
  const bare = core.validate(payload);
  const assumed = bare.findings.find((x) => x.id === 'version.assumed');
  assert.ok(assumed);
  assert.strictEqual(assumed.level, core.LEVELS.INFO);
  const pinned = core.validate(payload, { expectedVersion: '2.5' });
  assert.ok(!ids(pinned).includes('version.assumed'));
});

test('single 2.6 marker surfaces version.single_marker naming the field', () => {
  const r = core.validate({
    id: '1',
    imp: [{ id: '1', banner: { w: 1, h: 1 } }],
    at: 1,
    device: { sua: {} },
  });
  assert.strictEqual(r.version.version, core.VERSIONS.V_2_6);
  const f = r.findings.find((x) => x.id === 'version.single_marker');
  assert.ok(f);
  assert.strictEqual(f.params.signal, 'device.sua');
});

test('multiple 2.6 markers do not trigger version.single_marker', () => {
  const r = core.validate({
    id: '1',
    imp: [{ id: '1', banner: { w: 1, h: 1 }, rwdd: 1 }],
    at: 1,
    device: { sua: {} },
  });
  assert.strictEqual(r.version.version, core.VERSIONS.V_2_6);
  assert.ok(!ids(r).includes('version.single_marker'));
});

test('JSON Feed: honest non-validation finding instead of blind clean', () => {
  const r = core.validate({ version: 'https://jsonfeed.org/1.1', items: [] });
  assert.strictEqual(r.type, core.TYPES.JSON_FEED);
  assert.strictEqual(r.status, 'clean'); // INFO doesn't block clean
  assert.ok(ids(r).includes('jsonfeed.not_validated'));
  assert.strictEqual(r.version.version, core.VERSIONS.UNKNOWN);
});

test('vendor feeds carry no fake oRTB version axis', () => {
  const r = core.validate({ clickUrl: 'https://x', value: 1 });
  assert.strictEqual(r.version.version, core.VERSIONS.UNKNOWN);
  assert.strictEqual(r.version.confidence, 0);
});

test('format-detect: anchored VAST sniff — HTML mentioning <VAST is not video', () => {
  const html = core.detectFormat({
    seatbid: [{ bid: [{ adm: '<div>про <VAST творчість</div>', mtype: 1 }] }],
  });
  assert.ok(!html.formats.includes('video'));
  const vast = core.detectFormat({
    seatbid: [{ bid: [{ adm: '<?xml version="1.0"?><VAST version="4.2"><Ad/></VAST>' }] }],
  });
  assert.ok(vast.formats.includes('video'));
  assert.ok(vast.protocols.includes('vast-4'));
});

test('rollupStatus is exported and ignores question-level findings', () => {
  assert.strictEqual(typeof core.rollupStatus, 'function');
  assert.strictEqual(core.rollupStatus([]), 'clean');
  assert.strictEqual(core.rollupStatus([{ level: 'question' }]), 'clean');
  assert.strictEqual(core.rollupStatus([{ level: 'info' }, { level: 'error' }]), 'errors');
});

test('new finding messages resolve in all three locales (no raw key leaks)', () => {
  for (const locale of ['en', 'uk', 'ru']) {
    const r = core.validate(
      { id: '1', imp: [{ id: '1' }], seatbid: [{ bid: [{ id: 'b', impid: '1', price: 1 }] }] },
      { locale },
    );
    const f = r.findings.find((x) => x.id === 'payload.ambiguous_both_sides');
    assert.ok(f.msg && !f.msg.includes('payload.ambiguous_both_sides'), locale);
    assert.ok(!/\{validated\}/.test(f.msg), `${locale}: unsubstituted param`);
  }
});

// ── 013: single-object push-materials response (baseline shape) ─────────────
// A single push material — priced, clickable creative — is how most push
// auctions respond (owner ruling 2026-08-26). Synthetic replica of the
// reported payload: same key set and value shapes, synthetic values.

const pushSingleReplica = () => ({
  tId: '00000000-0000-4000-8000-000000000001',
  title: 'Synthetic push headline',
  description: 'Synthetic push body text',
  icon: 'https://ads.example.com/icn.png',
  image: 'https://ads.example.com/img.jpg',
  link: 'https://ads.example.com/click',
  linkTtl: 1900000000000,
  cpc: 0.01,
  crid: 'SYNTHETICCRID000000000000000000',
  cid: 'SYNTHETICCID0000000000000000000',
});

test('013: single push-material object is claimed as a vendor feed', () => {
  assert.strictEqual(core.detectType(pushSingleReplica()), core.TYPES.VENDOR_FEED);
});

test('013: generic objects below the push signature bar stay unknown', () => {
  // click key alone
  assert.strictEqual(core.detectType({ link: 'https://x' }), core.TYPES.UNKNOWN);
  // click + creative but no price key
  assert.strictEqual(core.detectType({ title: 't', link: 'https://x' }), core.TYPES.UNKNOWN);
  // click + price but no creative key
  assert.strictEqual(core.detectType({ cpc: 0.01, link: 'https://x' }), core.TYPES.UNKNOWN);
  // price + creative but no click key
  assert.strictEqual(core.detectType({ cpc: 0.01, title: 't' }), core.TYPES.UNKNOWN);
});

test('013: push-like keys never re-classify structurally claimed payloads', () => {
  const noise = { title: 't', link: 'https://x', cpc: 0.01 };
  assert.strictEqual(core.detectType({ imp: [{ id: '1' }], ...noise }), core.TYPES.ORTB_REQUEST);
  assert.strictEqual(
    core.detectType({ seatbid: [{ bid: [] }], ...noise }),
    core.TYPES.ORTB_RESPONSE,
  );
  assert.strictEqual(
    core.detectType({ openrtb: { ver: '3.0', request: {} }, ...noise }),
    core.TYPES.ORTB_REQUEST,
  );
  assert.strictEqual(
    core.detectType({ version: 'https://jsonfeed.org/version/1.1', items: [], ...noise }),
    core.TYPES.JSON_FEED,
  );
  // result-wrapped clickunder keeps its family (still VENDOR_FEED, but the
  // wrapper branch wins — asserted via the resolved feed type).
  const r = core.validate({
    result: { status: 'BID', listing: { url: 'https://x', bid: 1 } },
    ...noise,
  });
  assert.strictEqual(r.type, 'Clickunder Feed Response (single)');
});

test('013: unique-key single-bid vendors keep precedence over the push signature', () => {
  // Bid-price feed carrying push-like keys must stay bid-price.
  const r = core.validate({
    bid_price: 0.5,
    link: 'https://x',
    title: 't',
    image: 'https://ads.example.com/i.jpg',
    cpc: 0.01,
  });
  assert.strictEqual(r.type, 'Bid-Price Feed Response');
});

test('013: recognized single push object produces no unknown_type', () => {
  const r = core.validate(pushSingleReplica());
  assert.strictEqual(r.type, 'Push-Materials Feed Response (single)');
  assert.ok(!ids(r).includes('payload.unknown_type'));
});
