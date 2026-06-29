'use strict';

/**
 * Isolated API test: drive the REAL /api/analyze module (createAnalyzeModule)
 * with the real core pipeline injected and assert the response carries the
 * additive `finding.location` contract — request findings tagged side
 * 'request', response findings 'response', crosscheck with primary/related —
 * WITHOUT breaking any legacy field, and with NO payload value leaking into
 * the contract.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const core = require('../packages/core');
const { createAnalyzeModule } = require('../modules/analyze/handler');

function makeModule() {
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

function post(mod, body) {
  const route = mod.routes.find((r) => r.method === 'POST' && r.path === '/api/analyze');
  const req = Readable.from([JSON.stringify(body)]);
  return new Promise((resolve) => {
    const res = {
      writeHead() {},
      end(payload) {
        resolve(JSON.parse(payload));
      },
    };
    route.handler(req, res, new URL('http://x/api/analyze'));
  });
}

test('/api/analyze attaches location with explicit side per pane + crosscheck primary/related', async () => {
  const mod = makeModule();
  const bidReq = {
    id: 'req-1',
    cur: ['EUR'],
    imp: [{ id: 'i1', bidfloor: 0.9, banner: { format: [{ w: 300, h: 250 }] } }],
  };
  const bidRes = {
    id: 'req-1',
    cur: 'USD',
    seatbid: [{ bid: [{ id: 'b1', impid: 'i1', price: 0.1, w: 728, h: 90 }] }],
  };
  const out = await post(mod, { bidReq, bidRes });
  assert.equal(out.success, true);

  const findings = out.validation.findings;
  assert.ok(Array.isArray(findings) && findings.length > 0);

  // Every finding carries a location; legacy fields intact.
  for (const f of findings) {
    assert.ok(f.location, `finding ${f.id} missing location`);
    assert.ok('id' in f && 'level' in f && 'path' in f, 'legacy fields preserved');
    if (f.location.precision !== 'none') {
      assert.ok(['request', 'response'].includes(f.location.primary.side));
    }
  }

  // At least one request-side and one response-side locatable finding.
  const locatable = findings.filter((f) => f.location.precision !== 'none');
  assert.ok(
    locatable.some((f) => f.location.primary.side === 'request'),
    'expected a request-side location',
  );
  assert.ok(
    locatable.some((f) => f.location.primary.side === 'response'),
    'expected a response-side location',
  );

  // Crosscheck currency mismatch → primary RESPONSE /cur, related request /cur.
  const cur = out.crosscheck.find((c) => c.id === 'crosscheck.cur_not_in_request');
  assert.ok(cur, 'expected cur_not_in_request');
  assert.equal(cur.location.primary.side, 'response');
  assert.equal(cur.location.primary.pointer, '/cur');
  assert.ok(cur.location.related.some((r) => r.side === 'request' && r.pointer === '/cur'));

  // PRIVACY: the serialized contract must not embed payload values.
  const blob = JSON.stringify(out.validation.findings.map((f) => f.location)).concat(
    JSON.stringify(out.crosscheck.map((c) => c.location)),
  );
  for (const secret of ['req-1', '728', '0.1', 'USD', 'EUR']) {
    assert.ok(!blob.includes(secret), `location contract leaked payload value "${secret}"`);
  }
});

test('/api/analyze URL-string request → url dialect, provenance-gated location', async () => {
  const mod = makeModule();
  const out = await post(mod, {
    bidReq: 'https://ssp.example/win?ch-platformv=&ch-model=Pixel&url=http%3A%2F%2Fx%3F',
  });
  assert.equal(out.success, true);
  const urlLocs = out.validation.findings.map((f) => f.location).filter((l) => l.dialect === 'url');
  assert.ok(urlLocs.length > 0, 'expected url-dialect locations');
  // any enabled url location must point at a raw param key (not a JSON pointer)
  for (const l of urlLocs) {
    if (l.precision !== 'none') assert.ok(l.primary.pointer && l.primary.pointer[0] !== '/');
  }
});
