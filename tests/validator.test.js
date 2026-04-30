'use strict';

/**
 * Validator tests. Findings are asserted by stable `id` and `path` fields,
 * not by message text — so the suite survives future i18n / copy edits.
 *
 * Test fixtures default to the IAB dialect (no Kadam-isms unless the test
 * explicitly opts in via { dialect: 'kadam' }).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  validate,
  crosscheck,
  detectType,
  detectVersion,
  nativeAssetCrosscheck,
  TYPES,
  VERSIONS,
} = require('@kyivtech/spyglass-core');

const {
  validRequest,
  validResponse,
  nativeRequest,
  nativeResponse,
  v25Request,
  v26Request,
  v26GppRequest,
  v3Request,
} = require('./fixtures');

const findById = (findings, id) => findings.find((f) => f.id === id);
const byLevel = (findings, level) => findings.filter((f) => f.level === level);

// ── detectType ────────────────────────────────────────────────────────────

test('detectType: BidRequest', () => {
  assert.equal(detectType(validRequest()), TYPES.ORTB_REQUEST);
});

test('detectType: BidResponse', () => {
  assert.equal(detectType(validResponse()), TYPES.ORTB_RESPONSE);
});

test('detectType: Kadam Feed (clickunder)', () => {
  assert.equal(detectType({ result: { listing: [{ url: 'x', bid: 1 }] } }), TYPES.KADAM_FEED);
});

test('detectType: Kadam Feed (push array)', () => {
  assert.equal(detectType([{ id: 'm1' }]), TYPES.KADAM_FEED);
});

test('detectType: garbage', () => {
  assert.equal(detectType('not an object'), TYPES.UNKNOWN);
  assert.equal(detectType(42), TYPES.UNKNOWN);
});

// ── validate on a valid BidRequest (default IAB dialect) ─────────────────

test('valid BidRequest under IAB: status clean, no error findings', () => {
  const result = validate(validRequest());
  assert.equal(result.status, 'clean');
  assert.equal(byLevel(result.findings, 'error').length, 0);
  assert.match(result.type, /BidRequest/);
});

// ── BidRequest error-level findings (by stable id) ───────────────────────

test('missing BidRequest.id is error at id "request.id_required"', () => {
  const req = validRequest();
  delete req.id;
  const { findings, status } = validate(req);
  assert.equal(status, 'errors');
  const f = findById(findings, 'request.id_required');
  assert.ok(f);
  assert.equal(f.level, 'error');
  assert.equal(f.path, 'id');
});

test('empty imp[] is error "request.imp_required"', () => {
  const req = validRequest();
  req.imp = [];
  const { findings, status } = validate(req);
  assert.equal(status, 'errors');
  assert.ok(findById(findings, 'request.imp_required'));
});

test('missing site AND app is error "request.no_site_or_app"', () => {
  const req = validRequest();
  delete req.site;
  delete req.app;
  const { findings, status } = validate(req);
  assert.equal(status, 'errors');
  assert.ok(findById(findings, 'request.no_site_or_app'));
});

test('banner without w/h or format[] is error "imp.banner.size_required"', () => {
  const req = validRequest();
  req.imp[0].banner = {};
  const { findings } = validate(req);
  const f = findById(findings, 'imp.banner.size_required');
  assert.ok(f);
  assert.equal(f.level, 'error');
  assert.equal(f.path, 'imp[0].banner');
  assert.equal(f.params.num, 1);
});

test('banner with format[] but no w/h is OK', () => {
  const req = validRequest();
  req.imp[0].banner = {
    format: [
      { w: 300, h: 250 },
      { w: 728, h: 90 },
    ],
  };
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.banner.size_required'), undefined);
});

test('imp without any format slot is error "imp.format_required"', () => {
  const req = validRequest();
  delete req.imp[0].banner;
  const { findings } = validate(req);
  assert.ok(findById(findings, 'imp.format_required'));
});

// ── BidRequest warnings ──────────────────────────────────────────────────

test('non-ISO-3166 country is warning with country param', () => {
  const req = validRequest();
  req.device.geo.country = 'UA';
  const { findings } = validate(req);
  const f = findById(findings, 'request.device.geo.country_invalid');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.params.country, 'UA');
});

test('valid alpha-3 country produces no country warning', () => {
  const req = validRequest();
  req.device.geo.country = 'POL';
  const { findings } = validate(req);
  assert.equal(findById(findings, 'request.device.geo.country_invalid'), undefined);
});

test('non-array bcat is warning "request.bcat_invalid"', () => {
  const req = validRequest();
  req.bcat = 'IAB7';
  const { findings } = validate(req);
  assert.ok(findById(findings, 'request.bcat_invalid'));
});

test('invalid user.gender is warning with gender param', () => {
  const req = validRequest();
  req.user = { gender: 'X' };
  const { findings } = validate(req);
  const f = findById(findings, 'request.user.gender_invalid');
  assert.ok(f);
  assert.equal(f.params.gender, 'X');
});

// ── Dialect: IAB default does NOT emit Kadam-isms ────────────────────────

test('IAB dialect ignores ext.bsection (no kadam-* findings)', () => {
  const req = validRequest();
  req.ext = { bsection: 'wrong-type' };
  const { findings } = validate(req, { dialect: 'iab' });
  assert.equal(findings.filter((f) => f.id.startsWith('kadam.')).length, 0);
});

test('IAB dialect ignores push markers (no kadam.push_detected)', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-zone' };
  req.imp[0].ext = { subage: 7 };
  const { findings } = validate(req, { dialect: 'iab' });
  assert.equal(findings.filter((f) => f.id.startsWith('kadam.')).length, 0);
});

// ── Dialect: Kadam emits its extras ──────────────────────────────────────

test('Kadam dialect: ext.bsection wrong type → kadam.ext.bsection_invalid', () => {
  const req = validRequest();
  req.ext = { bsection: 'wrong-type' };
  const { findings } = validate(req, { dialect: 'kadam' });
  assert.ok(findById(findings, 'kadam.ext.bsection_invalid'));
});

test('Kadam dialect: push detected emits info finding', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-1234' };
  req.imp[0].ext = { subage: 7 };
  const { findings, type } = validate(req, { dialect: 'kadam' });
  assert.ok(findById(findings, 'kadam.push_detected'));
  // type comes from detect.js — pure IAB BidRequest (no push suffix any more)
  assert.equal(type, TYPES.ORTB_REQUEST);
});

test('Kadam dialect: push without subage triggers kadam.imp.subage_missing', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-zone' };
  // imp.ext absent → push detected via idzone, subage missing
  const { findings } = validate(req, { dialect: 'kadam' });
  assert.ok(findById(findings, 'kadam.imp.subage_missing'));
});

test('Kadam dialect: unsupported macro in bid.adm → kadam.bid.macro_unsupported', () => {
  const res = validResponse();
  res.seatbid[0].bid[0].adm = '<a href="${CLICKURL}">click</a>';
  const { findings } = validate(res, { dialect: 'kadam' });
  const f = findById(findings, 'kadam.bid.macro_unsupported');
  assert.ok(f);
  assert.equal(f.params.macro, 'CLICKURL');
});

test('IAB dialect does NOT flag macros — they belong to kadam dialect only', () => {
  const res = validResponse();
  res.seatbid[0].bid[0].adm = '<a href="${CLICKURL}">click</a>';
  const { findings } = validate(res, { dialect: 'iab' });
  assert.equal(findById(findings, 'kadam.bid.macro_unsupported'), undefined);
});

// ── BidResponse paths ────────────────────────────────────────────────────

test('valid BidResponse passes', () => {
  const result = validate(validResponse());
  assert.equal(result.status, 'clean');
  assert.equal(byLevel(result.findings, 'error').length, 0);
});

test('BidResponse missing seatbid is error "response.seatbid_required"', () => {
  const res = validResponse();
  delete res.seatbid;
  const { findings, status } = validate(res);
  assert.equal(status, 'errors');
  assert.ok(findById(findings, 'response.seatbid_required'));
});

test('bid without price is error "response.bid.price_required"', () => {
  const res = validResponse();
  delete res.seatbid[0].bid[0].price;
  const { findings } = validate(res);
  assert.ok(findById(findings, 'response.bid.price_required'));
});

test('bid with no adm and no nurl is warning "response.bid.payload_missing"', () => {
  const res = validResponse();
  delete res.seatbid[0].bid[0].adm;
  delete res.seatbid[0].bid[0].nurl;
  const { findings } = validate(res);
  const f = findById(findings, 'response.bid.payload_missing');
  assert.ok(f);
  assert.equal(f.level, 'warning');
});

// ── Garbage / detection ──────────────────────────────────────────────────

test('non-object payload is invalid', () => {
  const result = validate('hello');
  assert.equal(result.status, 'invalid');
});

test('object with unknown shape is errors with payload.unknown_type', () => {
  const result = validate({ unknown: 'shape' });
  assert.equal(result.status, 'errors');
  assert.ok(findById(result.findings, 'payload.unknown_type'));
});

// ── Localized messages ───────────────────────────────────────────────────

test('messages resolve for default locale (uk)', () => {
  const req = validRequest();
  delete req.id;
  const { findings } = validate(req);
  const f = findById(findings, 'request.id_required');
  assert.ok(f.msg);
  assert.match(f.msg, /id|запит/i);
});

test('messages interpolate params', () => {
  const req = validRequest();
  req.device.geo.country = 'UA';
  const { findings } = validate(req);
  const f = findById(findings, 'request.device.geo.country_invalid');
  assert.match(f.msg, /UA/);
});

test('unknown locale falls back to uk', () => {
  const req = validRequest();
  delete req.id;
  const { findings } = validate(req, { locale: 'xx' });
  assert.ok(findById(findings, 'request.id_required').msg.length > 0);
});

// ── Spec refs attached to known findings ─────────────────────────────────

test('findings carry specRef URLs', () => {
  const req = validRequest();
  delete req.id;
  const { findings } = validate(req);
  const f = findById(findings, 'request.id_required');
  assert.match(f.specRef, /^https:\/\/github\.com\/InteractiveAdvertisingBureau/);
});

// ── Crosscheck — semantic req↔res ─────────────────────────────────────────

test('crosscheck: matching pair has ok findings', () => {
  const findings = crosscheck(validRequest(), validResponse());
  assert.ok(findings.some((f) => f.id === 'crosscheck.id_match' && f.ok));
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.impid_resolved' && f.ok));
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.above_floor' && f.ok));
  assert.ok(findings.some((f) => f.id === 'crosscheck.auction.summary'));
});

test('crosscheck: id mismatch is crit', () => {
  const req = validRequest();
  const res = validResponse();
  res.id = 'different-id';
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.id === 'crosscheck.id_mismatch');
  assert.ok(f);
  assert.equal(f.level, 'crit');
  assert.equal(f.params.reqId, 'req-1');
  assert.equal(f.params.resId, 'different-id');
});

test('crosscheck: bid.impid not in request is crit', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].impid = 'nonexistent-imp';
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.id === 'crosscheck.bid.impid_unresolved');
  assert.ok(f);
  assert.equal(f.level, 'crit');
});

test('crosscheck: price below floor is crit', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].price = 0.05;
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.id === 'crosscheck.bid.below_floor');
  assert.ok(f);
  assert.equal(f.level, 'crit');
});

test('crosscheck: bid.cat in bcat is crit', () => {
  const req = validRequest();
  req.bcat = ['IAB7-39'];
  const res = validResponse();
  res.seatbid[0].bid[0].cat = ['IAB7-39'];
  const findings = crosscheck(req, res);
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.cat_blocked' && f.level === 'crit'));
});

test('crosscheck: banner size mismatch is warn', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].w = 728;
  res.seatbid[0].bid[0].h = 90;
  const findings = crosscheck(req, res);
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.size_mismatch' && f.level === 'warn'));
});

test('crosscheck: empty seatbid returns single crit (crosscheck.no_response)', () => {
  const req = validRequest();
  const res = { id: 'req-1', seatbid: [] };
  const findings = crosscheck(req, res);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'crosscheck.no_response');
});

test('crosscheck findings carry localized msg', () => {
  const findings = crosscheck(validRequest(), validResponse());
  const summary = findings.find((f) => f.id === 'crosscheck.auction.summary');
  assert.ok(summary);
  assert.match(summary.msg, /Підсумок|ставк/);
});

// ── detectVersion ────────────────────────────────────────────────────────

test('detectVersion: 2.5 marker (source.pchain)', () => {
  const v = detectVersion(v25Request());
  assert.equal(v.version, VERSIONS.V_2_5);
  assert.ok(v.signals.includes('source'));
  assert.equal(v.confidence, 0.7);
});

test('detectVersion: 2.6 marker (imp[].rwdd)', () => {
  const v = detectVersion(v26Request());
  assert.equal(v.version, VERSIONS.V_2_6);
  assert.ok(v.signals.includes('imp[].rwdd'));
  assert.equal(v.confidence, 1);
});

test('detectVersion: 2.6 marker (regs.gpp)', () => {
  const v = detectVersion(v26GppRequest());
  assert.equal(v.version, VERSIONS.V_2_6);
  assert.ok(v.signals.includes('regs.gpp'));
});

test('detectVersion: 3.0 envelope (openrtb.ver + item[])', () => {
  const v = detectVersion(v3Request());
  assert.equal(v.version, VERSIONS.V_3_0);
});

test('detectVersion: bare BidRequest with no markers defaults to 2.5 with low confidence', () => {
  const v = detectVersion(validRequest());
  assert.equal(v.version, VERSIONS.V_2_5);
  assert.ok(v.confidence < 0.5);
  assert.equal(v.signals.length, 0);
});

test('detectVersion: garbage input is unknown with confidence 0', () => {
  const v = detectVersion('garbage');
  assert.equal(v.version, VERSIONS.UNKNOWN);
  assert.equal(v.confidence, 0);
});

test('validate() result includes version detection', () => {
  const result = validate(v26Request());
  assert.ok(result.version);
  assert.equal(result.version.version, VERSIONS.V_2_6);
  assert.ok(Array.isArray(result.version.signals));
});

// ── VAST 4.x acceptance + unknown protocol detection ─────────────────────

test('video.protocols with VAST 4.x codes (10, 11, 12) is accepted', () => {
  const req = validRequest();
  req.imp[0] = {
    id: 'i1',
    video: { mimes: ['video/mp4'], protocols: [7, 11, 12] },
  };
  const { findings } = validate(req);
  // Should NOT flag protocols_unknown for these
  assert.equal(findById(findings, 'imp.video.protocols_unknown'), undefined);
});

test('video.protocols with malformed code (e.g. 99) is flagged', () => {
  const req = validRequest();
  req.imp[0] = {
    id: 'i1',
    video: { mimes: ['video/mp4'], protocols: [7, 99] },
  };
  const { findings } = validate(req);
  const f = findById(findings, 'imp.video.protocols_unknown');
  assert.ok(f);
  assert.match(f.params.values, /99/);
});

test('video.protocols with exchange-specific code (>=500) is accepted', () => {
  const req = validRequest();
  req.imp[0] = {
    id: 'i1',
    video: { mimes: ['video/mp4'], protocols: [7, 501] },
  };
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.video.protocols_unknown'), undefined);
});

// ── Native asset crosscheck (low-level helper) ───────────────────────────

test('nativeAssetCrosscheck: complete response has no missing', () => {
  const req = nativeRequest();
  const res = nativeResponse();
  const cm = nativeAssetCrosscheck(req.imp[0].native, res.seatbid[0].bid[0].adm);
  assert.deepEqual(cm.missing, []);
  assert.equal(cm.requiredIds.length, 2);
});

test('nativeAssetCrosscheck: missing required asset is reported', () => {
  const req = nativeRequest();
  const adm = JSON.stringify({
    native: { assets: [{ id: 1, title: { text: 'h' } }], link: { url: 'x' } },
  });
  const cm = nativeAssetCrosscheck(req.imp[0].native, adm);
  assert.deepEqual(cm.missing, [2]);
});

test('nativeAssetCrosscheck: extra asset id is flagged', () => {
  const req = nativeRequest();
  const adm = JSON.stringify({
    native: {
      assets: [
        { id: 1, title: { text: 'h' } },
        { id: 2, img: { url: 'x' } },
        { id: 99, data: { value: 'rogue' } },
      ],
    },
  });
  const cm = nativeAssetCrosscheck(req.imp[0].native, adm);
  assert.deepEqual(cm.extra, [99]);
});

test('nativeAssetCrosscheck: invalid JSON adm returns errorKey', () => {
  const req = nativeRequest();
  const cm = nativeAssetCrosscheck(req.imp[0].native, 'not json');
  assert.equal(cm.errorKey, 'crosscheck.bid.native_invalid_adm');
});
