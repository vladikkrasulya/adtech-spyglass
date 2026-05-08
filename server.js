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
const crypto = require('crypto');
const { Users, Partners, Samples, db } = require('./db');
const { createAuth } = require('./auth');
const { signToken, verifyToken, TokenError } = require('./tokens');
const { sendVerifyEmail, sendResetEmail } = require('./email');
const { notifyAdmin, escapeHtml: notifyEscape } = require('./notify');
const {
  validate,
  crosscheck,
  listLocales,
  listDialects,
  extractAllCategories,
  detectFormat,
} = require('@kyivtech/spyglass-core');
const { analyze: analyzeBehavior } = require('@kyivtech/spyglass-core/behavior');
const knowledgeBase = require('@kyivtech/spyglass-core/knowledge-base');
const SyntheticGenerator = require('./samples/synthetic-generator');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_LOCALE = 'uk';
const DEFAULT_DIALECT = 'iab';

// Phase 8 token durations
const VERIFY_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
const RESET_TOKEN_TTL = 15 * 60; // 15 min

// Limits and rates. Centralised so tuning doesn't require grepping the file.
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB — covers the largest realistic oRTB payload by ~10x
const ANALYZE_WINDOW_MS = 60 * 1000;
const ANALYZE_MAX_PER_WINDOW = 60; // 60 analyse calls/min/IP — generous human use, tight enough vs CPU-bound DoS

// Tiny per-IP analyze limiter using same shape as auth.makeLimiter
// (but kept inline because exporting a single helper across two files
// would be more boilerplate than it saves).
function makeAnalyzeLimiter() {
  const buckets = new Map();
  setInterval(() => {
    const cutoff = Date.now() - ANALYZE_WINDOW_MS;
    for (const [k, list] of buckets) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }, ANALYZE_WINDOW_MS).unref();
  return (key) => {
    const now = Date.now();
    const cutoff = now - ANALYZE_WINDOW_MS;
    const list = (buckets.get(key) || []).filter((t) => t > cutoff);
    if (list.length >= ANALYZE_MAX_PER_WINDOW) return false;
    list.push(now);
    buckets.set(key, list);
    return true;
  };
}
const analyzeLimiter = makeAnalyzeLimiter();

function getPublicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || 'http://localhost:' + PORT;
}

const auth = createAuth({ Users });

// ── Process-level safety net ────────────────────────────────────────────────
// Throttled per-tag so a tight crash loop doesn't burn through Telegram's
// 30-msg/sec limit; the alert will fire once, then logs cover the rest.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  notifyAdmin(
    `Uncaught exception\n<pre>${notifyEscape(String((err && err.stack) || err).slice(0, 800))}</pre>`,
    { tag: 'uncaught-exception', level: 'error' },
  );
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  notifyAdmin(
    `Unhandled rejection\n<pre>${notifyEscape(String((reason && reason.stack) || reason).slice(0, 800))}</pre>`,
    { tag: 'unhandled-rejection', level: 'error' },
  );
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

// Locale routing for the static UI. English (the global default) lives at
// the root — "/" serves index.en.html directly, "/about" serves about.en.html.
// Ukrainian gets a /uk/ subpath. This way the canonical English URL is the
// shortest one, which matches what Google indexes as the primary entry.
//
// /en/ and /en/about are kept as 301-redirects to canonicalize any URL that
// briefly leaked while the prefix-style was deployed (a few hours window).
// /index.html and /about.html are legacy paths from the pre-i18n single-file
// layout — same 301 treatment.
function resolveLocaleRoute(reqUrl) {
  const u = reqUrl.replace(/\/$/, '');
  if (u === '' || u === '/index.html') {
    return u === '' ? { file: '/index.en.html' } : { redirect: '/' };
  }
  if (u === '/about') return { file: '/about.en.html' };
  if (u === '/about.html') return { redirect: '/about' };
  if (u === '/en') return { redirect: '/' };
  if (u === '/en/about') return { redirect: '/about' };
  if (u === '/uk') return { file: '/index.uk.html' };
  if (u === '/uk/about') return { file: '/about.uk.html' };
  if (u === '/ru') return { file: '/index.ru.html' };
  if (u === '/ru/about') return { file: '/about.ru.html' };
  return null;
}

// ── Asset cache-bust: content-hash injection ──────────────────────────────
// Replaces manual `?v=N` bumps in HTML with `?v=<sha1[0..7]>` of the
// referenced file's contents. Hash is mtime-cached so each HTML render is
// near-zero cost; the cache invalidates when a file is touched.
//
// Why bother: Cloudflare aggressively caches static `*.js`/`*.css` and our
// `Cache-Control: no-cache` from the origin doesn't always override CDN
// rules. A content-hash in the URL is the only bulletproof invalidation.
const _hashCache = new Map(); // absPath → { hash, mtimeMs }

function fileHash(filepath) {
  try {
    const st = fs.statSync(filepath);
    const cached = _hashCache.get(filepath);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.hash;
    const buf = fs.readFileSync(filepath);
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
    _hashCache.set(filepath, { hash, mtimeMs: st.mtimeMs });
    return hash;
  } catch {
    return null;
  }
}

function rewriteAssetVersions(html) {
  // Match `<script src="/foo.js">` and `<link href="/bar.css">` (with or
  // without an existing `?v=…`). Skips external URLs (`https://…`) because
  // the regex requires the path to start with `/`.
  const re = /(<(?:script|link)[^>]*?(?:src|href)=")(\/[^"?]+\.(?:js|css))(?:\?v=[^"]+)?"/g;
  return html.replace(re, (match, prefix, asset) => {
    const filepath = path.join(PUBLIC_DIR, asset);
    const hash = fileHash(filepath);
    if (!hash) return match; // file missing — leave the original tag alone
    return `${prefix}${asset}?v=${hash}"`;
  });
}

function serveStaticFile(req, res) {
  const reqPath = req.url.split('?')[0];

  const route = resolveLocaleRoute(reqPath);
  if (route && route.redirect) {
    res.writeHead(302, { Location: route.redirect, 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }

  const rawUrl = (route && route.file) || reqPath;
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
    let body = content;
    if (ct === 'text/html') {
      body = Buffer.from(rewriteAssetVersions(content.toString('utf8')), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY_BYTES) {
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

// Public projection of the per-user crypto state. The wrapped-DEK + IV
// + salt is what the client needs to derive a KEK from the password and
// unwrap the DEK on login. Returns null when the user hasn't completed
// `setup-encryption` yet — clients use that to render the bootstrap UI.
function publicEncryption(cs) {
  if (!cs || !cs.kdf_salt) return null;
  return { kdf_salt: cs.kdf_salt, dek_wrapped: cs.dek_wrapped, dek_iv: cs.dek_iv };
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
    const encryption = publicEncryption(Users.getCryptoState(user.id));
    return sendJson(res, 200, { success: true, user: publicUser(user), encryption });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    return readJson(req)
      .then(async ({ email, password }) => {
        const user = await auth.register({ email, password }, req);
        auth.createSession(req, res, user);
        // Send verify email synchronously so we can surface failure to the
        // client. Registration itself stays successful regardless — the user
        // can retry via /api/auth/verify-email/request from the banner.
        let emailSent = false;
        let emailError = null;
        try {
          const tok = signToken({
            purpose: 'verify',
            user_id: user.id,
            email: user.email,
            expirySeconds: VERIFY_TOKEN_TTL,
          });
          const result = await sendVerifyEmail({ email: user.email }, tok, getPublicBaseUrl());
          emailSent = !result || !result.dev; // dev-mode short-circuit doesn't actually deliver
        } catch (err) {
          emailError = err.message;
          console.error('[register] verify email send failed:', err.message);
          notifyAdmin(
            `Verify email send failed for new user <code>${notifyEscape(user.email)}</code>\n<pre>${notifyEscape(err.message.slice(0, 500))}</pre>`,
            { tag: 'email-send-fail', level: 'error' },
          );
        }
        sendJson(res, 200, {
          success: true,
          user: publicUser(user),
          email_sent: emailSent,
          email_error: emailError,
        });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    return readJson(req)
      .then(async ({ email, password }) => {
        const user = await auth.login({ email, password }, req);
        auth.createSession(req, res, user);
        const encryption = publicEncryption(Users.getCryptoState(user.id));
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

  // Re-send verify email for the currently logged-in user. Awaits the send
  // so the UI can show "couldn't send" rather than a fake success toast.
  if (pathname === '/api/auth/verify-email/request' && method === 'POST') {
    const user = auth.getCurrentUser(req);
    if (!user) return sendError(res, 401, 'unauthorized', 'Sign in first');
    let tok;
    try {
      tok = signToken({
        purpose: 'verify',
        user_id: user.id,
        email: user.email,
        expirySeconds: VERIFY_TOKEN_TTL,
      });
    } catch (err) {
      return sendError(res, 500, 'verify_email_failed', err.message);
    }
    // Return 200 with `email_sent: false` rather than 5xx — Cloudflare's
    // edge intercepts 5xx and serves its own branded HTML error page,
    // which makes the JSON unreachable from the browser.
    return sendVerifyEmail({ email: user.email }, tok, getPublicBaseUrl()).then(
      () => sendJson(res, 200, { success: true, email_sent: true }),
      (sendErr) => {
        console.error('[verify-email/request] send failed:', sendErr.message);
        notifyAdmin(
          `Verify-email resend failed for <code>${notifyEscape(user.email)}</code>\n<pre>${notifyEscape(sendErr.message.slice(0, 500))}</pre>`,
          { tag: 'email-send-fail', level: 'error' },
        );
        sendJson(res, 200, {
          success: true,
          email_sent: false,
          email_error: 'Email provider error — try again in a few minutes.',
        });
      },
    );
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
              sendResetEmail({ email: u.email }, tok, getPublicBaseUrl()).catch((err) => {
                console.error('[forgot-password] send failed:', err.message);
                notifyAdmin(
                  `Reset-password email failed for <code>${notifyEscape(u.email)}</code>\n<pre>${notifyEscape(err.message.slice(0, 500))}</pre>`,
                  { tag: 'email-send-fail', level: 'error' },
                );
              });
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
    // Phase 9b/freeze (audit P0.1): per-IP cap to keep bcrypt.compare in
    // mode='rotate' from being a brute-force endpoint for the user's old
    // password. Reset tokens are short-lived but reusable until expiry,
    // so a held token + spamming /reset-password could try thousands of
    // old-password guesses without this limiter.
    if (!auth.checkResetPasswordLimit(req)) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Too many reset attempts. Try again in 15 minutes.',
      );
    }
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
        const encryption = publicEncryption(Users.getCryptoState(payload.user_id));
        return sendJson(res, 200, { success: true, user: publicUser(fresh), encryption });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  return false;
}

// ── /api/proxy (allow-listed test harness, session-gated) ──────────────────
//
// Used only by the developer for ad-hoc forward-to-test-harness experiments;
// no frontend code calls it. We gate on session because an unauth proxy that
// echoes attacker-controlled JSON to public request bins is an abuse amplifier
// (attacker burns *our* IP+TLS to hit their webhook). webhook.site was the
// worst offender — wildcard subdomain → any attacker-controlled bin — so it's
// off the allow-list.

const PROXY_ALLOWED_HOSTS = ['httpbin.org', 'postman-echo.com'];

function handleProxy(req, res) {
  const user = auth.getCurrentUser(req);
  if (!user) {
    return sendError(res, 401, 'unauthorized', 'Sign in to use the proxy harness');
  }
  readJson(req)
    .then(({ url, data }) => {
      const targetUrl = new URL(url);
      const hostname = targetUrl.hostname;
      const isAllowed = PROXY_ALLOWED_HOSTS.some(
        (h) => hostname === h || hostname.endsWith('.' + h),
      );
      if (!isAllowed) {
        return sendError(
          res,
          403,
          'host_not_allowed',
          'Host not allowed. Proxy is restricted to public test endpoints only.',
          { allowedHosts: PROXY_ALLOWED_HOSTS },
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

// Merge two detectFormat() results (request side + response side) into
// a single, de-duplicated tag set. Returns the canonical empty shape if
// both inputs are null — never null, so the frontend can render
// unconditionally.
function unionFormat(a, b) {
  const formats = new Set();
  const contexts = new Set();
  const protocols = new Set();
  for (const r of [a, b]) {
    if (!r) continue;
    for (const f of r.formats || []) formats.add(f);
    for (const c of r.contexts || []) contexts.add(c);
    for (const p of r.protocols || []) protocols.add(p);
  }
  const fmts = Array.from(formats);
  const ctxs = Array.from(contexts);
  const prots = Array.from(protocols);
  return {
    formats: fmts,
    contexts: ctxs,
    protocols: prots,
    tags: [...fmts, ...ctxs, ...prots],
    confidence: fmts.length + ctxs.length + prots.length > 0 ? 1 : 0,
  };
}

// ── /api/analyze ────────────────────────────────────────────────────────────

function handleAnalyze(req, res, parsed) {
  if (!analyzeLimiter(auth.clientIp(req))) {
    return sendError(
      res,
      429,
      'rate_limited',
      `Too many analyze calls. Try again shortly (limit: ${ANALYZE_MAX_PER_WINDOW}/min/IP).`,
    );
  }
  const locale = resolveLocale(parsed);
  const dialect = resolveDialect(parsed);
  readJson(req)
    .then(({ bidReq, bidRes }) => {
      const hasReq = bidReq && typeof bidReq === 'object' && Object.keys(bidReq).length > 0;
      const hasRes = bidRes && typeof bidRes === 'object' && Object.keys(bidRes).length > 0;

      // Empty payload is now an explicit 400 instead of a synthetic
      // "unknown_type" finding masquerading as a real validation error.
      if (!hasReq && !hasRes) {
        return sendError(
          res,
          400,
          'empty_payload',
          'Provide bidReq or bidRes (or both) in the request body',
        );
      }

      // Branch on what was actually sent — running validate({}) when only
      // bidRes is present produced a misleading payload.unknown_type error
      // that masked perfectly valid response findings.
      let validation;
      if (hasReq) {
        validation = validate(bidReq, { locale, dialect });
        if (hasRes) {
          const resValidation = validate(bidRes, { locale, dialect });
          if (resValidation.findings && resValidation.findings.length) {
            validation.findings = validation.findings.concat(
              resValidation.findings.map((f) =>
                Object.assign({}, f, { msg: '[response] ' + f.msg }),
              ),
            );
          }
        }
      } else {
        // Response-only path. Validate bidRes and prefix findings for clarity.
        validation = validate(bidRes, { locale, dialect });
        validation.findings = validation.findings.map((f) =>
          Object.assign({}, f, { msg: '[response] ' + f.msg }),
        );
      }

      // Recompute status from the union — `errors` if any finding is error,
      // else `warnings` if any warning, else `clean`. (Mirrors the core
      // rollupStatus helper without importing it; keep in sync.)
      const levels = new Set((validation.findings || []).map((f) => f.level));
      validation.status = levels.has('error')
        ? 'errors'
        : levels.has('warning')
          ? 'warnings'
          : 'clean';

      const cross = hasReq && hasRes ? crosscheck(bidReq, bidRes, { locale }) : [];

      // Decode IAB Content Taxonomy codes (cat / bcat / pcat / sectioncat
      // / pagecat / bid.cat) into English labels so the frontend can render
      // human text alongside `IAB9-11` etc. without bundling its own dict.
      const categories = {};
      if (hasReq) Object.assign(categories, extractAllCategories(bidReq));
      if (hasRes) Object.assign(categories, extractAllCategories(bidRes));

      // Phase 10b — third detection axis (banner/video/audio/native/push/…
      // + web/inapp/ctv/dooh + vast-N/daast). Compute on whichever payloads
      // were sent and union the results; the request side carries
      // imp[].banner|video|audio|native + context, the response side
      // carries mtype + adm sniffing. A null/empty `format` is a valid
      // outcome — the frontend gates rendering on `confidence`.
      const formatReq = hasReq ? detectFormat(bidReq) : null;
      const formatRes = hasRes ? detectFormat(bidRes) : null;
      const format = unionFormat(formatReq, formatRes);

      sendJson(res, 200, {
        success: true,
        validation,
        crosscheck: cross,
        meta: { locale, dialect, categories, format },
      });
    })
    .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
}

// ── /api/analyze-behavior ──────────────────────────────────────────────────
// Runs the behavior engine over an array of probe events captured by the
// in-iframe creative-probe.js. Stateless, mirrors /api/analyze envelope:
// findings are decorated (msg + specRef) by the engine itself, so server
// just pipes them through.
//
// Why server-side at all: keeps a single analysis source of truth across
// browser preview AND future Stream-pivot specimen-archive replay (Node).
// Client posts events on every Behavior-tab render; debouncing happens
// in the UI module.

function handleAnalyzeBehavior(req, res, parsed) {
  if (!analyzeLimiter(auth.clientIp(req))) {
    return sendError(
      res,
      429,
      'rate_limited',
      `Too many analyze calls. Try again shortly (limit: ${ANALYZE_MAX_PER_WINDOW}/min/IP).`,
    );
  }
  const locale = resolveLocale(parsed);
  readJson(req)
    .then(({ events, adm }) => {
      if (!Array.isArray(events)) {
        return sendError(res, 400, 'invalid_input', 'events array is required');
      }
      // Phase 6: optional `adm` field carries the raw creative string for
      // static-payload analysis (obfuscation/miner/XSS pattern matching +
      // entropy). Engine treats it as opt-in; callers that omit it get
      // the pre-Phase-6 runtime-only pipeline.
      const r = analyzeBehavior(events, {
        locale,
        adm: typeof adm === 'string' ? adm : '',
      });
      sendJson(res, 200, {
        success: true,
        findings: r.findings,
        status: r.status,
        eventCount: r.eventCount,
        meta: { locale },
      });
    })
    .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
}

// ── /api/intel/* — Phase 7c LLM intelligence ───────────────────────────────
// Two narrow endpoints (cluster naming + per-field purpose hint) that bridge
// to a locally-hosted Ollama instance via http://ollama:11434. Both are
// fire-on-user-gesture only — no automatic discovery — so the rate limit is
// modest (30/min/IP) and there's no caching server-side; the browser caches
// in IndexedDB for 30 days.
//
// Both endpoints fail open: when Ollama is unreachable the frontend silently
// hides the AI affordances (per Phase 7 R&D doc graceful-degradation rule).
// We log unavailability at warn-level so an admin can see the pattern but
// don't surface user-facing errors.

const intelLlm = require('./intel-llm');
const INTEL_MAX_PER_WINDOW = Number(process.env.INTEL_MAX_PER_WINDOW) || 30;
const INTEL_WINDOW_MS = 60_000;

function makeIntelLimiter() {
  const buckets = new Map();
  setInterval(() => {
    const cutoff = Date.now() - INTEL_WINDOW_MS;
    for (const [k, list] of buckets) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }, INTEL_WINDOW_MS).unref();
  return (key) => {
    const now = Date.now();
    const cutoff = now - INTEL_WINDOW_MS;
    const list = (buckets.get(key) || []).filter((t) => t > cutoff);
    if (list.length >= INTEL_MAX_PER_WINDOW) return false;
    list.push(now);
    buckets.set(key, list);
    return true;
  };
}
const intelLimiter = makeIntelLimiter();

function handleIntelSuggestName(req, res) {
  if (!intelLimiter(auth.clientIp(req))) {
    return sendError(res, 429, 'rate_limited', 'Intel rate limit reached. Try again in a minute.');
  }
  readJson(req)
    .then(async ({ bucket, fields, format }) => {
      if (!Array.isArray(fields) || fields.length === 0) {
        return sendError(res, 400, 'invalid_input', 'fields[] is required');
      }
      // Sanitise: paths must be strings, cap count to bound prompt size.
      const cleanFields = fields
        .filter((f) => typeof f === 'string' && f.length > 0 && f.length < 200)
        .slice(0, 50);
      if (cleanFields.length === 0) {
        return sendError(res, 400, 'invalid_input', 'no usable fields');
      }
      // Phase 10b — few-shot context: when the caller passes a recognised
      // format ("banner" / "video" / "push" / …) we look up 1–2 shipped KB
      // samples for that format and pass their anonymized field-name lists
      // to the LLM. When the format is unknown / missing / yields no KB
      // hits, fewShot is an empty array and the call degrades to Phase 7c
      // zero-shot behaviour silently.
      const cleanFormat = typeof format === 'string' ? format.replace(/[^a-z0-9-]/gi, '') : '';
      let fewShot = [];
      if (cleanFormat) {
        try {
          fewShot = knowledgeBase.fewShotForFormat(cleanFormat, { limit: 2 });
        } catch (e) {
          fewShot = [];
        }
      }
      try {
        const suggestion = await intelLlm.suggestName(bucket, cleanFields, { fewShot });
        if (!suggestion) {
          return sendError(res, 502, 'unparseable', 'LLM returned an unusable suggestion');
        }
        sendJson(res, 200, { success: true, suggestion });
      } catch (e) {
        if (e instanceof intelLlm.OllamaUnavailable) {
          console.warn('[intel] Ollama unavailable:', e.message);
          return sendError(res, 503, 'ollama_unavailable', e.message);
        }
        throw e;
      }
    })
    .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
}

function handleIntelFieldPurpose(req, res) {
  if (!intelLimiter(auth.clientIp(req))) {
    return sendError(res, 429, 'rate_limited', 'Intel rate limit reached. Try again in a minute.');
  }
  readJson(req)
    .then(async ({ path, charClass, bucket }) => {
      if (typeof path !== 'string' || path.length === 0 || path.length > 200) {
        return sendError(res, 400, 'invalid_input', 'path is required (≤200 chars)');
      }
      try {
        const purpose = await intelLlm.fieldPurpose(path, charClass, bucket);
        if (!purpose) {
          return sendError(res, 502, 'unparseable', 'LLM returned an unusable suggestion');
        }
        sendJson(res, 200, { success: true, purpose });
      } catch (e) {
        if (e instanceof intelLlm.OllamaUnavailable) {
          console.warn('[intel] Ollama unavailable:', e.message);
          return sendError(res, 503, 'ollama_unavailable', e.message);
        }
        throw e;
      }
    })
    .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
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

function handleHealth(req, res) {
  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const status = dbOk ? 200 : 503;
  // Anonymous callers (Docker healthcheck, Uptime Kuma, random probes) get
  // only liveness — no pid/node-version/user-count fingerprinting. Authed
  // sessions get the full operational view.
  const body = {
    success: dbOk,
    status: dbOk ? 'ok' : 'degraded',
    checks: { db: dbOk },
  };
  if (auth.getCurrentUser(req)) {
    body.sessions = auth.activeSessionCount();
    body.users = Users.count();
    body.uptime = Math.round(process.uptime());
    body.pid = process.pid;
    body.node = process.version;
  }
  sendJson(res, status, body);
}

// ── /api/v1/stream — public RTB observability feed (Phase 1 Step 1.2) ──────
//
// Synthetic-only for now; real-traffic ingest is gated on Risk B in
// docs/stream-platform-pivot-2026-05-05.md (Kadam legal/management approval).
// Pipeline: SyntheticGenerator → in-process ring buffer → SSE subscribers.
//
// Buffer is FIFO Array (Array.shift() at small N is fine). Replay window
// gives a fresh subscriber recent context immediately; live subscription
// covers everything after. Heartbeat keeps Cloudflare/proxies from killing
// idle SSE connections.

const STREAM_BUFFER_MAX = 100;
const STREAM_REPLAY_MAX = 50;
const STREAM_RATE_MS = Number(process.env.SYNTHETIC_RATE_MS) || 1000;
const STREAM_HEARTBEAT_MS = 15_000;

const streamBuffer = [];
function streamBufferPush(envelope) {
  streamBuffer.push(envelope);
  if (streamBuffer.length > STREAM_BUFFER_MAX) streamBuffer.shift();
}

const streamGenerator = new SyntheticGenerator({
  corpusDir: path.join(__dirname, 'samples'),
  intervalMs: STREAM_RATE_MS,
});
streamGenerator.loadCorpus();
// Each SSE subscriber attaches its own listener; default cap of 10 would
// limit concurrent viewers. 0 = unlimited (in-process pub/sub is the whole
// point). Per-IP cap will land separately as a connection limiter.
streamGenerator.setMaxListeners(0);
streamGenerator.on('specimen', streamBufferPush);
streamGenerator.on('error', (err) => console.error('[stream]', err));
streamGenerator.start();
console.log(
  '[stream] generator running: ' +
    STREAM_RATE_MS +
    'ms cadence, ' +
    streamGenerator.corpus.length +
    ' samples, buffer=' +
    STREAM_BUFFER_MAX,
);

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    // Nginx/CF buffering would batch SSE frames and break realtime. Disable.
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n'); // initial comment flushes headers, opens stream

  // Replay last N for context. Snapshot via slice — avoids race if buffer
  // mutates mid-iteration.
  const replay = streamBuffer.slice(-STREAM_REPLAY_MAX);
  for (const envelope of replay) {
    res.write('data: ' + JSON.stringify(envelope) + '\n\n');
  }

  const onSpecimen = (envelope) => {
    res.write('data: ' + JSON.stringify(envelope) + '\n\n');
  };
  streamGenerator.on('specimen', onSpecimen);

  const heartbeat = setInterval(() => res.write(': hb\n\n'), STREAM_HEARTBEAT_MS);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    streamGenerator.off('specimen', onSpecimen);
    clearInterval(heartbeat);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

// ── HTTP dispatch ────────────────────────────────────────────────────────────

// Baseline hardening headers applied to every response. The portal proxy
// in front of this app also sets some of these, but defense-in-depth means
// keeping them at the origin too — direct access (debug ports, dev) never
// loses the floor. CSP intentionally omitted: the frontend is full of
// inline event handlers + innerHTML usage that would break under any non-
// trivial CSP. Re-enable once those are migrated to delegated listeners.
function applyBaselineHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  // Spyglass landing/docs are public — no global X-Robots-Tag. Admin/auth
  // surfaces aren't crawler-relevant (no GET-renders to index), so a global
  // noindex would just hurt the public demo's discoverability.
}

const server = http.createServer((req, res) => {
  applyBaselineHeaders(res);

  let parsed;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch {
    return sendError(res, 400, 'bad_url', 'Invalid request URL');
  }
  const { pathname } = parsed;

  try {
    if (pathname === '/api/health' && req.method === 'GET') return handleHealth(req, res);
    if (pathname === '/api/v1/stream' && req.method === 'GET') return handleStream(req, res);
    if (pathname === '/api/analyze' && req.method === 'POST')
      return handleAnalyze(req, res, parsed);
    if (pathname === '/api/analyze-behavior' && req.method === 'POST')
      return handleAnalyzeBehavior(req, res, parsed);
    if (pathname === '/api/intel/suggest-name' && req.method === 'POST')
      return handleIntelSuggestName(req, res);
    if (pathname === '/api/intel/field-purpose' && req.method === 'POST')
      return handleIntelFieldPurpose(req, res);
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
    notifyAdmin(
      `<b>500 on</b> <code>${notifyEscape(req.method + ' ' + req.url)}</code>\n<pre>${notifyEscape(String((err && err.stack) || err).slice(0, 800))}</pre>`,
      { tag: 'handler-500', level: 'error' },
    );
    return sendError(res, 500, 'internal_error', 'Internal server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Spyglass backend listening at http://0.0.0.0:' + PORT);
});

const shutdown = (signal) => {
  console.log('[' + signal + '] shutting down');
  streamGenerator.stop();
  auth.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
