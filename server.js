'use strict';

/**
 * Spyglass HTTP server. Thin wrapper around the validator core (validator/),
 * the SQLite store (db.js), and the auth module (auth.js).
 *
 * Public (no auth):
 *   GET  /api/health                 — DB ping
 *   POST /api/analyze                — { bidReq, bidRes } → validation + crosscheck
 *   POST /api/proxy                  — SSRF-safe forwarder (allow-listed)
 *   POST /api/auth/register          — { email, password }
 *   POST /api/auth/login             — { email, password }
 *   POST /api/auth/logout            — clear session
 *   GET  /api/auth/me                — current user or { user: null }
 *
 * Auth required (per-user scoped, returns 401 when anonymous):
 *   GET/POST/PATCH/DELETE
 *        /api/partners[/:id]         — partner CRUD
 *        /api/samples[/:id]          — saved sample CRUD
 *
 * Static UI at GET /.
 *
 * Error contract:
 *   - All /api/* responses follow {success: bool, ...payload | error, code?}
 *   - Unhandled exceptions get logged + return 500 with a stable shape
 *   - process-level unhandledRejection / uncaughtException are caught so a
 *     single bug doesn't kill the worker — they log and continue
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Users, Partners, Samples, db } = require('./db');
const { createAuth } = require('./auth');
const { validate, crosscheck, listLocales, listDialects } = require('./validator');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_LOCALE = 'uk';
const DEFAULT_DIALECT = 'iab';

const auth = createAuth({ Users });

// ── Process-level safety net ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

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

// ── HTTP helpers ────────────────────────────────────────────────────────────

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2 * 1024 * 1024) {
        reject(makeError('payload_too_large', 'Payload exceeds 2MB limit'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(makeError('invalid_json', 'Body is not valid JSON: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, error, detail) {
  const body = { success: false, error, code };
  if (detail !== undefined) body.detail = detail;
  sendJson(res, status, body);
}

function makeError(code, msg) {
  const e = /** @type {Error & {code?: string}} */ (new Error(msg));
  e.code = code;
  return e;
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, created_at: u.created_at };
}

function resolveLocale(parsed) {
  const want = parsed.searchParams.get('locale');
  if (want && listLocales().includes(want)) return want;
  return DEFAULT_LOCALE;
}

function resolveDialect(parsed) {
  const want = parsed.searchParams.get('dialect');
  if (want && listDialects().includes(want)) return want;
  return DEFAULT_DIALECT;
}

// ── Auth routes ─────────────────────────────────────────────────────────────

function handleAuthRoute(req, res, parsed) {
  const { pathname } = parsed;
  const method = req.method;

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = auth.getCurrentUser(req);
    return sendJson(res, 200, { success: true, user: publicUser(user) });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    return readJson(req)
      .then(async ({ email, password }) => {
        const user = await auth.register({ email, password }, req);
        auth.createSession(req, res, user);
        sendJson(res, 200, { success: true, user: publicUser(user) });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    return readJson(req)
      .then(async ({ email, password }) => {
        const user = await auth.login({ email, password }, req);
        auth.createSession(req, res, user);
        sendJson(res, 200, { success: true, user: publicUser(user) });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    auth.destroySession(req, res);
    return sendJson(res, 200, { success: true });
  }

  return false;
}

// ── /api/proxy (allow-listed test harness) ──────────────────────────────────

function handleProxy(req, res) {
  readJson(req)
    .then(({ url, data }) => {
      const targetUrl = new URL(url);
      const ALLOWED_HOSTS = ['httpbin.org', 'postman-echo.com', 'webhook.site'];
      const hostname = targetUrl.hostname;
      const isAllowed = ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
      if (!isAllowed) {
        return sendError(
          res,
          403,
          'host_not_allowed',
          'Host not allowed. Proxy is restricted to public test endpoints only.',
          { allowedHosts: ALLOWED_HOSTS },
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

// ── /api/analyze ────────────────────────────────────────────────────────────

function handleAnalyze(req, res, parsed) {
  const locale = resolveLocale(parsed);
  const dialect = resolveDialect(parsed);
  readJson(req)
    .then(({ bidReq, bidRes }) => {
      const validation = validate(bidReq || {}, { locale, dialect });

      if (bidRes && Object.keys(bidRes).length) {
        const resValidation = validate(bidRes, { locale, dialect });
        if (resValidation.findings && resValidation.findings.length) {
          validation.findings = validation.findings.concat(
            resValidation.findings.map((f) => Object.assign({}, f, { msg: '[response] ' + f.msg })),
          );
          if (resValidation.status === 'errors' && validation.status !== 'errors') {
            validation.status = 'errors';
          } else if (resValidation.status === 'warnings' && validation.status === 'clean') {
            validation.status = 'warnings';
          }
        }
      }

      const cross =
        bidReq && bidRes && Object.keys(bidRes).length
          ? crosscheck(bidReq, bidRes, { locale })
          : [];

      sendJson(res, 200, {
        success: true,
        validation,
        crosscheck: cross,
        meta: { locale, dialect },
      });
    })
    .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
}

// ── Per-user CRUD: partners + samples (auth-required) ──────────────────────

function handleApi(req, res, parsed, user) {
  const { pathname, searchParams } = parsed;
  const method = req.method;
  const userId = user.id;

  // ── partners ────────────────────────────────────────────────────────────
  if (pathname === '/api/partners' && method === 'GET') {
    return sendJson(res, 200, { success: true, partners: Partners.list({ userId }) });
  }
  if (pathname === '/api/partners' && method === 'POST') {
    return readJson(req)
      .then((b) => {
        if (!b.name || !String(b.name).trim()) {
          return sendError(res, 400, 'name_required', 'Partner name is required');
        }
        const p = Partners.create({ userId, ...b });
        sendJson(res, 200, { success: true, partner: p });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }
  let m = pathname.match(/^\/api\/partners\/(\d+)$/);
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    return readJson(req)
      .then((b) => {
        const p = Partners.update({ id, userId, ...b });
        if (!p) return sendError(res, 404, 'not_found', 'Partner not found');
        sendJson(res, 200, { success: true, partner: p });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }
  if (m && method === 'DELETE') {
    const ok = Partners.delete({ id: Number(m[1]), userId });
    return ok
      ? sendJson(res, 200, { success: true })
      : sendError(res, 404, 'not_found', 'Partner not found');
  }

  // ── samples ─────────────────────────────────────────────────────────────
  if (pathname === '/api/samples' && method === 'GET') {
    const pid = searchParams.get('partner_id');
    /** @type {number | 'unassigned' | undefined} */
    let partnerId;
    if (pid === 'unassigned') partnerId = 'unassigned';
    else if (pid != null && pid !== '') partnerId = Number(pid);
    return sendJson(res, 200, {
      success: true,
      samples: Samples.list({ userId, partnerId }),
    });
  }
  if (pathname === '/api/samples' && method === 'POST') {
    return readJson(req)
      .then((b) => {
        if (!b.title || !String(b.title).trim()) {
          return sendError(res, 400, 'title_required', 'Sample title is required');
        }
        const s = Samples.create({ userId, ...b });
        sendJson(res, 200, { success: true, sample: s });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }
  m = pathname.match(/^\/api\/samples\/(\d+)$/);
  if (m && method === 'GET') {
    const s = Samples.get({ id: Number(m[1]), userId });
    if (!s) return sendError(res, 404, 'not_found', 'Sample not found');
    return sendJson(res, 200, { success: true, sample: s });
  }
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    return readJson(req)
      .then((b) => {
        const s = Samples.update({ id, userId, ...b });
        if (!s) return sendError(res, 404, 'not_found', 'Sample not found');
        sendJson(res, 200, { success: true, sample: s });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }
  if (m && method === 'DELETE') {
    const ok = Samples.delete({ id: Number(m[1]), userId });
    return ok
      ? sendJson(res, 200, { success: true })
      : sendError(res, 404, 'not_found', 'Sample not found');
  }

  return false;
}

// ── /api/health ─────────────────────────────────────────────────────────────

function handleHealth(_req, res) {
  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const status = dbOk ? 200 : 503;
  sendJson(res, status, {
    success: dbOk,
    status: dbOk ? 'ok' : 'degraded',
    checks: { db: dbOk },
    sessions: auth.activeSessionCount(),
    users: Users.count(),
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    node: process.version,
  });
}

// ── HTTP dispatch ────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  let parsed;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch {
    return sendError(res, 400, 'bad_url', 'Invalid request URL');
  }
  const { pathname } = parsed;

  try {
    if (pathname === '/api/health' && req.method === 'GET') return handleHealth(req, res);
    if (pathname === '/api/analyze' && req.method === 'POST')
      return handleAnalyze(req, res, parsed);
    if (pathname === '/api/proxy' && req.method === 'POST') return handleProxy(req, res);
    if (pathname.startsWith('/api/auth/')) {
      if (handleAuthRoute(req, res, parsed) !== false) return;
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed for this resource');
    }
    if (pathname.startsWith('/api/partners') || pathname.startsWith('/api/samples')) {
      const user = auth.getCurrentUser(req);
      if (!user) {
        return sendError(res, 401, 'unauthorized', 'Sign in to access your library');
      }
      if (handleApi(req, res, parsed, user) !== false) return;
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed for this resource');
    }
    return serveStaticFile(req, res);
  } catch (err) {
    console.error('[handler error]', err && err.stack ? err.stack : err);
    return sendError(res, 500, 'internal_error', 'Internal server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Spyglass backend listening at http://0.0.0.0:' + PORT);
});

const shutdown = (signal) => {
  console.log('[' + signal + '] shutting down');
  auth.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
