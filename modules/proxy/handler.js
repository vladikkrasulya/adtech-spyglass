'use strict';

/**
 * modules/proxy/handler.js — POST /api/proxy
 *
 * SSRF-safe outbound POST harness used by the Playground's
 * "Send to external endpoint" tool. The host must be on an operator-
 * supplied allow-list (ORTBTOOLS_PROXY_ALLOWED_HOSTS, comma-separated
 * exact hostnames). The built-in list is EMPTY: the harness is off until
 * the operator names a real ad-tech endpoint. Anything not listed returns
 * 403 host_not_allowed with the allow-list echoed back so the UI can
 * render a helpful error.
 *
 * Public echo / IP-reflection services (httpbin, postman-echo, ipify,
 * ifconfig.* ...) are refused even when listed: they reflect the server's
 * egress address (`origin`, X-Forwarded-For) back to the caller, which
 * unmasks a host that is otherwise hidden behind a tunnel/CDN.
 *
 * Auth-gated (session cookie) and rate-limited per user (deps.proxyLimiter).
 * No DB, no locale — the module's other deps are auth + Node http/https. Factory
 * keeps the same shape as the other modules for uniformity even
 * though the surface is tiny.
 *
 * The allow-list is injected via deps.allowedHosts (server.js reads the
 * env var); the module itself never reads the environment.
 *
 * Wiring (in server.js):
 *   const { createProxyModule } = require('./modules/proxy/handler');
 *   router.register(createProxyModule({ auth }));
 */

const http = require('http');
const https = require('https');
const { readJson, sendJson, sendError } = require('../../lib/http');

// No built-in hosts. httpbin.org and postman-echo.com used to be listed, but
// both echo the caller's source address back in the body (`origin`,
// `x-forwarded-for`), which handed any signed-in user the server's home IPv4.
/** @type {string[]} */
const DEFAULT_ALLOWED_HOSTS = [];

// Hosts that reflect the requester's address (or capture requests for later
// retrieval). Matched as the host itself or any subdomain. Refused even if an
// operator lists them: they defeat origin hiding.
const IP_ECHO_HOSTS = [
  'httpbin.org',
  'httpbingo.org',
  'postman-echo.com',
  'ipify.org',
  'ifconfig.me',
  'ifconfig.co',
  'ifconfig.io',
  'icanhazip.com',
  'ipinfo.io',
  'ipecho.net',
  'ident.me',
  'checkip.amazonaws.com',
  'wtfismyip.com',
  'ip-api.com',
  'ipapi.co',
  'myip.com',
  'whatismyip.com',
  'webhook.site',
  'requestbin.com',
  'pipedream.net',
  'requestcatcher.com',
];

/**
 * @param {string} hostname lower-case hostname
 */
function isIpEchoHost(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  return IP_ECHO_HOSTS.some((echo) => h === echo || h.endsWith('.' + echo));
}

/**
 * Parse ORTBTOOLS_PROXY_ALLOWED_HOSTS (comma-separated exact hostnames).
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseAllowedHosts(raw) {
  return String(raw || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

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
 *   proxyLimiter?: (key: string) => boolean,
 * }} deps
 */
function createProxyModule(deps) {
  const { auth, proxyLimiter } = deps;
  // An explicit empty list disables the harness; echo/IP-reflection hosts are
  // dropped no matter who supplied them.
  const allowedHosts = (
    Array.isArray(deps.allowedHosts) ? deps.allowedHosts : DEFAULT_ALLOWED_HOSTS
  )
    .map((h) => String(h).toLowerCase())
    .filter((h) => !isIpEchoHost(h));

  function handleProxy(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      return sendError(res, 401, 'unauthorized', 'Sign in to use the proxy harness');
    }
    // Keyed by user id (the route is session-gated), like the library writes.
    if (proxyLimiter && !proxyLimiter(String(user.id))) {
      return sendError(res, 429, 'rate_limited', 'Too many proxy requests. Try again shortly.');
    }
    readJson(req)
      .then(({ url, data }) => {
        if (typeof url !== 'string' || !url) {
          return sendError(res, 400, 'invalid_input', 'url is required');
        }
        if (data === undefined) {
          return sendError(res, 400, 'invalid_input', 'data is required');
        }
        const targetUrl = new URL(url);
        const hostname = targetUrl.hostname;
        // Strict host match (post-audit F-3): allow-list compares the FULL
        // hostname only, no subdomain wildcard. If a listed host ever permits user-registered
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

module.exports = {
  createProxyModule,
  DEFAULT_ALLOWED_HOSTS,
  IP_ECHO_HOSTS,
  isIpEchoHost,
  parseAllowedHosts,
};
