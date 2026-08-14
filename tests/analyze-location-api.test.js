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

// ── Raw-byte defects on the response side ──────────────────────────────────
// The browser parses before posting, so the three defects that exist only in
// unparsed text — a duplicate key, an integer past 2^53-1, a raw control
// character — are already gone from `bidRes` by the time validate() sees it.
// `bidResRaw` carries the bytes. Pre-fix NEITHER response branch passed
// rawText, and `bidResRaw` appeared nowhere in the repository, so the same
// defect was reportable in a BidRequest and silent in the BidResponse beside
// it.

// Duplicate `id`, and a price one past Number.MAX_SAFE_INTEGER that reads back
// as ...992. Written as text because that is the entire point.
const RAW_RES_WITH_DEFECTS =
  '{"id":"res-1","id":"res-2","seatbid":[{"bid":[{"id":"b1","impid":"i1","price":9007199254740993}]}]}';

test('/api/analyze response-only: bidResRaw surfaces duplicate keys + precision loss, [response]-prefixed', async () => {
  const mod = makeModule();
  const out = await post(mod, {
    bidRes: JSON.parse(RAW_RES_WITH_DEFECTS),
    bidResRaw: RAW_RES_WITH_DEFECTS,
  });
  assert.equal(out.success, true);

  const dup = out.validation.findings.find((f) => f.id === 'payload.duplicate_key');
  const num = out.validation.findings.find((f) => f.id === 'payload.unsafe_number');
  assert.ok(dup, 'expected payload.duplicate_key from the raw response bytes');
  assert.ok(num, 'expected payload.unsafe_number from the raw response bytes');
  // Every response-side finding is prefixed, or the reader cannot tell which
  // half of the transaction the defect is in.
  for (const f of out.validation.findings) {
    assert.ok(f.msg.startsWith('[response] '), `${f.id} must carry the [response] prefix`);
  }
  assert.match(num.msg, /9007199254740992/, 'must name the value the parse actually produced');
});

test('/api/analyze paired: the response half gets the same raw scan as the request half', async () => {
  const mod = makeModule();
  const rawReq = '{"id":"req-1","id":"req-2","imp":[{"id":"i1"}]}';
  const out = await post(mod, {
    bidReq: JSON.parse(rawReq),
    bidReqRaw: rawReq,
    bidRes: JSON.parse(RAW_RES_WITH_DEFECTS),
    bidResRaw: RAW_RES_WITH_DEFECTS,
  });
  assert.equal(out.success, true);

  const dups = out.validation.findings.filter((f) => f.id === 'payload.duplicate_key');
  assert.equal(dups.length, 2, 'both panes must report their own duplicate key');
  assert.equal(
    dups.filter((f) => f.msg.startsWith('[response] ')).length,
    1,
    'exactly one of the two is the response-side one',
  );
  assert.ok(
    out.validation.findings.some(
      (f) => f.id === 'payload.unsafe_number' && f.msg.startsWith('[response] '),
    ),
    'the response-side precision loss must survive the paired branch too',
  );
});

test('/api/analyze without bidResRaw reports nothing the raw bytes would have shown', async () => {
  // Pins the contract rather than the bug: the raw findings are reachable ONLY
  // when the caller holds the text and sends it. A caller that does not (the
  // public API, a script) still gets a valid analysis.
  const mod = makeModule();
  const out = await post(mod, { bidRes: JSON.parse(RAW_RES_WITH_DEFECTS) });
  assert.equal(out.success, true);
  for (const id of ['payload.duplicate_key', 'payload.unsafe_number']) {
    assert.ok(
      !out.validation.findings.some((f) => f.id === id),
      `${id} cannot be derived without the raw bytes`,
    );
  }
});

test('/api/analyze: the raw-scan cap notice is response-tagged like every other response finding', async () => {
  // The scan bounds how much it will list (packages/core/raw-json.js
  // DEFAULT_LIMITS.maxFindings) and says so via payload.raw_scan_truncated.
  // That notice reaches the user through the same prefixing map as the rest,
  // so it cannot read as a statement about the request.
  const mod = makeModule();
  const raw =
    '{' +
    Array.from({ length: 1100 }, (_, i) => `"k${i}":1,"k${i}":2`).join(',') +
    ',"seatbid":[]}';
  const out = await post(mod, { bidRes: JSON.parse(raw), bidResRaw: raw });
  const trunc = out.validation.findings.find((f) => f.id === 'payload.raw_scan_truncated');
  assert.ok(trunc, 'expected the cap notice once the scan stopped listing');
  assert.ok(trunc.msg.startsWith('[response] '), 'the cap notice must be response-tagged');
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
