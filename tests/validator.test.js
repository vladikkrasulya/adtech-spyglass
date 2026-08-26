'use strict';

/**
 * Validator tests. Findings are asserted by stable `id` and `path` fields,
 * not by message text — so the suite survives future i18n / copy edits.
 *
 * Test fixtures default to the IAB dialect (no vendor-dialect extras unless the test
 * explicitly opts in via { dialect: 'ext-rtb' }).
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
} = require('@ortbtools/core');

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

test('detectType: vendor feed (clickunder)', () => {
  assert.equal(detectType({ result: { listing: [{ url: 'x', bid: 1 }] } }), TYPES.VENDOR_FEED);
});

test('detectType: vendor feed (push array)', () => {
  assert.equal(detectType([{ id: 'm1' }]), TYPES.VENDOR_FEED);
});

test('detectType: URL request (clickunder feed)', () => {
  const url =
    'https://ads.example/feed?sid=123&format=cu&ua=Mozilla%2F5.0&ip=192.0.2.1&uid=u1&limit=1&language=en&pid=p1&page=https%3A%2F%2Fpub.example%2Fa';
  assert.equal(detectType(url), TYPES.URL_REQUEST);
});

test('detectType: garbage', () => {
  assert.equal(detectType('not an object'), TYPES.UNKNOWN);
  assert.equal(detectType(42), TYPES.UNKNOWN);
});

test('valid URL request clickunder feed: status clean and canonical format pops', () => {
  const url =
    'https://ads.example/feed?sid=123&format=cu&ua=Mozilla%2F5.0&ip=192.0.2.1&uid=u1&limit=1&language=en&pid=p1&page=https%3A%2F%2Fpub.example%2Fa';
  const result = validate(url);
  assert.equal(result.type, TYPES.URL_REQUEST);
  assert.equal(result.status, 'clean');
  assert.equal(result.urlRequest.variant, 'url-clickunder-feed');
  assert.equal(result.urlRequest.format, 'pops');
  assert.equal(result.urlRequest.device.ip, '192.0.2.1');
  assert.equal(result.urlRequest.device.ua, 'Mozilla/5.0');
  assert.equal(result.urlRequest.device.language, 'en');
  assert.equal(result.urlRequest.site.page, 'https://pub.example/a');
  assert.equal(result.urlRequest.user.id, 'u1');
});

test('valid URL request clickunder feed: trailing slash path and aliases decode', () => {
  for (const format of ['clickunder', 'popunder', 'popup']) {
    const url = `https://ads.example/feed/?sid=123&format=${format}&ip=192.0.2.1`;
    const result = validate(url);
    assert.equal(result.type, TYPES.URL_REQUEST);
    assert.equal(result.status, 'clean');
    assert.equal(result.urlRequest.variant, 'url-clickunder-feed');
    assert.equal(result.urlRequest.format, 'pops');
  }
});

test('valid URL request link-feed: canonical format pops', () => {
  const url =
    'https://ads.example/link?format=json&feed=abc&auth=tok&subid=u1&user_ip=192.0.2.1&ua=Mozilla%2F5.0&url=https%3A%2F%2Fpub.example%2Fa&lang=en';
  const result = validate(url);
  assert.equal(result.type, TYPES.URL_REQUEST);
  assert.equal(result.status, 'clean');
  assert.equal(result.urlRequest.variant, 'url-linkfeed');
  assert.equal(result.urlRequest.format, 'pops');
});

test('valid URL request search-feed: synthetic authenticated shape is accepted', () => {
  const url =
    'https://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=demo-query' +
    '&subid=u1&user_ip=192.0.2.44&ua=Mozilla%2F5.0' +
    '&url=https%3A%2F%2Fpublisher.example%2F&count=1&ad_info=1&lang=en';
  const result = validate(url);
  assert.equal(result.type, TYPES.URL_REQUEST);
  assert.equal(result.status, 'clean');
  assert.equal(result.urlRequest.variant, 'url-search-feed');
  assert.equal(result.urlRequest.endpoint, 'feed.vendor.example/search');
  assert.equal(result.urlRequest.format, undefined);
  assert.ok(Object.hasOwn(result.urlRequest._raw, 'auth'));
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

test('both site AND app present is warning "request.site_and_app_both"', () => {
  const req = validRequest();
  // validRequest() ships with site; add app so both are present.
  req.app = { bundle: 'com.example.app' };
  const { findings } = validate(req);
  const f = findById(findings, 'request.site_and_app_both');
  assert.ok(f, 'site+app dual presence should fire request.site_and_app_both');
  assert.equal(f.level, 'warning');
  // And we must NOT spuriously fire the opposite "neither present" rule.
  assert.equal(findById(findings, 'request.no_site_or_app'), undefined);
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

// ── New strict rules (2026-05-05): at, bidfloorcur, GDPR consent ────────

test('missing at is informational, not an error', () => {
  // `at` carries a spec default of 2, and a field with a default cannot be
  // required — the default is what the exchange applies when it is absent.
  // At ERROR this rolled a spec-compliant payload up to "errors".
  const req = validRequest();
  delete req.at;
  const { findings, status } = validate(req);
  const f = findById(findings, 'request.at_required');
  assert.ok(f, 'expected request.at_required finding');
  assert.equal(f.level, 'info');
  assert.equal(f.path, 'at');
  assert.notEqual(status, 'errors', 'a missing default must not fail the payload');
  // at_invalid must NOT also fire when at is missing — separate rules.
  assert.equal(findById(findings, 'request.at_invalid'), undefined);
});

test('non-numeric at (string "1") is error "request.at_required"', () => {
  const req = validRequest();
  req.at = '1';
  const { findings } = validate(req);
  assert.ok(findById(findings, 'request.at_required'));
  // at_invalid must NOT fire — typeof check upstream prevents double-flag.
  assert.equal(findById(findings, 'request.at_invalid'), undefined);
});

test('at = 3 is warning "request.at_invalid", not at_required', () => {
  const req = validRequest();
  req.at = 3;
  const { findings } = validate(req);
  assert.equal(findById(findings, 'request.at_required'), undefined);
  const f = findById(findings, 'request.at_invalid');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.params.at, 3);
});

test('positive bidfloor without bidfloorcur is warning "imp.bidfloorcur_missing"', () => {
  const req = validRequest();
  delete req.imp[0].bidfloorcur;
  const { findings } = validate(req);
  const f = findById(findings, 'imp.bidfloorcur_missing');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.path, 'imp[0].bidfloor');
  assert.equal(f.params.num, 1);
});

test('bidfloor = 0 with no bidfloorcur is OK (rule gates on > 0)', () => {
  const req = validRequest();
  req.imp[0].bidfloor = 0;
  delete req.imp[0].bidfloorcur;
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.bidfloorcur_missing'), undefined);
});

test('GDPR=1 without user.ext.consent is warning "regs.gdpr_consent_missing"', () => {
  const req = validRequest();
  req.regs = { ext: { gdpr: 1 } };
  // user.ext.consent absent
  const { findings } = validate(req);
  const f = findById(findings, 'regs.gdpr_consent_missing');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.path, 'regs.ext.gdpr');
});

test('GDPR=1 with non-empty user.ext.consent is OK', () => {
  const req = validRequest();
  req.regs = { ext: { gdpr: 1 } };
  req.user = { ext: { consent: 'CO_well_formed_TCF_string_xxx' } };
  const { findings } = validate(req);
  assert.equal(findById(findings, 'regs.gdpr_consent_missing'), undefined);
});

test('GDPR=0 produces no consent finding regardless of user.ext.consent', () => {
  const req = validRequest();
  req.regs = { ext: { gdpr: 0 } };
  // No consent at all — shouldn't matter when GDPR is opted out.
  const { findings } = validate(req);
  assert.equal(findById(findings, 'regs.gdpr_consent_missing'), undefined);
});

// ── Dialect: IAB default does NOT emit vendor-dialect extras ──────────────

test('IAB dialect ignores ext.bsection (no extrtb-* findings)', () => {
  const req = validRequest();
  req.ext = { bsection: 'wrong-type' };
  const { findings } = validate(req, { dialect: 'iab' });
  assert.equal(findings.filter((f) => f.id.startsWith('extrtb.')).length, 0);
});

test('IAB dialect ignores push markers (no extrtb.push_detected)', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-zone' };
  req.imp[0].ext = { subage: 7 };
  const { findings } = validate(req, { dialect: 'iab' });
  assert.equal(findings.filter((f) => f.id.startsWith('extrtb.')).length, 0);
});

// ── Dialect: Ext-RTB emits its extras ─────────────────────────────────────

test('Ext-RTB dialect: ext.bsection wrong type → extrtb.ext.bsection_invalid', () => {
  const req = validRequest();
  req.ext = { bsection: 'wrong-type' };
  const { findings } = validate(req, { dialect: 'ext-rtb' });
  assert.ok(findById(findings, 'extrtb.ext.bsection_invalid'));
});

test('Ext-RTB dialect: push detected emits info finding', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-1234' };
  req.imp[0].ext = { subage: 7 };
  const { findings, type } = validate(req, { dialect: 'ext-rtb' });
  assert.ok(findById(findings, 'extrtb.push_detected'));
  // type comes from detect.js — pure IAB BidRequest (no push suffix any more)
  assert.equal(type, TYPES.ORTB_REQUEST);
});

test('Ext-RTB dialect: push without subage triggers extrtb.imp.subage_missing', () => {
  const req = validRequest();
  req.site.ext = { idzone: 'push-zone' };
  // imp.ext absent → push detected via idzone, subage missing
  const { findings } = validate(req, { dialect: 'ext-rtb' });
  assert.ok(findById(findings, 'extrtb.imp.subage_missing'));
});

test('Ext-RTB dialect: unsupported macro in bid.adm → extrtb.bid.macro_unsupported', () => {
  const res = validResponse();
  res.seatbid[0].bid[0].adm = '<a href="${CLICKURL}">click</a>';
  const { findings } = validate(res, { dialect: 'ext-rtb' });
  const f = findById(findings, 'extrtb.bid.macro_unsupported');
  assert.ok(f);
  assert.equal(f.params.macro, 'CLICKURL');
});

test('IAB dialect does NOT flag macros — they belong to ext-rtb dialect only', () => {
  const res = validResponse();
  res.seatbid[0].bid[0].adm = '<a href="${CLICKURL}">click</a>';
  const { findings } = validate(res, { dialect: 'iab' });
  assert.equal(findById(findings, 'extrtb.bid.macro_unsupported'), undefined);
});

// ── BidResponse paths ────────────────────────────────────────────────────

test('valid BidResponse passes', () => {
  const result = validate(validResponse());
  assert.equal(result.status, 'clean');
  assert.equal(byLevel(result.findings, 'error').length, 0);
});

test('BidResponse missing seatbid AND nbr is error "response.seatbid_or_nbr_required"', () => {
  const res = validResponse();
  delete res.seatbid;
  const { findings, status } = validate(res);
  assert.equal(status, 'errors');
  assert.ok(findById(findings, 'response.seatbid_or_nbr_required'));
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

test('malformed notice URL is a warning and points at the exact notice field', () => {
  const res = validResponse();
  res.seatbid[0].bid[0].burl = '=broken&bid=${AUCTION_PRICE}<iframe></iframe>';
  const { findings, status } = validate(res);
  const f = findById(findings, 'response.bid.notice_url_invalid');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.path, 'seatbid[0].bid[0].burl');
  assert.equal(f.params.field, 'burl');
  assert.equal(status, 'warnings');
});

test('notice URL validation accepts HTTP(S) macro templates and exact CDATA wrappers', () => {
  const res = validResponse();
  const bid = res.seatbid[0].bid[0];
  bid.nurl = 'https://notice.example/win?p=${AUCTION_PRICE}';
  bid.burl = '<![CDATA[https://notice.example/bill?id=${AUCTION_ID}]]>';
  bid.lurl = 'http://notice.example/loss?code=${AUCTION_LOSS}';
  const { findings } = validate(res);
  assert.equal(findById(findings, 'response.bid.notice_url_invalid'), undefined);
});

test('whitespace-padded CDATA notice URLs are accepted; junk inside is still caught', () => {
  // XML→JSON adapters emit `<![CDATA[ url ]]>` with padding or newlines —
  // that is the common form, and the first version of this rule accepted only
  // the byte-exact wrapper while the product's own macro evaluator
  // (cleanRawUrl) took both. The trim must not become a loophole, though:
  // markup INSIDE the wrapper is still an adapter concatenation bug.
  const res = validResponse();
  const bid = res.seatbid[0].bid[0];
  bid.nurl = '<![CDATA[ https://notice.example/win?p=${AUCTION_PRICE} ]]>';
  bid.burl = '<![CDATA[\nhttps://notice.example/bill\n]]>';
  const { findings } = validate(res);
  assert.equal(findById(findings, 'response.bid.notice_url_invalid'), undefined);

  const bad = validResponse();
  bad.seatbid[0].bid[0].burl = '<![CDATA[ https://notice.example/bill <iframe> ]]>';
  const hits = validate(bad).findings.filter((f) => f.id === 'response.bid.notice_url_invalid');
  assert.equal(hits.length, 1, 'markup inside CDATA must stay flagged');
});

test('all present notice fields must be absolute HTTP(S) string templates', () => {
  const res = validResponse();
  const bid = res.seatbid[0].bid[0];
  bid.nurl = '/relative/win';
  bid.burl = { url: 'https://notice.example/bill' };
  bid.lurl = 'javascript:alert(1)';
  const hits = validate(res).findings.filter((f) => f.id === 'response.bid.notice_url_invalid');
  assert.deepEqual(
    hits.map((f) => f.path),
    ['seatbid[0].bid[0].burl', 'seatbid[0].bid[0].lurl', 'seatbid[0].bid[0].nurl'],
  );
});

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

test('crosscheck: price below floor is a warning, not a failure', () => {
  // Bidding under the floor is a losing bid, not a broken response: the
  // exchange accepts and processes the payload, then declines to select this
  // bid. At `crit` the crosscheck failed a document with nothing wrong in it.
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].price = 0.05;
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.id === 'crosscheck.bid.below_floor');
  assert.ok(f, 'the bid should still be reported as under the floor');
  assert.equal(f.level, 'warn');
});

test('crosscheck: bid currency ≠ floor currency → floor_currency_mismatch, no numeric verdict', () => {
  const req = validRequest();
  req.cur = ['USD', 'EUR'];
  req.imp[0].bidfloor = 0.5;
  req.imp[0].bidfloorcur = 'EUR';
  const res = validResponse();
  res.cur = 'USD';
  res.seatbid[0].bid[0].price = 0.6; // numerically > 0.5 but a different currency
  const findings = crosscheck(req, res);
  const mm = findings.find((x) => x.id === 'crosscheck.bid.floor_currency_mismatch');
  assert.ok(mm, 'floor_currency_mismatch should fire when bid cur differs from floor cur');
  assert.equal(mm.level, 'warn');
  assert.equal(mm.params.bidCur, 'USD');
  assert.equal(mm.params.floorCur, 'EUR');
  // The numeric above/below verdicts are meaningless cross-currency and must be suppressed.
  assert.equal(
    findings.find((x) => x.id === 'crosscheck.bid.above_floor'),
    undefined,
  );
  assert.equal(
    findings.find((x) => x.id === 'crosscheck.bid.below_floor'),
    undefined,
  );
});

test('crosscheck: imp without bidfloor → no_floor_set WARN', () => {
  const req = validRequest();
  delete req.imp[0].bidfloor;
  delete req.imp[0].bidfloorcur;
  const res = validResponse();
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.id === 'crosscheck.bid.no_floor_set');
  assert.ok(f, 'no_floor_set should fire when imp.bidfloor is missing');
  assert.equal(f.level, 'warn');
  assert.equal(f.path, 'imp[0].bidfloor');
  assert.equal(f.params.impid, 'imp-1');
  // above_floor must still fire — the comparison happens against implicit 0
  assert.ok(findings.some((x) => x.id === 'crosscheck.bid.above_floor' && x.ok));
});

test('crosscheck: imp with bidfloor:0 explicit → no no_floor_set fired', () => {
  const req = validRequest();
  req.imp[0].bidfloor = 0;
  const res = validResponse();
  const findings = crosscheck(req, res);
  // explicit 0 means the integrator opted in; not a degenerate auction
  assert.equal(
    findings.filter((x) => x.id === 'crosscheck.bid.no_floor_set').length,
    0,
    'explicit bidfloor:0 must not fire no_floor_set',
  );
});

test('crosscheck: no_floor_set fires at most once per imp across multiple bids', () => {
  const req = validRequest();
  delete req.imp[0].bidfloor;
  const res = validResponse();
  // Three bids targeting the same imp.
  res.seatbid[0].bid = [
    { ...res.seatbid[0].bid[0], id: 'b1', price: 1.0 },
    { ...res.seatbid[0].bid[0], id: 'b2', price: 1.5 },
    { ...res.seatbid[0].bid[0], id: 'b3', price: 2.0 },
  ];
  const findings = crosscheck(req, res);
  const hits = findings.filter((x) => x.id === 'crosscheck.bid.no_floor_set');
  assert.equal(hits.length, 1, 'should de-dupe per imp');
});

test('crosscheck: bid.cat in bcat is crit', () => {
  const req = validRequest();
  req.bcat = ['IAB7-39'];
  const res = validResponse();
  res.seatbid[0].bid[0].cat = ['IAB7-39'];
  const findings = crosscheck(req, res);
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.cat_blocked' && f.level === 'crit'));
});

test('crosscheck: bcat parent blocks child via hierarchy (IAB Taxonomy 1.x)', () => {
  // bcat=["IAB7"] (Health & Fitness top-level) must block any subcategory
  // like "IAB7-1" (Exercise) or "IAB7-39" (Substance Abuse).
  // Pre-v0.25.0: exact-string match only — bid cleared the block.
  const req = validRequest();
  req.bcat = ['IAB7'];
  const res = validResponse();
  res.seatbid[0].bid[0].cat = ['IAB7-39'];
  const findings = crosscheck(req, res);
  assert.ok(
    findings.some((f) => f.id === 'crosscheck.bid.cat_blocked' && f.level === 'crit'),
    'IAB7-39 should be blocked by bcat=["IAB7"] via hierarchical match',
  );
});

test('crosscheck: bcat parent blocks child via hierarchy (IAB Taxonomy 2.x)', () => {
  // 2.x uses plain numbers: bcat=["1"] should block "1-7".
  const req = validRequest();
  req.bcat = ['1'];
  const res = validResponse();
  res.seatbid[0].bid[0].cat = ['1-7'];
  const findings = crosscheck(req, res);
  assert.ok(
    findings.some((f) => f.id === 'crosscheck.bid.cat_blocked' && f.level === 'crit'),
    'Taxonomy 2.x: id "1-7" should be blocked by bcat=["1"]',
  );
});

test('crosscheck: bcat does NOT match sibling-by-prefix (IAB1 vs IAB10)', () => {
  // Strict hierarchical match: "IAB10" is NOT a child of "IAB1" — they are
  // independent top-level categories. The prefix rule must require a hyphen
  // boundary; otherwise we'd false-block sibling categories.
  const req = validRequest();
  req.bcat = ['IAB1'];
  const res = validResponse();
  res.seatbid[0].bid[0].cat = ['IAB10'];
  const findings = crosscheck(req, res);
  assert.ok(
    !findings.some((f) => f.id === 'crosscheck.bid.cat_blocked'),
    'IAB10 must NOT be blocked by bcat=["IAB1"] — different top-level category',
  );
  // Should see cat_clean instead, since bcat is non-empty and bid.cat present.
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.cat_clean'));
});

test('crosscheck: banner size mismatch is warn', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].w = 728;
  res.seatbid[0].bid[0].h = 90;
  const findings = crosscheck(req, res);
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.size_mismatch' && f.level === 'warn'));
});

test('crosscheck: pop bid with adomain matching landing host → match OK', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].ext = { adtype: 'popunder' };
  res.seatbid[0].bid[0].adm = '<script>window.open("https://landing.com/promo")</script>';
  res.seatbid[0].bid[0].adomain = ['landing.com'];
  const findings = crosscheck(req, res);
  assert.ok(
    findings.some((f) => f.id === 'crosscheck.bid.pop.adomain_landing_match' && f.ok),
    'should emit landing_match OK',
  );
  assert.ok(!findings.some((f) => f.id === 'crosscheck.bid.pop.adomain_landing_mismatch'));
});

test('crosscheck: pop bid with adomain mismatching landing → mismatch CRIT', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].ext = { adtype: 'popunder' };
  res.seatbid[0].bid[0].adm = '<script>window.open("https://evil-spoof.tld/")</script>';
  res.seatbid[0].bid[0].adomain = ['legit-brand.com'];
  const findings = crosscheck(req, res);
  const f = findings.find((x) => x.id === 'crosscheck.bid.pop.adomain_landing_mismatch');
  assert.ok(f, 'should emit landing_mismatch');
  assert.equal(f.level, 'crit');
  assert.equal(f.params.landing, 'evil-spoof.tld');
  assert.match(f.params.declared, /legit-brand\.com/);
});

test('crosscheck: pop bid with subdomain landing matches adomain (host ⊆ adomain)', () => {
  const req = validRequest();
  const res = validResponse();
  res.seatbid[0].bid[0].ext = { adtype: 'popunder' };
  res.seatbid[0].bid[0].adm = 'https://ads.brand.com/utm';
  res.seatbid[0].bid[0].adomain = ['brand.com'];
  const findings = crosscheck(req, res);
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.pop.adomain_landing_match' && f.ok));
});

test('crosscheck: non-pop bid does NOT trigger adomain_landing_* check', () => {
  const req = validRequest();
  const res = validResponse();
  // No bid.ext.adtype — banner bid. adm has window.open but the request side
  // doesn't smell like pop, so the check should be inert.
  const findings = crosscheck(req, res);
  assert.ok(!findings.some((f) => f.id.startsWith('crosscheck.bid.pop.')));
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

// ── Version pinning (v0.38.0) ────────────────────────────────────────────

test('version pinning: expected=2.5 but payload has 2.6 markers → version.mismatch', () => {
  // The canonical "rogue 2.6 field in a pinned-2.5 payload" scenario from
  // Round 1 of the audit. v26Request() includes imp[].rwdd which is a
  // 2.6-only field; the detector flips to 2.6 silently. With pinning we
  // surface the mismatch so the dev sees that rwdd is the rogue field.
  const result = validate(v26Request(), { expectedVersion: VERSIONS.V_2_5 });
  const f = findById(result.findings, 'version.mismatch');
  assert.ok(f, 'version.mismatch must fire');
  assert.equal(f.level, 'warning');
  assert.equal(f.params.expected, VERSIONS.V_2_5);
  assert.equal(f.params.detected, VERSIONS.V_2_6);
  // signals param should be JSON-stringified array carrying the path that
  // triggered the detection flip
  const signals = JSON.parse(f.params.signals);
  assert.ok(Array.isArray(signals));
  assert.ok(
    signals.some((s) => s.includes('rwdd')),
    'signals should mention rwdd (the 2.6-only field that flipped detection)',
  );
});

test('version pinning: expected=2.6 but only 2.5 markers present → version.mismatch', () => {
  // Inverse case: dev declares "this is a 2.6 stream" but the payload only
  // carries 2.5 signals (source.pchain). Detection lands on 2.5; pinning
  // surfaces the gap so dev can confirm whether the pin or the payload
  // is wrong.
  const result = validate(v25Request(), { expectedVersion: VERSIONS.V_2_6 });
  const f = findById(result.findings, 'version.mismatch');
  assert.ok(f, 'version.mismatch must fire (2.6 expected, 2.5 detected)');
  assert.equal(f.params.expected, VERSIONS.V_2_6);
  assert.equal(f.params.detected, VERSIONS.V_2_5);
});

test('version pinning: expected matches detected → NO mismatch finding', () => {
  // The happy path. v26Request() has 2.6 markers; pinning to 2.6 should
  // be silent on the version axis. (Other findings — like
  // device.client_hints.os_unknown — are still allowed.)
  const result = validate(v26Request(), { expectedVersion: VERSIONS.V_2_6 });
  assert.equal(
    findById(result.findings, 'version.mismatch'),
    undefined,
    'matching pin must not fire mismatch',
  );
});

test('version pinning: no opts.expectedVersion → backward-compat, no mismatch', () => {
  // Regression guard: pre-v0.38.0 behavior must be preserved when caller
  // omits expectedVersion. Skipping pinning entirely (not even a finding
  // for "version is unknown").
  const result = validate(v26Request());
  assert.equal(findById(result.findings, 'version.mismatch'), undefined);
});

test('version pinning: invalid expected (random string) is silently ignored', () => {
  // Garbage-in defense: we accept any string but only act on the three
  // pinnable versions. Anything else degrades to no-finding rather than
  // throwing or "expected_unknown" noise.
  const result = validate(v26Request(), { expectedVersion: 'banana' });
  assert.equal(findById(result.findings, 'version.mismatch'), undefined);
});

test('version pinning: non-oRTB type (JSON Feed) → no mismatch', () => {
  // Pinning is meaningful only on the oRTB axis. Other formats (JSON
  // Feed, vendor feed) don't carry an IAB version, so even with an
  // expectedVersion the rule stays silent.
  const jsonFeed = { version: 'https://jsonfeed.org/version/1.1', items: [] };
  const result = validate(jsonFeed, { expectedVersion: VERSIONS.V_2_6 });
  assert.equal(findById(result.findings, 'version.mismatch'), undefined);
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

// ── Non-IAB ad-format detection (pop / clickunder / pushunder / push) ────

test('non-standard format: ext.adtype="popunder" is flagged', () => {
  const req = validRequest();
  req.imp[0].ext = { adtype: 'popunder' };
  const { findings } = validate(req);
  const f = findById(findings, 'imp.non_standard_format');
  assert.ok(f, 'expected imp.non_standard_format finding');
  assert.equal(f.params.format, 'popunder');
  assert.equal(f.level, 'info');
});

test('non-standard format: ext.pop = true is flagged', () => {
  const req = validRequest();
  req.imp[0].ext = { pop: true };
  const { findings } = validate(req);
  const f = findById(findings, 'imp.non_standard_format');
  assert.ok(f);
  assert.equal(f.params.format, 'pop');
});

test('non-standard format: ext.format="click_under" normalises to clickunder', () => {
  const req = validRequest();
  req.imp[0].ext = { format: 'click_under' };
  const { findings } = validate(req);
  const f = findById(findings, 'imp.non_standard_format');
  assert.ok(f);
  assert.equal(f.params.format, 'clickunder');
});

test('non-standard format: req.ext.adtype="push" surfaces from request root', () => {
  const req = validRequest();
  req.ext = { adtype: 'push' };
  const { findings } = validate(req);
  const f = findById(findings, 'imp.non_standard_format');
  assert.ok(f);
  assert.equal(f.params.format, 'push');
  assert.ok(f.path.startsWith('ext'), 'path should point at request.ext');
});

test('non-standard format: same format on multiple imps emits one finding (deduped)', () => {
  const req = validRequest();
  req.imp = [
    { id: 'i1', banner: { w: 300, h: 250 }, ext: { adtype: 'popunder' } },
    { id: 'i2', banner: { w: 300, h: 250 }, ext: { adtype: 'popunder' } },
  ];
  const { findings } = validate(req);
  const all = findings.filter((f) => f.id === 'imp.non_standard_format');
  assert.equal(all.length, 1, 'duplicate format should be deduped');
});

test('non-standard format: legitimate ext.adtype="banner" is NOT flagged', () => {
  const req = validRequest();
  req.imp[0].ext = { adtype: 'banner' };
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.non_standard_format'), undefined);
});

// ── AdKernel-routed traffic detection ────────────────────────────────────

test('adkernel: imp.ext.adkernel = { zoneId } emits info-level finding', () => {
  const req = validRequest();
  req.imp[0].ext = { adkernel: { zoneId: 12345, host: 'pbs.adksrv.com' } };
  const { findings } = validate(req);
  const f = findById(findings, 'info.adkernel.routed');
  assert.ok(f, 'expected info.adkernel.routed finding');
  assert.equal(f.level, 'info');
  assert.equal(f.params.alias, 'adkernel');
});

test('adkernel: aliased network (waardex_ak) is detected', () => {
  const req = validRequest();
  req.imp[0].ext = { waardex_ak: { zoneId: 999, host: 'rtb.waardex.com' } };
  const { findings } = validate(req);
  const f = findById(findings, 'info.adkernel.routed');
  assert.ok(f);
  assert.equal(f.params.alias, 'waardex_ak');
});

test('adkernel: Prebid-server style imp.ext.bidder.adkernel detected', () => {
  const req = validRequest();
  req.imp[0].ext = { bidder: { adkernel: { zoneId: 1, host: 'h' } } };
  const { findings } = validate(req);
  assert.ok(findById(findings, 'info.adkernel.routed'));
});

test('adkernel: no adapter signature → no finding', () => {
  const req = validRequest();
  req.imp[0].ext = { adtype: 'banner' }; // unrelated ext
  const { findings } = validate(req);
  assert.equal(findById(findings, 'info.adkernel.routed'), undefined);
});

test('adkernel: alias key without zoneId is NOT flagged (avoids false positives)', () => {
  const req = validRequest();
  req.imp[0].ext = { adkernel: { something_else: 1 } };
  const { findings } = validate(req);
  assert.equal(findById(findings, 'info.adkernel.routed'), undefined);
});

// ── IAB Content Taxonomy decoder ─────────────────────────────────────────

const { decodeCategory, decodeCategories, extractAllCategories } = require('@ortbtools/core');

test('decodeCategory: known sub-code resolves to "Top → Sub"', () => {
  assert.equal(decodeCategory('IAB9-11'), 'Hobbies & Interests → Comic Books');
});

test('decodeCategory: top-level code resolves alone', () => {
  assert.equal(decodeCategory('IAB17'), 'Sports');
});

test('decodeCategory: unknown sub falls back to parent label', () => {
  // IAB9-99 is NOT in the dict; should fall back to "Hobbies & Interests"
  assert.equal(decodeCategory('IAB9-99'), 'Hobbies & Interests');
});

test('decodeCategory: garbage returns null', () => {
  assert.equal(decodeCategory('NOT_A_CODE'), null);
  assert.equal(decodeCategory(''), null);
  assert.equal(decodeCategory(null), null);
});

test('decodeCategories: keeps order + nulls unrecognised codes', () => {
  const out = decodeCategories(['IAB1', 'GARBAGE', 'IAB25-3']);
  assert.equal(out.length, 3);
  assert.equal(out[0].code, 'IAB1');
  assert.equal(out[0].label, 'Arts & Entertainment');
  assert.equal(out[1].code, 'GARBAGE');
  assert.equal(out[1].label, null);
  assert.equal(out[2].label, 'Non-Standard Content → Pornography');
});

test('extractAllCategories: walks bcat / site.cat / app.cat / bid.cat', () => {
  const payload = {
    bcat: ['IAB25-3'],
    site: { cat: ['IAB1', 'IAB12'] },
    seatbid: [{ bid: [{ cat: ['IAB17-12'] }] }],
  };
  const out = extractAllCategories(payload);
  assert.ok(out['bcat']);
  assert.equal(out['bcat'][0].label, 'Non-Standard Content → Pornography');
  assert.ok(out['site.cat']);
  assert.equal(out['site.cat'].length, 2);
  assert.ok(out['seatbid[0].bid[0].cat']);
  assert.equal(out['seatbid[0].bid[0].cat'][0].label, 'Sports → Football');
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

// ── Push-materials feed — cpc/price 3-tier finding ──────────────────────────

const findByIdInResult = (result, id) => (result.findings || []).find((f) => f.id === id);

test('push-materials feed: numeric cpc → no bid finding fires', () => {
  const r = validate([{ id: 'm1', click_url: 'https://x', cpc: 0.05 }]);
  assert.equal(findByIdInResult(r, 'feed.push.bid_required'), undefined);
  assert.equal(findByIdInResult(r, 'feed.push.bid_string_type'), undefined);
  assert.equal(findByIdInResult(r, 'feed.push.bid_not_numeric'), undefined);
});

test('push-materials feed: numeric-string cpc → WARN bid_string_type, NOT bid_required', () => {
  const r = validate([{ id: 'm1', click_url: 'https://x', cpc: '0.01495' }]);
  const f = findByIdInResult(r, 'feed.push.bid_string_type');
  assert.ok(f, 'expected bid_string_type finding to fire');
  assert.equal(f.level, 'warning');
  assert.equal(findByIdInResult(r, 'feed.push.bid_required'), undefined);
  assert.equal(findByIdInResult(r, 'feed.push.bid_not_numeric'), undefined);
});

test('push-materials feed: non-numeric string cpc → ERROR bid_not_numeric', () => {
  const r = validate([{ id: 'm1', click_url: 'https://x', cpc: 'free' }]);
  const f = findByIdInResult(r, 'feed.push.bid_not_numeric');
  assert.ok(f, 'expected bid_not_numeric finding to fire');
  assert.equal(f.level, 'error');
  assert.equal(findByIdInResult(r, 'feed.push.bid_required'), undefined);
  assert.equal(findByIdInResult(r, 'feed.push.bid_string_type'), undefined);
});

test('push-materials feed: absent cpc AND absent price → ERROR bid_required (unchanged)', () => {
  const r = validate([{ id: 'm1', click_url: 'https://x' }]);
  const f = findByIdInResult(r, 'feed.push.bid_required');
  assert.ok(f, 'expected bid_required finding to fire');
  assert.equal(f.level, 'error');
  assert.equal(findByIdInResult(r, 'feed.push.bid_string_type'), undefined);
});

test('push-materials feed: numeric price (fallback) → no bid finding', () => {
  const r = validate([{ id: 'm1', click_url: 'https://x', price: 1.5 }]);
  assert.equal(findByIdInResult(r, 'feed.push.bid_required'), undefined);
  assert.equal(findByIdInResult(r, 'feed.push.bid_string_type'), undefined);
});

// ── 013: single-object push-materials response (baseline shape) ─────────────
// Synthetic replica of the reported payload — same key set and value shapes,
// synthetic values (no production records in tests, Constitution III/VII).

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

test('013 US1: synthetic replica end-to-end — recognized, no unknown_type', () => {
  const r = validate(pushSingleReplica());
  assert.equal(r.type, 'Push-Materials Feed Response (single)');
  assert.equal(findByIdInResult(r, 'payload.unknown_type'), undefined);
});

test('013 US1: single object and one-element array produce equivalent findings', () => {
  const single = validate(pushSingleReplica());
  const arr = validate([pushSingleReplica()]);
  assert.equal(arr.type, 'Push-Materials Feed Response');
  // Same finding ids in the same order; paths differ only by the [0] prefix.
  assert.deepEqual(
    single.findings.map((f) => f.id),
    arr.findings.map((f) => f.id),
  );
  const stripPrefix = (p) => p.replace(/^\[0\]\.?/, '');
  assert.deepEqual(
    single.findings.map((f) => f.path),
    arr.findings.map((f) => stripPrefix(f.path)),
  );
});

// ── 013 US2: alias acceptance (id/tId, image_url/image, icon_url/icon/nurl) ──

test('013 US2: aliases satisfy presence checks in both shapes', () => {
  const material = {
    tId: 't-1',
    link: 'https://ads.example.com/click',
    cpc: 0.01,
    title: 'h',
    image: 'https://ads.example.com/img.jpg',
    icon: 'https://ads.example.com/icn.png',
  };
  for (const r of [validate({ ...material }), validate([{ ...material }])]) {
    assert.equal(findByIdInResult(r, 'feed.push.id_required'), undefined);
    assert.equal(findByIdInResult(r, 'feed.push.click_url_required'), undefined);
    assert.equal(findByIdInResult(r, 'feed.push.image_url_recommended'), undefined);
    assert.equal(findByIdInResult(r, 'feed.push.nurl_recommended'), undefined);
  }
});

test('013 US2: absence under all names keeps the existing findings', () => {
  // No id/tId, no image_url/image, no icon_url/icon/nurl.
  const bare = { link: 'https://x', cpc: 0.01, title: 'h' };
  for (const r of [validate({ ...bare }), validate([{ ...bare }])]) {
    assert.ok(findByIdInResult(r, 'feed.push.id_required'));
    assert.ok(findByIdInResult(r, 'feed.push.image_url_recommended'));
    assert.ok(findByIdInResult(r, 'feed.push.nurl_recommended'));
  }
});

test('013 US2: both names present → single finding stream, no duplicates', () => {
  const r = validate({
    id: 'canonical',
    tId: 'alias',
    click_url: 'https://x',
    link: 'https://y',
    cpc: 0.01,
    title: 'h',
    image_url: 'https://x/i.jpg',
    image: 'https://y/i.jpg',
  });
  const idFindings = r.findings.filter((f) => f.id === 'feed.push.id_required');
  assert.equal(idFindings.length, 0);
  const seen = new Set();
  for (const f of r.findings) {
    const key = `${f.id}|${f.path}`;
    assert.ok(!seen.has(key), `duplicate finding ${key}`);
    seen.add(key);
  }
});

test('013 US2: alias present with non-string value keeps the existing finding', () => {
  const r = validate({ tId: 123, link: 'https://x', cpc: 0.01, title: 'h' });
  assert.ok(findByIdInResult(r, 'feed.push.id_required'));
});

test('013 US2: single-shape price tiers match the array behavior', () => {
  const base = { tId: 't-1', link: 'https://x', title: 'h' };
  const rString = validate({ ...base, cpc: '0.01' });
  assert.ok(findByIdInResult(rString, 'feed.push.bid_string_type'));
  assert.equal(findByIdInResult(rString, 'feed.push.bid_required'), undefined);
  const rBad = validate({ ...base, cpc: 'free' });
  assert.ok(findByIdInResult(rBad, 'feed.push.bid_not_numeric'));
  const rAbsent = validate({ ...base, price: undefined, cpc: undefined, image: 'https://x/i' });
  assert.ok(findByIdInResult(rAbsent, 'feed.push.bid_required'));
  assert.equal(rAbsent.type, 'Push-Materials Feed Response (single)');
});

test('013 US2: linkTtl draws no findings (FR-008)', () => {
  const r = validate(pushSingleReplica());
  for (const f of r.findings) {
    assert.ok(!String(f.path).includes('linkTtl'), `finding on linkTtl: ${f.id}`);
  }
});
