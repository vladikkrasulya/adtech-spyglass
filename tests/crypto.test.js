'use strict';

/**
 * Crypto round-trip tests for public/spyglass-crypto.js.
 *
 * The module is browser-targeted (it puts `SpyglassCrypto` on `window`),
 * but its primitives are pure Web Crypto. We can run it under Node 20+ by
 * polyfilling `window`, `crypto`, `btoa`/`atob`, and the encoders. No fake
 * crypto — we use Node's actual `crypto.webcrypto`, which is the same impl
 * the browser would use.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let SC;

before(() => {
  // Node 20+ already has globalThis.crypto = webcrypto, so we don't override
  // it. We just need to provide the browser-only globals the module expects:
  // window (for the export), btoa/atob (Node has these in 20+ but be safe),
  // and TextEncoder/TextDecoder (also in Node 20).
  if (typeof globalThis.window === 'undefined') {
    /** @type {any} */ (globalThis).window = globalThis;
  }
  if (typeof globalThis.btoa === 'undefined') {
    globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  }
  if (typeof globalThis.atob === 'undefined') {
    globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
  }

  // Loading the module attaches SpyglassCrypto onto window. It's not a
  // CommonJS module (it's a browser IIFE), so eval rather than require.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'spyglass-crypto.js'), 'utf8');

  (0, eval)(src);
  SC = globalThis.SpyglassCrypto;
});

// ── helpers + base64 ─────────────────────────────────────────────────────

test('base64 round-trip', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const b64 = SC._bytesToB64(bytes);
  const back = SC._b64ToBytes(b64);
  assert.deepEqual([...back], [...bytes]);
});

test('hex round-trip', () => {
  const bytes = new Uint8Array([0x00, 0x0a, 0xff, 0x42]);
  const hex = SC._bytesToHex(bytes);
  assert.equal(hex, '000aff42');
  const back = SC._hexToBytes(hex);
  assert.deepEqual([...back], [...bytes]);
});

// ── KDF ──────────────────────────────────────────────────────────────────

test('deriveKEK: same password+salt → same key (deterministic)', async () => {
  const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const k1 = await SC.deriveKEK('test-password', salt);
  const k2 = await SC.deriveKEK('test-password', salt);
  // Use both keys to encrypt the same data — same output ⇒ same key.
  const data = new TextEncoder().encode('hello');
  const iv = new Uint8Array(12);
  const ct1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, data);
  const ct2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, data);
  assert.deepEqual([...new Uint8Array(ct1)], [...new Uint8Array(ct2)]);
});

test('deriveKEK: different salts → different keys', async () => {
  const salt1 = new Uint8Array(16).fill(1);
  const salt2 = new Uint8Array(16).fill(2);
  const k1 = await SC.deriveKEK('same-password', salt1);
  const k2 = await SC.deriveKEK('same-password', salt2);
  const data = new TextEncoder().encode('hello');
  const iv = new Uint8Array(12);
  const ct1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, data);
  const ct2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, data);
  assert.notDeepEqual([...new Uint8Array(ct1)], [...new Uint8Array(ct2)]);
});

// ── bootstrap + open round-trip ──────────────────────────────────────────

test('bootstrap → openWithPassword: round-trip works', async () => {
  const { state, dekKey } = await SC.bootstrap('correct-horse-battery');
  const reopenedKey = await SC.openWithPassword('correct-horse-battery', state);
  // Encrypt with one, decrypt with the other.
  const { iv, ct } = await SC.encryptBlob(dekKey, 'sensitive-payload');
  const back = await SC.decryptBlob(reopenedKey, iv, ct);
  assert.equal(back, 'sensitive-payload');
});

test('openWithPassword: wrong password fails', async () => {
  const { state } = await SC.bootstrap('right-password');
  await assert.rejects(SC.openWithPassword('wrong-password', state));
});

test('openWithRecoveryKey: round-trip works', async () => {
  const { state, recoveryKey, dekKey } = await SC.bootstrap('original-pw');
  // recoveryKey is shown to user once; user uses it to recover.
  const reopened = await SC.openWithRecoveryKey(recoveryKey, state);
  const { iv, ct } = await SC.encryptBlob(dekKey, 'hello');
  const back = await SC.decryptBlob(reopened, iv, ct);
  assert.equal(back, 'hello');
});

test('openWithRecoveryKey: wrong recovery key fails', async () => {
  const { state } = await SC.bootstrap('pw');
  await assert.rejects(SC.openWithRecoveryKey('00'.repeat(16), state));
});

// ── encryptBlob / decryptBlob ────────────────────────────────────────────

test('encryptBlob+decryptBlob: round-trip preserves UTF-8', async () => {
  const { dekKey } = await SC.bootstrap('pw');
  const plain = '{"id":"x","привіт":"світе","emoji":"🚀"}';
  const { iv, ct } = await SC.encryptBlob(dekKey, plain);
  const back = await SC.decryptBlob(dekKey, iv, ct);
  assert.equal(back, plain);
});

test('encryptBlob: empty string returns empty {iv:"",ct:""}', async () => {
  const { dekKey } = await SC.bootstrap('pw');
  const result = await SC.encryptBlob(dekKey, '');
  assert.equal(result.iv, '');
  assert.equal(result.ct, '');
});

test('decryptBlob: tampered ciphertext fails (AES-GCM auth)', async () => {
  const { dekKey } = await SC.bootstrap('pw');
  const { iv, ct } = await SC.encryptBlob(dekKey, 'original');
  // Flip a byte in the ciphertext.
  const bytes = SC._b64ToBytes(ct);
  bytes[0] ^= 0xff;
  const tamperedCt = SC._bytesToB64(bytes);
  await assert.rejects(SC.decryptBlob(dekKey, iv, tamperedCt));
});

test('encryptBlob: same plaintext encrypted twice produces different ciphertext (random IV)', async () => {
  const { dekKey } = await SC.bootstrap('pw');
  const a = await SC.encryptBlob(dekKey, 'same input');
  const b = await SC.encryptBlob(dekKey, 'same input');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

// ── full flow: simulate two sessions ─────────────────────────────────────

test('full flow: bootstrap on register, login on next session decrypts old data', async () => {
  // Session 1: register, encrypt, "log out" (drop dekKey).
  const session1 = await SC.bootstrap('strong-pw');
  const stored = session1.state;
  const enc = await SC.encryptBlob(session1.dekKey, 'bid request body');

  // Session 2: log in with password, decrypt previously stored blob.
  const dek2 = await SC.openWithPassword('strong-pw', stored);
  const back = await SC.decryptBlob(dek2, enc.iv, enc.ct);
  assert.equal(back, 'bid request body');
});
