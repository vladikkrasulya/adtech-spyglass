'use strict';

/**
 * tests/upstream-status.test.js
 *
 * Upstream-caused failures (third-party asset host, local labeller model) are
 * answered 424 Failed Dependency, never 502/504: Cloudflare replaces an origin
 * 502/504 with a plain-text `error code: 5xx` page, so the client loses the
 * JSON `code` the UI branches on. Client mistakes keep their own 4xx.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const http = require('../lib/http');
const ollama = require('../lib/ollama');

function makeRes() {
  const res = {
    statusCode: 0,
    payload: null,
    headers: {},
    setHeader(k, v) {
      res.headers[k] = v;
    },
    writeHead(code) {
      res.statusCode = code;
    },
    end(text) {
      res.payload = text ? JSON.parse(text) : null;
    },
  };
  return res;
}

async function call(route, body) {
  const res = makeRes();
  await route.handler(Readable.from([JSON.stringify(body)]), res);
  return res;
}

// ── creative-asset ───────────────────────────────────────────────────

function loadCreativeAsset(fetchAsset) {
  const fetchPath = require.resolve('../lib/asset-fetch');
  const handlerPath = require.resolve('../modules/creative-asset/handler');
  const realFetchMod = require.cache[fetchPath];
  delete require.cache[handlerPath];
  require.cache[fetchPath] = /** @type {any} */ ({
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: { fetchAsset, MAX_ASSET_BYTES: 1 },
  });
  const { createCreativeAssetModule } = require(handlerPath);
  const mod = createCreativeAssetModule({ auth: { getCurrentUser: () => ({ id: 'u1' }) } });
  // restore so other test files in this process see the real module
  delete require.cache[handlerPath];
  if (realFetchMod) require.cache[fetchPath] = realFetchMod;
  else delete require.cache[fetchPath];
  return mod.routes[0];
}

function failing(code, message) {
  return async () => {
    const e = /** @type {Error & {code?: string}} */ (new Error(message || code));
    e.code = code;
    throw e;
  };
}

test('creative-asset: upstream_failed / upstream_status / timeout / unknown → 424 with the same JSON code', async () => {
  for (const code of ['upstream_failed', 'upstream_status', 'timeout']) {
    const route = loadCreativeAsset(failing(code, 'boom ' + code));
    const res = await call(route, { url: 'https://cdn.example.test/a.png' });
    assert.equal(res.statusCode, 424, code);
    assert.equal(res.payload.code, code);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.error, 'boom ' + code);
  }
  // An error without a `code` is treated as upstream_failed.
  const route = loadCreativeAsset(async () => {
    throw new Error('weird');
  });
  const res = await call(route, { url: 'https://cdn.example.test/a.png' });
  assert.equal(res.statusCode, 424);
  assert.equal(res.payload.code, 'upstream_failed');
});

test('creative-asset: caller-caused failures keep their own 4xx and nothing returns 502/504', async () => {
  const expected = {
    url_invalid: 400,
    scheme_blocked: 400,
    port_blocked: 400,
    host_blocked: 403,
    dns_failed: 404,
    redirect_blocked: 409,
    type_blocked: 415,
    too_large: 413,
  };
  for (const [code, status] of Object.entries(expected)) {
    const route = loadCreativeAsset(failing(code));
    const res = await call(route, { url: 'https://cdn.example.test/a.png' });
    assert.equal(res.statusCode, status, code);
    assert.equal(res.payload.code, code);
    assert.notEqual(res.statusCode, 502);
    assert.notEqual(res.statusCode, 504);
  }
});

// ── ai-label ─────────────────────────────────────────────────────────

// Every deterministic source abstains on this signal, so the route reaches the
// model (see tests/key-role-precedence.test.js "everything abstains").
const MODEL_ROUTE_BODY = {
  signal_path: 'imp[0].ext.publisher_account_ref',
  signal_value: 42,
  imp: { id: '1', banner: { w: 300, h: 250 } },
};

function aiLabelRoute() {
  const { createAiLabelModule } = require('../modules/ai-label/handler');
  const mod = createAiLabelModule({ auth: { getCurrentUser: () => ({ id: 'u1' }) } });
  return mod.routes.find((r) => r.path === '/api/dialects/suggest-label');
}

async function withOllama(stubs, fn) {
  const real = { verifyPersona: ollama.verifyPersona, classifySignal: ollama.classifySignal };
  Object.assign(ollama, stubs);
  const pages = [];
  http.init({
    notifyAdmin: (msg, opts) => pages.push({ msg, opts }),
    notifyEscape: (s) => String(s),
  });
  try {
    return await fn(pages);
  } finally {
    Object.assign(ollama, real);
    http.init({ notifyAdmin: null, notifyEscape: null });
  }
}

test('ai-label: model timeout → 424 labeller_timeout, operator still alerted', async () => {
  await withOllama(
    {
      verifyPersona: async () => ({ ok: true }),
      classifySignal: async () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      },
    },
    async (pages) => {
      const res = await call(aiLabelRoute(), MODEL_ROUTE_BODY);
      assert.equal(res.statusCode, 424);
      assert.equal(res.payload.code, 'labeller_timeout');
      assert.equal(pages.length, 1);
      assert.match(pages[0].msg, /labeller_timeout/);
    },
  );
});

test('ai-label: model failure and out-of-vocabulary output → 424', async () => {
  await withOllama(
    {
      verifyPersona: async () => ({ ok: true }),
      classifySignal: async () => {
        throw new Error('ollama exploded');
      },
    },
    async () => {
      const res = await call(aiLabelRoute(), MODEL_ROUTE_BODY);
      assert.equal(res.statusCode, 424);
      assert.equal(res.payload.code, 'labeller_failed');
    },
  );
  await withOllama(
    {
      verifyPersona: async () => ({ ok: true }),
      classifySignal: async () => ({ label: 'not-a-label', confidence: 0.5, reason: 'x' }),
    },
    async () => {
      const res = await call(aiLabelRoute(), MODEL_ROUTE_BODY);
      assert.equal(res.statusCode, 424);
      assert.equal(res.payload.code, 'bad_model_output');
    },
  );
});

test('ai-label: model host unreachable stays 503 labeller_unavailable', async () => {
  await withOllama(
    { verifyPersona: async () => ({ ok: false, reason: 'unreachable' }) },
    async (pages) => {
      const res = await call(aiLabelRoute(), MODEL_ROUTE_BODY);
      assert.equal(res.statusCode, 503);
      assert.equal(res.payload.code, 'labeller_unavailable');
      assert.equal(pages.length, 1, '5xx still pages via sendError');
    },
  );
});

test('http.alertOperator is a no-op without a configured sink', () => {
  http.init({ notifyAdmin: null, notifyEscape: null });
  assert.doesNotThrow(() => http.alertOperator(makeRes(), 424, 'x'));
});
