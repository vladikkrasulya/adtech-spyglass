'use strict';

/**
 * Mirror generator tests.
 *
 * Contract: every successful mirror() call must return output that:
 *   - validate() rolls up to status ∈ { 'clean', 'warnings' }, never 'errors'
 *   - crosscheck(input, output) (or output, input) emits 0 CRIT findings
 *
 * That's the self-test loop already wired into the wrapper; here we
 * verify it holds across banner / video / native / no-bid / multi-imp
 * inputs in both directions.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mirror, validate, crosscheck } = require('@kyivtech/spyglass-core');

const {
  validRequest,
  validResponse,
  nativeRequest,
  v3Request,
} = require('./fixtures');

// ─── basic shape ─────────────────────────────────────────────────────

test('mirror returns ok=false for non-object input', () => {
  const r = mirror(null);
  assert.equal(r.ok, false);
  assert.equal(r.output, null);
  assert.ok(r.notes.length, 'should explain refusal');
});

test('mirror returns ok=false for unrecognised type', () => {
  const r = mirror({ what: 'a', random: 'object' });
  assert.equal(r.ok, false);
  assert.equal(r.direction, 'unsupported');
});

test('mirror refuses oRTB 3.0 envelope with explicit note', () => {
  const r = mirror(v3Request());
  assert.equal(r.ok, false);
  assert.equal(r.direction, 'unsupported');
  assert.ok(
    r.notes.some((n) => n.id === 'mirror.note.ortb_30_not_supported'),
    'should surface the 3.0 not-supported note',
  );
});

// ─── request → response ──────────────────────────────────────────────

test('request → response: banner imp produces a valid bid with matching size', () => {
  const req = validRequest();
  const r = mirror(req);

  assert.equal(r.ok, true);
  assert.equal(r.direction, 'response_from_request');

  const res = r.output;
  assert.equal(res.id, req.id, 'response.id must match request.id');
  assert.equal(res.cur, 'USD');
  assert.ok(res.seatbid && res.seatbid[0] && res.seatbid[0].bid[0]);

  const bid = res.seatbid[0].bid[0];
  assert.equal(bid.impid, 'imp-1');
  assert.equal(bid.w, 300);
  assert.equal(bid.h, 250);
  assert.ok(bid.price > req.imp[0].bidfloor, 'price must be above floor');
  assert.ok(Array.isArray(bid.adomain) && bid.adomain.length);
});

test('request → response: self-test reports 0 errors / 0 CRIT', () => {
  const r = mirror(validRequest());
  assert.equal(r.selfTest.validate.errorCount, 0);
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('request → response: video imp produces VAST adm', () => {
  const req = validRequest();
  delete req.imp[0].banner;
  req.imp[0].video = {
    mimes: ['video/mp4'],
    minduration: 5,
    maxduration: 30,
    protocols: [3, 7],
    w: 640,
    h: 360,
  };
  const r = mirror(req);
  assert.equal(r.ok, true);
  const adm = r.output.seatbid[0].bid[0].adm;
  assert.ok(/^<\?xml/.test(adm));
  assert.ok(/<VAST[\s>]/.test(adm));
  assert.equal(r.selfTest.validate.errorCount, 0);
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('request → response: native imp produces matching native adm', () => {
  const req = nativeRequest();
  const r = mirror(req);
  assert.equal(r.ok, true);
  const adm = r.output.seatbid[0].bid[0].adm;
  const parsed = JSON.parse(adm);
  assert.ok(parsed.native);
  assert.ok(Array.isArray(parsed.native.assets));
  // request asks for ids 1,2,3 — response must include all three
  const ids = parsed.native.assets.map((a) => a.id).sort();
  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('request → response: multi-imp produces one bid per imp', () => {
  const req = validRequest();
  req.imp.push({
    id: 'imp-2',
    bidfloor: 0.2,
    bidfloorcur: 'USD',
    banner: { format: [{ w: 728, h: 90 }] },
  });
  const r = mirror(req);
  assert.equal(r.output.seatbid[0].bid.length, 2);
  const sizes = r.output.seatbid[0].bid.map((b) => `${b.w}x${b.h}`);
  assert.ok(sizes.includes('300x250'));
  assert.ok(sizes.includes('728x90'));
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('request → response: currency inherited from request', () => {
  const req = validRequest();
  req.cur = ['EUR', 'USD'];
  const r = mirror(req);
  assert.equal(r.output.cur, 'EUR');
  assert.ok(r.notes.some((n) => n.id === 'mirror.note.cur_inferred_from_request'));
});

test('request → response: emits explanatory note for the bid price choice', () => {
  const req = validRequest();
  const r = mirror(req);
  assert.ok(
    r.notes.some((n) => n.id === 'mirror.note.bid_price_above_floor'),
    'should explain the price calculation',
  );
});

// ─── response → request ──────────────────────────────────────────────

test('response → request: banner bid produces matching imp', () => {
  const res = validResponse();
  const r = mirror(res);

  assert.equal(r.ok, true);
  assert.equal(r.direction, 'request_from_response');

  const req = r.output;
  assert.equal(req.id, res.id);
  assert.deepEqual(req.cur, ['USD']);
  assert.ok(Array.isArray(req.imp) && req.imp.length === 1);
  assert.equal(req.imp[0].id, 'imp-1');
  assert.deepEqual(req.imp[0].banner, { w: 300, h: 250 });
  // floor must be ≤ price so original response would still be above-floor
  assert.ok(req.imp[0].bidfloor <= res.seatbid[0].bid[0].price);
});

test('response → request: self-test passes both validate and crosscheck', () => {
  const r = mirror(validResponse());
  assert.equal(r.selfTest.validate.errorCount, 0);
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('response → request: VAST adm becomes imp.video', () => {
  const res = validResponse();
  res.seatbid[0].bid[0].adm = '<?xml version="1.0"?><VAST version="4.0"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>Y</AdTitle><Impression>http://i</Impression><Creatives><Creative><Linear><Duration>00:00:30</Duration><MediaFiles><MediaFile delivery="progressive" type="video/mp4" width="640" height="360">http://m.mp4</MediaFile></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  delete res.seatbid[0].bid[0].w;
  delete res.seatbid[0].bid[0].h;
  const r = mirror(res);
  assert.equal(r.ok, true);
  assert.ok(r.output.imp[0].video);
  assert.deepEqual(r.output.imp[0].video.protocols, [3, 7]);
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('response → request: no-bid (nbr) returns a default-imp request', () => {
  const r = mirror({ id: 'no-bid', nbr: 2 });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.output.imp) && r.output.imp.length === 1);
  assert.ok(
    r.notes.some((n) => n.id === 'mirror.note.no_bids_default_banner_imp'),
    'should mention default-imp synthesis',
  );
});

test('response → request: dedups multiple bids on same impid', () => {
  const res = validResponse();
  res.seatbid[0].bid.push({
    id: 'bid-2',
    impid: 'imp-1', // same imp
    price: 2.0,
    adm: '<html>2</html>',
    adomain: ['x.com'],
    w: 300,
    h: 250,
  });
  const r = mirror(res);
  assert.equal(r.output.imp.length, 1, 'duplicate impid should map to one imp');
});

// ─── round-trip stability ────────────────────────────────────────────

test('round-trip: request → mirror response → mirror back to request, both clean', () => {
  const req = validRequest();
  const a = mirror(req);
  assert.equal(a.ok, true);
  const b = mirror(a.output);
  assert.equal(b.ok, true);
  assert.equal(b.selfTest.validate.errorCount, 0);
  assert.equal(b.selfTest.crosscheck.critCount, 0);
});

// ─── best-practice mode ──────────────────────────────────────────────

test('best-practice mode: response carries DSA bidext, crid, cid, cattax, lurl, nurl', () => {
  const r = mirror(validRequest(), { mode: 'best-practice' });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'best-practice');
  const bid = r.output.seatbid[0].bid[0];
  assert.ok(bid.crid, 'crid should be filled');
  assert.ok(bid.cid, 'cid should be filled');
  assert.equal(bid.cattax, 6);
  assert.ok(Array.isArray(bid.cat) && bid.cat.length, 'cat should be filled');
  assert.ok(bid.lurl);
  assert.ok(bid.nurl);
  assert.ok(bid.ext && bid.ext.dsa, 'DSA bidext required for EU');
  assert.ok(r.output.bidid, 'response-level bidid');
  assert.ok(r.output.seatbid[0].seat, 'seat string');
  assert.equal(r.selfTest.validate.errorCount, 0);
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('best-practice mode: request carries schain, regs, user.consent placeholder, device.sua', () => {
  const r = mirror(validResponse(), { mode: 'best-practice' });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'best-practice');
  const out = r.output;
  assert.ok(out.source && out.source.ext && out.source.ext.schain, 'schain present');
  assert.equal(out.source.ext.schain.ver, '1.0');
  assert.ok(Array.isArray(out.source.ext.schain.nodes) && out.source.ext.schain.nodes.length);
  assert.equal(out.regs.coppa, 0);
  assert.ok(out.user.ext, 'user.ext present');
  assert.ok(typeof out.user.ext.consent === 'string', 'consent placeholder');
  assert.ok(out.device.sua, 'device.sua present');
  assert.ok(out.device.sua.platform);
  assert.equal(r.selfTest.validate.errorCount, 0);
  assert.equal(r.selfTest.crosscheck.critCount, 0);
});

test('best-practice mode emits an explanatory note', () => {
  const r1 = mirror(validRequest(), { mode: 'best-practice' });
  assert.ok(r1.notes.some((n) => n.id === 'mirror.note.bestpractice_response_enriched'));
  const r2 = mirror(validResponse(), { mode: 'best-practice' });
  assert.ok(r2.notes.some((n) => n.id === 'mirror.note.bestpractice_request_enriched'));
});

test('mode defaults to minimal when omitted or invalid', () => {
  const a = mirror(validRequest());
  assert.equal(a.mode, 'minimal');
  const b = mirror(validRequest(), { mode: 'gibberish' });
  assert.equal(b.mode, 'minimal');
});

test('best-practice mode does not overwrite minimal-set fields', () => {
  // Minimal mirror sets bid.adomain — best-practice must not clobber.
  const r = mirror(validRequest(), { mode: 'best-practice' });
  const bid = r.output.seatbid[0].bid[0];
  assert.deepEqual(bid.adomain, ['advertiser.example']);
});
