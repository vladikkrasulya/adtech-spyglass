'use strict';

/**
 * Spyglass HTTP server. Thin wrapper around the validator core (validator.js)
 * and the SQLite store (db.js). Endpoints:
 *
 *   POST /api/analyze         — { bidReq, bidRes } → { validation, crosscheck }
 *   POST /api/proxy           — SSRF-safe forwarder to a small allow-list
 *   GET/POST/PATCH/DELETE
 *        /api/partners[/:id]  — partner CRUD
 *        /api/samples[/:id]   — saved sample CRUD
 *   GET /                     — static UI (public/index.html, etc.)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Partners, Samples } = require('./db');
const { validateORTB, crosscheck } = require('./validator');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Static file serving ─────────────────────────────────────────────────────

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
};

function serveStaticFile(req, res) {
  const rawUrl = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const sanitized = decodeURIComponent(rawUrl).replace(/\\/g, '/');
  const normalized = path.normalize(sanitized).replace(/^(\.\.(\/|\\))+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  const resolved = path.resolve(filePath);

  // Path-traversal guard
  if (resolved.indexOf(path.resolve(PUBLIC_DIR)) !== 0) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ct = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

// ── Proxy (test harness, allow-listed) ──────────────────────────────────────

function handleProxy(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    try {
      const { url, data } = JSON.parse(body);
      const targetUrl = new URL(url);
      const ALLOWED_HOSTS = ['httpbin.org', 'postman-echo.com', 'webhook.site'];
      const hostname = targetUrl.hostname;
      const isAllowed = ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
      if (!isAllowed) {
        res.writeHead(403);
        res.end(
          JSON.stringify({
            error: 'Host not allowed. Proxy is restricted to public test endpoints only.',
          }),
        );
        return;
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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: proxyRes.statusCode, data: resData }));
          });
        },
      );
      proxyReq.on('error', (e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });
      proxyReq.write(JSON.stringify(data));
      proxyReq.end();
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ── /api/analyze: validate request + response, diff them ───────────────────

function handleAnalyze(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    try {
      const { bidReq, bidRes } = JSON.parse(body);
      // Validate request — primary signal in the panel.
      const validation = validateORTB(bidReq || {});
      // Bonus: validate response if provided, append its issues to the same list.
      if (bidRes && Object.keys(bidRes).length) {
        const resValidation = validateORTB(bidRes);
        if (resValidation.errors && resValidation.errors.length) {
          validation.errors = validation.errors.concat(
            resValidation.errors.map((e) => ({ ...e, msg: '[response] ' + e.msg })),
          );
          if (resValidation.status === 'Critical' && validation.status !== 'Critical') {
            validation.status = 'Critical';
          }
        }
      }
      // Semantic crosscheck: matters only when both sides are present.
      const cross =
        bidReq && bidRes && Object.keys(bidRes).length ? crosscheck(bidReq, bidRes) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, validation, crosscheck: cross }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ── DB-backed CRUD: partners + samples ──────────────────────────────────────

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function handleApi(req, res, parsed) {
  const { pathname, searchParams } = parsed;
  const method = req.method;

  // ── partners ────────────────────────────────────────────────────────────
  if (pathname === '/api/partners' && method === 'GET') {
    return sendJson(res, 200, { success: true, partners: Partners.list() });
  }
  if (pathname === '/api/partners' && method === 'POST') {
    return readJson(req)
      .then((b) => {
        if (!b.name || !String(b.name).trim())
          return sendJson(res, 400, { success: false, error: 'name required' });
        const p = Partners.create(b);
        sendJson(res, 200, { success: true, partner: p });
      })
      .catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  let m = pathname.match(/^\/api\/partners\/(\d+)$/);
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    return readJson(req)
      .then((b) => {
        const p = Partners.update(id, b);
        if (!p) return sendJson(res, 404, { success: false, error: 'not found' });
        sendJson(res, 200, { success: true, partner: p });
      })
      .catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  if (m && method === 'DELETE') {
    const ok = Partners.delete(Number(m[1]));
    return sendJson(res, ok ? 200 : 404, { success: ok });
  }

  // ── samples ─────────────────────────────────────────────────────────────
  if (pathname === '/api/samples' && method === 'GET') {
    const pid = searchParams.get('partner_id');
    /** @type {number | 'unassigned' | undefined} */
    let partnerId;
    if (pid === 'unassigned') partnerId = 'unassigned';
    else if (pid != null && pid !== '') partnerId = Number(pid);
    return sendJson(res, 200, { success: true, samples: Samples.list({ partnerId }) });
  }
  if (pathname === '/api/samples' && method === 'POST') {
    return readJson(req)
      .then((b) => {
        if (!b.title || !String(b.title).trim())
          return sendJson(res, 400, { success: false, error: 'title required' });
        const s = Samples.create(b);
        sendJson(res, 200, { success: true, sample: s });
      })
      .catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  m = pathname.match(/^\/api\/samples\/(\d+)$/);
  if (m && method === 'GET') {
    const s = Samples.get(Number(m[1]));
    if (!s) return sendJson(res, 404, { success: false, error: 'not found' });
    return sendJson(res, 200, { success: true, sample: s });
  }
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    return readJson(req)
      .then((b) => {
        const s = Samples.update(id, b);
        if (!s) return sendJson(res, 404, { success: false, error: 'not found' });
        sendJson(res, 200, { success: true, sample: s });
      })
      .catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  if (m && method === 'DELETE') {
    const ok = Samples.delete(Number(m[1]));
    return sendJson(res, ok ? 200 : 404, { success: ok });
  }

  return false;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  if (pathname === '/api/analyze' && req.method === 'POST') return handleAnalyze(req, res);
  if (pathname === '/api/proxy' && req.method === 'POST') return handleProxy(req, res);
  if (pathname.startsWith('/api/partners') || pathname.startsWith('/api/samples')) {
    if (handleApi(req, res, parsed) !== false) return;
    return sendJson(res, 405, { success: false, error: 'method not allowed' });
  }
  serveStaticFile(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Spyglass v8 backend running at http://0.0.0.0:' + PORT);
});
