'use strict';

/**
 * Stateless HMAC-SHA-256 tokens for email-verify + password-reset flows.
 *
 * Format: <base64url(payload_json)>.<base64url(hmac_signature)>
 * Payload: { purpose, user_id, email, iat, exp } — timestamps in unix seconds.
 *
 * Why stateless: avoids a `tokens` table + the cron to clean it. The HMAC is
 * sufficient — only this server (with EMAIL_TOKEN_SECRET) can produce a valid
 * signature, and tampering with payload or signature invalidates the token.
 * The `exp` field inside the payload makes tokens self-expiring.
 *
 * Secret: process.env.EMAIL_TOKEN_SECRET. Generate with `openssl rand -hex 32`.
 *
 * Threat notes:
 *   - signature comparison is timing-safe (crypto.timingSafeEqual)
 *   - purpose is part of payload AND verified explicitly to prevent
 *     cross-purpose replay (a `verify` token can't be used as `reset`).
 */

const crypto = require('crypto');

const ALGO = 'sha256';
const MIN_SECRET_LEN = 32;

class TokenError extends Error {
  /**
   * @param {'malformed'|'tampered'|'expired'|'wrong-purpose'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

function getSecret() {
  const s = process.env.EMAIL_TOKEN_SECRET;
  if (!s || s.length < MIN_SECRET_LEN) {
    throw new Error(
      `EMAIL_TOKEN_SECRET missing or too short (need >= ${MIN_SECRET_LEN} chars). ` +
        `Generate with: openssl rand -hex 32`,
    );
  }
  return s;
}

function hmac(payloadB64u, secret) {
  return crypto.createHmac(ALGO, secret).update(payloadB64u).digest();
}

/**
 * @param {{ purpose: string, user_id: number, email: string, expirySeconds: number }} args
 * @returns {string} token
 */
function signToken({ purpose, user_id, email, expirySeconds }) {
  if (!purpose || typeof purpose !== 'string') {
    throw new Error('signToken: purpose required (string)');
  }
  if (!Number.isInteger(user_id) || user_id <= 0) {
    throw new Error('signToken: user_id must be positive integer');
  }
  if (!email || typeof email !== 'string') {
    throw new Error('signToken: email required (string)');
  }
  if (!Number.isFinite(expirySeconds) || expirySeconds <= 0) {
    throw new Error('signToken: expirySeconds must be positive number');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    purpose,
    user_id,
    email,
    iat: now,
    exp: now + Math.floor(expirySeconds),
  };
  const payloadB64u = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigB64u = hmac(payloadB64u, getSecret()).toString('base64url');
  return `${payloadB64u}.${sigB64u}`;
}

/**
 * @param {string} token
 * @param {string} expectedPurpose
 * @returns {{ purpose: string, user_id: number, email: string, iat: number, exp: number }}
 * @throws {TokenError} with code 'malformed' | 'tampered' | 'expired' | 'wrong-purpose'
 */
function verifyToken(token, expectedPurpose) {
  if (!token || typeof token !== 'string') {
    throw new TokenError('malformed', 'token missing or not a string');
  }
  if (!expectedPurpose || typeof expectedPurpose !== 'string') {
    throw new Error('verifyToken: expectedPurpose required (string)');
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new TokenError('malformed', 'token must be "<payload>.<sig>"');
  }
  const [payloadB64u, sigB64u] = parts;

  let providedSig;
  try {
    providedSig = Buffer.from(sigB64u, 'base64url');
  } catch {
    throw new TokenError('malformed', 'signature not valid base64url');
  }
  const expectedSig = hmac(payloadB64u, getSecret());
  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    throw new TokenError('tampered', 'signature mismatch');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64u, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('malformed', 'payload not valid JSON');
  }
  if (!payload || typeof payload !== 'object') {
    throw new TokenError('malformed', 'payload not an object');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new TokenError('expired', 'token expired');
  }
  if (payload.purpose !== expectedPurpose) {
    throw new TokenError(
      'wrong-purpose',
      `expected purpose "${expectedPurpose}", got "${payload.purpose}"`,
    );
  }

  return payload;
}

module.exports = { signToken, verifyToken, TokenError };
