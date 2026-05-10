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
const { createHealthModule } = require('./modules/health/handler');
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

// Intel (LLM-bridge) limiter — slower service, smaller per-IP allowance.
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
const intelLlm = require('./intel-llm');

function getPublicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || 'http://localhost:' + PORT;
}

const auth = createAuth({ Users, Sessions });

// ── Backend module router ───────────────────────────────────────────────────
// First-module migration: GET /api/health moved to modules/health/handler.js.
// Subsequent migrations register here; the dispatcher in createServer checks
// the Router first and falls through to the inline if-chain on miss.
const router = new Router();
router.register(createHealthModule({ db, auth, Users, sendJson }));

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

// ── Backend module registrations ────────────────────────────────────────────
// Wired after analyzeLimiter / auth / resolveLocale / resolveDialect /
// validate-crosscheck-mirror engine are all in scope. router itself was
// instantiated earlier (next to health registration); we just push more
// routes into it here.
const { createMirrorModule } = require('./modules/mirror/handler');
const { createReplayModule } = require('./modules/replay/handler');
const sampleModule = require('./modules/sample/handler');
const { createAnalyzeModule } = require('./modules/analyze/handler');
const { createIntelModule } = require('./modules/intel/handler');
const { createCorpusModule } = require('./modules/corpus/handler');
const { createAccountModule } = require('./modules/account/handler');
const { createAdminModule } = require('./modules/admin/handler');
const { createProxyModule } = require('./modules/proxy/handler');
// intelLlm + knowledgeBase already required at the top of the file
const { computeCorpusMatrix: _computeCorpusMatrix } = require('./lib/corpus-matrix');

router.register(
  createMirrorModule({
    analyzeLimiter,
    auth,
    ANALYZE_MAX_PER_WINDOW,
    resolveLocale,
    resolveDialect,
    mirror,
  }),
);
router.register(
  createReplayModule({
    analyzeLimiter,
    auth,
    ANALYZE_MAX_PER_WINDOW,
    resolveLocale,
    resolveDialect,
    validate,
    crosscheck,
    analyzeBehavior,
    replay: require('./lib/replay').replay,
  }),
);
router.register(sampleModule);
router.register(
  createAnalyzeModule({
    analyzeLimiter,
    behaviorLimiter,
    auth,
    ANALYZE_MAX_PER_WINDOW,
    BEHAVIOR_MAX_PER_WINDOW,
    resolveLocale,
    resolveDialect,
    validate,
    crosscheck,
    analyzeBehavior,
    extractAllCategories,
    detectFormat,
    unionFormat,
    AnalyzeLog,
  }),
);
router.register(
  createIntelModule({
    intelLimiter,
    auth,
    intelLlm,
    knowledgeBase,
  }),
);
router.register(
  createCorpusModule({
    auth,
    BehaviorCorpus,
    computeCorpusMatrix: (userId) =>
      _computeCorpusMatrix({ BehaviorCorpus, analyzeBehavior }, userId),
  }),
);
router.register(createAccountModule({ auth, AnalyzeLog }));
router.register(createAdminModule({ db, Users, auth }));
router.register(createProxyModule({ auth }));

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

// ── /api/account/insights ──────────────────────────────────────────────────
// Personal cabinet aggregates. Auth-gated; anonymous → 401. Returns the
// shape AnalyzeLog.insights() produces — see db.js for fields.

// ── /api/behavior/corpus — labelled event-stream archive (Chapter B) ───────
//
// Auth-gated, per-user. POST creates an entry from the events the
// user just observed in the behavior tab. GET lists their entries,
// optionally filtered by label. DELETE removes one. Listing returns
// metadata only; full events_json is fetched via GET /:id when the
// matrix runner replays it (next sprint).

// computeCorpusMatrix lookup + replay engine moved to module registrations
// above (modules/corpus/handler.js + modules/replay/handler.js).

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

// intel limiter + intelLlm moved up before module registrations.

// Phase C-1 — partner inference for the save-modal. Caller is the
// in-app save flow: sends the raw bid_req / bid_res JSON strings and
// expects a short vendor brand name + confidence. Auth-gated because
// only signed-in users save samples; the payload is theirs already.

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

// ── /api/health ─────────────────────────────────────────────────────────────
// Moved to modules/health/handler.js — registered with `router` near the top
// of this file. Dispatcher calls router.dispatch() before the inline if-chain.

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
    // Backend module router first; falls through on miss to the inline
    // if-chain below as modules migrate over.
    const hit = router.match(req.method, pathname);
    if (hit) {
      const out = hit.handler(req, res, parsed, hit.match);
      if (out && typeof out.then === 'function') {
        out.catch((err) => {
          console.error('[router handler]', err && err.stack ? err.stack : err);
          notifyAdmin(
            `<b>500 on</b> <code>${notifyEscape(req.method + ' ' + req.url)}</code>\n<pre>${notifyEscape(String((err && err.stack) || err).slice(0, 800))}</pre>`,
            { tag: 'handler-500', level: 'error' },
          );
          if (!res.headersSent) sendError(res, 500, 'internal_error', 'Internal server error');
        });
      }
      return;
    }
    // Wave-1 + wave-2 routes (/api/health, /api/v1/{sample,mirror,replay},
    // /api/analyze*, /api/account/insights, /api/admin/stats, /api/proxy,
    // /api/intel/*, /api/behavior/corpus*) all routed via Router above.
    if (pathname === '/api/v1/stream' && req.method === 'GET') return handleStream(req, res);
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
