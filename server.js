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
const { Users, Partners, Samples, AnalyzeLog, Sessions, BehaviorCorpus, db } = require('./db');
const { createAuth } = require('./auth');
const { signToken, verifyToken, TokenError } = require('./tokens');
const { sendVerifyEmail, sendResetEmail } = require('./email');
const { notifyAdmin, escapeHtml: notifyEscape } = require('./notify');
const httpLib = require('./lib/http');
httpLib.init({ notifyAdmin, notifyEscape });
const { readJson, sendJson, sendError, makeError, MAX_BODY_BYTES } = httpLib;
const { Router } = require('./lib/router');
const {
  validate,
  crosscheck,
  mirror,
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
// MAX_BODY_BYTES + readJson/sendJson/sendError/makeError moved to lib/http.js.
// Re-exported above via destructuring so legacy call sites keep working.
const ANALYZE_WINDOW_MS = 60 * 1000;
const ANALYZE_MAX_PER_WINDOW = 60; // 60 analyse calls/min/IP — generous human use, tight enough vs CPU-bound DoS

// Tiny per-IP analyze limiter using same shape as auth.makeLimiter
// (but kept inline because exporting a single helper across two files
// would be more boilerplate than it saves).
function makeAnalyzeLimiter(maxPerWindow) {
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
    if (list.length >= maxPerWindow) return false;
    list.push(now);
    buckets.set(key, list);
    return true;
  };
}
const analyzeLimiter = makeAnalyzeLimiter(ANALYZE_MAX_PER_WINDOW);
// /api/analyze-behavior is more attractive to fuzzers (anonymous, takes
// arbitrary event arrays). Tighter cap. Real users — even with a
// 1Hz heartbeat from the probe + UI debounce — never exceed ~3/min.
const BEHAVIOR_MAX_PER_WINDOW = 20;
const behaviorLimiter = makeAnalyzeLimiter(BEHAVIOR_MAX_PER_WINDOW);

function getPublicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || 'http://localhost:' + PORT;
}

const auth = createAuth({ Users, Sessions });

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
    `Unhandled rejection\n<pre>${notifyEscape(String((reason instanceof Error && reason.stack) || reason).slice(0, 800))}</pre>`,
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
// Set the `kt-lang` cookie (1 year, SameSite=Lax). Plain cookie — NOT
// HttpOnly so JS can read it for fast first-paint locale decisions.
// Used by the language menu (anon path) and by /api/auth/preferences
// (authed path mirror). Server reads it in resolveLocaleRoute() below
// to redirect bare URLs to the user's preferred locale.
function setLocaleCookie(req, res, locale) {
  const parts = [
    `kt-lang=${encodeURIComponent(locale)}`,
    'Path=/',
    'SameSite=Lax',
    'Max-Age=31536000', // 1 year
  ];
  // Be defensive — req.connection / x-forwarded-proto detection mirrors auth.js
  const proto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
  const isHttps = (req.connection && req.connection.encrypted) || proto === 'https';
  if (isHttps) parts.push('Secure');
  // Append rather than overwrite so other Set-Cookie headers (session
  // cookie set in the same response) aren't clobbered.
  const existing = res.getHeader('Set-Cookie');
  const cookieValue = parts.join('; ');
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', existing.concat([cookieValue]));
  } else if (existing) {
    res.setHeader('Set-Cookie', [existing, cookieValue]);
  } else {
    res.setHeader('Set-Cookie', cookieValue);
  }
}

function readLocaleCookie(req) {
  const cookie = req.headers.cookie || '';
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'kt-lang') {
      const decoded = decodeURIComponent(v || '').trim();
      if (decoded === 'en' || decoded === 'uk' || decoded === 'ru') return decoded;
    }
  }
  return null;
}

function resolveLocaleRoute(reqUrl) {
  const u = reqUrl.replace(/\/$/, '');
  // "/" stays the Playground (the canonical entry — what Google indexed,
  // what the operator's brand pointed at for years). Stream is reachable
  // via "/stream" as a secondary surface. Briefly tried Stream-as-default
  // 2026-05-09 — reverted same day per operator preference.
  if (u === '' || u === '/index.html') {
    return u === '' ? { file: '/index.en.html' } : { redirect: '/' };
  }
  if (u === '/stream') return { file: '/stream.html' };
  if (u === '/stream.html') return { redirect: '/stream' };
  // /playground was a brief alias during the failed pivot — keep the
  // 301 so any stray bookmarks land at /.
  if (u === '/playground' || u === '/playground.html') return { redirect: '/' };
  if (u === '/about') return { file: '/about.en.html' };
  if (u === '/about.html') return { redirect: '/about' };
  if (u === '/account') return { file: '/account.en.html' };
  if (u === '/account.html') return { redirect: '/account' };
  if (u === '/en') return { redirect: '/' };
  if (u === '/en/about') return { redirect: '/about' };
  if (u === '/en/account') return { redirect: '/account' };
  if (u === '/uk') return { file: '/index.uk.html' };
  if (u === '/uk/about') return { file: '/about.uk.html' };
  if (u === '/uk/account') return { file: '/account.uk.html' };
  if (u === '/ru') return { file: '/index.ru.html' };
  if (u === '/ru/about') return { file: '/about.ru.html' };
  if (u === '/ru/account') return { file: '/account.ru.html' };
  return null;
}

// ── Asset cache-bust: content-hash injection ──────────────────────────────
// Replaces manual `?v=N` bumps with `?v=<sha1[0..7]>` of the referenced
// file's contents. Three patterns covered:
//
//   1. `<script src="…">` and `<link href="…">` in HTML.
//   2. ES `import x from '/path.js'` — both inline in HTML <script type=module>
//      and inside .js files.
//   3. Dynamic `import('/path.js')` — same contexts as #2.
//
// The hash is TRANSITIVE: hashing A.js means rewriting A.js (so all its
// imports get current hashes) and then hashing the rewritten content. So
// touching B.js (which A imports) automatically changes A's hash — no
// manual ?v=N bumps anywhere in the codebase. Disk-content hashing is
// reserved for terminal assets (.css, images) where there are no imports
// to chase.
//
// Why bother: Cloudflare aggressively caches static `*.js`/`*.css` and the
// `Cache-Control: no-cache` from the origin doesn't always override CDN
// rules. A content-hash in the URL is the only bulletproof invalidation.

const _hashCache = new Map(); // absPath → { hash, mtimeMs } — for terminal (.css, image) only

const HTML_TAG_RE = /(<(?:script|link)[^>]*?(?:src|href)=")(\/[^"?]+\.(?:js|css))(?:\?v=[^"]+)?"/g;
// Catches `from "/x.js"` and `import("/x.js")` with optional ?v=…
// Backtick template-literal imports are theoretically possible but rare;
// adding them later is one more alternation if it ever matters.
const ES_IMPORT_RE = /(\b(?:from|import\s*\()\s*['"])(\/[^'"?]+\.(?:js|css))(?:\?v=[^'"]+)?(['"])/g;

function rewriteAssetVersions(content, sourceType, visited) {
  let result = content;
  if (sourceType === 'html') {
    result = result.replace(HTML_TAG_RE, (match, prefix, asset) => {
      const filepath = path.join(PUBLIC_DIR, asset);
      const hash = fileHash(filepath, visited);
      if (!hash) return match;
      return `${prefix}${asset}?v=${hash}"`;
    });
  }
  // ES imports — applies to both HTML inline and JS files
  result = result.replace(ES_IMPORT_RE, (match, prefix, asset, suffix) => {
    const filepath = path.join(PUBLIC_DIR, asset);
    const hash = fileHash(filepath, visited);
    if (!hash) return match;
    return `${prefix}${asset}?v=${hash}${suffix}`;
  });
  return result;
}

function fileHash(filepath, visited) {
  try {
    // Cycle protection: if we're already computing this file's hash deeper
    // up the call stack, return a stub. ES modules don't permit cycles in
    // practice, but defending here is cheap.
    const v = visited || new Set();
    if (v.has(filepath)) return 'cycle';
    v.add(filepath);

    const ext = path.extname(filepath).toLowerCase();
    if (ext === '.js' || ext === '.html') {
      // Transitive hash: rewrite first (which recursively hashes imports),
      // then hash the rewritten content. Not mtime-cached because a child
      // mtime change must invalidate this entry; tracking that explicitly
      // is more complex than just recomputing on each request.
      const buf = fs.readFileSync(filepath);
      const rewritten = rewriteAssetVersions(
        buf.toString('utf8'),
        ext === '.html' ? 'html' : 'js',
        v,
      );
      v.delete(filepath);
      return crypto.createHash('sha1').update(rewritten).digest('hex').slice(0, 8);
    }

    // Terminal assets (.css, images, …) — disk-content hash, mtime-cached.
    const st = fs.statSync(filepath);
    const cached = _hashCache.get(filepath);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      v.delete(filepath);
      return cached.hash;
    }
    const buf = fs.readFileSync(filepath);
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
    _hashCache.set(filepath, { hash, mtimeMs: st.mtimeMs });
    v.delete(filepath);
    return hash;
  } catch {
    return null;
  }
}

// Locale-aware "bare URL" set — when the user lands on one of these AND
// has a kt-lang cookie pointing to a non-EN locale, we 302-redirect to
// the localized path. EN is the canonical (no-prefix) locale; UK / RU
// live under /uk/ and /ru/. Out-of-scope URLs (assets, /api/, deep app
// paths) are NEVER redirected — only these "front door" landing pages.
const LOCALE_REDIRECT_TABLE = {
  '/': { uk: '/uk', ru: '/ru' },
  '/about': { uk: '/uk/about', ru: '/ru/about' },
  '/account': { uk: '/uk/account', ru: '/ru/account' },
};

function serveStaticFile(req, res) {
  const reqPath = req.url.split('?')[0];

  // Chrome / Slack / Discord / link-preview bots all request /favicon.ico
  // by default regardless of the <link rel="icon"> tag. A 404 here gets
  // cached aggressively and can override the SVG icon for the browser tab.
  // Serve the SVG bytes under image/svg+xml — browsers sniff the magic and
  // render it correctly, and the negative cache stops poisoning the tab.
  if (reqPath === '/favicon.ico') {
    try {
      const svg = fs.readFileSync(path.join(PUBLIC_DIR, 'favicon.svg'));
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'max-age=86400',
      });
      res.end(svg);
      return;
    } catch {
      /* fall through to normal 404 */
    }
  }

  // Cookie-driven locale redirect for bare landing URLs. Only fires when
  // the cookie says non-EN AND the user is on a known landing path. Has
  // to happen BEFORE resolveLocaleRoute resolves '/' → /index.en.html.
  const norm = reqPath.replace(/\/$/, '') || '/';
  const cookieLocale = readLocaleCookie(req);
  if (cookieLocale && LOCALE_REDIRECT_TABLE[norm] && LOCALE_REDIRECT_TABLE[norm][cookieLocale]) {
    res.writeHead(302, {
      Location: LOCALE_REDIRECT_TABLE[norm][cookieLocale],
      'Cache-Control': 'no-cache',
      Vary: 'Cookie',
    });
    res.end();
    return;
  }

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
      body = Buffer.from(rewriteAssetVersions(content.toString('utf8'), 'html'), 'utf8');
    } else if (ct === 'application/javascript') {
      // .js files also get rewritten so their `import …` statements pick up
      // current content-hashes for child modules. Critical for ES module
      // graphs: changing modules/foo/index.js must invalidate any parent
      // that imports it, even if the parent's disk bytes haven't changed.
      body = Buffer.from(rewriteAssetVersions(content.toString('utf8'), 'js'), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
// Moved to lib/http.js (and re-required above). Kept this comment as a
// pointer for archaeology: pre-2026-05-10 these lived inline here.

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    email_verified_at: u.email_verified_at != null ? u.email_verified_at : null,
    // Locale preference for cross-device language stickiness. NULL means
    // the user hasn't picked one yet — client falls back to localStorage
    // / URL / 'en' default.
    preferred_locale: u.preferred_locale || null,
  };
}

// Public projection of the per-user crypto state. The wrapped-DEK + IV
// + salt is what the client needs to derive a KEK from the password and
// unwrap the DEK on login. Returns null when the user hasn't completed
// `setup-encryption` yet — clients use that to render the bootstrap UI.
function publicEncryption(cs) {
  if (!cs || !cs.kdf_salt) return null;
  return {
    kdf_salt: cs.kdf_salt,
    dek_wrapped: cs.dek_wrapped,
    dek_iv: cs.dek_iv,
    // Recovery setup status (boolean only — never expose the wrapped DEK
    // bytes themselves; those aren't needed in the browser unless user
    // is mid-reset). Lets the personal cabinet show "recovery key set
    // up: yes / no" without an extra endpoint.
    recovery_configured: !!(cs.recovery_dek_wrapped && cs.recovery_salt),
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
          // dev-mode short-circuit returns { dev: true, link } and doesn't actually deliver
          emailSent = !result || !('dev' in result) || !result.dev;
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

  // Per-user preferences. Currently just `locale` — the language the user
  // wants the site rendered in. Stored on the user row (cross-device) +
  // mirrored as `kt-lang` cookie (cross-tab + anon). Picking a locale via
  // the lang menu calls this when the user is logged in; anonymous users
  // get cookie-only.
  //
  // Body: { locale: 'en' | 'uk' | 'ru' }. Returns the saved value.
  if (pathname === '/api/auth/preferences' && method === 'POST') {
    const user = auth.getCurrentUser(req);
    if (!user) return sendError(res, 401, 'unauthorized', 'Sign in first');
    return readJson(req)
      .then((b) => {
        const want = String((b && b.locale) || '').trim();
        if (!['en', 'uk', 'ru'].includes(want)) {
          return sendError(res, 400, 'bad_locale', 'locale must be en | uk | ru');
        }
        Users.setPreferredLocale(user.id, want);
        // Mirror to cookie so the next bare-URL hit gets server-side
        // redirect to the right locale (see resolveLocaleRoute).
        setLocaleCookie(req, res, want);
        return sendJson(res, 200, { success: true, locale: want });
      })
      .catch((e) => sendError(res, 400, 'bad_request', e.message));
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
    // Replay/overwrite protection. The endpoint is meant for the
    // first-time bootstrap right after register; once the user has a
    // crypto state, password-rotation lives behind the reset-password
    // flow (which also handles re-wrapping). A second call to
    // setup-encryption on an already-bootstrapped account is either a
    // bug (client retrying after a partial failure) or a hostile attempt
    // to swap the wrapped DEK. Reject it.
    const existingState = Users.getCryptoState(user.id);
    if (existingState && existingState.kdf_salt) {
      return sendError(
        res,
        409,
        'crypto_already_setup',
        'Encryption is already bootstrapped for this account. Use reset-password to rotate.',
      );
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
    if (!auth.checkVerifyEmailLimit(req)) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Too many verify-email requests. Try again later (limit: 5/hour/IP).',
      );
    }
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
    if (!auth.checkResetStateLimit(req)) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Too many state lookups. Try again shortly (limit: 10/15min/IP).',
      );
    }
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
    .then((body) => {
      const { bidReq, bidRes } = body || {};
      const hasReq = bidReq && typeof bidReq === 'object' && Object.keys(bidReq).length > 0;
      const hasRes = bidRes && typeof bidRes === 'object' && Object.keys(bidRes).length > 0;

      // Optional `opts.disabledRules`: forwarded to validate() / crosscheck()
      // for per-call rule suppression. Accepts string[] of exact ids or
      // trailing-`*` prefixes (e.g. ['imp.*', 'regs.coppa_pii_present']).
      // See packages/core/README.md → "API stability contract".
      const rawDisabled = body && body.opts && body.opts.disabledRules;
      const disabledRules = Array.isArray(rawDisabled)
        ? rawDisabled.filter((r) => typeof r === 'string' && r.length).slice(0, 100)
        : undefined;

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
        validation = validate(bidReq, { locale, dialect, disabledRules });
        if (hasRes) {
          const resValidation = validate(bidRes, { locale, dialect, disabledRules });
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
        validation = validate(bidRes, { locale, dialect, disabledRules });
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

      const cross =
        hasReq && hasRes ? crosscheck(bidReq, bidRes, { locale, dialect, disabledRules }) : [];

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

      // Per-user usage tracking — METADATA only, never the payload bodies.
      // Skipped for anonymous calls (no user_id). The personal cabinet's
      // Insights section reads aggregates back via /api/account/insights.
      try {
        const currentUser = auth.getCurrentUser(req);
        if (currentUser && currentUser.id) {
          const findings = (validation && validation.findings) || [];
          const errs = findings.filter((f) => f.level === 'error').length;
          const warns = findings.filter((f) => f.level === 'warning').length;
          const fmt =
            format && format.formats && format.formats.length
              ? format.formats.length === 1
                ? format.formats[0]
                : 'multi'
              : null;
          AnalyzeLog.record({
            userId: currentUser.id,
            payloadType: hasReq && hasRes ? 'both' : hasReq ? 'request' : 'response',
            version:
              validation && validation.version && validation.version.version
                ? validation.version.version
                : null,
            status: validation && validation.status ? validation.status : 'unknown',
            format: fmt,
            findingCount: findings.length,
            errorCount: errs,
            warningCount: warns,
          });
        }
      } catch (e) {
        // Tracking failure must never break the response. Log + continue.
        console.error('[analyze-log] record failed:', e.message);
      }

      sendJson(res, 200, {
        success: true,
        validation,
        crosscheck: cross,
        meta: { locale, dialect, categories, format },
      });
    })
    .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
}

// ── /api/account/insights ──────────────────────────────────────────────────
// Personal cabinet aggregates. Auth-gated; anonymous → 401. Returns the
// shape AnalyzeLog.insights() produces — see db.js for fields.
function handleAccountInsights(req, res) {
  const user = auth.getCurrentUser(req);
  if (!user) {
    return sendError(res, 401, 'auth_required', 'Sign in to view account insights');
  }
  try {
    const data = AnalyzeLog.insights(user.id);
    sendJson(res, 200, { success: true, insights: data });
  } catch (e) {
    console.error('[account/insights] failed:', e.message);
    sendError(res, 500, 'insights_failed', e.message);
  }
}

// ── /api/behavior/corpus — labelled event-stream archive (Chapter B) ───────
//
// Auth-gated, per-user. POST creates an entry from the events the
// user just observed in the behavior tab. GET lists their entries,
// optionally filtered by label. DELETE removes one. Listing returns
// metadata only; full events_json is fetched via GET /:id when the
// matrix runner replays it (next sprint).

const { computeCorpusMatrix: _computeCorpusMatrix } = require('./lib/corpus-matrix');
const computeCorpusMatrix = (userId) =>
  _computeCorpusMatrix({ BehaviorCorpus, analyzeBehavior }, userId);

const { replay: _replay } = require('./lib/replay');

function handleBehaviorCorpus(req, res, parsed) {
  const user = auth.getCurrentUser(req);
  if (!user) {
    return sendError(res, 401, 'auth_required', 'Sign in to use the behavior corpus');
  }
  const method = req.method;
  const pathname = parsed.pathname;
  const idMatch = pathname.match(/^\/api\/behavior\/corpus\/(\d+)$/);

  if (method === 'GET' && pathname === '/api/behavior/corpus') {
    const label = parsed.searchParams.get('label') || undefined;
    try {
      const entries = BehaviorCorpus.listForUser(user.id, { label });
      const counts = BehaviorCorpus.countsForUser(user.id);
      return sendJson(res, 200, { success: true, entries, counts });
    } catch (e) {
      console.error('[corpus/list] failed:', e.message);
      return sendError(res, 500, 'list_failed', e.message);
    }
  }

  if (method === 'GET' && pathname === '/api/behavior/corpus/matrix') {
    try {
      const matrix = computeCorpusMatrix(user.id);
      return sendJson(res, 200, { success: true, matrix });
    } catch (e) {
      console.error('[corpus/matrix] failed:', e.message);
      return sendError(res, 500, 'matrix_failed', e.message);
    }
  }

  if (method === 'GET' && idMatch) {
    const id = Number(idMatch[1]);
    const row = BehaviorCorpus.getById(id, user.id);
    if (!row) return sendError(res, 404, 'not_found', 'Corpus entry not found');
    return sendJson(res, 200, { success: true, entry: row });
  }

  if (method === 'POST' && pathname === '/api/behavior/corpus') {
    return readJson(req)
      .then((body) => {
        const events = body && body.events;
        const label = body && body.label;
        if (!Array.isArray(events) || !events.length) {
          return sendError(
            res,
            400,
            'events_required',
            'Provide an `events` array (output of behavior probe)',
          );
        }
        if (!BehaviorCorpus.LABELS.includes(label)) {
          return sendError(
            res,
            400,
            'label_invalid',
            'label must be one of: legitimate, fraud, ambiguous',
          );
        }
        try {
          const r = BehaviorCorpus.create({
            userId: user.id,
            label,
            events,
            sourceSampleId: body.sourceSampleId || null,
            notes: body.notes || '',
          });
          sendJson(res, 200, { success: true, id: r.id });
        } catch (e) {
          console.error('[corpus/create] failed:', e.message);
          sendError(res, 400, 'create_failed', e.message);
        }
      })
      .catch((e) => sendError(res, 400, 'invalid_json', e.message));
  }

  if (method === 'DELETE' && idMatch) {
    const id = Number(idMatch[1]);
    const ok = BehaviorCorpus.destroy(id, user.id);
    if (!ok) return sendError(res, 404, 'not_found', 'Corpus entry not found');
    return sendJson(res, 200, { success: true });
  }

  return sendError(res, 405, 'method_not_allowed', 'Unsupported method/path');
}

// ── /api/v1/replay — bulk pipeline runner (Stream Pivot foundation) ───────
//
// POST { samples: [{bidReq?, bidRes?, behaviorEvents?, adm?, label?}] }
// → { results: [...], summary: {...} }
//
// Single endpoint that runs validate + crosscheck + behavior over an array
// of slim envelopes. Replaces N round-trips to /api/analyze + N to
// /api/analyze-behavior for any external pipeline that wants to bulk-grade
// RTB samples (CI test fixtures, archive replay, partner audits, etc.).
//
// Cap: 100 samples per call (configurable up to 1000 via opts.maxSamples).
// Reuses the analyze rate limiter — bulk calls are heavier than single
// analyze, so we count each replay call as ~ceil(N/10) tokens via the
// rate limiter. Simple approach: just consume one bucket slot, but cap
// max-samples at 100 per call so a malicious caller can't bypass with
// one giant request.

function handleReplay(req, res, parsed) {
  if (!analyzeLimiter(auth.clientIp(req))) {
    return sendError(
      res,
      429,
      'rate_limited',
      `Too many replay calls. Try again shortly (limit: ${ANALYZE_MAX_PER_WINDOW}/min/IP).`,
    );
  }
  const locale = resolveLocale(parsed);
  const dialect = resolveDialect(parsed);
  readJson(req)
    .then((body) => {
      const samples = body && body.samples;
      if (!Array.isArray(samples)) {
        return sendError(res, 400, 'samples_required', 'samples must be an array');
      }
      if (samples.length === 0) {
        return sendError(res, 400, 'samples_empty', 'samples array is empty');
      }
      const opts = body && body.opts ? body.opts : {};
      try {
        const out = _replay(samples, {
          validate,
          crosscheck,
          analyzeBehavior,
          locale,
          dialect,
          topK: opts.topK,
          maxSamples: 100, // hard cap server-side regardless of client request
        });
        sendJson(res, 200, { success: true, ...out });
      } catch (e) {
        console.error('[replay] failed:', e.message);
        sendError(res, 400, 'replay_failed', e.message);
      }
    })
    .catch((e) => sendError(res, 400, 'invalid_json', e.message));
}

// ── /api/v1/mirror ─────────────────────────────────────────────────────────
// Generate a canonical counterpart of a paste:
//   { input: BidRequest }  → { output: BidResponse, ... }
//   { input: BidResponse } → { output: BidRequest,  ... }
// Self-test (validate + crosscheck against the original) is run inside
// core's mirror() and the rolled-up counts are returned.
//
// Reuses the analyze rate limiter — generation is cheaper than full
// validation but happens on the same human-paste cadence, so sharing
// the bucket keeps fuzz-protection coherent.

function handleMirror(req, res, parsed) {
  if (!analyzeLimiter(auth.clientIp(req))) {
    return sendError(
      res,
      429,
      'rate_limited',
      `Too many mirror calls. Try again shortly (limit: ${ANALYZE_MAX_PER_WINDOW}/min/IP).`,
    );
  }
  const locale = resolveLocale(parsed);
  const dialect = resolveDialect(parsed);
  readJson(req)
    .then((body) => {
      const input = body && body.input;
      if (!input || typeof input !== 'object') {
        return sendError(
          res,
          400,
          'empty_payload',
          'Provide an `input` object (BidRequest or BidResponse) in the request body',
        );
      }
      const mode = body && body.mode === 'best-practice' ? 'best-practice' : 'minimal';
      const result = mirror(input, { locale, dialect, mode });
      sendJson(res, 200, { success: true, result });
    })
    .catch((e) => {
      console.error('[mirror] failed:', e.message);
      sendError(res, 400, 'invalid_json', e.message);
    });
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
  if (!behaviorLimiter(auth.clientIp(req))) {
    return sendError(
      res,
      429,
      'rate_limited',
      `Too many behavior-analyze calls. Try again shortly (limit: ${BEHAVIOR_MAX_PER_WINDOW}/min/IP).`,
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

// Phase C-1 — partner inference for the save-modal. Caller is the
// in-app save flow: sends the raw bid_req / bid_res JSON strings and
// expects a short vendor brand name + confidence. Auth-gated because
// only signed-in users save samples; the payload is theirs already.
function handleIntelSuggestPartner(req, res) {
  if (!intelLimiter(auth.clientIp(req))) {
    return sendError(res, 429, 'rate_limited', 'Intel rate limit reached. Try again in a minute.');
  }
  if (!auth.getCurrentUser(req)) {
    return sendError(res, 401, 'unauthorized', 'Sign in first');
  }
  readJson(req)
    .then(async ({ bid_req, bid_res }) => {
      // Strict caps so a noisy payload can't blow up our prompt budget.
      const MAX_BYTES = 250_000;
      let parsedReq = null;
      let parsedRes = null;
      try {
        if (typeof bid_req === 'string' && bid_req.length > 0 && bid_req.length < MAX_BYTES) {
          parsedReq = JSON.parse(bid_req);
        }
      } catch (_e) {
        parsedReq = null;
      }
      try {
        if (typeof bid_res === 'string' && bid_res.length > 0 && bid_res.length < MAX_BYTES) {
          parsedRes = JSON.parse(bid_res);
        }
      } catch (_e) {
        parsedRes = null;
      }
      if (!parsedReq && !parsedRes) {
        return sendError(res, 400, 'invalid_input', 'bid_req and/or bid_res JSON required');
      }
      try {
        const suggestion = await intelLlm.suggestPartner(parsedReq, parsedRes);
        if (!suggestion) {
          // Not an error — just no confident vendor signal in the payload.
          return sendJson(res, 200, { success: true, suggestion: null });
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

// ── /api/intel/simulate-bids — Bid simulator demo ─────────────────────────
//
// Given a parsed BidRequest, fan out 3 strategies (aggressive /
// conservative / quality) to gemma3:4b in parallel. Each strategy gets a
// metadata-only summary (no bid VALUES) and decides bid yes/no, price,
// and a one-sentence rationale. Demonstrates the AI-bridge as more than
// just naming/classification — it's also useful for "what would
// different bidders do?" intuition.
//
// Public — no auth — to match other intel endpoints. Rate-limited to
// 30/min/IP via the shared intelLimiter. Heavy: 3 LLM calls per request.
function handleIntelSimulateBids(req, res) {
  if (!intelLimiter(auth.clientIp(req))) {
    return sendError(res, 429, 'rate_limited', 'Intel rate limit reached. Try again in a minute.');
  }
  readJson(req)
    .then(async ({ bid_req }) => {
      let parsed = null;
      const MAX_BYTES = 250_000;
      try {
        if (typeof bid_req === 'string' && bid_req.length > 0 && bid_req.length < MAX_BYTES) {
          parsed = JSON.parse(bid_req);
        } else if (bid_req && typeof bid_req === 'object') {
          parsed = bid_req;
        }
      } catch (_e) {
        parsed = null;
      }
      if (!parsed) {
        return sendError(res, 400, 'invalid_input', 'bid_req JSON required');
      }
      try {
        const results = await intelLlm.simulateBids(parsed);
        if (!results) {
          return sendError(res, 400, 'invalid_input', 'bid_req must be an object');
        }
        sendJson(res, 200, { success: true, strategies: results });
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
  // GET /api/partners/:id/samples-count — used by the delete-partner
  // confirm dialog to surface "X samples will become unassigned" before
  // the user confirms. Cheap (indexed COUNT). Auth-scoped to the user.
  const mCount = pathname.match(/^\/api\/partners\/(\d+)\/samples-count$/);
  if (mCount && method === 'GET') {
    const count = Partners.countSamples({ id: Number(mCount[1]), userId });
    return sendJson(res, 200, { success: true, count });
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

// ── /api/admin/stats — bearer-token operational stats ──────────────────────
// For internal callers (the n8n morning-brief workflow, future ops scripts).
// Auth = ADMIN_STATS_TOKEN env. Returns aggregate counts + 24h activity.
function handleAdminStats(req, res) {
  const expected = process.env.ADMIN_STATS_TOKEN;
  if (!expected) {
    return sendError(res, 503, 'admin_stats_disabled', 'ADMIN_STATS_TOKEN not configured');
  }
  const auth_h = req.headers['authorization'] || '';
  const provided = auth_h.startsWith('Bearer ') ? auth_h.slice(7) : '';
  if (!provided || provided !== expected) {
    return sendError(res, 401, 'unauthorized', 'Bearer token required');
  }
  try {
    const dayAgoMs = Date.now() - 24 * 3600 * 1000;
    const samples_total = db.prepare('SELECT COUNT(*) AS n FROM samples').get().n;
    const samples_24h = db
      .prepare('SELECT COUNT(*) AS n FROM samples WHERE created_at > ?')
      .get(dayAgoMs).n;
    const partners_total = db.prepare('SELECT COUNT(*) AS n FROM partners').get().n;
    const users_total = Users.count();
    const verified_users = db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE email_verified_at IS NOT NULL')
      .get().n;
    sendJson(res, 200, {
      success: true,
      generated_at: Date.now(),
      uptime_sec: Math.round(process.uptime()),
      sessions: auth.activeSessionCount(),
      counts: {
        users_total,
        verified_users,
        partners_total,
        samples_total,
        samples_24h,
      },
    });
  } catch (e) {
    console.error('[admin/stats]', e.message);
    sendError(res, 500, 'stats_failed', e.message);
  }
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

// ── /api/v1/sample — one synthetic example for the Playground "🎲 приклад" ─
// First-time-visitor onboarding: empty Playground is intimidating, "what do
// I paste here?" is the bounce signal. This endpoint returns a complete
// BidRequest+BidResponse pair pulled from the synthetic corpus so the
// "🎲 приклад" button can pre-fill both editors with real-looking JSON.
// The corpus is BidResponse-only on disk; we synthesize a minimally valid
// matching BidRequest (impid + size + site stub) so crosscheck has something
// to work with.
function handleSample(req, res) {
  try {
    const dir = path.join(__dirname, 'samples');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('synthetic-') && f.endsWith('.json'));
    if (!files.length) return sendError(res, 503, 'no_samples', 'Sample corpus is empty');
    // Optional ?type=<slug> picks a specific specimen (e.g. type=clean-banner,
    // type=frame-bust-form). Slug is matched against the filename minus the
    // 'synthetic-' prefix and '.json' suffix. Anything unmatched falls back
    // to random — keeps the URL forgiving for bookmarks / typos.
    const url = new URL(req.url, 'http://x');
    const wanted = (url.searchParams.get('type') || '').trim();
    let pick = null;
    if (wanted) {
      const match = files.find((f) => f === 'synthetic-' + wanted + '.json');
      if (match) pick = match;
    }
    if (!pick) pick = files[Math.floor(Math.random() * files.length)];
    const sample = JSON.parse(fs.readFileSync(path.join(dir, pick), 'utf8'));
    const note = sample._note;
    const label = pick
      .replace(/^synthetic-/, '')
      .replace(/\.json$/, '')
      .replace(/-/g, ' ');

    // Sample shape autodetect:
    //   - has `seatbid` → it IS a BidResponse; synthesize a matching 2.x
    //     BidRequest from the first bid (today's path, used by every
    //     creative-attack specimen)
    //   - has `openrtb` OR top-level `item[]` OR top-level `imp[]` → it
    //     IS a BidRequest; load it directly into the request editor and
    //     leave the response editor empty (used by 3.0 samples + future
    //     request-only specimens)
    const isPlainObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
    // Three discriminators:
    //   1. legacy 2.x BidResponse — has top-level `seatbid[]`
    //   2. oRTB 3.0 BidResponse — has `openrtb.response{}` envelope
    //   3. BidRequest (2.x or 3.0) — has imp[] / item[] / openrtb.request{}
    //      OR `openrtb` envelope without `response` (broken 3.0 request)
    const is2xResponse = Array.isArray(sample.seatbid);
    const is30Response = isPlainObj(sample.openrtb) && isPlainObj(sample.openrtb.response);
    const isBidResponse = is2xResponse || is30Response;
    const isBidRequest =
      !isBidResponse &&
      (isPlainObj(sample.openrtb) || Array.isArray(sample.item) || Array.isArray(sample.imp));
    const cleanSample = Object.assign({}, sample);
    delete cleanSample._note;

    if (isBidRequest) {
      sendJson(res, 200, {
        success: true,
        label,
        _note: note,
        bid_request: cleanSample,
        bid_response: {},
      });
      return;
    }

    if (is30Response) {
      // 3.0 BidResponse — load into the response editor, leave request
      // editor empty (no synthesized 2.x request would make sense here).
      sendJson(res, 200, {
        success: true,
        label,
        _note: note,
        bid_request: {},
        bid_response: cleanSample,
      });
      return;
    }

    // Default: treat as BidResponse and synthesize a minimal 2.x request.
    const firstBid =
      (sample.seatbid && sample.seatbid[0] && sample.seatbid[0].bid && sample.seatbid[0].bid[0]) ||
      {};
    const request = {
      id: 'demo-' + String(sample.id || 'sample').slice(0, 40),
      imp: [
        {
          id: firstBid.impid || '1',
          banner: {
            w: firstBid.w || 300,
            h: firstBid.h || 250,
          },
          bidfloor: 0.1,
          bidfloorcur: 'USD',
        },
      ],
      site: {
        id: 'demo-site',
        domain: 'example.com',
        page: 'https://example.com/demo',
        cat: ['IAB1'],
      },
      device: {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ip: '203.0.113.42',
        devicetype: 2,
      },
      user: { id: 'demo-user' },
      at: 2,
      tmax: 200,
      cur: ['USD'],
    };
    sendJson(res, 200, {
      success: true,
      label,
      _note: note,
      bid_request: request,
      bid_response: cleanSample,
    });
  } catch (e) {
    sendError(res, 500, 'sample_failed', e.message);
  }
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
    if (pathname === '/api/admin/stats' && req.method === 'GET') return handleAdminStats(req, res);
    if (pathname === '/api/v1/stream' && req.method === 'GET') return handleStream(req, res);
    if (pathname === '/api/v1/sample' && req.method === 'GET') return handleSample(req, res);
    if (pathname === '/api/analyze' && req.method === 'POST')
      return handleAnalyze(req, res, parsed);
    if (pathname === '/api/v1/mirror' && req.method === 'POST')
      return handleMirror(req, res, parsed);
    if (pathname === '/api/v1/replay' && req.method === 'POST')
      return handleReplay(req, res, parsed);
    if (pathname === '/api/analyze-behavior' && req.method === 'POST')
      return handleAnalyzeBehavior(req, res, parsed);
    if (pathname === '/api/account/insights' && req.method === 'GET')
      return handleAccountInsights(req, res);
    if (pathname.startsWith('/api/behavior/corpus')) return handleBehaviorCorpus(req, res, parsed);
    if (pathname === '/api/intel/suggest-name' && req.method === 'POST')
      return handleIntelSuggestName(req, res);
    if (pathname === '/api/intel/suggest-partner' && req.method === 'POST')
      return handleIntelSuggestPartner(req, res);
    if (pathname === '/api/intel/field-purpose' && req.method === 'POST')
      return handleIntelFieldPurpose(req, res);
    if (pathname === '/api/intel/simulate-bids' && req.method === 'POST')
      return handleIntelSimulateBids(req, res);
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
