'use strict';

/**
 * modules/proxy/handler.js — POST /api/proxy
 *
 * SSRF-safe outbound POST harness used by the Playground's
 * "Send to external endpoint" tool. The host must be on a small,
 * static allow-list (httpbin.org, postman-echo.com — public RTB-
 * shaped echo services). Anything else returns 403 host_not_allowed
 * with the allow-list echoed back so the UI can render a helpful
 * error.
 *
 * Auth-gated (session cookie). No DB, no rate-limiter, no locale —
 * the module's only real deps are auth + Node http/https. Factory
 * keeps the same shape as the other modules for uniformity even
 * though the surface is tiny.
 *
 * The allow-list is INTENTIONALLY hard-coded inside the module:
 * adding a host requires a code review + deploy, not an env flip.
 * If you ever need it dynamic, inject via deps.allowedHosts instead
 * of plumbing env into the handler.
 *
 * Wiring (in server.js):
 *   const { createProxyModule } = require('./modules/proxy/handler');
 *   router.register(createProxyModule({ auth }));
 */

const http = require('http');
const https = require('https');
const { readJson, sendJson, sendError } = require('../../lib/http');

const DEFAULT_ALLOWED_HOSTS = ['httpbin.org', 'postman-echo.com'];

/**
 * @param {{
 *   auth: { getCurrentUser: (req: import('http').IncomingMessage) => any },
 *   allowedHosts?: string[],
 * }} deps
 */
function createProxyModule(deps) {
  const { auth } = deps;
  const allowedHosts =
    Array.isArray(deps.allowedHosts) && deps.allowedHosts.length
      ? deps.allowedHosts.slice()
      : DEFAULT_ALLOWED_HOSTS.slice();

  function handleProxy(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      return sendError(res, 401, 'unauthorized', 'Sign in to use the proxy harness');
    }
    readJson(req)
      .then(({ url, data }) => {
        const targetUrl = new URL(url);
        const hostname = targetUrl.hostname;
        const isAllowed = allowedHosts.some((h) => hostname === h || hostname.endsWith('.' + h));
        if (!isAllowed) {
          return sendError(
            res,
            403,
            'host_not_allowed',
            'Host not allowed. Proxy is restricted to public test endpoints only.',
            { allowedHosts },
          );
        }
        const client = targetUrl.protocol === 'https:' ? https : http;
        const proxyReq = client.request(
          url,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (proxyRes) => {
            let resData = '';
            proxyRes.on('data', (d) => {
              resData += d;
            });
            proxyRes.on('end', () => {
              sendJson(res, 200, {
                success: true,
                status: proxyRes.statusCode,
                data: resData,
              });
            });
          },
        );
        proxyReq.on('error', (e) => sendError(res, 502, 'upstream_error', e.message));
        proxyReq.write(JSON.stringify(data));
        proxyReq.end();
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  return {
    id: 'proxy',
    routes: [{ method: 'POST', path: '/api/proxy', handler: handleProxy }],
  };
}

module.exports = { createProxyModule, DEFAULT_ALLOWED_HOSTS };
