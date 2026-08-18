'use strict';

/**
 * tests/rules-25-audit.test.js — regressions for the oRTB 2.5/2.6 rule audit
 * (2026-08-18) over packages/core/rules-request.js + rules-response.js.
 *
 * Four defects, one theme between them: the validator was answering a
 * question other than the one the payload asked.
 *
 *   1. A field present with the WRONG TYPE crashed the validator instead of
 *      producing a finding. `imp` as an object, `banner` as a string,
 *      `seatbid`/`bid` as objects, `user.eids[].uids` as an object — each of
 *      the four unwrapped a value with `.forEach` / `.map` / the `in`
 *      operator without checking what it was. The TypeError escaped
 *      validate() (core/index.js has no try around validateRequest /
 *      validateResponse) and surfaced as an HTTP 400 whose body quoted our
 *      own source: "(sb.bid || []).forEach is not a function". No verdict at
 *      all — on exactly the payload class an inspector is for.
 *
 *   2. oRTB 2.6 §3.2.1 has THREE distribution channels; the rule knew two.
 *      Every DOOH request — including the engine's own reference sample —
 *      came back with an ERROR saying it had no channel, while the version
 *      detector was simultaneously reporting 2.6 with confidence 1 *because*
 *      of the `dooh` object it claimed not to see.
 *
 *   3. `banner.format[]` was counted, never read. An entry of `{}`, `null`
 *      or `{w:"300",h:"250"}` silenced the size rule for the whole
 *      impression; so did `w:0,h:0`, because helpers.js `isNum` is true of
 *      zero. The verdict on a sizeless slot was "clean".
 *
 *   4. `at` values above 500 are exchange-specific by the letter of the spec
 *      ("Exchange-specific auction types can be defined using values greater
 *      than 500", §3.2.1) and were reported as non-standard.
 *
 * WHY THE TESTS ASSERT WHAT THEY ASSERT. For (1) the interesting property is
 * not the finding id — it is that validate() RETURNS. Each of those cases is
 * therefore written as a call with no try/catch around it: a regression does
 * not fail an assertion here, it throws, which is the same shape the user saw
 * and the least ambiguous failure a test can have. The finding that comes
 * back is asserted too, because "returns something" would also be satisfied
 * by silently swallowing the malformed field.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { validate } = require('@ortbtools/core');
const { validRequest, validResponse } = require('./fixtures');

const findById = (findings, id) => findings.find((f) => f.id === id);
const ids = (findings) => findings.map((f) => f.id);

// ───────────────────────────────────────────────────────────────────────────
// 1. Wrong-typed fields produce findings, not exceptions
// ───────────────────────────────────────────────────────────────────────────

test('imp as a bare object: verdict returned, imp_required fired, no throw', () => {
  const req = validRequest();
  // The shape a sender produces when it has one impression and forgets the
  // array wrapper. Field present, type wrong — the validator's core subject.
  req.imp = { id: 'imp-1', banner: { w: 300, h: 250 } };
  const { findings, status } = validate(req);
  assert.ok(
    findById(findings, 'request.imp_required'),
    `expected request.imp_required, got ${ids(findings)}`,
  );
  assert.equal(status, 'errors');
});

test('imp as a bare object also survives the non-IAB format scan', () => {
  // detectNonStandardFormats runs a SECOND pass over req.imp after the main
  // loop. Guarding only the first one moves the crash instead of removing it,
  // and nothing about the returned findings would reveal that — hence a case
  // whose only job is to reach the second pass with a non-array imp.
  const req = validRequest();
  req.imp = { id: 'imp-1', ext: { adtype: 'pop' } };
  const { findings } = validate(req);
  assert.ok(findById(findings, 'request.imp_required'));
});

test('banner as a string: size_required fired instead of an `in`-operator throw', () => {
  const req = validRequest();
  // `'pos' in "300x250"` is a TypeError, not a false — the `in` operator
  // refuses primitives outright.
  req.imp[0].banner = '300x250';
  const { findings } = validate(req);
  const f = findById(findings, 'imp.banner.size_required');
  assert.ok(f, `expected imp.banner.size_required, got ${ids(findings)}`);
  assert.equal(f.path, 'imp[0].banner');
  // The slot still counts as declaring a format — `banner` is present, so
  // "no creative format at all" would be the wrong thing to say.
  assert.equal(findById(findings, 'imp.format_required'), undefined);
});

test('banner as a number or boolean is tolerated the same way', () => {
  for (const bad of [1, true]) {
    const req = validRequest();
    req.imp[0].banner = bad;
    const { findings } = validate(req);
    assert.ok(
      findById(findings, 'imp.banner.size_required'),
      `banner: ${JSON.stringify(bad)} → ${ids(findings)}`,
    );
  }
});

test('user.eids[].uids as a bare object does not throw the eids comparison', () => {
  // Both eids arrays must be present to reach the fingerprint helper at all,
  // which is why this shape survived so long: it needs the legacy AND the
  // core array before the `.map` on `uids` is ever evaluated.
  //
  // The verdict itself is not "clean" here and should not be — a separate
  // plugin rule reports the unusable uids container. What this case pins is
  // that the run REACHES that rule instead of dying in the fingerprint
  // helper, and that the two identical arrays are not reported as disagreeing.
  const req = validRequest();
  req.user = {
    eids: [{ source: 'id5-sync.com', uids: { id: 'abc' } }],
    ext: { eids: [{ source: 'id5-sync.com', uids: { id: 'abc' } }] },
  };
  const { findings } = validate(req);
  assert.ok(Array.isArray(findings));
  assert.equal(findById(findings, 'request.user.eids_disagree'), undefined);
});

test('a malformed uids container on one side only is still compared, not skipped', () => {
  // The guard must degrade the unreadable side to "no uids", not to "same as
  // the other side" — otherwise a legacy array carrying a real identity and a
  // core array carrying junk would fingerprint alike and the disagreement
  // this rule exists to surface would vanish.
  const req = validRequest();
  req.user = {
    eids: [{ source: 'id5-sync.com', uids: { id: 'abc' } }],
    ext: { eids: [{ source: 'id5-sync.com', uids: [{ id: 'abc' }] }] },
  };
  const { findings } = validate(req);
  assert.ok(
    findById(findings, 'request.user.eids_disagree'),
    `expected request.user.eids_disagree, got ${ids(findings)}`,
  );
});

test('seatbid[].bid as a bare object: seatbid.empty fired, no throw', () => {
  const res = validResponse();
  res.seatbid[0].bid = { id: 'bid-1', impid: 'imp-1', price: 1.5 };
  const { findings } = validate(res);
  const f = findById(findings, 'response.seatbid.empty');
  assert.ok(f, `expected response.seatbid.empty, got ${ids(findings)}`);
  assert.equal(f.level, 'error');
});

test('seatbid as a bare object: seatbid_or_nbr_required fired, no throw', () => {
  // This one is normally screened off by detectType (an object under
  // `seatbid` stops the payload looking like a BidResponse), so it is asserted
  // against the rule module directly — the guard has to hold for every caller
  // of validateResponse, not only for the one path that happens to filter it.
  const { validateResponse } = require(
    path.join(__dirname, '..', 'packages', 'core', 'rules-response.js'),
  );
  const findings = validateResponse(
    { id: 'res-1', seatbid: { seat: 's', bid: [{ id: 'b', impid: 'i', price: 1 }] } },
    {},
  );
  assert.ok(
    findById(findings, 'response.seatbid_or_nbr_required'),
    `expected response.seatbid_or_nbr_required, got ${ids(findings)}`,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 2. DOOH is a distribution channel
// ───────────────────────────────────────────────────────────────────────────

test('the reference 2.6 DOOH request is not reported as channel-less', () => {
  // Deliberately the engine's OWN knowledge-base sample rather than a payload
  // written for this test: the defect was that two parts of one engine read
  // the same shipped file and disagreed about it.
  const dooh = require(
    path.join(
      __dirname,
      '..',
      'packages',
      'core',
      'knowledge_base',
      'ortb-2.6',
      'request',
      'dooh',
      'billboard-roadside.json',
    ),
  );
  const { findings, status, version } = validate(dooh);
  assert.equal(version.version, '2.6');
  assert.equal(
    findById(findings, 'request.no_site_or_app'),
    undefined,
    `dooh is a channel; findings were ${ids(findings)}`,
  );
  // A DOOH panel is not a browser and has no meaningful client address, so
  // those two checks must not roll the whole verdict up to "errors" either.
  assert.equal(findById(findings, 'request.device.ip_required').level, 'info');
  assert.equal(findById(findings, 'request.device.ua_required').level, 'info');
  assert.equal(status, 'warnings');
});

test('dooh alongside site is still flagged as an ambiguous channel', () => {
  const req = validRequest();
  req.dooh = { id: 'panel-42' };
  const { findings } = validate(req);
  assert.ok(findById(findings, 'request.site_and_app_both'));
  assert.equal(findById(findings, 'request.no_site_or_app'), undefined);
});

test('dooh alongside site keeps the strict device rules — a real client is claimed', () => {
  const req = validRequest();
  req.dooh = { id: 'panel-42' };
  delete req.device.ip;
  delete req.device.ua;
  const { findings } = validate(req);
  assert.equal(findById(findings, 'request.device.ip_required').level, 'error');
  assert.equal(findById(findings, 'request.device.ua_required').level, 'error');
});

test('no channel at all is still an error, and site+app still collide', () => {
  // The rewrite from two booleans to a channel filter must not lose either of
  // the two answers the old shape already gave.
  const none = validRequest();
  delete none.site;
  assert.ok(findById(validate(none).findings, 'request.no_site_or_app'));

  const both = validRequest();
  both.app = { bundle: 'com.example.app' };
  assert.ok(findById(validate(both).findings, 'request.site_and_app_both'));
});

// ───────────────────────────────────────────────────────────────────────────
// 3. banner.format[] is read, not counted
// ───────────────────────────────────────────────────────────────────────────

test('a format[] with no usable size does not silence imp.banner.size_required', () => {
  const cases = [
    ['empty object', [{}]],
    ['null entry', [null]],
    ['string dimensions', [{ w: '300', h: '250' }]],
    ['zero dimensions', [{ w: 0, h: 0 }]],
    ['negative dimensions', [{ w: -300, h: -250 }]],
    ['ratios without hratio', [{ wratio: 4 }]],
  ];
  for (const [label, format] of cases) {
    const req = validRequest();
    req.imp[0].banner = { format };
    const { findings } = validate(req);
    assert.ok(
      findById(findings, 'imp.banner.size_required'),
      `${label}: expected imp.banner.size_required, got ${ids(findings)}`,
    );
  }
});

test('zero and negative w/h on the banner itself are not sizes', () => {
  for (const banner of [
    { w: 0, h: 0 },
    { w: -300, h: -250 },
    { w: 300, h: 0 },
  ]) {
    const req = validRequest();
    req.imp[0].banner = banner;
    const { findings } = validate(req);
    assert.ok(
      findById(findings, 'imp.banner.size_required'),
      `${JSON.stringify(banner)} → ${ids(findings)}`,
    );
  }
});

test('a real format[] entry still passes, including relative sizing', () => {
  const accepted = [
    [{ w: 300, h: 250 }],
    [{ w: 300, h: 250 }, {}], // one usable entry is enough
    [{ wratio: 4, hratio: 1, wmin: 100 }],
    [{ wratio: 4, hratio: 1 }], // wmin is not demanded — see rules-request.js
  ];
  for (const format of accepted) {
    const req = validRequest();
    req.imp[0].banner = { format };
    const { findings } = validate(req);
    assert.equal(
      findById(findings, 'imp.banner.size_required'),
      undefined,
      `${JSON.stringify(format)} → ${ids(findings)}`,
    );
  }
});

test('fixed w/h on the banner wins even when format[] is junk', () => {
  const req = validRequest();
  req.imp[0].banner = { w: 300, h: 250, format: [{}] };
  const { findings } = validate(req);
  assert.equal(findById(findings, 'imp.banner.size_required'), undefined);
});

// ───────────────────────────────────────────────────────────────────────────
// 4. at: the exchange-specific range above 500
// ───────────────────────────────────────────────────────────────────────────

test('at above 500 is exchange-specific, not at_invalid', () => {
  for (const at of [501, 777, 9000]) {
    const req = validRequest();
    req.at = at;
    const { findings, status } = validate(req);
    assert.equal(
      findById(findings, 'request.at_invalid'),
      undefined,
      `at=${at} is exchange-specific per §3.2.1; got ${ids(findings)}`,
    );
    assert.equal(status, 'clean');
  }
});

test('at below the exchange range is still flagged', () => {
  // The carve-out must not become a hole: 3 and 499 are neither of the two
  // enumerated types nor in the vendor range.
  for (const at of [3, 0, -1, 499]) {
    const req = validRequest();
    req.at = at;
    const f = findById(validate(req).findings, 'request.at_invalid');
    assert.ok(f, `at=${at} should still be at_invalid`);
    assert.equal(f.params.at, at);
  }
});

test('at threshold matches the imp.video.protocols rule in the same file', () => {
  // Both rules describe the same "500+ is vendor territory" sentence from the
  // spec. They disagreed for months — this pins them together so the next
  // person to touch one is told about the other.
  const reqAt = validRequest();
  reqAt.at = 500;
  const reqProto = validRequest();
  reqProto.imp[0].video = { mimes: ['video/mp4'], protocols: [500] };
  assert.equal(findById(validate(reqAt).findings, 'request.at_invalid'), undefined);
  assert.equal(
    findById(validate(reqProto).findings, 'imp.video.protocols_unknown'),
    undefined,
    'protocols and at must draw the exchange-specific boundary at the same number',
  );
});
