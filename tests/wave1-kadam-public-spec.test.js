'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validate, crosscheck, detectFormat } = require('@ortbtools/core');
const { admLooksLikePop, extractPopLandingHost } = require('../packages/core/non-iab-formats');

function baseRequest(overrides = {}) {
  return {
    id: 'req-wave1-1',
    imp: [{ id: 'imp-1', banner: { w: 300, h: 250 } }],
    site: { domain: 'publisher.example' },
    device: { ua: 'Mozilla/5.0', ip: '192.0.2.10' },
    at: 1,
    ...overrides,
  };
}

function baseResponse(bidOverrides = {}) {
  return {
    id: 'req-wave1-1',
    seatbid: [
      {
        bid: [
          {
            id: 'bid-1',
            impid: 'imp-1',
            price: 0.5,
            adomain: ['advertiser.example'],
            adm: 'https://advertiser.example/click',
            ...bidOverrides,
          },
        ],
      },
    ],
  };
}

// ── 1. Publicly documented macros in ext-rtb ─────────────────────────────

test('ext-rtb: accepts all publicly documented macros without macro_unsupported', () => {
  const documented = [
    'AUCTION_PRICE',
    'AUCTION_CURRENCY',
    'AUCTION_LOSS',
    'AUCTION_BID_ID',
    'AUCTION_ID',
    'AUCTION_IMP_ID',
    'CLICK_URL',
    'CLICK_URL_ENC',
  ];
  const res = baseResponse({
    adm:
      '<a href="${CLICK_URL}"><img src="https://cdn.example/img?p=${AUCTION_PRICE}' +
      '&c=${AUCTION_CURRENCY}&id=${AUCTION_ID}&bid=${AUCTION_BID_ID}' +
      '&imp=${AUCTION_IMP_ID}&enc=${CLICK_URL_ENC}"></a>',
    lurl: 'https://track.example/loss?reason=${AUCTION_LOSS}',
  });

  const { findings } = validate(res, { dialect: 'ext-rtb' });
  const unsupported = findings.filter((f) => f.id === 'extrtb.bid.macro_unsupported');
  assert.deepEqual(
    unsupported,
    [],
    `Unexpected unsupported macro findings for documented macros: ${documented.join(', ')}`,
  );
});

test('ext-rtb: still flags unknown macros with extrtb.bid.macro_unsupported', () => {
  const res = baseResponse({
    adm: 'https://advertiser.example/landing?u=${UNKNOWN_MACRO}',
  });

  const { findings } = validate(res, { dialect: 'ext-rtb' });
  const f = findings.find((x) => x.id === 'extrtb.bid.macro_unsupported');
  assert.ok(f, 'expected extrtb.bid.macro_unsupported for ${UNKNOWN_MACRO}');
  assert.equal(f.params.macro, 'UNKNOWN_MACRO');
});

// ── 2. Subscription age fields (subage*) in ext-rtb ──────────────────────

test('ext-rtb: push request with subage_dt or subage0 does NOT emit subage_missing', () => {
  for (const extField of [
    { subage_dt: '2026-01-15T10:00:00Z' },
    { subage0: 0 },
    { subage_ts: 1700000000 },
    { subage_ts_ms: 1700000000000 },
    { subage: 12 },
  ]) {
    const req = baseRequest({
      site: { domain: 'publisher.example', ext: { idzone: 'push-123' } },
      imp: [{ id: 'imp-1', banner: { w: 300, h: 250 }, ext: extField }],
    });
    const { findings } = validate(req, { dialect: 'ext-rtb' });
    assert.ok(
      findings.some((f) => f.id === 'extrtb.push_detected'),
      `expected extrtb.push_detected for ${JSON.stringify(extField)}`,
    );
    assert.equal(
      findings.some((f) => f.id === 'extrtb.imp.subage_missing'),
      false,
      `did not expect extrtb.imp.subage_missing for ${JSON.stringify(extField)}`,
    );
  }
});

test('ext-rtb: push request detected via site.ext.idzone with no subage* emits subage_missing', () => {
  const req = baseRequest({
    site: { domain: 'publisher.example', ext: { idzone: 'push-zone-1' } },
    imp: [{ id: 'imp-1', banner: { w: 300, h: 250 } }],
  });
  const { findings } = validate(req, { dialect: 'ext-rtb' });
  assert.ok(findings.some((f) => f.id === 'extrtb.push_detected'));
  assert.ok(findings.some((f) => f.id === 'extrtb.imp.subage_missing'));
});

// ── 3. OpenRTB Popunder XML wrapper ──────────────────────────────────────

const POPUNDER_CDATA_ADM =
  '<?xml version="1.0"?><ad><popunderAd><url><![CDATA[https://landing.example/pop]]></url></popunderAd></ad>';
const POPUNDER_PLAIN_ADM =
  '<popunderAd><url>https://plain-landing.example/offer?a=1</url></popunderAd>';
const POPUNDER_ATTR_ADM =
  '<?xml version="1.0" encoding="UTF-8"?><ad xmlns="https://spec.example"><popunderAd id="1"><url type="click">https://attr-landing.example/go</url></popunderAd></ad>';

test('non-iab-formats: admLooksLikePop and extractPopLandingHost handle popunderAd XML (CDATA & plain)', () => {
  assert.equal(admLooksLikePop(POPUNDER_CDATA_ADM), true);
  assert.equal(admLooksLikePop(POPUNDER_PLAIN_ADM), true);
  assert.equal(admLooksLikePop(POPUNDER_ATTR_ADM), true);

  assert.equal(extractPopLandingHost(POPUNDER_CDATA_ADM), 'landing.example');
  assert.equal(extractPopLandingHost(POPUNDER_PLAIN_ADM), 'plain-landing.example');
  assert.equal(extractPopLandingHost(POPUNDER_ATTR_ADM), 'attr-landing.example');
});

test('format-detect: OpenRTB Popunder XML response is detected as pops', () => {
  for (const adm of [POPUNDER_CDATA_ADM, POPUNDER_PLAIN_ADM, POPUNDER_ATTR_ADM]) {
    const res = baseResponse({ adm });
    const detected = detectFormat(res);
    assert.ok(
      detected.formats.includes('pops'),
      `expected formats to include "pops" for adm=${adm}, got ${JSON.stringify(detected.formats)}`,
    );
  }
});

test('crosscheck: OpenRTB Popunder XML triggers adomain_landing_mismatch when adomain differs', () => {
  const req = baseRequest();
  const res = baseResponse({
    adm: POPUNDER_CDATA_ADM,
    adomain: ['declared-advertiser.example'],
    ext: { adtype: 'popunder' },
  });
  const findings = crosscheck(req, res);
  const mismatch = findings.find((f) => f.id === 'crosscheck.bid.pop.adomain_landing_mismatch');
  assert.ok(mismatch, 'expected crosscheck.bid.pop.adomain_landing_mismatch');
  assert.equal(mismatch.level, 'crit');
  assert.equal(mismatch.params.landing, 'landing.example');

  const resMatch = baseResponse({
    adm: POPUNDER_CDATA_ADM,
    adomain: ['landing.example'],
    ext: { adtype: 'popunder' },
  });
  const matchFindings = crosscheck(req, resMatch);
  assert.ok(
    matchFindings.some((f) => f.id === 'crosscheck.bid.pop.adomain_landing_match' && f.ok),
    'expected crosscheck.bid.pop.adomain_landing_match when adomain matches',
  );
});
