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
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Users, Partners, Samples, AnalyzeLog, Sessions, BehaviorCorpus, db } = require('./db');
const { createAuth } = require('./auth');
const { signToken, verifyToken, TokenError } = require('./tokens');
const { sendVerifyEmail, sendResetEmail } = require('./email');
const { notifyAdmin, escapeHtml: notifyEscape } = require('./notify');
const httpLib = require('./lib/http');
const _logger = require('./lib/logger');
const log = _logger.child('server');
const { captureException, flushSentry } = _logger;
httpLib.init({ notifyAdmin, notifyEscape });
const { sendJson, sendError } = httpLib;
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

const auth = createAuth({ Users, Sessions, logger: require('./lib/logger').child('auth') });

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
  log.fatal({ err }, 'uncaughtException');
  captureException(err, { source: 'uncaughtException' });
  notifyAdmin(
    `Uncaught exception\n<pre>${notifyEscape(String((err && err.stack) || err).slice(0, 800))}</pre>`,
    { tag: 'uncaught-exception', level: 'error' },
  );
});
process.on('unhandledRejection', (reason) => {
  log.fatal({ err: reason }, 'unhandledRejection');
  captureException(reason, { source: 'unhandledRejection' });
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
      // .js files get two passes: rewriteAssetVersions for static
      // `import …` graphs (transitive content-hash), and
      // injectModuleBundleHashes for `__<MODULE>_BUNDLE_HASH__` tokens
      // inside runtime-built URLs (template literals etc.) that the
      // regex-based rewriter can't reach. Together these eliminate every
      // manual `?v=N` knob in the codebase.
      let txt = rewriteAssetVersions(content.toString('utf8'), 'js');
      txt = injectModuleBundleHashes(txt);
      body = Buffer.from(txt, 'utf8');
    }
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}

// ── Module bundle hash: token-based cache-bust for runtime-built URLs ────
//
// rewriteAssetVersions() above handles static imports + <script src=> /
// <link href=> markup. But some modules build URLs at runtime in JS
// (template literals, string concat), which the regex can't safely catch.
//
// Convention: a module foo declares `const ASSET_VERSION =
// '__FOO_BUNDLE_HASH__';` and interpolates it where needed. When the
// server delivers the JS, every `__<MODULE>_BUNDLE_HASH__` token is
// replaced with sha1(concat of all direct files in public/modules/<module>/)
// — same idea as a webpack bundle hash, applied at serve time.
//
// Why bundle-hash (not per-file): a module is a unit. Bumping the inspector
// CSS should re-fetch the template too (they may have a coupled DOM
// contract). Bundle = "everything inside the module's dir". Touching any
// file flips the hash. Mtime-cached via a {filename: mtimeMs} manifest.
const _bundleHashCache = new Map(); // moduleId → { manifest, hash }

function moduleBundleHash(moduleId) {
  const dir = path.join(PUBLIC_DIR, 'modules', moduleId);
  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => fs.statSync(path.join(dir, f)).isFile())
      .sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const manifest = {};
  for (const f of files) manifest[f] = fs.statSync(path.join(dir, f)).mtimeMs;
  const cached = _bundleHashCache.get(moduleId);
  if (cached && JSON.stringify(cached.manifest) === JSON.stringify(manifest)) {
    return cached.hash;
  }
  const h = crypto.createHash('sha1');
  for (const f of files) h.update(fs.readFileSync(path.join(dir, f)));
  const hash = h.digest('hex').slice(0, 8);
  _bundleHashCache.set(moduleId, { manifest, hash });
  return hash;
}

const BUNDLE_TOKEN_RE = /__([A-Z][A-Z0-9_]*)_BUNDLE_HASH__/g;

function injectModuleBundleHashes(txt) {
  return txt.replace(BUNDLE_TOKEN_RE, (match, mod) => {
    const hash = moduleBundleHash(mod.toLowerCase());
    return hash !== null ? hash : match;
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

// Wave 3 modules (auth bundle, library, stream)
const { createAuthRoutesModule } = require('./modules/auth/handler');
const { createPartnersModule } = require('./modules/partners/handler');
const { createSamplesModule } = require('./modules/samples/handler');
const { createStreamModule } = require('./modules/stream/handler');
router.register(
  createAuthRoutesModule({
    auth,
    Users,
    signToken,
    verifyToken,
    TokenError,
    sendVerifyEmail,
    sendResetEmail,
    notifyAdmin,
    notifyEscape,
    publicUser,
    publicEncryption,
    getPublicBaseUrl,
    setLocaleCookie,
    VERIFY_TOKEN_TTL,
    RESET_TOKEN_TTL,
    // Post-login Ollama warmup (v0.38.2). Fire-and-forget — login
    // response is sent first, then warmup ping is issued. Tests in
    // isolation get the no-op stub default.
    intelLlm,
  }),
);
router.register(createPartnersModule({ auth, Partners }));
router.register(createSamplesModule({ auth, Samples }));
// stream module registered after streamGenerator + streamBuffer are
// instantiated lower in the file — see the second router.register() block
// near line ~1180.

// ── Auth routes ─────────────────────────────────────────────────────────────

// ── /api/proxy (allow-listed test harness, session-gated) ──────────────────
//
// Used only by the developer for ad-hoc forward-to-test-harness experiments;
// no frontend code calls it. We gate on session because an unauth proxy that
// echoes attacker-controlled JSON to public request bins is an abuse amplifier
// (attacker burns *our* IP+TLS to hit their webhook). webhook.site was the
// worst offender — wildcard subdomain → any attacker-controlled bin — so it's
// off the allow-list.

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
streamGenerator.on('error', (err) => log.error({ err }, 'stream generator error'));
streamGenerator.start();

// Stream module registers here — needs streamGenerator + streamBuffer in scope.
router.register(
  createStreamModule({
    streamGenerator,
    streamBuffer,
    STREAM_REPLAY_MAX,
    STREAM_HEARTBEAT_MS,
  }),
);
log.info(
  {
    cadenceMs: STREAM_RATE_MS,
    samples: streamGenerator.corpus.length,
    bufferMax: STREAM_BUFFER_MAX,
  },
  'stream generator running',
);

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
// loses the floor.
//
// CSP — enabled 2026-05-12 after the Phase-C / Cabinet sprint migrated all
// 126× inline event handlers to `data-action` + central dispatcher. Old
// comment about "frontend is full of inline event handlers" is now stale.
// What remains and requires 'unsafe-inline':
//   - 4 inline <script> blocks in each HTML shell (theme IIFE, JSON-LD,
//     module bootstrap, etc.) — would need per-request nonces to remove
//   - Inline <style> for palette/theme overrides — same nonce story
//   - iframe srcdoc creatives that ship inline event handlers from the
//     publisher's ad markup; the srcdoc iframe inherits parent CSP per
//     spec so blocking inline would break creative preview entirely
// 'unsafe-inline' is a known compromise; future improvement = per-request
// nonces + drop 'unsafe-inline' for script-src. Tracked in tech-debt.
//
// External origins allow-listed: only Google Fonts CSS + WOFF2 endpoints,
// pulled in by /design-system.css from the kyivtech-portal shared file.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self'",
  "frame-src 'self' data: blob:",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

function applyBaselineHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', CSP);
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
          log.error({ err, method: req.method, url: req.url }, 'router handler rejection');
          captureException(err, { request: { method: req.method, url: req.url } });
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
    // All /api/* routes (stream, auth bundle, library) now flow through the
    // Router above. Unmatched paths fall through to static file serving.
    return serveStaticFile(req, res);
  } catch (err) {
    log.error({ err, method: req.method, url: req.url }, 'handler crashed sync');
    captureException(err, { request: { method: req.method, url: req.url } });
    notifyAdmin(
      `<b>500 on</b> <code>${notifyEscape(req.method + ' ' + req.url)}</code>\n<pre>${notifyEscape(String((err && err.stack) || err).slice(0, 800))}</pre>`,
      { tag: 'handler-500', level: 'error' },
    );
    return sendError(res, 500, 'internal_error', 'Internal server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log.info({ port: PORT, addr: 'http://0.0.0.0:' + PORT }, 'spyglass backend listening');
});

const shutdown = (signal) => {
  log.info({ signal }, 'shutting down');
  streamGenerator.stop();
  auth.shutdown();
  // Flush in-flight Sentry events before close — best-effort 2s budget.
  // Server close + flush race; whichever finishes first wins, the 5s
  // hard-exit below catches any remaining hang.
  flushSentry(2000).finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
