'use strict';

/**
 * Stateless HMAC token tests. Covers happy path + each documented failure
 * mode. Expired-token test forges a token directly (bypasses signToken's
 * "expirySeconds must be positive" guard) so we don't need time mocking.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Set secret BEFORE requiring the module — module reads it lazily, but tests
// might race if we ever cache it, so be explicit.
process.env.EMAIL_TOKEN_SECRET = 'a'.repeat(64); // 64 chars = >=32 minimum

const { signToken, verifyToken, TokenError } = require('../tokens');

// Helper: forge a token with arbitrary payload (used to test exp boundaries
// without time mocking).
function forgeToken(payload, secret = process.env.EMAIL_TOKEN_SECRET) {
  const payloadB64u = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64u).digest();
  return `${payloadB64u}.${sig.toString('base64url')}`;
}

test('signToken + verifyToken: round-trip succeeds and payload is preserved', () => {
  const tok = signToken({
    purpose: 'reset',
    user_id: 42,
    email: 'alice@example.com',
    expirySeconds: 900,
  });
  const payload = verifyToken(tok, 'reset');
  assert.equal(payload.purpose, 'reset');
  assert.equal(payload.user_id, 42);
  assert.equal(payload.email, 'alice@example.com');
  assert.ok(payload.iat <= Math.floor(Date.now() / 1000));
  assert.equal(payload.exp, payload.iat + 900);
});

test('verifyToken: tampered payload is rejected', () => {
  const tok = signToken({
    purpose: 'verify',
    user_id: 1,
    email: 'bob@example.com',
    expirySeconds: 60,
  });
  // Flip a character in the payload (preserving base64url alphabet).
  const [payloadB64u, sigB64u] = tok.split('.');
  const tampered = payloadB64u.slice(0, -1) + (payloadB64u.endsWith('A') ? 'B' : 'A');
  assert.throws(
    () => verifyToken(`${tampered}.${sigB64u}`, 'verify'),
    (e) => e instanceof TokenError && e.code === 'tampered',
  );
});

test('verifyToken: tampered signature is rejected', () => {
  const tok = signToken({
    purpose: 'verify',
    user_id: 1,
    email: 'bob@example.com',
    expirySeconds: 60,
  });
  const [payloadB64u, sigB64u] = tok.split('.');
  // Flip the FIRST base64url char — every one of its 6 bits maps to real
  // signature bytes. (Flipping the LAST char is flaky: a 32-byte HMAC is 43
  // base64url chars = 258 bits, so the final char's low 2 bits are zero-padding;
  // when the signature ends in A/B/C/D, flipping it changes only padding and the
  // signature still verifies — ~6% false-pass rate.)
  const flipped = (sigB64u[0] === 'A' ? 'B' : 'A') + sigB64u.slice(1);
  assert.throws(
    () => verifyToken(`${payloadB64u}.${flipped}`, 'verify'),
    (e) => e instanceof TokenError && e.code === 'tampered',
  );
});

test('verifyToken: expired token is rejected', () => {
  const past = Math.floor(Date.now() / 1000) - 10; // 10s ago
  const tok = forgeToken({
    purpose: 'reset',
    user_id: 7,
    email: 'old@example.com',
    iat: past - 60,
    exp: past,
  });
  assert.throws(
    () => verifyToken(tok, 'reset'),
    (e) => e instanceof TokenError && e.code === 'expired',
  );
});

test('verifyToken: wrong purpose is rejected (cross-purpose replay defense)', () => {
  const tok = signToken({
    purpose: 'verify',
    user_id: 1,
    email: 'a@b.com',
    expirySeconds: 60,
  });
  assert.throws(
    () => verifyToken(tok, 'reset'),
    (e) => e instanceof TokenError && e.code === 'wrong-purpose',
  );
});

test('verifyToken: malformed token (no dot) is rejected', () => {
  assert.throws(
    () => verifyToken('not-a-token', 'reset'),
    (e) => e instanceof TokenError && e.code === 'malformed',
  );
});

test('verifyToken: empty token is rejected', () => {
  assert.throws(
    () => verifyToken('', 'reset'),
    (e) => e instanceof TokenError && e.code === 'malformed',
  );
});

test('verifyToken: token signed with different secret is rejected', () => {
  const tok = forgeToken(
    {
      purpose: 'reset',
      user_id: 1,
      email: 'a@b.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    'a-completely-different-secret-of-sufficient-length-XX',
  );
  assert.throws(
    () => verifyToken(tok, 'reset'),
    (e) => e instanceof TokenError && e.code === 'tampered',
  );
});

test('signToken: input validation rejects bad arguments', () => {
  assert.throws(() => signToken({ purpose: '', user_id: 1, email: 'a@b.com', expirySeconds: 60 }));
  assert.throws(() =>
    signToken({ purpose: 'reset', user_id: 0, email: 'a@b.com', expirySeconds: 60 }),
  );
  assert.throws(() =>
    signToken({ purpose: 'reset', user_id: 1.5, email: 'a@b.com', expirySeconds: 60 }),
  );
  assert.throws(() => signToken({ purpose: 'reset', user_id: 1, email: '', expirySeconds: 60 }));
  assert.throws(() =>
    signToken({ purpose: 'reset', user_id: 1, email: 'a@b.com', expirySeconds: 0 }),
  );
  assert.throws(() =>
    signToken({ purpose: 'reset', user_id: 1, email: 'a@b.com', expirySeconds: -1 }),
  );
});

test('signToken: missing secret throws clearly', () => {
  const saved = process.env.EMAIL_TOKEN_SECRET;
  delete process.env.EMAIL_TOKEN_SECRET;
  try {
    assert.throws(
      () =>
        signToken({
          purpose: 'reset',
          user_id: 1,
          email: 'a@b.com',
          expirySeconds: 60,
        }),
      /EMAIL_TOKEN_SECRET/,
    );
  } finally {
    process.env.EMAIL_TOKEN_SECRET = saved;
  }
});

test('signToken: short secret throws clearly', () => {
  const saved = process.env.EMAIL_TOKEN_SECRET;
  process.env.EMAIL_TOKEN_SECRET = 'too-short';
  try {
    assert.throws(
      () =>
        signToken({
          purpose: 'reset',
          user_id: 1,
          email: 'a@b.com',
          expirySeconds: 60,
        }),
      /too short/,
    );
  } finally {
    process.env.EMAIL_TOKEN_SECRET = saved;
  }
});

test('round-trip: tokens are URL-safe (no +/= chars)', () => {
  // Run a few different payloads to exercise base64url output paths
  for (let i = 0; i < 20; i++) {
    const tok = signToken({
      purpose: 'verify',
      user_id: i + 1,
      email: `u${i}@example.com`,
      expirySeconds: 60,
    });
    assert.ok(!tok.includes('+'), `token #${i} contains '+': ${tok}`);
    assert.ok(!tok.includes('/'), `token #${i} contains '/': ${tok}`);
    assert.ok(!tok.includes('='), `token #${i} contains '=': ${tok}`);
  }
});
