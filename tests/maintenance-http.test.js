'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createAuth } = require('../auth');
const { createAuthRoutesModule } = require('../modules/auth/handler');
const { createAnalyzeModule } = require('../modules/analyze/handler');
const core = require('../packages/core');

function response() {
  return {
    status: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}

test('logout persistence failure clears local token and cookie before surfacing a safe error', () => {
  const dbError = new Error('synthetic private database detail');
  const logger = { info() {}, error() {} };
  const auth = createAuth({
    Users: { get: (id) => ({ id }) },
    Sessions: {
      create() {},
      pruneExpired() {},
      loadActive: () => [],
      destroy() {
        throw dbError;
      },
    },
    logger,
  });
  const req = {
    headers: { 'x-forwarded-proto': 'https', cookie: '' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const created = response();
  auth.createSession(req, created, { id: 42 });
  req.headers.cookie = created.headers['Set-Cookie'].split(';')[0];
  assert.equal(auth.getCurrentUser(req).id, 42);
  const out = response();
  assert.throws(
    () => auth.destroySession(req, out),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'session_persistence_failed');
      assert.equal(err.cause, dbError);
      return true;
    },
  );
  assert.equal(auth.getCurrentUser(req), null);
  assert.match(out.headers['Set-Cookie'], /Max-Age=0/);
  assert.match(out.headers['Set-Cookie'], /HttpOnly/);
  assert.match(out.headers['Set-Cookie'], /Secure/);
});

test('logout without a cookie remains successful and expires the cookie', () => {
  const auth = createAuth({ Users: {}, logger: { info() {} } });
  const out = response();
  auth.destroySession({ headers: {}, socket: {} }, out);
  assert.match(out.headers['Set-Cookie'], /Max-Age=0/);
});

for (const locale of ['en', 'uk', 'ru']) {
  test('logout route returns a safe localized failure after cleanup: ' + locale, () => {
    const out = response();
    const mod = createAuthRoutesModule({
      auth: {
        destroySession(_req, res) {
          res.setHeader('Set-Cookie', 'ot_session=; Max-Age=0');
          throw new Error('synthetic private database detail');
        },
      },
      Users: {},
      signToken() {},
      verifyToken() {},
      TokenError: Error,
      sendVerifyEmail() {},
      sendResetEmail() {},
      notifyAdmin() {},
      notifyEscape: String,
      publicUser: (x) => x,
      publicEncryption: (x) => x,
      getPublicBaseUrl: () => '',
      setLocaleCookie() {},
      readLocaleCookie: () => locale,
      VERIFY_TOKEN_TTL: 1,
      RESET_TOKEN_TTL: 1,
    });
    mod.routes.find((r) => r.path === '/api/auth/logout').handler({ headers: {} }, out);
    assert.equal(out.status, 500);
    assert.equal(out.body.success, false);
    assert.equal(out.body.code, 'logout_persistence_failed');
    assert.ok(out.body.error.length > 15);
    assert.doesNotMatch(JSON.stringify(out.body), /synthetic|database/);
    const expected = { en: /session/i, uk: /сес/, ru: /сесс/ };
    assert.match(out.body.error, expected[locale]);
    assert.match(out.headers['Set-Cookie'], /Max-Age=0/);
  });
}

function catalogHarness(initial, target = 'messages') {
  let content = initial;
  let reads = 0;
  const warnings = [];
  const filename = path.resolve(__dirname, '../modules/findings/handler.js');
  const realRequire = createRequire(filename);
  const moduleRecord = { exports: /** @type {any} */ ({}) };
  const code = fs.readFileSync(filename, 'utf8');
  const scopedRequire = (id) => {
    if (id === 'fs')
      return {
        readFileSync(file) {
          const isSpec = file.endsWith('spec-refs.json');
          if (target === 'messages' && isSpec) return '{}';
          if (target === 'spec' && !isSpec) return '{"synthetic.catalog":"Known message"}';
          reads++;
          if (content instanceof Error) throw content;
          return content;
        },
      };
    if (id === '../../lib/logger')
      return { child: () => ({ warn: (...args) => warnings.push(args) }) };
    return realRequire(id);
  };
  const execute = vm.runInNewContext(
    '(function(require,module,exports,__dirname){' + code + '\n})',
    { URL },
  );
  execute(scopedRequire, moduleRecord, moduleRecord.exports, path.dirname(filename));
  return {
    warnings,
    reads: () => reads,
    repair(value) {
      content = value;
    },
    get() {
      const out = response();
      moduleRecord.exports.routes[0].handler({ url: '/api/v1/finding-catalog?lang=uk' }, out);
      return out;
    },
  };
}

for (const broken of ['{invalid JSON', 'null', '[]', new Error('synthetic file read failure')]) {
  test(
    'finding catalog recovers a failed dictionary load without caching failure: ' + String(broken),
    () => {
      const h = catalogHarness(broken);
      const initial = h.get();
      assert.equal(initial.status, 200, 'existing degraded response shape remains compatible');
      assert.equal(initial.body.count, 0);
      assert.equal(initial.headers['Cache-Control'], 'no-store');
      assert.equal(h.warnings.length, 1, 'the failure is observable');
      assert.doesNotMatch(JSON.stringify(h.warnings), /synthetic file read failure|invalid JSON/);
      h.repair(JSON.stringify({ 'synthetic.catalog': 'Recovered dictionary' }));
      const repaired = h.get();
      assert.equal(repaired.body.count, 1);
      assert.equal(repaired.body.items[0].message, 'Recovered dictionary');
      assert.equal(repaired.headers['Cache-Control'], 'public, max-age=300');
      h.get();
      assert.equal(h.reads(), 2, 'successful dictionaries remain cached');
      assert.equal(h.warnings.length, 1);
    },
  );
}

test('finding catalog does not externally cache a failed specification dictionary', () => {
  const h = catalogHarness(new Error('synthetic reference read failure'), 'spec');
  const initial = h.get();
  assert.equal(initial.status, 200);
  assert.equal(initial.body.items[0].specRef, '');
  assert.equal(initial.headers['Cache-Control'], 'no-store');
  h.repair('{"synthetic.catalog":"https://example.test/spec"}');
  const repaired = h.get();
  assert.equal(repaired.body.items[0].specRef, 'https://example.test/spec');
  assert.equal(repaired.headers['Cache-Control'], 'public, max-age=300');
  assert.equal(h.reads(), 2);
});

function analyzeModule(validate = core.validate) {
  return createAnalyzeModule({
    analyzeLimiter: () => true,
    behaviorLimiter: () => true,
    auth: { clientIp: () => '127.0.0.1', getCurrentUser: () => null },
    ANALYZE_MAX_PER_WINDOW: 1000,
    BEHAVIOR_MAX_PER_WINDOW: 1000,
    resolveLocale: () => 'en',
    resolveDialect: () => 'iab',
    validate,
    crosscheck: core.crosscheck,
    analyzeBehavior: () => ({ findings: [] }),
    extractAllCategories: core.extractAllCategories,
    detectFormat: core.detectFormat,
    unionFormat: (a, b) => a || b || null,
    rollupStatus: core.rollupStatus,
    AnalyzeLog: { record() {} },
  });
}

/** @returns {Promise<ReturnType<typeof response>>} */
function analyze(body, validate) {
  const mod = analyzeModule(validate);
  const req = Readable.from([JSON.stringify(body)]);
  return new Promise((resolve) => {
    const out = response();
    out.end = function (value) {
      out.body = JSON.parse(value);
      resolve(out);
    };
    mod.routes
      .find((r) => r.path === '/api/analyze')
      .handler(req, out, new URL('http://x/api/analyze'));
  });
}

const request = { id: 'auction', imp: [{ id: 'slot', banner: { w: 300, h: 250 } }] };
const bidResponse = {
  id: 'auction',
  cur: 'EUR',
  seatbid: [{ bid: [{ id: 'bid', impid: 'slot', price: 1 }] }],
};

/** @type {Array<{bidReq?: any, bidRes?: any}>} */
const sideScenarios = [
  { bidReq: request },
  { bidRes: bidResponse },
  { bidReq: request, bidRes: bidResponse },
  { bidReq: request, bidRes: 7 },
  { bidReq: 'https://ssp.example/win?ch-platformv=&ch-model=Pixel&url=http%3A%2F%2Fx%3F' },
  {
    bidReq: {
      openrtb: {
        ver: '3.0',
        request: {
          id: 'auction',
          item: [{ id: 'slot', spec: { placement: { display: { w: 300, h: 250 } } } }],
        },
      },
    },
    bidRes: bidResponse,
  },
];
for (const body of sideScenarios) {
  test(
    'analysis sides preserve individual type/version/status and unprefixed located findings: ' +
      Object.keys(body).join('+') +
      (body.bidRes === 7
        ? '-scalar'
        : typeof body.bidReq === 'string'
          ? '-url'
          : body.bidReq?.openrtb
            ? '-mixed-versions'
            : ''),
    async () => {
      const out = await analyze(body);
      assert.equal(out.status, 200);
      assert.equal(out.body.success, true);
      for (const [side, key] of [
        ['request', 'bidReq'],
        ['response', 'bidRes'],
      ]) {
        if (!(key in body)) {
          assert.equal(out.body.sides[side], null);
          continue;
        }
        const expected = core.validate(body[key], {
          locale: 'en',
          dialect: 'iab',
          ...(side === 'response' && body.bidReq ? { pairReq: body.bidReq } : {}),
        });
        const actual = out.body.sides[side];
        assert.equal(actual.type, expected.type);
        assert.deepEqual(actual.version, expected.version);
        assert.equal(actual.status, expected.status);
        assert.deepEqual(
          actual.findings.map((f) => [f.id, f.path, f.msg]),
          expected.findings.map((f) => [f.id, f.path, f.msg]),
        );
        assert.ok(actual.findings.every((f) => f.location));
      }
      const legacyResponse = out.body.validation.findings.filter(
        (f) => f.location?.primary?.side === 'response',
      );
      assert.ok(legacyResponse.every((f) => f.msg.startsWith('[response] ')));
      const count = Object.values(out.body.sides).reduce(
        (n, side) => n + (side?.findings.length || 0),
        0,
      );
      assert.equal(out.body.validation.findings.length, count, 'no cross-document deduplication');
    },
  );
}

test('analysis sides retain duplicate-key findings separately for identical paths in two documents', async () => {
  const bidReqRaw =
    '{"id":"first","id":"auction","imp":[{"id":"slot","banner":{"w":300,"h":250}}]}';
  const bidResRaw =
    '{"id":"first","id":"auction","seatbid":[{"bid":[{"id":"bid","impid":"slot","price":1}]}]}';
  const out = await analyze({
    bidReq: JSON.parse(bidReqRaw),
    bidRes: JSON.parse(bidResRaw),
    bidReqRaw,
    bidResRaw,
  });
  for (const side of ['request', 'response']) {
    const finding = out.body.sides[side].findings.find((f) => f.id === 'payload.duplicate_key');
    assert.ok(finding, side);
    assert.equal(finding.location.primary.side, side);
    assert.doesNotMatch(finding.msg, /^\[response\] /);
  }
  assert.equal(
    out.body.validation.findings.filter((f) => f.id === 'payload.duplicate_key').length,
    2,
  );
});

test('analysis preserves filtered family incompleteness from either side without a clean union', async () => {
  const validate = (payload) => ({
    type: payload.imp ? 'request' : 'response',
    version: { version: '2.6', confidence: 1, signals: [] },
    status: 'warnings',
    findings: [],
    completeness: { complete: false, failedFamilies: payload.imp ? ['request'] : ['response'] },
  });
  const out = await analyze({ bidReq: request, bidRes: bidResponse }, validate);
  assert.equal(out.body.success, true);
  assert.equal(out.body.validation.status, 'warnings');
  assert.deepEqual(out.body.validation.completeness, {
    complete: false,
    failedFamilies: ['request', 'response'],
  });
  assert.deepEqual(out.body.sides.request.completeness.failedFamilies, ['request']);
  assert.deepEqual(out.body.sides.response.completeness.failedFamilies, ['response']);
});
