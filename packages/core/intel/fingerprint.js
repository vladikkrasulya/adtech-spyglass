'use strict';

/**
 * Value shape fingerprinting — pure. Given a primitive or container, returns
 * a coarse descriptor that's safe to store: NEVER contains the actual value
 * for strings/URLs, just statistics and a character-class hint.
 *
 * This is the core of the privacy story: discovery records SHAPE, not VALUE.
 * "Field has a 32-char hex string" is recorded; the actual hex is not.
 *
 * Shape outputs (by type):
 *   - string  → { len, charClass, looksLikeUrl, looksLikeBase64 }
 *   - number  → { integer, sign, magnitude }    // magnitude is order-of-10
 *   - boolean → {}                              // no extras needed
 *   - array   → { length, elemTypes }           // elemTypes: sorted unique
 *   - object  → { keyCount, keys }              // keys: first 10 sorted
 *   - null    → null  (caller treats null as missing)
 *
 * `charClass` for strings is one of:
 *   - 'digits'        → /^\d+$/
 *   - 'alnum-lower'   → /^[a-z0-9]+$/
 *   - 'alnum-upper'   → /^[A-Z0-9]+$/
 *   - 'alnum-mixed'   → /^[a-zA-Z0-9]+$/
 *   - 'hex'           → /^[0-9a-fA-F]+$/
 *   - 'base64'        → /^[A-Za-z0-9+/=]+$/
 *   - 'url'           → starts with http(s)://
 *   - 'mixed'         → anything else
 *
 * Why coarse:
 *   The fingerprint is for clustering ("this field is always 64-char hex" vs
 *   "this field is a URL"), not for value reconstruction. A finer fingerprint
 *   would risk encoding identifying information.
 */

function classifyString(s) {
  if (s.length === 0) return 'empty';
  if (/^https?:\/\//i.test(s)) return 'url';
  if (/^\d+$/.test(s)) return 'digits';
  // Hex BEFORE alnum-* — pure-hex strings are also alnum-lower/upper, but
  // 'hex' is the more informative cluster (likely IDs / hashes).
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return 'hex';
  // Base64 requires AT LEAST ONE of '+', '/', '=' — otherwise every
  // alnum string would over-match into 'base64' and the cluster
  // becomes meaningless.
  if (/^[A-Za-z0-9+/=]+$/.test(s) && /[+/=]/.test(s) && s.length >= 8) return 'base64';
  if (/^[A-Z0-9]+$/.test(s)) return 'alnum-upper';
  if (/^[a-z0-9]+$/.test(s)) return 'alnum-lower';
  if (/^[a-zA-Z0-9]+$/.test(s)) return 'alnum-mixed';
  return 'mixed';
}

function fingerprintString(s) {
  return {
    len: s.length,
    charClass: classifyString(s),
  };
}

function fingerprintNumber(n) {
  if (!Number.isFinite(n)) return { integer: false, sign: 0, magnitude: 0 };
  const abs = Math.abs(n);
  return {
    integer: Number.isInteger(n),
    sign: n === 0 ? 0 : n > 0 ? 1 : -1,
    // log10 bucket: 0 → 0..1, 1 → 1..10, 2 → 10..100, …
    magnitude: abs === 0 ? 0 : Math.floor(Math.log10(abs)),
  };
}

function fingerprintArray(a) {
  const elemTypes = new Set();
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v === null) elemTypes.add('null');
    else if (Array.isArray(v)) elemTypes.add('array');
    else elemTypes.add(typeof v);
  }
  return {
    length: a.length,
    elemTypes: Array.from(elemTypes).sort(),
  };
}

function fingerprintObject(o) {
  const keys = Object.keys(o).sort();
  return {
    keyCount: keys.length,
    // Cap at 10 keys so bizarre wrappers (e.g. a flat object with 200
    // ad-IDs as keys) don't bloat the fingerprint.
    keys: keys.slice(0, 10),
  };
}

/**
 * Public dispatcher. Defensive — returns {} for unrecognised inputs so
 * callers can store the result without null checks.
 */
function fingerprintValue(v) {
  if (v == null) return null;
  const t = typeof v;
  if (t === 'string') return fingerprintString(v);
  if (t === 'number') return fingerprintNumber(v);
  if (t === 'boolean') return {};
  if (Array.isArray(v)) return fingerprintArray(v);
  if (t === 'object') return fingerprintObject(v);
  return {};
}

module.exports = { fingerprintValue, classifyString };
