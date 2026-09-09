'use strict';

/**
 * Email/password auth with persistent sessions (since v0.18.0).
 *
 * Sessions live in BOTH:
 *   - in-process Map (hot read path — every request hits this)
 *   - SQLite `sessions` table (survives container restart; before this
 *     change every `compose up --build` kicked all logged-in users out
 *     even though their cookie was still valid for 30 days)
 *
 * Production persists versioned keyed lookup identities, never raw cookies.
 * The recovery owner fences startup and journals revocations before DB deletion.
 * Only a drained, orderly shutdown may preserve trusted restart continuity.
 *
 * Cookie:
 *   ot_session = <64-char hex token>
 *   HttpOnly · SameSite=Lax · Secure (when behind https) · Max-Age=30d
 *
 * Rate limits (per IP):
 *   register — 5 / hour
 *   login    — 10 / 15 min
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const eventLog = require('./lib/event-log');
const { resolveClientIp } = require('./lib/client-ip');

const COOKIE_NAME = 'ot_session';
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
 * @param {{ Users: any, Sessions?: any, recovery?: any, logger?: any }} deps
 */
function createAuth({ Users, Sessions, recovery, logger }) {
  const log = logger || console;
  /** @type {Map<string, { userId: number, expiresAt: number, ip: string, ua: string }>} */
  const sessions = new Map();
  const proofs = new WeakMap();
  const epochs = new Map();
  let closing = false;
  let closed = false;
  let unaccountedRevocation = false;

  function recordRevocations(entries) {
    try {
      if (recovery.revoke(entries)) return true;
    } catch {
      /* hot denial and the prearmed fence still have to finish */
    }
    unaccountedRevocation = true;
    return false;
  }

  function assertWritable() {
    if (closing || closed) {
      throw Object.assign(new Error('Authentication is temporarily unavailable.'), {
        code: 'auth_unavailable',
        status: 503,
      });
    }
  }

  function credentialHash(user) {
    try {
      return Sessions && typeof Sessions.credentialHash === 'function'
        ? Sessions.credentialHash(user.id)
        : Users.getByEmail(user.email)?.password_hash;
    } catch {
      throw Object.assign(new Error('Authentication is temporarily unavailable.'), {
        code: 'auth_unavailable',
        status: 503,
      });
    }
  }

  function rememberProof(user, passwordHash, epoch = epochs.get(user.id) || 0) {
    proofs.set(user, { passwordHash, epoch });
    return user;
  }

  // Used only after an already-authorized synchronous reset transaction.
  // Callers cannot turn a pre-reset user object into a later login proof.
  function sessionUser(id) {
    assertWritable();
    const user = Users.get(id);
    if (!user)
      throw Object.assign(new Error('Sign in again.'), {
        code: 'session_state_changed',
        status: 401,
      });
    return rememberProof(user, credentialHash(user));
  }

  const lookup = (token) => (recovery ? recovery.lookup(token) : token);

  // Boot-time hydration: pull all non-expired sessions from DB into the
  // Map so request handlers (which only check the Map) recognise tokens
  // that survive a restart. Cheap — typical row count is single-digits
  // to low hundreds even for active products. Sessions param is optional
  // for tests that exercise auth without a DB.
  if (recovery) {
    for (const r of recovery.activeRows) {
      sessions.set(r.token, {
        userId: r.userId,
        expiresAt: r.expiresAt,
        ip: r.ip || '',
        ua: r.ua || '',
      });
    }
  } else if (Sessions) {
    try {
      Sessions.pruneExpired();
      const rows = Sessions.loadActive();
      for (const r of rows) {
        sessions.set(r.token, {
          userId: r.userId,
          expiresAt: r.expiresAt,
          ip: r.ip || '',
          ua: r.ua || '',
        });
      }
      log.info && log.info({ loaded: rows.length }, 'sessions hydrated from DB');
    } catch (e) {
      log.error && log.error({ err: e.message }, 'session hydration failed');
    }
  }

  // Pre-computed real bcrypt hash used as a stand-in when login is attempted
  // for a non-existent email. A literal "looks-like-bcrypt" string short-
  // circuits inside bcrypt.compare on bad cost/salt parsing — leaking the
  // "user not found" branch via timing. Generating once at boot keeps the
  // compare path identical to the real-user path.
  const TIMING_DUMMY_HASH = bcrypt.hashSync('timing-dummy', BCRYPT_ROUNDS);

  // Periodic sweep of expired sessions — Map + DB.
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [t, s] of sessions) {
      if (s.expiresAt < now) {
        sessions.delete(t);
        removed++;
      }
    }
    if (Sessions) {
      try {
        Sessions.pruneExpired();
      } catch (e) {
        log.error && log.error({ err: e.message }, 'session DB sweep failed');
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
    const id = lookup(token);
    const s = sessions.get(id);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      sessions.delete(id);
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

  // The single client-address rule for the whole app — see lib/client-ip.js for
  // the trust model and the measurement behind it.
  //
  // This used to trust X-Forwarded-For only when the TCP peer was loopback, on
  // the assumption that the proxy dialled 127.0.0.1:8090. It does, but the
  // published port (127.0.0.1:8090 -> 3000) makes Docker's userland proxy
  // re-originate the connection, so the peer is the bridge gateway and the
  // header was never read. Every visitor therefore resolved to the SAME
  // address, and these per-IP limiters were per-IP in name only: one shared
  // bucket for the whole internet.
  //
  // It also used to take the LEFTMOST X-Forwarded-For entry. Cloudflare appends
  // rather than replaces, so that entry is whatever the client sent — spoofable
  // by anyone who could reach the trusted path. resolveClientIp() prefers
  // CF-Connecting-IP (rewritten at the edge) and otherwise walks XFF from the
  // right, which a client-supplied prefix cannot reach.
  function clientIp(req) {
    return resolveClientIp(req) || 'unknown';
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
    assertWritable();
    const proof = proofs.get(user);
    if (recovery || proof) {
      if (
        !proof ||
        typeof proof.passwordHash !== 'string' ||
        proof.epoch !== (epochs.get(user.id) || 0) ||
        proof.passwordHash !== credentialHash(user)
      ) {
        throw Object.assign(new Error('Sign in again.'), {
          code: 'session_state_changed',
          status: 401,
        });
      }
      proofs.delete(user);
    }
    const token = newToken();
    const identity = lookup(token);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const ip = clientIp(req);
    const ua = (req.headers['user-agent'] || '').slice(0, 200);
    if (Sessions) {
      // Persist FIRST. If the DB write fails, the session would survive
      // only until container restart — the cookie would lie about
      // persistence and the user would experience a "silent logout"
      // post-restart. Throwing here lets the caller return 500; better
      // than handing out a session that won't outlive the process.
      try {
        Sessions.create({ token: identity, userId: user.id, expiresAt, ip, ua });
      } catch (e) {
        log.error && log.error({ operation: 'session_create' }, 'session DB write failed');
        throw new Error('session_persistence_failed', { cause: e });
      }
    }
    sessions.set(identity, { userId: user.id, expiresAt, ip, ua });
    setSessionCookie(req, res, token);
    log.info && log.info({ userId: user.id, sessions: sessions.size }, 'session created');
  }

  function destroySession(req, res) {
    const token = getCookieToken(req);
    let persistenceError;
    if (token) {
      const id = lookup(token);
      const known = sessions.get(id);
      // Only a known live session can add a revocation. Unknown cookies must
      // not turn this public endpoint into an unbounded journal/DB writer.
      const durable =
        recovery && known ? recordRevocations([{ id, expiresAt: known.expiresAt }]) : false;
      sessions.delete(id);
      if (Sessions && (!recovery || known)) {
        try {
          Sessions.destroy(id);
        } catch (e) {
          if (!durable) persistenceError = new Error('session_persistence_failed', { cause: e });
          log.error && log.error({ operation: 'session_delete' }, 'session DB delete failed');
        }
      }
    }
    const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (isHttps(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
    // Durable intent is sufficient even when the physical DB deletion fails.
    // Total-write failure keeps the prearmed recovery fence dirty.
    if (persistenceError) {
      throw persistenceError;
    }
  }

  async function register({ email, password }, req) {
    assertWritable();
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
    assertWritable();
    if (Users.getByEmail(normEmail)) {
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Email already registered')
      );
      e.code = 'email_taken';
      e.status = 409;
      throw e;
    }
    const user = Users.create({ email: normEmail, password_hash });
    return rememberProof(user, password_hash);
  }

  async function login({ email, password }, req) {
    assertWritable();
    const ip = clientIp(req);
    const emailKey =
      typeof email === 'string' && email.length ? email.trim().toLowerCase() : '<empty>';
    // Belt-and-suspenders: per-IP catches one host abusing the form,
    // per-account catches one identity getting hammered from many IPs.
    // Any failure to either bucket → 429 (without saying which one).
    if (!loginLimiter(ip) || !loginEmailLimiter(emailKey)) {
      // Auth telemetry carries NO PII: the event-log boundary reconstructs the
      // whole row from this finite ctx (no email/ip/user_id, and the msg label
      // is derived internally from reason_code — caller fields are discarded).
      eventLog.record({
        level: 'warn',
        component: 'auth',
        ctx: { outcome: 'failure', reason_code: 'rate_limited' },
      });
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
    const epoch = userRow ? epochs.get(userRow.id) || 0 : 0;
    // Always run bcrypt to keep timing similar between "no such email" and
    // "wrong password" cases.
    const ok = await bcrypt.compare(password, userRow ? userRow.password_hash : TIMING_DUMMY_HASH);
    if (!userRow || !ok) {
      eventLog.record({
        level: 'warn',
        component: 'auth',
        ctx: { outcome: 'failure', reason_code: userRow ? 'wrong_password' : 'no_such_user' },
      });
      const e = /** @type {Error & {code?: string, status?: number}} */ (
        new Error('Wrong email or password')
      );
      e.code = 'invalid_credentials';
      e.status = 401;
      throw e;
    }
    eventLog.record({
      level: 'info',
      component: 'auth',
      ctx: { outcome: 'success', reason_code: 'ok' },
    });
    return rememberProof(
      { id: userRow.id, email: userRow.email, created_at: userRow.created_at },
      userRow.password_hash,
      epoch,
    );
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
   * Revoke every known session, retire outstanding credential proofs, then
   * attempt DB cleanup. Reset/wipe retain their atomic password/data/session
   * transaction; the journal also protects direct account-wide invalidation.
   * Hot denial always finishes. A durable journal is sufficient if deletion
   * fails; failure of both stores is surfaced and forbids a clean checkpoint.
   *
   * @param {number} userId
   * @returns {number} count removed from the in-memory Map
   * @throws when durable revocation cannot be confirmed; local denial is done
   */
  function invalidateUserSessions(userId) {
    epochs.set(userId, (epochs.get(userId) || 0) + 1);
    const affected = [...sessions].filter(([, session]) => session.userId === userId);
    const durable = recovery
      ? recordRevocations(affected.map(([id, session]) => ({ id, expiresAt: session.expiresAt })))
      : false;
    let dbError = null;
    try {
      if (Sessions) {
        Sessions.destroyForUser(userId);
      }
    } catch (e) {
      dbError = e;
    }
    let removed = 0;
    for (const [t, s] of sessions) {
      if (s.userId === userId) {
        sessions.delete(t);
        removed++;
      }
    }
    if (dbError && !durable) {
      if (recovery) throw new Error('session_persistence_failed');
      throw dbError;
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

  // Phase 9b/freeze hardening (audit P0.1 correction): /reset-password
  // in mode='rotate' calls bcrypt.compare(oldPassword, ...) — that's a
  // brute-force gateway for the OLD password as long as the attacker
  // holds a valid 15-min reset token (which they could obtain by, say,
  // having stolen email access for a moment, or by social engineering).
  // 5/15min/IP matches the /forgot-password tier. Reset tokens still
  // expire by their HMAC TTL on top of this — defense in depth.
  const resetPasswordLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
  function checkResetPasswordLimit(req) {
    return resetPasswordLimiter(clientIp(req));
  }

  // /reset-password/state lookup. Same window as the password endpoints
  // — without this an attacker holding a reset token could probe the
  // token's crypto state response unboundedly.
  const resetStateLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  function checkResetStateLimit(req) {
    return resetStateLimiter(clientIp(req));
  }

  // /verify-email/request — auth-gated already, but we cap so a logged-in
  // attacker (or just a frustrated user) can't spam Resend with verify
  // emails. Emails cost real $ and burn quota.
  const verifyEmailLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
  function checkVerifyEmailLimit(req) {
    return verifyEmailLimiter(clientIp(req));
  }

  function beginShutdown() {
    closing = true;
  }

  function shutdown({ clean = false } = {}) {
    clearInterval(sweepTimer);
    sessions.clear();
    const trusted = recovery
      ? recovery.close({ clean: clean && closing && !unaccountedRevocation })
      : true;
    closing = true;
    closed = true;
    return trusted;
  }

  return {
    COOKIE_NAME,
    register,
    login,
    createSession,
    sessionUser,
    assertWritable,
    destroySession,
    getCurrentUser,
    activeSessionCount,
    hashPassword,
    verifyPassword,
    invalidateUserSessions,
    checkForgotPasswordLimit,
    checkResetPasswordLimit,
    checkResetStateLimit,
    checkVerifyEmailLimit,
    clientIp, // exposed so other handlers (e.g. /api/analyze rate-limit) reuse the same trusted-proxy rule
    shutdown,
    beginShutdown,
  };
}

module.exports = { createAuth };
