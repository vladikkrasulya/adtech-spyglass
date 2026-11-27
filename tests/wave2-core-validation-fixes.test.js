'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const core = require('@ortbtools/core');
const { createAnalyzeModule } = require('../modules/analyze/handler');

const byId = (findings, id) => findings.find((f) => f.id === id);
const allById = (findings, id) => findings.filter((f) => f.id === id);

function makeAnalyzeModule() {
  return createAnalyzeModule({
    analyzeLimiter: () => true,
    behaviorLimiter: () => true,
    auth: { clientIp: () => '127.0.0.1', getCurrentUser: () => null },
    ANALYZE_MAX_PER_WINDOW: 1000,
    BEHAVIOR_MAX_PER_WINDOW: 1000,
    resolveLocale: () => 'en',
    resolveDialect: () => undefined,
    validate: core.validate,
    crosscheck: core.crosscheck,
    analyzeBehavior: () => ({ findings: [] }),
    extractAllCategories: core.extractAllCategories,
    detectFormat: core.detectFormat,
    unionFormat: (a, b) => a || b || null,
    rollupStatus: core.rollupStatus,
    AnalyzeLog: { record: () => {} },
  });
}

function postAnalyze(mod, body) {
  const route = mod.routes.find((r) => r.method === 'POST' && r.path === '/api/analyze');
  const req = Readable.from([JSON.stringify(body)]);
  return new Promise((resolve) => {
    let statusCode = 200;
    const res = {
      writeHead(code) {
        statusCode = code;
      },
      end(payload) {
        resolve({ status: statusCode, body: JSON.parse(payload) });
      },
    };
    route.handler(req, res, new URL('http://x/api/analyze'));
  });
}

// ── Bug 1: banner.format wratio/hratio/wmin ──────────────────────────────────

test('crosscheck banner.format: wratio/hratio with wmin accepts matching aspect ratio', () => {
  const req = {
    id: 'req-flex-1',
    cur: ['USD'],
    imp: [
      {
        id: '1',
        bidfloor: 0.5,
        bidfloorcur: 'USD',
        banner: { format: [{ wratio: 16, hratio: 9, wmin: 320 }] },
      },
    ],
  };
  const res = {
    id: 'req-flex-1',
    cur: 'USD',
    seatbid: [{ bid: [{ id: 'b1', impid: '1', price: 1.0, w: 640, h: 360, mtype: 1 }] }],
  };
  const findings = core.crosscheck(req, res, { locale: 'en' });
  assert.ok(byId(findings, 'crosscheck.bid.size_match'));
  assert.equal(byId(findings, 'crosscheck.bid.size_mismatch'), undefined);
});

test('crosscheck banner.format: wratio/hratio enforces wmin and formats allowed as ratio', () => {
  const req = {
    id: 'req-flex-2',
    cur: ['USD'],
    imp: [
      {
        id: '1',
        bidfloor: 0.5,
        bidfloorcur: 'USD',
        banner: {
          format: [
            { w: 300, h: 250 },
            { wratio: 16, hratio: 9, wmin: 320 },
          ],
        },
      },
    ],
  };
  const res = {
    id: 'req-flex-2',
    cur: 'USD',
    seatbid: [{ bid: [{ id: 'b1', impid: '1', price: 1.0, w: 160, h: 90, mtype: 1 }] }],
  };
  const findings = core.crosscheck(req, res, { locale: 'en' });
  const mismatch = byId(findings, 'crosscheck.bid.size_mismatch');
  assert.ok(mismatch);
  assert.equal(mismatch.params.allowed, '300×250, 16:9');
  assert.ok(!mismatch.msg.includes('undefined'));
});

// ── Bug 2: PMP private_auction: 1 without valid dealid ───────────────────────

test('crosscheck PMP private_auction=1 rejects bid missing dealid or with unknown dealid', () => {
  const req = {
    id: 'req-pmp-1',
    cur: ['USD'],
    imp: [
      {
        id: '1',
        bidfloor: 0.5,
        bidfloorcur: 'USD',
        pmp: {
          private_auction: 1,
          deals: [{ id: 'deal-valid', bidfloor: 2.0, bidfloorcur: 'USD' }],
        },
      },
    ],
  };

  for (const bidPatch of [{}, { dealid: 'deal-other' }]) {
    const res = {
      id: 'req-pmp-1',
      cur: 'USD',
      seatbid: [
        {
          seat: 'seat-a',
          bid: [{ id: 'b1', impid: '1', price: 5.0, ...bidPatch }],
        },
      ],
    };
    const findings = core.crosscheck(req, res, { locale: 'en' });
    assert.equal(
      byId(findings, 'crosscheck.bid.above_floor'),
      undefined,
      'private_auction=1 bid without valid dealid must not clear floor',
    );
    const rejected = byId(findings, 'crosscheck.seat.not_allowed');
    assert.ok(rejected, 'private_auction=1 bid without valid dealid must be rejected');
    assert.equal(rejected.level, 'crit');
    const summary = byId(findings, 'crosscheck.auction.summary');
    assert.equal(summary.params.bidsAboveFloor, 0);
    assert.equal(summary.params.impsFilled, 0);
  }

  // Matched dealid clears its own deal floor normally.
  const validRes = {
    id: 'req-pmp-1',
    cur: 'USD',
    seatbid: [
      {
        seat: 'seat-a',
        bid: [{ id: 'b1', impid: '1', price: 2.5, dealid: 'deal-valid' }],
      },
    ],
  };
  const okFindings = core.crosscheck(req, validRes, { locale: 'en' });
  assert.equal(byId(okFindings, 'crosscheck.seat.not_allowed'), undefined);
  const above = byId(okFindings, 'crosscheck.bid.above_floor');
  assert.ok(above);
  assert.equal(above.params.floor, '2.0000');
});

// ── Bug 3: nativeAssetFitness still runs when another required asset is missing

test('crosscheck native: runs asset fitness checks even when another required asset is missing', () => {
  const req = {
    id: 'req-nat-1',
    cur: ['USD'],
    imp: [
      {
        id: '1',
        bidfloor: 0.5,
        native: {
          request: JSON.stringify({
            ver: '1.2',
            assets: [
              { id: 1, required: 1, title: { len: 10 } },
              { id: 2, required: 1, img: { w: 300, h: 250 } },
            ],
          }),
        },
      },
    ],
  };
  const res = {
    id: 'req-nat-1',
    cur: 'USD',
    seatbid: [
      {
        bid: [
          {
            id: 'b1',
            impid: '1',
            price: 1.0,
            mtype: 4,
            adm: JSON.stringify({
              native: {
                link: { url: 'javascript:alert(1)' },
                assets: [{ id: 1, title: { text: 'This title is way over 10 chars' } }],
              },
            }),
          },
        ],
      },
    ],
  };
  const findings = core.crosscheck(req, res, { locale: 'en' });
  assert.ok(byId(findings, 'crosscheck.bid.native_missing_assets'));
  assert.ok(byId(findings, 'crosscheck.bid.native_over_length'));
  assert.ok(byId(findings, 'crosscheck.bid.native_unsafe_scheme'));
  assert.equal(byId(findings, 'crosscheck.bid.native_complete'), undefined);
});

// ── Bug 4: top-level oRTB 2.6 regs.us_privacy ────────────────────────────────

test('rules-request: validates top-level regs.us_privacy when regs.ext.us_privacy is absent', () => {
  const baseReq = {
    id: 'req-usp-1',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    site: { domain: 'example.test' },
  };

  const valid = core.validate({ ...baseReq, regs: { us_privacy: '1YNN' } });
  assert.equal(byId(valid.findings, 'regs.us_privacy_invalid'), undefined);

  const invalid = core.validate({ ...baseReq, regs: { us_privacy: 'BAD!' } });
  const finding = byId(invalid.findings, 'regs.us_privacy_invalid');
  assert.ok(finding);
  assert.equal(finding.path, 'regs.us_privacy');
  assert.equal(finding.level, 'warning');

  const nonString = core.validate({ ...baseReq, regs: { us_privacy: 123 } });
  assert.equal(byId(nonString.findings, 'regs.us_privacy_invalid').path, 'regs.us_privacy');

  // When regs.ext.us_privacy is present, it takes precedence.
  const both = core.validate({
    ...baseReq,
    regs: { us_privacy: 'BAD!', ext: { us_privacy: '1YNN' } },
  });
  assert.equal(byId(both.findings, 'regs.us_privacy_invalid'), undefined);
});

// ── Bug 5: regs.coppa === 1 PII check includes device.ifa, device hashes, yob/gender, eids

test('rules-request: regs.coppa=1 flags device.ifa, device hashes, user.yob/gender, and eids', () => {
  const baseReq = {
    id: 'req-coppa-1',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    site: { domain: 'example.test' },
    regs: { coppa: 1 },
  };

  const piiCases = [
    { device: { ifa: 'aaid-1234' } },
    { device: { didsha1: 'hash1' } },
    { device: { dpidsha1: 'hash2' } },
    { device: { macsha1: 'hash3' } },
    { user: { yob: 2015 } },
    { user: { gender: 'F' } },
    { user: { eids: [{ source: 'id.example.test', uids: [{ id: 'u1' }] }] } },
    { user: { ext: { eids: [{ source: 'id.example.test', uids: [{ id: 'u1' }] }] } } },
  ];

  for (const patch of piiCases) {
    const r = core.validate({ ...baseReq, ...patch });
    assert.ok(
      byId(r.findings, 'regs.coppa_pii_present'),
      `expected regs.coppa_pii_present for ${JSON.stringify(patch)}`,
    );
  }

  const clean = core.validate({
    ...baseReq,
    device: { ifa: '   ' },
    user: { eids: [], ext: { eids: [] } },
  });
  assert.equal(byId(clean.findings, 'regs.coppa_pii_present'), undefined);
});

// ── Bug 6: SChain duplicate_identity and declared_sender_mismatch when another node errors

test('schain: duplicate_identity and declared_sender_mismatch still run when a node has an error', () => {
  const req = {
    id: 'req-schain-1',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    site: { domain: 'example.test' },
    source: {
      schain: {
        ver: '1.0',
        complete: 1,
        nodes: [
          { asi: 'exchange.example.test', sid: 'seller-1', hp: 2 },
          { asi: 'EXCHANGE.EXAMPLE.TEST', sid: 'seller-1', hp: 1 },
        ],
      },
    },
  };
  const r = core.validate(req, {
    declaredSender: { asi: 'other.example.test', sid: 'seller-2', provenance: 'declared' },
  });
  assert.ok(byId(r.findings, 'err-schain-node-hp'));
  assert.ok(byId(r.findings, 'schain.duplicate_identity'));
  assert.ok(byId(r.findings, 'schain.declared_sender_mismatch'));
  assert.equal(allById(r.findings, 'schain.duplicate_identity').length, 1);
});

// ── Bug 7: modules/analyze/handler.js handling of empty {} / [] bidRes ────────

test('analyze handler: handles explicit {} / [] bidRes without breaking frontend placeholder', async () => {
  const mod = makeAnalyzeModule();
  const validReq = {
    id: 'req-analyze-1',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    site: { domain: 'example.test' },
  };

  // Frontend placeholder on request-only analyze: bidRes: {}, bidResRaw: "" -> request-only.
  const frontendPlaceholder = await postAnalyze(mod, {
    bidReq: validReq,
    bidRes: {},
    bidResRaw: '',
  });
  assert.equal(frontendPlaceholder.status, 200);
  assert.equal(frontendPlaceholder.body.sides.response, null);
  assert.equal(frontendPlaceholder.body.crosscheck.length, 0);

  // Explicit {} pasted as bidRes (with bidResRaw: "{}") -> validates response + crosscheck.
  const explicitEmptyObj = await postAnalyze(mod, {
    bidReq: validReq,
    bidRes: {},
    bidResRaw: '{}',
  });
  assert.equal(explicitEmptyObj.status, 200);
  assert.ok(explicitEmptyObj.body.sides.response);
  assert.ok(
    explicitEmptyObj.body.validation.findings.some((f) => f.id === 'payload.unknown_type'),
    'explicit "{}" bidResRaw should validate bidRes',
  );
  assert.ok(explicitEmptyObj.body.crosscheck.some((f) => f.id === 'crosscheck.no_response'));

  // Response-only { bidRes: {} } (no bidReq) -> validates bidRes instead of 400 empty_payload.
  const resOnlyEmpty = await postAnalyze(mod, { bidRes: {} });
  assert.equal(resOnlyEmpty.status, 200);
  assert.ok(resOnlyEmpty.body.sides.response);
  assert.ok(resOnlyEmpty.body.validation.findings.some((f) => f.id === 'payload.unknown_type'));

  // Empty placeholder on both sides { bidReq: {}, bidRes: {} } -> still 400 empty_payload.
  const bothEmpty = await postAnalyze(mod, { bidReq: {}, bidRes: {} });
  assert.equal(bothEmpty.status, 400);
  assert.equal(bothEmpty.body.code, 'empty_payload');

  // Empty array bidRes: [] with valid bidReq -> validates bidRes + crosscheck.
  const emptyArrayRes = await postAnalyze(mod, { bidReq: validReq, bidRes: [] });
  assert.equal(emptyArrayRes.status, 200);
  assert.ok(emptyArrayRes.body.sides.response);
  assert.equal(emptyArrayRes.body.sides.response.type, 'Push-Materials Feed Response');
  assert.ok(emptyArrayRes.body.crosscheck.some((f) => f.id === 'crosscheck.no_response'));
});
