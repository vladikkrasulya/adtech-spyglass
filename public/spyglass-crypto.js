/* ============================================================
   Spyglass crypto helpers — Web Crypto API only, no deps.
   Browser-side primitives for the zero-knowledge encryption layer:

     - PBKDF2-SHA-256 (600k iters) password → KEK (key encryption key)
     - AES-GCM-256 wrap (KEK ⊗ DEK), unwrap (KEK ⊗ wrapped)
     - AES-GCM-256 encrypt (DEK ⊗ plaintext) → {iv, ct}, decrypt back

   All keys live in browser memory only. The server never sees a
   plaintext DEK, never sees the password beyond bcrypt-verify, and
   never sees decrypted bid_req/bid_res payloads.

   Exposed on window.SpyglassCrypto. Pure functions, browser-only.
   ============================================================ */
(function () {
  'use strict';

  // ── Constants (don't change without a migration) ────────────────────
  const PBKDF2_ITERATIONS = 600000;
  const PBKDF2_HASH = 'SHA-256';
  const KEY_BITS = 256; // AES-256
  const SALT_BYTES = 16; // 128 bits — sufficient for KDF salt
  const IV_BYTES = 12; // 96 bits — recommended for AES-GCM
  const DEK_BYTES = 32; // 256-bit DEK (raw bytes, will become a CryptoKey)
  const RECOVERY_BYTES = 16; // 128-bit recovery key, displayed to user as 32 hex chars

  // ── base64 / hex helpers ───────────────────────────────────────────
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }
  function hexToBytes(hex) {
    const clean = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
    if (clean.length % 2 !== 0) throw new Error('Invalid hex string');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }
  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }
  function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  // ── KDF: derive a 256-bit AES-GCM key from a password + salt ───────
  async function deriveKEK(password, saltBytes) {
    const baseKey = await crypto.subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, [
      'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: PBKDF2_ITERATIONS,
        hash: PBKDF2_HASH,
      },
      baseKey,
      { name: 'AES-GCM', length: KEY_BITS },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  // ── Wrap / unwrap a DEK with a KEK using AES-GCM ───────────────────
  // We treat DEK as raw bytes (32) so we can wrap/unwrap as data — easier
  // than CryptoKey wrap APIs and equally secure.
  async function wrapBytes(kek, plainBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, plainBytes);
    return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
  }
  async function unwrapBytes(kek, ivB64, ctB64) {
    const iv = b64ToBytes(ivB64);
    const ct = b64ToBytes(ctB64);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ct);
    return new Uint8Array(plain);
  }

  // ── Import a raw DEK (32 bytes) as an AES-GCM CryptoKey ────────────
  // opts.extractable=true is required if the caller wants to later
  // exportKey('raw') the key (e.g. to mirror it into sessionStorage so
  // F5 doesn't force a re-unlock — see /core docs and the kt-dek-v1
  // sessionStorage contract in spyglass.app.js). Default stays false,
  // matching the original threat model where XSS can OPERATE the key
  // but cannot dump its raw bytes.
  async function importDEK(dekBytes, opts) {
    const extractable = !!(opts && opts.extractable);
    return crypto.subtle.importKey(
      'raw',
      dekBytes,
      { name: 'AES-GCM', length: KEY_BITS },
      extractable,
      ['encrypt', 'decrypt'],
    );
  }

  // ── Serialize / deserialize a DEK to/from a base64 string ──────────
  // Only callable on extractable=true keys. Used for sessionStorage
  // persistence of the unlock state across F5 within the same tab.
  async function serializeDEK(dekKey) {
    const raw = await crypto.subtle.exportKey('raw', dekKey);
    return bytesToB64(new Uint8Array(raw));
  }
  async function deserializeDEK(b64) {
    const bytes = b64ToBytes(b64);
    return importDEK(bytes, { extractable: true });
  }

  // ── Encrypt / decrypt arbitrary string blobs with the DEK ──────────
  async function encryptBlob(dekKey, plaintextStr) {
    if (!plaintextStr) return { iv: '', ct: '' };
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      dekKey,
      utf8Encode(plaintextStr),
    );
    return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
  }
  async function decryptBlob(dekKey, ivB64, ctB64) {
    if (!ivB64 || !ctB64) return '';
    const iv = b64ToBytes(ivB64);
    const ct = b64ToBytes(ctB64);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dekKey, ct);
    return utf8Decode(new Uint8Array(plain));
  }

  // ── High-level: bootstrap a brand new crypto state ─────────────────
  // Generates DEK + recovery key, wraps DEK twice (with password-KEK and
  // recovery-KEK), returns everything ready to POST to the server plus
  // the recovery key (hex) and the live DEK CryptoKey for the session.
  // opts.extractable forwards to importDEK — pass true if the caller
  // plans to mirror the key into sessionStorage for F5 survival.
  async function bootstrap(password, opts) {
    const dek = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
    const recovery = crypto.getRandomValues(new Uint8Array(RECOVERY_BYTES));
    const recoveryHex = bytesToHex(recovery);

    const pwSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const rkSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

    const kekPw = await deriveKEK(password, pwSalt);
    const kekRk = await deriveKEK(recoveryHex, rkSalt);

    const wrappedPw = await wrapBytes(kekPw, dek);
    const wrappedRk = await wrapBytes(kekRk, dek);

    const dekKey = await importDEK(dek, opts);
    return {
      // server-side state to persist
      state: {
        kdf_salt: bytesToB64(pwSalt),
        dek_wrapped: wrappedPw.ct,
        dek_iv: wrappedPw.iv,
        recovery_salt: bytesToB64(rkSalt),
        recovery_dek_wrapped: wrappedRk.ct,
        recovery_dek_iv: wrappedRk.iv,
      },
      // shown to user once, never sent to server again
      recoveryKey: recoveryHex,
      // live DEK key for the session
      dekKey,
    };
  }

  // ── High-level: open an existing crypto state with the user's password ─
  async function openWithPassword(password, state, opts) {
    const salt = b64ToBytes(state.kdf_salt);
    const kek = await deriveKEK(password, salt);
    const dekBytes = await unwrapBytes(kek, state.dek_iv, state.dek_wrapped);
    return importDEK(dekBytes, opts);
  }

  // ── High-level: open with recovery key (forgot-password flow) ──────
  async function openWithRecoveryKey(recoveryKeyHex, state, opts) {
    const salt = b64ToBytes(state.recovery_salt);
    const kek = await deriveKEK(recoveryKeyHex, salt);
    const dekBytes = await unwrapBytes(kek, state.recovery_dek_iv, state.recovery_dek_wrapped);
    return importDEK(dekBytes, opts);
  }

  // Public surface
  window.SpyglassCrypto = {
    deriveKEK,
    importDEK,
    wrapBytes,
    unwrapBytes,
    encryptBlob,
    decryptBlob,
    bootstrap,
    openWithPassword,
    openWithRecoveryKey,
    serializeDEK,
    deserializeDEK,
    // helpers exposed for tests / debugging
    _bytesToB64: bytesToB64,
    _b64ToBytes: b64ToBytes,
    _bytesToHex: bytesToHex,
    _hexToBytes: hexToBytes,
  };
})();
