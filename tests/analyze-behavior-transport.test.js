'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createAnalyzeModule } = require('../modules/analyze/handler');

const ADM_MAX_BYTES = 1024 * 1024;
const HTTP_MAX_BYTES = 2 * 1024 * 1024;

function makeModule(analyzeBehavior) {
  return createAnalyzeModule({
    analyzeLimiter: () => true,
    behaviorLimiter: () => true,
    auth: { clientIp: () => '127.0.0.1', getCurrentUser: () => null },
    ANALYZE_MAX_PER_WINDOW: 1000,
    BEHAVIOR_MAX_PER_WINDOW: 1000,
    resolveLocale: () => 'en',
    resolveDialect: () => undefined,
    validate: () => ({ findings: [] }),
    crosscheck: () => [],
    analyzeBehavior,
    extractAllCategories: () => [],
    detectFormat: () => null,
    unionFormat: () => null,
    rollupStatus: () => 'clean',
    AnalyzeLog: { record: () => {} },
  });
}

function postBehavior(mod, body) {
  const route = mod.routes.find(
    (candidate) => candidate.method === 'POST' && candidate.path === '/api/analyze-behavior',
  );
  const req = Readable.from([JSON.stringify(body)]);
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      writeHead(code) {
        status = code;
      },
      end(payload) {
        resolve({ status, body: JSON.parse(payload) });
      },
    };
    route.handler(req, res, new URL('http://x/api/analyze-behavior'));
  });
}

test('behavior transport decodes a serialization-safe exact 1 MiB UTF-8 creative', async () => {
  const tail = '<script>eval(atob("dmFyIHg9MTs="))</script>';
  const bom = '\uFEFF';
  const adm =
    bom + '\u0001'.repeat(ADM_MAX_BYTES - Buffer.byteLength(bom) - Buffer.byteLength(tail)) + tail;
  assert.equal(Buffer.byteLength(adm), ADM_MAX_BYTES);
  assert.ok(
    Buffer.byteLength(JSON.stringify({ events: [], adm })) > HTTP_MAX_BYTES,
    'raw JSON fixture must reproduce control-byte escaping beyond the parser cap',
  );

  const request = {
    events: [],
    adm_b64: Buffer.from(adm, 'utf8').toString('base64'),
    adm_truncated: false,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < HTTP_MAX_BYTES);

  let received = null;
  const mod = makeModule((events, options) => {
    received = { events, options };
    return { findings: [], status: 'clean', eventCount: events.length };
  });
  const response = await postBehavior(mod, request);
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  const captured = /** @type {{options: {adm: string}}} */ (/** @type {unknown} */ (received));
  assert.equal(captured.options.adm, adm);
  assert.equal(response.body.meta.admTruncated, false);
});

test('behavior transport preserves legacy adm callers', async () => {
  let received = '';
  const mod = makeModule((_events, options) => {
    received = options.adm;
    return { findings: [], status: 'clean', eventCount: 0 };
  });
  const response = await postBehavior(mod, { events: [], adm: '<div>legacy</div>' });
  assert.equal(response.status, 200);
  assert.equal(received, '<div>legacy</div>');
});

test('behavior transport rejects non-canonical, invalid UTF-8, and oversized adm_b64', async () => {
  let calls = 0;
  const mod = makeModule(() => {
    calls++;
    return { findings: [], status: 'clean', eventCount: 0 };
  });
  const invalidCases = [
    'not base64',
    '/w==',
    Buffer.alloc(ADM_MAX_BYTES + 1, 0x61).toString('base64'),
  ];
  for (const adm_b64 of invalidCases) {
    const response = await postBehavior(mod, { events: [], adm_b64 });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'invalid_input');
  }
  assert.equal(calls, 0, 'invalid source bytes must not reach the behavior engine');
});
