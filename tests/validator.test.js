'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateORTB, crosscheck, detectType, nativeAssetCrosscheck } = require('../validator');

const { validRequest, validResponse, nativeRequest, nativeResponse } = require('./fixtures');

// Findings are asserted by `path` rather than message text so tests survive
// future i18n / message-key refactors. Path is structurally stable.
const findByPath = (errors, path) => errors.find((e) => e.path === path);
const findingsByLevel = (errors, level) => errors.filter((e) => e.level === level);

// ── detectType ────────────────────────────────────────────────────────────

test('detectType: BidRequest', () => {
  assert.equal(detectType(validRequest()), 'oRTB BidRequest');
});

test('detectType: BidResponse', () => {
  assert.equal(detectType(validResponse()), 'oRTB BidResponse');
});

test('detectType: Kadam Feed (clickunder)', () => {
  assert.equal(detectType({ result: { listing: [{ url: 'x', bid: 1 }] } }), 'Kadam Feed Response');
});

test('detectType: Kadam Feed (push array)', () => {
  assert.equal(detectType([{ id: 'm1' }]), 'Kadam Feed Response');
});

test('detectType: garbage', () => {
  assert.equal(detectType('not an object'), 'unknown');
  assert.equal(detectType(42), 'unknown');
});

// ── validateORTB on a valid BidRequest ────────────────────────────────────

test('valid BidRequest: status Healthy, no danger findings', () => {
  const result = validateORTB(validRequest());
  assert.equal(result.status, 'Healthy');
  assert.equal(findingsByLevel(result.errors, 'danger').length, 0);
  assert.match(result.type, /BidRequest/);
});

// ── BidRequest danger paths ──────────────────────────────────────────────

test('missing BidRequest.id is danger at path "id"', () => {
  const req = validRequest();
  delete req.id;
  const { errors, status } = validateORTB(req);
  assert.equal(status, 'Critical');
  assert.ok(findByPath(errors, 'id'));
  assert.equal(findByPath(errors, 'id').level, 'danger');
});

test('empty imp[] is danger at path "imp"', () => {
  const req = validRequest();
  req.imp = [];
  const { errors, status } = validateORTB(req);
  assert.equal(status, 'Critical');
  assert.ok(findByPath(errors, 'imp'));
});

test('missing site AND app is danger at path "site/app"', () => {
  const req = validRequest();
  delete req.site;
  delete req.app;
  const { errors, status } = validateORTB(req);
  assert.equal(status, 'Critical');
  assert.ok(findByPath(errors, 'site/app'));
});

test('banner without w/h or format[] is danger at path "imp[0].banner"', () => {
  const req = validRequest();
  req.imp[0].banner = {}; // no w, no h, no format
  const { errors } = validateORTB(req);
  assert.ok(findByPath(errors, 'imp[0].banner'));
  assert.equal(findByPath(errors, 'imp[0].banner').level, 'danger');
});

test('banner with format[] but no w/h is OK', () => {
  const req = validRequest();
  req.imp[0].banner = {
    format: [
      { w: 300, h: 250 },
      { w: 728, h: 90 },
    ],
  };
  const { errors } = validateORTB(req);
  assert.equal(findByPath(errors, 'imp[0].banner'), undefined);
});

test('imp without any format slot is danger at path "imp[0]"', () => {
  const req = validRequest();
  delete req.imp[0].banner; // no banner, video, native, audio
  const { errors } = validateORTB(req);
  assert.ok(findByPath(errors, 'imp[0]'));
});

// ── BidRequest warning paths ─────────────────────────────────────────────

test('non-ISO-3166 country is warning at path "device.geo.country"', () => {
  const req = validRequest();
  req.device.geo.country = 'UA'; // alpha-2 instead of alpha-3
  const { errors } = validateORTB(req);
  const f = findByPath(errors, 'device.geo.country');
  assert.ok(f);
  assert.equal(f.level, 'warning');
});

test('valid alpha-3 country produces no country warning', () => {
  const req = validRequest();
  req.device.geo.country = 'POL';
  const { errors } = validateORTB(req);
  assert.equal(findByPath(errors, 'device.geo.country'), undefined);
});

test('non-array bcat is warning at path "bcat"', () => {
  const req = validRequest();
  req.bcat = 'IAB7';
  const { errors } = validateORTB(req);
  assert.ok(findByPath(errors, 'bcat'));
});

test('invalid user.gender is warning', () => {
  const req = validRequest();
  req.user = { gender: 'X' };
  const { errors } = validateORTB(req);
  assert.ok(findByPath(errors, 'user.gender'));
});

// ── Push trafffic detection ──────────────────────────────────────────────

test('push impression detection adds info finding', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-1234' };
  req.imp[0].ext = { subage: 7 };
  const { errors, type } = validateORTB(req);
  assert.match(type, /push/);
  assert.ok(errors.some((e) => e.level === 'info' && e.path === 'imp.ext'));
});

test('push without subage triggers warning', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-zone' };
  // no imp.ext.subage → warning
  const { errors } = validateORTB(req);
  assert.ok(findByPath(errors, 'imp[0].ext.subage'));
});

// ── BidResponse paths ────────────────────────────────────────────────────

test('valid BidResponse passes', () => {
  const result = validateORTB(validResponse());
  assert.equal(result.status, 'Healthy');
  assert.equal(findingsByLevel(result.errors, 'danger').length, 0);
});

test('BidResponse missing seatbid is danger', () => {
  const res = validResponse();
  delete res.seatbid;
  const { errors, status } = validateORTB(res);
  assert.equal(status, 'Critical');
  assert.ok(findByPath(errors, 'seatbid'));
});

test('bid without price is danger', () => {
  const res = validResponse();
  delete res.seatbid[0].bid[0].price;
  const { errors } = validateORTB(res);
  assert.ok(findByPath(errors, 'seatbid[0].bid[0].price'));
});

test('bid with no adm and no nurl is warning', () => {
  const res = validResponse();
  delete res.seatbid[0].bid[0].adm;
  delete res.seatbid[0].bid[0].nurl;
  const { errors } = validateORTB(res);
  const f = findByPath(errors, 'seatbid[0].bid[0].adm');
  assert.ok(f);
  assert.equal(f.level, 'warning');
});

test('unsupported macro in bid.adm yields warning', () => {
  const res = validResponse();
  res.seatbid[0].bid[0].adm = '<a href="${CLICKURL}">click</a>'; // not in supported set
  const { errors } = validateORTB(res);
  assert.ok(errors.some((e) => e.level === 'warning' && /CLICKURL/.test(e.msg)));
});

// ── Garbage / detection ──────────────────────────────────────────────────

test('non-object payload is Invalid', () => {
  const result = validateORTB('hello');
  assert.equal(result.status, 'Invalid');
});

test('object that matches no known type is Critical with detection error', () => {
  const result = validateORTB({ unknown: 'shape' });
  assert.equal(result.status, 'Critical');
  assert.ok(result.errors.length > 0);
});

// ── Crosscheck — semantic req↔res ─────────────────────────────────────────

test('crosscheck: matching pair produces ok findings', () => {
  const findings = crosscheck(validRequest(), validResponse());
  // id match
  assert.ok(findings.some((f) => f.path === 'id' && f.ok));
  // impid resolution
  assert.ok(findings.some((f) => f.path.endsWith('.impid') && f.ok));
  // price ≥ floor
  assert.ok(findings.some((f) => f.path.endsWith('.price') && f.ok));
  // auction summary
  assert.ok(findings.some((f) => f.path === 'auction'));
});

test('crosscheck: id mismatch is crit', () => {
  const req = validRequest();
  const res = validResponse();
  res.id = 'different-id';
  const findings = crosscheck(req, res);
  const idFinding = findings.find((f) => f.path === 'id');
  assert.ok(idFinding);
  assert.equal(idFinding.level, 'crit');
});

test('crosscheck: bid.impid not in request is crit', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].impid = 'nonexistent-imp';
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.path.endsWith('.impid') && !x.ok);
  assert.ok(f);
  assert.equal(f.level, 'crit');
});

test('crosscheck: price below floor is crit', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].price = 0.05; // below 0.10 floor
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.path.endsWith('.price') && !x.ok);
  assert.ok(f);
  assert.equal(f.level, 'crit');
});

test('crosscheck: bid.cat in bcat is crit', () => {
  const req = validRequest();
  req.bcat = ['IAB7-39'];
  const res = validResponse();
  res.seatbid[0].bid[0].cat = ['IAB7-39'];
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.path.endsWith('.cat') && !x.ok);
  assert.ok(f);
  assert.equal(f.level, 'crit');
});

test('crosscheck: banner size mismatch is warn', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].w = 728;
  res.seatbid[0].bid[0].h = 90;
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.path.endsWith('.size') && !x.ok);
  assert.ok(f);
  assert.equal(f.level, 'warn');
});

test('crosscheck: empty seatbid returns single crit', () => {
  const req = validRequest();
  const res = { id: 'req-1', seatbid: [] };
  const findings = crosscheck(req, res);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'crit');
});

// ── Native asset crosscheck ───────────────────────────────────────────────

test('nativeAssetCrosscheck: complete response has no missing', () => {
  const req = nativeRequest();
  const res = nativeResponse();
  const cm = nativeAssetCrosscheck(req.imp[0].native, res.seatbid[0].bid[0].adm);
  assert.deepEqual(cm.missing, []);
  assert.equal(cm.requiredIds.length, 2);
});

test('nativeAssetCrosscheck: missing required asset is reported', () => {
  const req = nativeRequest();
  // Response missing one of the required assets (id 2)
  const adm = JSON.stringify({
    native: {
      assets: [{ id: 1, title: { text: 'h' } }], // only id 1
      link: { url: 'x' },
    },
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
        { id: 99, data: { value: 'rogue' } }, // not in request
      ],
    },
  });
  const cm = nativeAssetCrosscheck(req.imp[0].native, adm);
  assert.deepEqual(cm.extra, [99]);
});

test('nativeAssetCrosscheck: invalid JSON adm returns error', () => {
  const req = nativeRequest();
  const cm = nativeAssetCrosscheck(req.imp[0].native, 'not json');
  assert.ok(cm.error);
});
