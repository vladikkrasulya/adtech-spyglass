'use strict';

/**
 * modules/auth/handler.js — /api/auth/* (11 routes).
 *
 * The biggest backend migration: extracted verbatim from server.js
 * `handleAuthRoute`, which was a sub-dispatcher matching `pathname ===
 * '/api/auth/...' && method === '...'` in sequence. Each branch is now
 * an individually-registered Router route. No behavior changes —
 * payload shapes, status codes, error codes, side-effects (Sessions
 * mutation, cookie writes, Telegram alerts) are all preserved.
 *
 * Security note (zero-knowledge invariants):
 *   - The server never sees plaintext DEK bytes. /setup-encryption and
 *     /reset-password store whatever the client computed (kdf_salt +
 *     wrapped DEK ciphertext + IVs). This module forwards those fields
 *     to Users.setCryptoState / Users.setPasswordCryptoState verbatim.
 *   - There is no server-side reset state cache (no `_resetCtx`-style
 *     object). The JWT reset token itself is the proof — /reset-password
 *     verifies it on every call, looks up the user, and trusts the
 *     client's freshly-wrapped material. So the factory closure has no
 *     stateful slots and `module.exports` exposes only the factory.
 *   - All helpers that the legacy handler called via closure (publicUser,
 *     publicEncryption, getPublicBaseUrl, setLocaleCookie, signToken,
 *     verifyToken, TokenError, sendVerifyEmail, sendResetEmail,
 *     notifyAdmin, notifyEscape, VERIFY_TOKEN_TTL, RESET_TOKEN_TTL) are
 *     received via DI so this module stays unit-testable. None of them
 *     are stored on `module.exports`.
 *
 * Wiring (in server.js):
 *   const { createAuthRoutesModule } = require('./modules/auth/handler');
 *   router.register(createAuthRoutesModule({
 *     auth, Users,
 *     signToken, verifyToken, TokenError,
 *     sendVerifyEmail, sendResetEmail,
 *     notifyAdmin, notifyEscape,
 *     publicUser, publicEncryption,
 *     getPublicBaseUrl, setLocaleCookie,
 *     VERIFY_TOKEN_TTL, RESET_TOKEN_TTL,
 *   }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   auth: any,
 *   Users: any,
 *   signToken: Function,
 *   verifyToken: Function,
 *   TokenError: Function,
 *   sendVerifyEmail: Function,
 *   sendResetEmail: Function,
 *   notifyAdmin: Function,
 *   notifyEscape: (s: string) => string,
 *   publicUser: (u: any) => any,
 *   publicEncryption: (cs: any) => any,
 *   getPublicBaseUrl: () => string,
 *   setLocaleCookie: (req: import('http').IncomingMessage, res: import('http').ServerResponse, locale: string) => void,
 *   VERIFY_TOKEN_TTL: number,
 *   RESET_TOKEN_TTL: number,
 *   intelLlm?: { warmupOllama: () => void },
 * }} deps
 */
function createAuthRoutesModule(deps) {
  const {
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
    // v0.38.2 — optional intel-llm injection for the post-login warmup
    // ping. Default to a no-op stub so the module stays usable in test
    // environments that don't wire Ollama.
    intelLlm = { warmupOllama: () => {} },
  } = deps;

  function handleMe(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) return sendJson(res, 200, { success: true, user: null, encryption: null });
    // Surface crypto state so the client can derive KEK and unwrap DEK.
    const encryption = publicEncryption(Users.getCryptoState(user.id));
    return sendJson(res, 200, { success: true, user: publicUser(user), encryption });
  }

  function handleRegister(req, res) {
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

  function handleLogin(req, res) {
    return readJson(req)
      .then(async ({ email, password }) => {
        const user = await auth.login({ email, password }, req);
        auth.createSession(req, res, user);
        const encryption = publicEncryption(Users.getCryptoState(user.id));
        sendJson(res, 200, { success: true, user: publicUser(user), encryption });
        // v0.38.2 — Ollama warmup. The user has just authenticated; they
        // likely will (or won't) hit /api/intel/* soon. Pre-warm the
        // local LLM so the first call doesn't pay the 10-15s cold-load
        // tax. Fire-and-forget — warmupOllama swallows all errors and
        // has its own 5s abort timeout, so login response stays snappy
        // regardless of Ollama health.
        try {
          intelLlm.warmupOllama();
        } catch {
          /* warmup must never disrupt login */
        }
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  function handleLogout(req, res) {
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
  function handlePreferences(req, res) {
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
  function handleSetupEncryption(req, res) {
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
  function handleVerifyEmailRequest(req, res) {
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
  function handleVerifyEmailConfirm(req, res, parsed) {
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
      const code = err instanceof TokenError ? /** @type {any} */ (err).code : 'invalid';
      res.writeHead(302, { Location: `${base}/?verify_error=${encodeURIComponent(code)}` });
      return res.end();
    }
  }

  // Public — always returns 200 (don't leak which emails exist).
  function handleForgotPassword(req, res) {
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
  function handleResetPasswordState(req, res) {
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
          const code = err instanceof TokenError ? /** @type {any} */ (err).code : 'invalid_token';
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
  function handleResetPassword(req, res) {
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
          const code = err instanceof TokenError ? /** @type {any} */ (err).code : 'invalid_token';
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
          // Atomic: password + crypto-state wrap rotate together. A crash
          // between hash-write and wrap-write previously locked the user
          // out of their own library (new password → new KEK → can't
          // unwrap old DEK). Now both land or neither does.
          Users.updatePasswordAndCrypto(payload.user_id, newHash, {
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
          // Same atomicity contract as 'rotate' — locked-out-on-crash was a
          // missed defect in the original audit (caught on second pass).
          Users.updatePasswordAndCrypto(payload.user_id, newHash, {
            kdf_salt: b.new_kdf_salt,
            dek_wrapped: b.new_dek_wrapped,
            dek_iv: b.new_dek_iv,
          });
        } else if (mode === 'wipe') {
          // Lost both password AND recovery key. User accepts data loss.
          // Atomic: password + clear crypto + wipe all five per-user tables
          // in one transaction. Crash mid-flow rolls back entirely — user
          // keeps old state or transitions to clean-slate, never a half-state.
          const newHash = await auth.hashPassword(b.newPassword);
          Users.updatePasswordAndWipe(payload.user_id, newHash);
        } else {
          return sendError(res, 400, 'invalid_mode', `Unknown reset mode: ${mode}`);
        }

        // Drop all old sessions, mint a new one. Old cookies (if stolen)
        // stop working immediately.
        //
        // Throw on DB-side session-delete failure (post-v0.25.0): refuse to
        // mint a new session if the old ones might still be valid. Returning
        // 500 lets the client retry; minting under partial invalidation
        // would silently revive stolen tokens after the next container
        // restart.
        try {
          auth.invalidateUserSessions(payload.user_id);
        } catch (e) {
          notifyAdmin(
            `<b>reset-password session-invalidate failed</b>\n<pre>${notifyEscape(String((e && e.stack) || e).slice(0, 800))}</pre>`,
            { tag: 'reset-password-sessions', level: 'error' },
          );
          return sendError(
            res,
            500,
            'sessions_invalidate_failed',
            'Password reset partially applied. Please retry; do not assume old sessions are invalidated.',
          );
        }
        const fresh = Users.get(payload.user_id);
        auth.createSession(req, res, fresh);
        const encryption = publicEncryption(Users.getCryptoState(payload.user_id));
        return sendJson(res, 200, { success: true, user: publicUser(fresh), encryption });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  return {
    id: 'auth',
    routes: [
      { method: 'GET', path: '/api/auth/me', handler: handleMe },
      { method: 'POST', path: '/api/auth/register', handler: handleRegister },
      { method: 'POST', path: '/api/auth/login', handler: handleLogin },
      { method: 'POST', path: '/api/auth/logout', handler: handleLogout },
      { method: 'POST', path: '/api/auth/preferences', handler: handlePreferences },
      { method: 'POST', path: '/api/auth/setup-encryption', handler: handleSetupEncryption },
      {
        method: 'POST',
        path: '/api/auth/verify-email/request',
        handler: handleVerifyEmailRequest,
      },
      {
        method: 'GET',
        path: '/api/auth/verify-email/confirm',
        handler: handleVerifyEmailConfirm,
      },
      { method: 'POST', path: '/api/auth/forgot-password', handler: handleForgotPassword },
      {
        method: 'POST',
        path: '/api/auth/reset-password/state',
        handler: handleResetPasswordState,
      },
      { method: 'POST', path: '/api/auth/reset-password', handler: handleResetPassword },
    ],
  };
}

module.exports = { createAuthRoutesModule };
