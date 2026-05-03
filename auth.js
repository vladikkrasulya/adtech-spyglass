'use strict';

/**
 * Email/password auth with in-memory sessions.
 *
 * Sessions live in process memory — wipe on container restart by design
 * (limits stolen-cookie window, also keeps the auth path tiny). Phase 7+
 * may move them to a `sessions` table when persistent login becomes a
 * real ask.
 *
 * Cookie:
 *   spy_session = <64-char hex token>
 *   HttpOnly · SameSite=Lax · Secure (when behind https) · Max-Age=30d
 *
 * Rate limits (per IP):
 *   register — 5 / hour
 *   login    — 10 / 15 min
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const COOKIE_NAME = 'spy_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LEN = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function makeLimiter({ windowMs, max }) {
  const buckets = new Map();
  // Sweep stale buckets so this map doesn't grow forever
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of buckets) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }, windowMs).unref();

  return (key) => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const list = (buckets.get(key) || []).filter((t) => t > cutoff);
    if (list.length >= max) return false;
    list.push(now);
    buckets.set(key, list);
    return true;
  };
}

/**
 * @param {{ Users: any, logger?: any }} deps
 */
function createAuth({ Users, logger }) {
  const log = logger || console;
  /** @type {Map<string, { userId: number, expiresAt: number, ip: string, ua: string }>} */
  const sessions = new Map();

  // Pre-computed real bcrypt hash used as a stand-in when login is attempted
  // for a non-existent email. A literal "looks-like-bcrypt" string short-
  // circuits inside bcrypt.compare on bad cost/salt parsing — leaking the
  // "user not found" branch via timing. Generating once at boot keeps the
  // compare path identical to the real-user path.
  const TIMING_DUMMY_HASH = bcrypt.hashSync('timing-dummy', BCRYPT_ROUNDS);

  // Periodic sweep of expired sessions
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [t, s] of sessions) {
      if (s.expiresAt < now) {
        sessions.delete(t);
        removed++;
      }
    }
    if (removed) log.info && log.info({ removed, remaining: sessions.size }, 'session sweep');
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  const loginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  // Per-account lockout: if an attacker rotates IPs (botnet) the per-IP
  // limiter doesn't help. Bucketed by normalised email so 8 failed logins
  // within 15min on the same email lock everyone out — including
  // legitimate user, by design (typo five times then go drink coffee).
  const loginEmailLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 8 });
  const registerLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

  function newToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  function getCookieToken(req) {
    const cookie = req.headers.cookie || '';
    for (const part of cookie.split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === COOKIE_NAME) return v;
    }
    return null;
  }

  function getCurrentUser(req) {
    const token = getCookieToken(req);
    if (!token) return null;
    const s = sessions.get(token);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }
    const user = Users.get(s.userId);
    return user || null;
  }

  function isHttps(req) {
    return (
      req.headers['x-forwarded-proto'] === 'https' || (req.connection && req.connection.encrypted)
    );
  }

  // Trust X-Forwarded-For only when the request actually came from the local
  // proxy (kyivtech-portal binds the container on 127.0.0.1:8090). Otherwise
  // an attacker who reaches the app directly could spoof XFF and bypass the
  // per-IP rate limiters on /login and /register.
  function clientIp(req) {
    const peer = (req.socket && req.socket.remoteAddress) || 'unknown';
    const peerIsLoopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    if (peerIsLoopback) {
      const fwd = req.headers['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
    }
    return peer;
  }

  function setSessionCookie(req, res, token) {
    const parts = [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (isHttps(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function createSession(req, res, user) {
    const token = newToken();
    sessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
      ip: clientIp(req),
      ua: (req.headers['user-agent'] || '').slice(0, 200),
    });
    setSessionCookie(req, res, token);
    log.info && log.info({ userId: user.id, sessions: sessions.size }, 'session created');
  }

  function destroySession(req, res) {
    const token = getCookieToken(req);
    if (token) sessions.delete(token);
    const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (isHttps(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  async function register({ email, password }, req) {
    const ip = clientIp(req);
    if (!registerLimiter(ip)) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Too many sign-up attempts. Try again in an hour.')
      );
      e.code = 'rate_limited';
      e.status = 429;
      throw e;
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim().toLowerCase())) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Invalid email format')
      );
      e.code = 'invalid_email';
      e.status = 400;
      throw e;
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters`)
      );
      e.code = 'weak_password';
      e.status = 400;
      throw e;
    }
    const normEmail = email.trim().toLowerCase();
    // Hash *before* the existence check so the bcrypt cost (≈300ms at rounds=12)
    // is paid by both branches — kills the timing-side-channel that lets an
    // attacker enumerate registered emails by measuring response latency.
    // The 409 response code itself is a residual disclosure but at this
    // scale (small user base) the UX win of an honest error outweighs it.
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    if (Users.getByEmail(normEmail)) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Email already registered')
      );
      e.code = 'email_taken';
      e.status = 409;
      throw e;
    }
    const user = Users.create({ email: normEmail, password_hash });
    return user;
  }

  async function login({ email, password }, req) {
    const ip = clientIp(req);
    const emailKey =
      typeof email === 'string' && email.length ? email.trim().toLowerCase() : '<empty>';
    // Belt-and-suspenders: per-IP catches one host abusing the form,
    // per-account catches one identity getting hammered from many IPs.
    // Any failure to either bucket → 429 (without saying which one).
    if (!loginLimiter(ip) || !loginEmailLimiter(emailKey)) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Too many login attempts. Try again in 15 minutes.')
      );
      e.code = 'rate_limited';
      e.status = 429;
      throw e;
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Email and password required')
      );
      e.code = 'invalid_credentials';
      e.status = 400;
      throw e;
    }
    const userRow = Users.getByEmail(email);
    // Always run bcrypt to keep timing similar between "no such email" and
    // "wrong password" cases.
    const ok = await bcrypt.compare(
      password,
      userRow ? userRow.password_hash : TIMING_DUMMY_HASH,
    );
    if (!userRow || !ok) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Wrong email or password')
      );
      e.code = 'invalid_credentials';
      e.status = 401;
      throw e;
    }
    return { id: userRow.id, email: userRow.email, created_at: userRow.created_at };
  }

  function activeSessionCount() {
    return sessions.size;
  }

  // ── Phase 8 — password reset helpers ───────────────────────────────────

  /** Bcrypt-hash a password (rounds=12). */
  async function hashPassword(plaintext) {
    if (typeof plaintext !== 'string' || plaintext.length < MIN_PASSWORD_LEN) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters`)
      );
      e.code = 'weak_password';
      e.status = 400;
      throw e;
    }
    return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  }

  /** Verify a password against a bcrypt hash. */
  async function verifyPassword(plaintext, hash) {
    if (typeof plaintext !== 'string' || typeof hash !== 'string') return false;
    return bcrypt.compare(plaintext, hash);
  }

  /**
   * Drop all in-memory sessions belonging to a user. Used on password reset
   * so previously-stolen cookies stop working immediately. Returns count
   * removed.
   * @param {number} userId
   */
  function invalidateUserSessions(userId) {
    let removed = 0;
    for (const [t, s] of sessions) {
      if (s.userId === userId) {
        sessions.delete(t);
        removed++;
      }
    }
    return removed;
  }

  // Per-IP rate limit for /forgot-password — 5 / 15 min. Same response
  // ("200 ok") regardless of whether email exists, so callers can't probe
  // existence; the limiter just stops trivial flooding.
  const forgotPasswordLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
  function checkForgotPasswordLimit(req) {
    return forgotPasswordLimiter(clientIp(req));
  }

  function shutdown() {
    clearInterval(sweepTimer);
    sessions.clear();
  }

  return {
    COOKIE_NAME,
    register,
    login,
    createSession,
    destroySession,
    getCurrentUser,
    activeSessionCount,
    hashPassword,
    verifyPassword,
    invalidateUserSessions,
    checkForgotPasswordLimit,
    clientIp, // exposed so other handlers (e.g. /api/analyze rate-limit) reuse the same loopback-XFF logic
    shutdown,
  };
}

module.exports = { createAuth };
