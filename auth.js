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

  function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || 'unknown';
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
    if (Users.getByEmail(normEmail)) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Email already registered')
      );
      e.code = 'email_taken';
      e.status = 409;
      throw e;
    }
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = Users.create({ email: normEmail, password_hash });
    return user;
  }

  async function login({ email, password }, req) {
    const ip = clientIp(req);
    if (!loginLimiter(ip)) {
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
      userRow
        ? userRow.password_hash
        : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid',
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
    shutdown,
  };
}

module.exports = { createAuth };
