'use strict';

/**
 * Raw-byte JSON scanner.
 *
 * `JSON.parse` is a lossy projection. Two things it destroys without a word:
 *
 *   duplicate keys   {"bidfloor":1.5, … ,"bidfloor":9.99}
 *                    → Node and Python both keep 9.99, silently. RFC 8259 §4
 *                      does not define the behaviour, so a receiver that keeps
 *                      the FIRST value is equally conformant. On `bidfloor`
 *                      that difference is money.
 *
 *   large integers   9007199254740993 → 9007199254740992
 *                    1234567890123456789 → 1234567890123456800
 *                    → Node, silently. Python reads both exactly. The same
 *                      bytes become different ids depending on who reads them.
 *
 * Neither is recoverable after parsing — by the time you hold the object, the
 * duplicate is gone and the integer is already rounded. So this module reads
 * the source text directly and reports what the parse *would* discard. It is a
 * scanner, not a parser: it returns observations, never a value to use.
 *
 * Scope, deliberately narrow:
 *   - Integer precision is decided by comparing BigInt(token) against
 *     BigInt(Number(token)) — exact, not a heuristic. `9007199254740992` is
 *     above MAX_SAFE_INTEGER yet reads back exactly, so it is reported as a
 *     magnitude hazard and NOT as damage. Claiming corruption where none
 *     happened would be its own silent lie.
 *   - Floats are out of scope. `1.50` → `1.5` is cosmetic, and separating
 *     cosmetic from lossy in decimal fractions needs more than a token scan.
 *     Integers are where identifiers and bid prices live.
 *
 * Tolerant by design: a structural error stops the scan and is reported in
 * `error`, but everything found before it is still returned. Input that fails
 * to parse is exactly when an operator most needs to see what was in there.
 */

/** Node's exact-integer ceiling: 2^53 − 1. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const WS = new Set([' ', '\t', '\n', '\r']);

/** RFC 6901 §3: `~` → `~0`, `/` → `~1`, in that order. */
function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * @typedef {Object} DuplicateKey
 * @property {string} pointer      RFC 6901 pointer to the key.
 * @property {string} key          Key name, after unescaping.
 * @property {Array<{ offset: number, raw: string }>} occurrences
 *           Every occurrence in source order, with the raw source text of each
 *           value. `JSON.parse` keeps the last; a conformant peer may keep the
 *           first, which is why all of them are returned rather than the pair.
 */

/**
 * @typedef {Object} UnsafeInteger
 * @property {string} pointer  RFC 6901 pointer to the number.
 * @property {string} raw      The integer literal exactly as written.
 * @property {string} parsed   What `Number()` makes of it, as a string.
 * @property {boolean} lossy   True when `parsed` is a different integer than
 *                             `raw` — i.e. the value did not survive the read.
 */

/**
 * @typedef {Object} RawJsonScan
 * @property {boolean} ok
 * @property {{ message: string, offset: number }|null} error
 * @property {Array<DuplicateKey>} duplicateKeys
 * @property {Array<UnsafeInteger>} unsafeIntegers
 */

/**
 * Scan JSON source text for what parsing would silently discard.
 *
 * @param {string} text  JSON source, exactly as received.
 * @returns {RawJsonScan}
 */
function scanRawJson(text) {
  /** @type {RawJsonScan} */
  const out = { ok: true, error: null, duplicateKeys: [], unsafeIntegers: [] };

  if (typeof text !== 'string') {
    out.ok = false;
    out.error = { message: 'input is not a string', offset: 0 };
    return out;
  }

  let i = 0;
  const n = text.length;

  function err(message) {
    const e = /** @type {Error & { offset?: number }} */ (new Error(message));
    e.offset = i; // rides along so the caller can point at the failure
    return e;
  }

  function skipWs() {
    while (i < n && WS.has(text[i])) i++;
  }

  function expect(ch) {
    if (text[i] !== ch) throw err(`expected ${JSON.stringify(ch)}`);
    i++;
  }

  /**
   * Read a string token, returning its unescaped value.
   *
   * Unescaping is what makes key comparison correct: `"id"` and `"id"`
   * are the same key on the wire, and a duplicate written that way is exactly
   * the one a byte-for-byte comparison would miss.
   *
   * @returns {string}
   */
  function readString() {
    expect('"');
    let value = '';
    while (i < n) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return value;
      }
      if (ch === '\\') {
        i++;
        const esc = text[i];
        if (esc === undefined) throw err('unterminated escape');
        i++;
        if (esc === 'u') {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw err('bad \\u escape');
          value += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          /** @type {Object<string, string>} */
          const simple = {
            '"': '"',
            '\\': '\\',
            '/': '/',
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
          };
          if (!(esc in simple)) throw err(`bad escape \\${esc}`);
          value += simple[esc];
        }
        continue;
      }
      value += ch;
      i++;
    }
    throw err('unterminated string');
  }

  /**
   * Read a number token and record it when its magnitude puts it outside the
   * range Node reads exactly.
   *
   * @param {string} pointer
   */
  function readNumber(pointer) {
    const start = i;
    if (text[i] === '-') i++;
    while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    let isInteger = true;
    if (text[i] === '.') {
      isInteger = false;
      i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      isInteger = false;
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    }
    const raw = text.slice(start, i);
    if (raw === '' || raw === '-') throw err('invalid number');
    if (!isInteger) return;

    // Magnitude check first: inside the safe range there is nothing to say.
    const asNumber = Number(raw);
    if (Math.abs(asNumber) <= MAX_SAFE) return;

    // Enough digits and the value does not merely lose precision, it stops
    // being a number at all. Report the overflow rather than crashing BigInt
    // on `Infinity`.
    if (!Number.isFinite(asNumber)) {
      out.unsafeIntegers.push({ pointer, raw, parsed: String(asNumber), lossy: true });
      return;
    }

    // BigInt on both sides decides precision exactly. `9007199254740992` is
    // outside the safe range and still round-trips; saying it was damaged
    // would be a false alarm, so `lossy` carries the distinction.
    const written = BigInt(raw);
    const readBack = BigInt(asNumber);
    out.unsafeIntegers.push({
      pointer,
      raw,
      parsed: readBack.toString(),
      lossy: written !== readBack,
    });
  }

  function readLiteral() {
    for (const lit of ['true', 'false', 'null']) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return;
      }
    }
    throw err('unexpected token');
  }

  /**
   * @param {string} pointer  Pointer of the object itself.
   */
  function readObject(pointer) {
    expect('{');
    /**
     * First offset seen per key, plus every occurrence. Keyed by the unescaped
     * name, so escape-equivalent spellings collide the way they do on the wire.
     * @type {Map<string, Array<{ offset: number, raw: string }>>}
     */
    const seen = new Map();
    skipWs();
    if (text[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      skipWs();
      const keyOffset = i;
      const key = readString();
      skipWs();
      expect(':');
      skipWs();
      const valueStart = i;
      readValue(pointer + '/' + escapePointerToken(key));
      const rawValue = text.slice(valueStart, i);

      const prior = seen.get(key);
      if (prior) prior.push({ offset: keyOffset, raw: rawValue });
      else seen.set(key, [{ offset: keyOffset, raw: rawValue }]);

      skipWs();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        break;
      }
      throw err('expected "," or "}"');
    }

    for (const [key, occurrences] of seen) {
      if (occurrences.length > 1) {
        out.duplicateKeys.push({
          pointer: pointer + '/' + escapePointerToken(key),
          key,
          occurrences,
        });
      }
    }
  }

  /**
   * @param {string} pointer  Pointer of the array itself.
   */
  function readArray(pointer) {
    expect('[');
    skipWs();
    if (text[i] === ']') {
      i++;
      return;
    }
    let idx = 0;
    for (;;) {
      skipWs();
      readValue(pointer + '/' + idx);
      idx++;
      skipWs();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        break;
      }
      throw err('expected "," or "]"');
    }
  }

  /**
   * @param {string} pointer
   */
  function readValue(pointer) {
    skipWs();
    const ch = text[i];
    if (ch === undefined) throw err('unexpected end of input');
    if (ch === '{') return readObject(pointer);
    if (ch === '[') return readArray(pointer);
    if (ch === '"') {
      readString();
      return;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) return readNumber(pointer);
    return readLiteral();
  }

  try {
    skipWs();
    readValue('');
    skipWs();
    if (i < n) throw err('trailing content after the top-level value');
  } catch (e) {
    out.ok = false;
    out.error = {
      message: String((e && e.message) || e),
      offset: typeof (e && e.offset) === 'number' ? e.offset : i,
    };
  }

  return out;
}

module.exports = { scanRawJson, MAX_SAFE };
