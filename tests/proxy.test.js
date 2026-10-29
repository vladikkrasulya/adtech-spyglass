'use strict';

/**
 * Proxy module tests — focus on the URL/port gate added in v0.38.1 after
 * the Gemini Pro 3.1 SSRF audit. The handler does a real `client.request`
 * for allowed hosts, so we don't exercise the streaming/timeout paths
 * here (would require a mock HTTP server). What we DO test is the
 * pre-network validation: host allow-list, port allow-list, auth gate,
 * subdomain strictness.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createProxyModule,
  DEFAULT_ALLOWED_HOSTS,
  isIpEchoHost,
  parseAllowedHosts,
} = require('../modules/proxy/handler');

// A stand-in for an operator-configured ad-tech endpoint. Nothing is
// allow-listed by default, so tests that exercise the port/URL gates must
// inject a host.
const TEST_HOST = 'rtb.partner.example';
const authed = () => ({ getCurrentUser: () => ({ id: 1 }) });

// Minimal req/res stub. Each test gets its own pair so they don't
// interfere via shared headers/state.
function makeRes() {
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    headersSent: false,
    setHeader(k, v) {
      this._headers[k] = v;
    },
    writeHead(s, h) {
      this._status = s;
      Object.assign(this._headers, h || {});
      this.headersSent = true;
    },
    end(body) {
      if (this._body == null) this._body = body;
      this.headersSent = true;
    },
  };
  return res;
}
function makeReq(body) {
  // readJson reads from a Node IncomingMessage. We fake just enough to
  // pass through readJson's expectation of a string-chunked stream.
  // Cast to `any` because IncomingMessage extends Readable with extra
  // headers/method fields the TypeScript type doesn't know we're patching on.
  const Readable = require('stream').Readable;
  /** @type {any} */
  const r = new Readable();
  r.headers = { 'content-type': 'application/json' };
  r.method = 'POST';
  r.push(typeof body === 'string' ? body : JSON.stringify(body));
  r.push(null);
  return r;
}

async function callHandler(handler, body) {
  const req = makeReq(body);
  const res = makeRes();
  await new Promise((resolve) => {
    const origEnd = res.end.bind(res);
    res.end = (b) => {
      origEnd(b);
      resolve();
    };
    handler(req, res);
    // Give the handler a tick to readJson + run the synchronous
    // validation. Network calls would take longer; we only test paths
    // that error out before any network call.
    setTimeout(() => resolve(), 200);
  });
  return res;
}

function parseBody(res) {
  if (typeof res._body !== 'string') return res._body;
  try {
    return JSON.parse(res._body);
  } catch {
    return res._body;
  }
}

// ── Auth gate ─────────────────────────────────────────────────────────────

test('proxy: 401 when not authenticated', async () => {
  const mod = createProxyModule({ auth: { getCurrentUser: () => null } });
  const handler = mod.routes[0].handler;
  const res = await callHandler(handler, { url: 'http://httpbin.org/post', data: {} });
  assert.equal(res._status, 401);
  const body = parseBody(res);
  assert.equal(body.code, 'unauthorized');
});

// ── Host allow-list ──────────────────────────────────────────────────────

test('proxy: 403 host_not_allowed for arbitrary external host', async () => {
  const mod = createProxyModule({ auth: { getCurrentUser: () => ({ id: 1 }) } });
  const handler = mod.routes[0].handler;
  const res = await callHandler(handler, { url: 'http://evil.example/post', data: {} });
  assert.equal(res._status, 403);
  assert.equal(parseBody(res).code, 'host_not_allowed');
});

test('proxy: 403 host_not_allowed for subdomain of allowed host (strict match, F-3)', async () => {
  // Pre-fix: `.endsWith('.' + h)` would have allowed evil.httpbin.org
  // through. Post-fix: strict equality, so any subdomain — even of an
  // allow-listed root — is denied.
  const mod = createProxyModule({ auth: authed(), allowedHosts: [TEST_HOST] });
  const handler = mod.routes[0].handler;
  const res = await callHandler(handler, { url: 'http://evil.' + TEST_HOST + '/post', data: {} });
  assert.equal(res._status, 403);
  assert.equal(parseBody(res).code, 'host_not_allowed');
});

// ── Port allow-list ──────────────────────────────────────────────────────

test('proxy: 403 port_not_allowed for non-standard port on allowed host (F-2)', async () => {
  // Pre-fix: hostname check let `:22` through and the proxy
  // tried to connect, leaking ECONNREFUSED vs timeout via the upstream
  // error message. Post-fix: ports outside {80, 443, default} blocked.
  const mod = createProxyModule({ auth: authed(), allowedHosts: [TEST_HOST] });
  const handler = mod.routes[0].handler;
  const res = await callHandler(handler, { url: 'http://' + TEST_HOST + ':22/', data: {} });
  assert.equal(res._status, 403);
  assert.equal(parseBody(res).code, 'port_not_allowed');
});

test('proxy: port_not_allowed for 8080 too (only 80/443 pass)', async () => {
  const mod = createProxyModule({ auth: authed(), allowedHosts: [TEST_HOST] });
  const handler = mod.routes[0].handler;
  const res = await callHandler(handler, { url: 'http://' + TEST_HOST + ':8080/', data: {} });
  assert.equal(res._status, 403);
  assert.equal(parseBody(res).code, 'port_not_allowed');
});

// ── Malformed URLs ───────────────────────────────────────────────────────

test('proxy: 400 bad_request on unparseable URL', async () => {
  const mod = createProxyModule({ auth: { getCurrentUser: () => ({ id: 1 }) } });
  const handler = mod.routes[0].handler;
  const res = await callHandler(handler, { url: 'not a url at all', data: {} });
  // URL constructor throws; readJson chain catches it → 400 bad_request.
  assert.equal(res._status, 400);
});

test('proxy: protocol smuggling (gopher://) is rejected at URL parse', async () => {
  const mod = createProxyModule({ auth: { getCurrentUser: () => ({ id: 1 }) } });
  const handler = mod.routes[0].handler;
  // gopher:// parses to a URL but with empty hostname — the allow-list
  // rejects it before the protocol-selection branch. Either path is fine
  // (no network call made).
  const res = await callHandler(handler, { url: 'gopher://httpbin.org/', data: {} });
  // Either 403 (host check on empty hostname) or 400 (parse error) is acceptable.
  assert.ok(res._status === 403 || res._status === 400, 'gopher:// must not reach the network');
});

// ── Echo / IP-reflection hosts (audit 2026-10-29, P1) ────────────────────

test('proxy: no host is allow-listed by default (httpbin/postman-echo leaked the egress IP)', async () => {
  assert.deepEqual(DEFAULT_ALLOWED_HOSTS, []);
  const handler = createProxyModule({ auth: authed() }).routes[0].handler;
  for (const url of [
    'https://httpbin.org/post',
    'https://postman-echo.com/post',
    'https://api.ipify.org/',
  ]) {
    const res = await callHandler(handler, { url, data: {} });
    assert.equal(res._status, 403, url);
    assert.equal(parseBody(res).code, 'host_not_allowed', url);
  }
});

test('proxy: echo hosts stay refused even when an operator lists them', async () => {
  const handler = createProxyModule({
    auth: authed(),
    allowedHosts: ['httpbin.org', 'Postman-Echo.com', 'eu.httpbin.org', TEST_HOST],
  }).routes[0].handler;
  for (const url of [
    'https://httpbin.org/post',
    'https://postman-echo.com/post',
    'https://eu.httpbin.org/post',
  ]) {
    const res = await callHandler(handler, { url, data: {} });
    assert.equal(res._status, 403, url);
    assert.deepEqual(
      parseBody(res).detail.allowedHosts,
      [TEST_HOST],
      'echo hosts filtered from the list',
    );
  }
});

test('proxy: isIpEchoHost matches the host and its subdomains only', () => {
  for (const h of [
    'httpbin.org',
    'a.b.httpbin.org',
    'IFCONFIG.ME',
    'api64.ipify.org',
    'webhook.site',
  ]) {
    assert.equal(isIpEchoHost(h), true, h);
  }
  for (const h of ['rtb.partner.example', 'nothttpbin.org', 'httpbin.org.example.com', '']) {
    assert.equal(isIpEchoHost(h), false, h);
  }
});

test('proxy: parseAllowedHosts trims, lower-cases and drops empties', () => {
  assert.deepEqual(parseAllowedHosts(' RTB.Example.com, ,b.example.org '), [
    'rtb.example.com',
    'b.example.org',
  ]);
  assert.deepEqual(parseAllowedHosts(undefined), []);
  assert.deepEqual(parseAllowedHosts(''), []);
});

test('proxy: a listed host passes the gate and a missing data field is a clean 400', async () => {
  const handler = createProxyModule({ auth: authed(), allowedHosts: [TEST_HOST] }).routes[0]
    .handler;
  // No `data`: pre-fix the outbound request was opened and then blew up with
  // ERR_INVALID_ARG_TYPE (a leaked Node internal) after the socket hung.
  const res = await callHandler(handler, { url: 'http://' + TEST_HOST + '/post' });
  assert.equal(res._status, 400);
  assert.equal(parseBody(res).code, 'invalid_input');
  const noUrl = await callHandler(handler, { data: {} });
  assert.equal(noUrl._status, 400);
  assert.equal(parseBody(noUrl).code, 'invalid_input');
});
