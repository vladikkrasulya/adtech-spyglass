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
 *   GET  /api/auth/me                — current user + opaque crypto state
 *
 * Auth required (per-user scoped, returns 401 when anonymous):
 *   POST /api/auth/setup-encryption  — opaque crypto-state bootstrap (Phase 7)
 *   GET/POST/PATCH/DELETE
 *        /api/partners[/:id]         — partner CRUD
 *        /api/samples[/:id]          — saved sample CRUD (bid_req/bid_res
 *                                      are AES-GCM ciphertext + IVs; server
 *                                      cannot decrypt — Phase 7 zero-knowledge)
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
const { signToken, verifyToken, TokenError } = require('./tokens');
const { sendVerifyEmail, sendResetEmail } = require('./email');
const { validate, crosscheck, listLocales, listDialects } = require('@kyivtech/spyglass-core');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_LOCALE = 'uk';
const DEFAULT_DIALECT = 'iab';

// Phase 8 token durations
const VERIFY_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
const RESET_TOKEN_TTL = 15 * 60; // 15 min

function getPublicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || 'http://localhost:' + PORT;
}

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
  return {
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    email_verified_at: u.email_verified_at != null ? u.email_verified_at : null,
  };
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
    if (!user) return sendJson(res, 200, { success: true, user: null, encryption: null });
    // Surface crypto state so the client can derive KEK and unwrap DEK.
    const cs = Users.getCryptoState(user.id);
    const encryption =
      cs && cs.kdf_salt
        ? {
            kdf_salt: cs.kdf_salt,
            dek_wrapped: cs.dek_wrapped,
            dek_iv: cs.dek_iv,
          }
        : null;
    return sendJson(res, 200, { success: true, user: publicUser(user), encryption });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    return readJson(req)
      .then(async ({ email, password }) => {
        const user = await auth.register({ email, password }, req);
        auth.createSession(req, res, user);
        sendJson(res, 200, { success: true, user: publicUser(user) });
        // Fire-and-forget: don't block the register response on email send.
        // Failures are logged; user will see "unverified" banner regardless
        // and can re-trigger via /api/auth/verify-email/request.
        try {
          const tok = signToken({
            purpose: 'verify',
            user_id: user.id,
            email: user.email,
            expirySeconds: VERIFY_TOKEN_TTL,
          });
          sendVerifyEmail({ email: user.email }, tok, getPublicBaseUrl()).catch((err) =>
            console.error('[register] verify email send failed:', err.message),
          );
        } catch (err) {
          console.error('[register] verify token sign failed:', err.message);
        }
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    return readJson(req)
      .then(async ({ email, password }) => {
        const user = await auth.login({ email, password }, req);
        auth.createSession(req, res, user);
        const cs = Users.getCryptoState(user.id);
        const encryption =
          cs && cs.kdf_salt
            ? {
                kdf_salt: cs.kdf_salt,
                dek_wrapped: cs.dek_wrapped,
                dek_iv: cs.dek_iv,
              }
            : null;
        sendJson(res, 200, { success: true, user: publicUser(user), encryption });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    auth.destroySession(req, res);
    return sendJson(res, 200, { success: true });
  }

  // Bootstrap or rotate the per-user crypto state. Body is opaque to the
  // server — it just stores what the client computed in the browser.
  // Required: { kdf_salt, dek_wrapped, dek_iv,
  //             recovery_salt, recovery_dek_wrapped, recovery_dek_iv }.
  if (pathname === '/api/auth/setup-encryption' && method === 'POST') {
    const user = auth.getCurrentUser(req);
    if (!user) {
      return sendError(res, 401, 'unauthorized', 'Sign in first');
    }
    return readJson(req)
      .then((b) => {
        const required = [
          'kdf_salt',
          'dek_wrapped',
          'dek_iv',
          'recovery_salt',
          'recovery_dek_wrapped',
          'recovery_dek_iv',
        ];
        for (const k of required) {
          if (typeof b[k] !== 'string' || !b[k].length) {
            return sendError(res, 400, 'invalid_state', `Missing field: ${k}`);
          }
        }
        Users.setCryptoState(user.id, b);
        sendJson(res, 200, { success: true });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  // ── Phase 8 — email verification + password reset ──────────────────────

  // Re-send verify email for the currently logged-in user.
  if (pathname === '/api/auth/verify-email/request' && method === 'POST') {
    const user = auth.getCurrentUser(req);
    if (!user) return sendError(res, 401, 'unauthorized', 'Sign in first');
    try {
      const tok = signToken({
        purpose: 'verify',
        user_id: user.id,
        email: user.email,
        expirySeconds: VERIFY_TOKEN_TTL,
      });
      sendVerifyEmail({ email: user.email }, tok, getPublicBaseUrl()).catch((err) =>
        console.error('[verify-email/request] send failed:', err.message),
      );
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendError(res, 500, 'verify_email_failed', err.message);
    }
  }

  // GET because user clicks a link from their email. Browser does GET, we
  // 302-redirect to / with a status param the UI reads to show a banner.
  if (pathname === '/api/auth/verify-email/confirm' && method === 'GET') {
    const tok = parsed.searchParams.get('token');
    const base = getPublicBaseUrl();
    if (!tok) {
      res.writeHead(302, { Location: `${base}/?verify_error=missing` });
      return res.end();
    }
    try {
      const payload = verifyToken(tok, 'verify');
      const u = Users.get(payload.user_id);
      if (!u || u.email !== payload.email) {
        // Email rotated since token was issued, or user gone.
        res.writeHead(302, { Location: `${base}/?verify_error=stale` });
        return res.end();
      }
      Users.markEmailVerified(payload.user_id);
      res.writeHead(302, { Location: `${base}/?verified=1` });
      return res.end();
    } catch (err) {
      const code = err instanceof TokenError ? err.code : 'invalid';
      res.writeHead(302, { Location: `${base}/?verify_error=${encodeURIComponent(code)}` });
      return res.end();
    }
  }

  // Public — always returns 200 (don't leak which emails exist).
  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    return readJson(req)
      .then(async ({ email }) => {
        // Rate-limit silently: success response either way, but stop floods.
        if (!auth.checkForgotPasswordLimit(req)) {
          return sendJson(res, 200, { success: true });
        }
        if (typeof email === 'string' && email.trim()) {
          const u = Users.getByEmail(email);
          if (u) {
            try {
              const tok = signToken({
                purpose: 'reset',
                user_id: u.id,
                email: u.email,
                expirySeconds: RESET_TOKEN_TTL,
              });
              sendResetEmail({ email: u.email }, tok, getPublicBaseUrl()).catch((err) =>
                console.error('[forgot-password] send failed:', err.message),
              );
            } catch (err) {
              console.error('[forgot-password] sign failed:', err.message);
            }
          }
        }
        return sendJson(res, 200, { success: true });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  // Used by the reset-password UI: with a valid reset token (proof of email
  // ownership), client fetches the user's crypto state so it can unwrap the
  // DEK locally and re-wrap under a new KEK before POSTing to /reset-password.
  // Same-token-as-proof: no separate auth needed.
  if (pathname === '/api/auth/reset-password/state' && method === 'POST') {
    return readJson(req)
      .then((b) => {
        let payload;
        try {
          payload = verifyToken(b.token, 'reset');
        } catch (err) {
          const code = err instanceof TokenError ? err.code : 'invalid_token';
          return sendError(res, 400, code, 'Reset link is invalid or expired');
        }
        const u = Users.get(payload.user_id);
        if (!u || u.email !== payload.email) {
          return sendError(res, 400, 'stale_token', 'Reset link is no longer valid');
        }
        const cs = Users.getCryptoState(payload.user_id);
        return sendJson(res, 200, {
          success: true,
          email: u.email,
          encryption: cs && cs.kdf_salt ? cs : null,
        });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  // Public — body shape depends on `mode`. See spyglass_phase_8_plan.md and
  // spyglass_crypto_architecture.md (wrap-rotation gotcha) for context.
  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    return readJson(req)
      .then(async (b) => {
        let payload;
        try {
          payload = verifyToken(b.token, 'reset');
        } catch (err) {
          const code = err instanceof TokenError ? err.code : 'invalid_token';
          return sendError(res, 400, code, 'Reset link is invalid or expired');
        }
        const u = Users.get(payload.user_id);
        if (!u || u.email !== payload.email) {
          return sendError(res, 400, 'stale_token', 'Reset link is no longer valid');
        }
        if (typeof b.newPassword !== 'string') {
          return sendError(res, 400, 'invalid_request', 'newPassword required');
        }

        const mode = b.mode;
        if (mode === 'rotate') {
          // Browser unwrapped DEK using OLD password, re-wrapped under NEW KEK.
          // Server verifies old password as proof, then stores new wrap.
          const fullUser = Users.getByEmail(payload.email);
          const ok = await auth.verifyPassword(b.oldPassword, fullUser.password_hash);
          if (!ok) return sendError(res, 401, 'invalid_credentials', 'Wrong current password');
          const required = ['new_kdf_salt', 'new_dek_wrapped', 'new_dek_iv'];
          for (const k of required) {
            if (typeof b[k] !== 'string' || !b[k].length) {
              return sendError(res, 400, 'invalid_state', `Missing field: ${k}`);
            }
          }
          const newHash = await auth.hashPassword(b.newPassword);
          Users.updatePassword(payload.user_id, newHash);
          Users.setPasswordCryptoState(payload.user_id, {
            kdf_salt: b.new_kdf_salt,
            dek_wrapped: b.new_dek_wrapped,
            dek_iv: b.new_dek_iv,
          });
        } else if (mode === 'recover') {
          // Browser unwrapped DEK using recovery key, re-wrapped under new KEK.
          // No password proof needed (recovery key WAS the proof).
          const required = ['new_kdf_salt', 'new_dek_wrapped', 'new_dek_iv'];
          for (const k of required) {
            if (typeof b[k] !== 'string' || !b[k].length) {
              return sendError(res, 400, 'invalid_state', `Missing field: ${k}`);
            }
          }
          const newHash = await auth.hashPassword(b.newPassword);
          Users.updatePassword(payload.user_id, newHash);
          Users.setPasswordCryptoState(payload.user_id, {
            kdf_salt: b.new_kdf_salt,
            dek_wrapped: b.new_dek_wrapped,
            dek_iv: b.new_dek_iv,
          });
        } else if (mode === 'wipe') {
          // Lost both password AND recovery key. User accepts data loss.
          const newHash = await auth.hashPassword(b.newPassword);
          Users.updatePassword(payload.user_id, newHash);
          Users.clearCryptoState(payload.user_id);
          Users.wipeUserData(payload.user_id);
        } else {
          return sendError(res, 400, 'invalid_mode', `Unknown reset mode: ${mode}`);
        }

        // Drop all old sessions, mint a new one. Old cookies (if stolen)
        // stop working immediately.
        auth.invalidateUserSessions(payload.user_id);
        const fresh = Users.get(payload.user_id);
        auth.createSession(req, res, fresh);
        const cs = Users.getCryptoState(payload.user_id);
        const encryption =
          cs && cs.kdf_salt
            ? { kdf_salt: cs.kdf_salt, dek_wrapped: cs.dek_wrapped, dek_iv: cs.dek_iv }
            : null;
        return sendJson(res, 200, { success: true, user: publicUser(fresh), encryption });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
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
