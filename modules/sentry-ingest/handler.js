'use strict';

const http = require('http');

/**
 * modules/sentry-ingest/handler.js — POST /glitchtip-ingest/*
 *
 * Same-origin reverse proxy from the browser-facing /glitchtip-ingest/
 * subpath to the internal glitchtip-web:8000 ingestion endpoint. Lets the
 * browser-side reporter (public/sentry-init.js) post error envelopes
 * without crossing origins (no CORS preflight) and without exposing the
 * GlitchTip web UI publicly.
 *
 * Hardening:
 *   - POST only — other methods get 405.
 *   - Path whitelist — only /api/<N>/envelope|store|security. Anything
 *     else (e.g. /api/0/organizations/, /admin/) returns 404.
 *   - Per-IP rate limit — 60 events/minute. Frontend reporter itself caps
 *     at 20/page-load but a misbehaving page or bot could still spray.
 *   - 256KB body cap on the upstream — large payloads truncated.
 *   - 5s upstream timeout — never hold the page-unload network slot.
 *
 * Factory shape: createSentryIngestModule({ logger }) returns
 * { id, routes } per the Router contract.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const UPSTREAM_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 256 * 1024;
const ALLOWED_PATH_RE = /^\/api\/\d+\/(envelope|store|security)\/?(\?.*)?$/;

function createSentryIngestModule({ logger }) {
  const log = logger.child('sentry-ingest');
  const upstreamHost = process.env.GLITCHTIP_INGEST_HOST || 'glitchtip-web';
  const upstreamPort = parseInt(process.env.GLITCHTIP_INGEST_PORT || '8000', 10);

  const buckets = new Map();
  function rateLimitOk(ip) {
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now - b.windowStart >= RATE_LIMIT_WINDOW_MS) {
      b = { count: 0, windowStart: now };
      buckets.set(ip, b);
    }
    b.count++;
    if (buckets.size > 10_000) buckets.clear();
    return b.count <= RATE_LIMIT_MAX;
  }

  function handleIngest(req, res) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
      .split(',')[0]
      .trim();
    if (!rateLimitOk(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('rate_limited');
      return;
    }

    const upstreamPath = req.url.replace(/^\/glitchtip-ingest/, '');
    if (!ALLOWED_PATH_RE.test(upstreamPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not_found');
      return;
    }

    /** @type {http.OutgoingHttpHeaders} */
    const forwardHeaders = { host: `${upstreamHost}:${upstreamPort}` };
    for (const k of ['content-type', 'content-length', 'x-sentry-auth', 'user-agent']) {
      const v = req.headers[k];
      if (v) forwardHeaders[k] = v;
    }

    const proxyReq = http.request(
      {
        hostname: upstreamHost,
        port: upstreamPort,
        path: upstreamPath,
        method: 'POST',
        headers: forwardHeaders,
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (proxyRes) => {
        const respHeaders = {};
        for (const k of ['content-type', 'content-length']) {
          if (proxyRes.headers[k]) respHeaders[k] = proxyRes.headers[k];
        }
        res.writeHead(proxyRes.statusCode || 502, respHeaders);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('upstream_timeout'));
    });
    proxyReq.on('error', (err) => {
      log.warn({ err: err.message, path: upstreamPath }, 'glitchtip upstream failed');
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('upstream_error');
      }
    });

    // 256KB body cap — the docstring promised it; req.pipe alone never enforced it.
    let bodyBytes = 0;
    req.on('data', (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        req.destroy();
        proxyReq.destroy(new Error('body_too_large'));
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end('payload_too_large');
        }
      }
    });
    req.pipe(proxyReq);
  }

  return {
    id: 'sentry-ingest',
    routes: [{ method: 'POST', path: '/glitchtip-ingest/*', handler: handleIngest }],
  };
}

module.exports = { createSentryIngestModule };
