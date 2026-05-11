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

// Hard caps applied to outbound proxy requests. Tightened in v0.38.1 after
// Gemini Pro 3.1 SSRF audit (F-1, F-2, F-3):
//   - MAX_PROXY_RESPONSE_BYTES: prevents OOM via /bytes/N-style endpoints
//     that can stream arbitrary payload size. 1 MB is generous for the
//     RTB-shaped echo replies this harness exists to inspect.
//   - PROXY_TIMEOUT_MS: prevents file-descriptor exhaustion via /drip-style
//     endpoints that hold the connection open indefinitely.
//   - ALLOWED_PORTS: closes the port-scan vector. Pre-fix the hostname
//     check let `http://httpbin.org:22/` through and the proxy connected,
//     leaking ECONNREFUSED vs timeout side-channels.
const MAX_PROXY_RESPONSE_BYTES = 1024 * 1024;
const PROXY_TIMEOUT_MS = 10_000;
const ALLOWED_PORTS = new Set(['', '80', '443']);

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
        // Strict host match (post-audit F-3): allow-list compares the FULL
        // hostname only, no subdomain wildcard. The allow-list is two
        // specific hosts; if either ever permits user-registered
        // subdomains, the prior `.endsWith('.' + h)` rule would have
        // tunneled SSRF through (DNS rebinding via attacker.httpbin.org).
        const isAllowed = allowedHosts.some((h) => hostname === h);
        if (!isAllowed) {
          return sendError(
            res,
            403,
            'host_not_allowed',
            'Host not allowed. Proxy is restricted to public test endpoints only.',
            { allowedHosts },
          );
        }
        // Port allow-list (post-audit F-2): pre-fix the hostname check let
        // `http://httpbin.org:22/` through and `client.request` connected
        // to port 22 (leaking ECONNREFUSED vs timeout side-channels — port
        // scanning amplifier). Now we accept only the canonical HTTP/HTTPS
        // ports plus empty (default).
        if (!ALLOWED_PORTS.has(targetUrl.port)) {
          return sendError(
            res,
            403,
            'port_not_allowed',
            'Port not allowed. Proxy is restricted to ports 80/443.',
            { port: targetUrl.port },
          );
        }
        const client = targetUrl.protocol === 'https:' ? https : http;
        const proxyReq = client.request(
          url,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (proxyRes) => {
            // Response size cap (post-audit F-1). httpbin.org/bytes/N can
            // stream arbitrary sizes; without a cap a single authed user
            // can OOM the Node process. Destroy the upstream socket the
            // moment we cross the cap, return 502, and bail.
            let resData = '';
            let exceeded = false;
            proxyRes.on('data', (d) => {
              if (exceeded) return;
              if (resData.length + d.length > MAX_PROXY_RESPONSE_BYTES) {
                exceeded = true;
                proxyRes.destroy();
                if (!res.headersSent) {
                  sendError(
                    res,
                    502,
                    'response_too_large',
                    'Upstream response exceeded ' + MAX_PROXY_RESPONSE_BYTES + ' bytes.',
                  );
                }
                return;
              }
              resData += d;
            });
            proxyRes.on('end', () => {
              if (exceeded) return;
              sendJson(res, 200, {
                success: true,
                status: proxyRes.statusCode,
                data: resData,
              });
            });
          },
        );
        // Hard timeout (post-audit F-1). httpbin.org/drip and similar can
        // hold the socket open indefinitely; without a timeout an authed
        // attacker exhausts file descriptors. setTimeout triggers
        // `timeout` event but doesn't auto-destroy — do it explicitly.
        proxyReq.setTimeout(PROXY_TIMEOUT_MS, () => {
          proxyReq.destroy();
          if (!res.headersSent) {
            sendError(
              res,
              504,
              'upstream_timeout',
              'Upstream took longer than ' + PROXY_TIMEOUT_MS + 'ms.',
            );
          }
        });
        proxyReq.on('error', (e) => {
          if (!res.headersSent) sendError(res, 502, 'upstream_error', e.message);
        });
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
