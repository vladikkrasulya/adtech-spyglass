'use strict';

/**
 * raw-json.js — scanner for the defects that `JSON.parse` destroys.
 *
 * Every parse is a lossy projection. Two classes of defect are gone by the
 * time `JSON.parse` returns, so an inspector that works on the parsed object
 * cannot see them by construction — the evidence no longer exists:
 *
 *   1. Duplicate object keys. RFC 8259 §4 leaves the behaviour undefined;
 *      receivers variously keep the first, keep the last, keep all, or reject
 *      the document. ECMAScript keeps the last (§25.5.1, repeated
 *      CreateDataProperty). Measured:
 *
 *        bytes  {"id":"A","imp":[{"id":"1"}],"id":"B","bidfloor":1.5,"bidfloor":9.99}
 *        parse  id="B"  bidfloor=9.99          — Node and CPython alike, silently
 *
 *      `bidfloor` 1.5 against 9.99 is money. After the parse the ambiguity is
 *      not recoverable at all: the object holds one value and keeps no record
 *      that another one was on the wire.
 *
 *   2. Numeric tokens a binary64 double cannot hold. Measured:
 *
 *        9007199254740993     → 9007199254740992     — Node, silently
 *        1234567890123456789  → 1234567890123456800  — Node, silently
 *        both                 → unchanged            — CPython (arbitrary ints)
 *
 *      `Number.MAX_SAFE_INTEGER` is 9007199254740991. The same bytes therefore
 *      yield different IDs depending on the receiver's language, and that
 *      divergence IS the defect — invisible downstream, because the parsed
 *      value looks like a perfectly ordinary number.
 *
 * So this module never parses. It walks the original text and reports findings
 * with UTF-16 `[start, end)` offsets into that same text, so a caller can point
 * at the exact characters the operator pasted — never at a re-serialized copy.
 *
 * Pure and dependency-free: no I/O, no shared state between calls, no
 * `JSON.parse` anywhere in the scan. Malformed input is not an exception — the
 * walk stops where the text stops making sense and returns everything found up
 * to that point, alongside the error that stopped it.
 *
 * The tokenizer accepts a small superset of `JSON.parse` (raw control
 * characters inside strings are tolerated), matching source-map.js: a
 * raw-bytes inspector must never refuse a payload an exchange accepted.
 *
 * What "lossy" means for a number, precisely — this is the one judgement call
 * in the module. A binary64 holds almost no decimal fraction exactly: 9.99 is
 * really 9.9900000000000002131628…, and 1e300 is off by some 10^283. Reporting
 * that would flag every bidfloor in every payload and say nothing useful. What
 * makes receivers actually *disagree* is narrower: the token cannot be
 * reproduced from the parsed number. So a token is lossy when it differs from
 * `String(Number(token))` as an exact decimal value — 9.99 and 1e300 both come
 * back out spelled the way they went in, on every conforming implementation,
 * while 9007199254740993 does not. Integers past ±(2^53−1) that do survive are
 * still reported, under `unsafe-magnitude` with `lossy:false`: nothing was lost
 * here, but nothing downstream may touch them either.
 */

/**
 * @typedef {Object} ScanLimits
 * @property {number} maxFindings     max findings kept per category
 * @property {number} maxOccurrences  max recorded occurrences per duplicated key
 * @property {number} maxValueChars   max characters kept of each value preview
 * @property {number} maxDepth        max nesting depth before the walk gives up
 */

/**
 * @typedef {Object} KeyOccurrence
 * @property {string} raw            the key token exactly as written, quotes included
 * @property {boolean} escaped       the token used at least one backslash escape
 * @property {number} keyStart       offset of the key's opening quote
 * @property {number} keyEnd         offset just past the key's closing quote
 * @property {number} valueStart     offset of the value's first character
 * @property {number} valueEnd       offset just past the value's last character
 * @property {string} value          the value text, cut to `maxValueChars`
 * @property {boolean} valueTruncated `value` is shorter than the real value text
 * @property {number} line           1-based line of `keyStart`
 * @property {number} col            1-based column of `keyStart`
 */

/**
 * @typedef {Object} DuplicateKeyFinding
 * @property {'duplicate-key'} kind
 * @property {string} key             the decoded key name — what the receiver sees
 * @property {string} path            display path of the key ("imp[0].id")
 * @property {string} pointer         RFC 6901 pointer of the key ("/imp/0/id")
 * @property {string} container       display path of the object holding it ("imp[0]")
 * @property {number} count           total occurrences, including any not recorded
 * @property {KeyOccurrence[]} occurrences  in order of appearance, up to `maxOccurrences`
 * @property {boolean} occurrencesTruncated `occurrences` is shorter than `count`
 * @property {boolean} valuesDiffer   recorded occurrences do not all carry the same value text
 * @property {boolean} spellingsDiffer recorded key tokens are not byte-identical (escapes)
 */

/**
 * @typedef {Object} UnsafeNumberFinding
 * @property {'unsafe-number'} kind
 * @property {string} path       display path of the number ("imp[0].ext.auction_id")
 * @property {string} pointer    RFC 6901 pointer of the same
 * @property {string} raw        the numeric token exactly as written
 * @property {number} value      what `Number(raw)` yields — may be ±Infinity
 * @property {string} rendered   `String(value)` — the JSON-safe rendering of `value`
 * @property {string} reason     one of UNSAFE_REASONS.*
 * @property {boolean} lossy     `raw` cannot be reproduced from `value` — see the header
 * @property {number} start      offset of the token's first character
 * @property {number} end        offset just past its last character
 * @property {number} line       1-based line of `start`
 * @property {number} col        1-based column of `start`
 */

/**
 * @typedef {Object} RawScanResult
 * @property {boolean} ok        the text was walked to the end as one well-formed value
 * @property {{message:string,offset:number,line:number,col:number}|null} error
 * @property {DuplicateKeyFinding[]} duplicateKeys  in document order
 * @property {UnsafeNumberFinding[]} unsafeNumbers  in document order
 * @property {{duplicateKeys:boolean,unsafeNumbers:boolean}} truncated  a limit was hit
 */

/**
 * Why a numeric token is unsafe.
 *
 *   precision-loss   — the value changes: 9007199254740993 → …92. Lossy.
 *   overflow         — the magnitude does not fit a double at all: 1e309 → Infinity.
 *                      `JSON.stringify` then emits `null`. Lossy.
 *   underflow        — a non-zero value collapses to 0: 1e-999. Lossy.
 *   unsafe-magnitude — the value survives this parse exactly, but sits outside
 *                      ±(2^53−1), where neither arithmetic nor a re-encode is
 *                      reliable any more: 9007199254740992, 1e21. Advisory.
 */
const UNSAFE_REASONS = Object.freeze({
  PRECISION_LOSS: 'precision-loss',
  OVERFLOW: 'overflow',
  UNDERFLOW: 'underflow',
  UNSAFE_MAGNITUDE: 'unsafe-magnitude',
});

/** @type {ScanLimits} */
const DEFAULT_LIMITS = Object.freeze({
  maxFindings: 1000,
  maxOccurrences: 50,
  maxValueChars: 120,
  maxDepth: 512,
});

// The display-path grammar the rest of core speaks (finding-location.js):
// ident = [A-Za-z_][A-Za-z0-9_-]* . Anything else gets bracket-quoted, because
// `ext.a.b` would be a lie about a key literally named "a.b".
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const HEX4_RE = /^[0-9a-fA-F]{4}$/;

/** @param {number} code @returns {boolean} */
function isDigit(code) {
  return code >= 0x30 && code <= 0x39;
}

/**
 * Canonical exact form of a decimal literal: value = ±digits × 10^exp, with
 * `digits` carrying neither leading nor trailing zeros. Normalized this way the
 * triple is unique, so two literals denote the same number exactly when their
 * triples match — no floating point, no big-integer arithmetic needed.
 *
 * @param {string} text
 * @returns {{neg:boolean, digits:string, exp:number}|null} null if `text` is not a decimal literal
 */
function decimalParts(text) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) return null;
  const intPart = m[2] || '';
  const fracPart = m[3] || '';
  if (!intPart && !fracPart) return null;

  let digits = intPart + fracPart;
  let exp = (m[4] ? Number(m[4]) : 0) - fracPart.length;
  if (!Number.isFinite(exp)) return null; // exponent field too large to reason about

  let lead = 0;
  while (lead < digits.length - 1 && digits.charCodeAt(lead) === 0x30) lead++;
  digits = digits.slice(lead);

  let end = digits.length;
  while (end > 1 && digits.charCodeAt(end - 1) === 0x30) {
    end--;
    exp++;
  }
  digits = digits.slice(0, end);

  if (digits === '0') return { neg: false, digits: '0', exp: 0 }; // −0 and 0 are one value here
  return { neg: m[1] === '-', digits, exp };
}

/**
 * Exact equality of two decimal literals — no doubles involved, so it can judge
 * a double's own rendering against the token it came from.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean|null} null when either side is not a decimal literal at all
 */
function decimalEquals(a, b) {
  const pa = decimalParts(a);
  const pb = decimalParts(b);
  if (!pa || !pb) return null;
  return pa.neg === pb.neg && pa.exp === pb.exp && pa.digits === pb.digits;
}

/**
 * Cheap rejection for tokens that cannot possibly lose anything: at most 15
 * plain digits is under 10^15, comfortably inside ±(2^53−1). Keeps the hot loop
 * off `Number()`/`String()` for the overwhelming majority of real payloads.
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isShortPlainInteger(raw) {
  let k = raw.charCodeAt(0) === 0x2d ? 1 : 0;
  if (raw.length - k < 1 || raw.length - k > 15) return false;
  for (; k < raw.length; k++) {
    if (!isDigit(raw.charCodeAt(k))) return false;
  }
  return true;
}

/**
 * Classify one numeric token against binary64.
 *
 * @param {string} raw
 * @returns {{reason:string, lossy:boolean, value:number, rendered:string}|null} null when the token is safe
 */
function classifyNumberToken(raw) {
  if (isShortPlainInteger(raw)) return null;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { reason: UNSAFE_REASONS.OVERFLOW, lossy: true, value, rendered: String(value) };
  }

  // `String(n)` is the shortest decimal that round-trips back to `n`, so it is
  // exactly what a re-encoder would emit. If it denotes a different number than
  // the token did, the wire value did not survive the parse.
  const rendered = String(value);
  if (rendered !== raw && decimalEquals(raw, rendered) !== true) {
    const reason = value === 0 ? UNSAFE_REASONS.UNDERFLOW : UNSAFE_REASONS.PRECISION_LOSS;
    return { reason, lossy: true, value, rendered };
  }

  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return { reason: UNSAFE_REASONS.UNSAFE_MAGNITUDE, lossy: false, value, rendered };
  }
  return null;
}

/** @param {Array<string|number>} segments @returns {string} */
function displayPath(segments) {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += '[' + seg + ']';
    else if (IDENT_RE.test(seg)) out += out === '' ? seg : '.' + seg;
    // Not display grammar — quote it so the path stays honest. `pointer` is the
    // field to address the node with; this one is for a human to read.
    else out += '[' + JSON.stringify(seg) + ']';
  }
  return out;
}

/** RFC 6901 §3 — '~' → '~0', '/' → '~1'. @param {Array<string|number>} segments @returns {string} */
function pointerPath(segments) {
  let out = '';
  for (const seg of segments) {
    out +=
      '/' + (typeof seg === 'number' ? String(seg) : seg.replace(/~/g, '~0').replace(/\//g, '~1'));
  }
  return out;
}

/** @param {unknown} value @param {number} fallback @returns {number} */
function limitOption(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Walk `text` as JSON without parsing it, collecting duplicate keys and numeric
 * tokens a double cannot hold.
 *
 * Never throws. Non-string input, empty input and malformed input all come back
 * as `ok:false` with whatever the walk managed to collect first.
 *
 * @param {string} text  the exact bytes the operator pasted
 * @param {Partial<ScanLimits>} [options]
 * @returns {RawScanResult}
 */
function scanRawJson(text, options) {
  const opts = options || {};
  const maxFindings = limitOption(opts.maxFindings, DEFAULT_LIMITS.maxFindings);
  const maxOccurrences = Math.max(
    2,
    limitOption(opts.maxOccurrences, DEFAULT_LIMITS.maxOccurrences),
  );
  const maxValueChars = limitOption(opts.maxValueChars, DEFAULT_LIMITS.maxValueChars);
  const maxDepth = Math.max(1, limitOption(opts.maxDepth, DEFAULT_LIMITS.maxDepth));

  const src = typeof text === 'string' ? text : '';
  const n = src.length;

  /** @type {DuplicateKeyFinding[]} */
  const duplicateKeys = [];
  /** @type {UnsafeNumberFinding[]} */
  const unsafeNumbers = [];
  const truncated = { duplicateKeys: false, unsafeNumbers: false };
  /** @type {Array<string|number>} */
  const stack = [];
  // Objects currently being walked, outermost first. A truncated paste — by far
  // the most common malformed input — leaves every enclosing object unclosed,
  // and reporting only on a clean close would throw away everything we found.
  /** @type {Array<{seen: Map<string, RecordedKey>, depth: number}>} */
  const openObjects = [];

  let i = 0;
  let depth = 0;

  // ── position bookkeeping ──────────────────────────────────────────────────

  /** @type {number[]|null} */
  let lineStarts = null;
  /** @param {number} offset @returns {{line:number,col:number}} */
  function positionAt(offset) {
    if (!lineStarts) {
      lineStarts = [0];
      for (let k = 0; k < n; k++) if (src.charCodeAt(k) === 0x0a) lineStarts.push(k + 1);
    }
    const starts = lineStarts;
    if (offset < 0) offset = 0;
    if (offset > n) offset = n;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - starts[lo] + 1 };
  }

  /** @param {string} message @param {number} at @returns {never} */
  function fail(message, at) {
    throw Object.assign(new Error(message), { rawJsonOffset: at });
  }

  // ── tokenizer ─────────────────────────────────────────────────────────────

  function skipWs() {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  }

  /**
   * Scan a string starting at its opening quote. Decoding is opt-in because
   * only keys need their value — skipping the string body keeps large payloads
   * cheap.
   *
   * @param {boolean} decode
   * @returns {{start:number, end:number, value:string, escaped:boolean}}
   */
  function scanString(decode) {
    const start = i;
    i++; // opening quote
    let out = '';
    let chunk = i;
    let escaped = false;

    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 0x22) {
        if (decode) out += src.slice(chunk, i);
        i++;
        return { start, end: i, value: out, escaped };
      }
      if (c !== 0x5c) {
        i++;
        continue;
      }

      escaped = true;
      if (decode) out += src.slice(chunk, i);
      const at = i;
      i++;
      if (i >= n) fail('unterminated escape sequence', at);
      const e = src[i];
      switch (e) {
        case '"':
        case '\\':
        case '/':
          if (decode) out += e;
          i++;
          break;
        case 'b':
          if (decode) out += '\b';
          i++;
          break;
        case 'f':
          if (decode) out += '\f';
          i++;
          break;
        case 'n':
          if (decode) out += '\n';
          i++;
          break;
        case 'r':
          if (decode) out += '\r';
          i++;
          break;
        case 't':
          if (decode) out += '\t';
          i++;
          break;
        case 'u': {
          const hex = src.slice(i + 1, i + 5);
          if (!HEX4_RE.test(hex)) fail('invalid \\u escape', at);
          // Per code unit, so a surrogate pair written as two escapes decodes to
          // the same two units as the literal character would.
          if (decode) out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          break;
        }
        default:
          fail('invalid escape sequence \\' + e, at);
      }
      chunk = i;
    }
    return fail('unterminated string', start);
  }

  /** @returns {{start:number, end:number}} */
  function scanNumber() {
    const start = i;
    if (src[i] === '-') i++;
    if (src[i] === '0') i++;
    else if (isDigit(src.charCodeAt(i))) while (i < n && isDigit(src.charCodeAt(i))) i++;
    else fail('expected a digit', i);

    if (src[i] === '.') {
      i++;
      if (!isDigit(src.charCodeAt(i))) fail('expected a digit after "."', i);
      while (i < n && isDigit(src.charCodeAt(i))) i++;
    }
    if (src[i] === 'e' || src[i] === 'E') {
      i++;
      if (src[i] === '+' || src[i] === '-') i++;
      if (!isDigit(src.charCodeAt(i))) fail('expected a digit in the exponent', i);
      while (i < n && isDigit(src.charCodeAt(i))) i++;
    }

    const end = i;
    const raw = src.slice(start, end);
    const verdict = classifyNumberToken(raw);
    if (verdict) {
      if (unsafeNumbers.length >= maxFindings) truncated.unsafeNumbers = true;
      else {
        unsafeNumbers.push({
          kind: 'unsafe-number',
          path: displayPath(stack),
          pointer: pointerPath(stack),
          raw,
          value: verdict.value,
          rendered: verdict.rendered,
          reason: verdict.reason,
          lossy: verdict.lossy,
          start,
          end,
          ...positionAt(start),
        });
      }
    }
    return { start, end };
  }

  /** @param {string} word @returns {{start:number, end:number}} */
  function scanLiteral(word) {
    const start = i;
    if (!src.startsWith(word, i)) fail('unexpected token', i);
    i += word.length;
    return { start, end: i };
  }

  /** @returns {{start:number, end:number}} */
  function scanArray() {
    const start = i;
    i++; // '['
    skipWs();
    if (src[i] === ']') {
      i++;
      return { start, end: i };
    }
    let index = 0;
    for (;;) {
      skipWs();
      stack.push(index);
      scanValue();
      stack.pop();
      skipWs();
      if (src[i] === ',') {
        i++;
        index++;
        continue;
      }
      if (src[i] === ']') {
        i++;
        return { start, end: i };
      }
      return fail('expected "," or "]"', i);
    }
  }

  /**
   * @typedef {Object} RecordedKey
   * @property {number} count
   * @property {Array<{keyStart:number,keyEnd:number,valueStart:number,valueEnd:number,escaped:boolean}>} kept
   */

  /** @returns {{start:number, end:number}} */
  function scanObject() {
    const start = i;
    i++; // '{'
    /** @type {Map<string, RecordedKey>} */
    const seen = new Map();
    const frame = { seen, depth: stack.length };
    openObjects.push(frame);

    skipWs();
    if (src[i] === '}') {
      i++;
      openObjects.pop();
      return { start, end: i };
    }

    for (;;) {
      skipWs();
      if (src[i] !== '"') fail('expected a key string', i);
      const key = scanString(true);
      skipWs();
      if (src[i] !== ':') fail('expected ":" after a key', i);
      i++;
      skipWs();

      // A Map, not a plain object: "__proto__" is a perfectly legal JSON key and
      // an object literal would swallow it instead of counting it.
      let record = seen.get(key.value);
      if (!record) {
        record = { count: 0, kept: [] };
        seen.set(key.value, record);
      }
      // Counted before the value is walked, so a paste that was cut off inside
      // the last value still reports the duplicate key that precedes it.
      // `valueEnd: -1` means "still unknown"; reportDuplicates resolves it to
      // however far the scan got.
      record.count++;
      /** @type {{keyStart:number,keyEnd:number,valueStart:number,valueEnd:number,escaped:boolean}|null} */
      let occurrence = null;
      if (record.kept.length < maxOccurrences) {
        occurrence = {
          keyStart: key.start,
          keyEnd: key.end,
          valueStart: i,
          valueEnd: -1,
          escaped: key.escaped,
        };
        record.kept.push(occurrence);
      }

      stack.push(key.value);
      const value = scanValue();
      stack.pop();
      if (occurrence) {
        occurrence.valueStart = value.start;
        occurrence.valueEnd = value.end;
      }

      skipWs();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') {
        i++;
        break;
      }
      fail('expected "," or "}"', i);
    }

    openObjects.pop();
    reportDuplicates(seen, stack);
    return { start, end: i };
  }

  /**
   * Emitted on the way out of an object — or, for an object the input never
   * closed, from the error handler with that object's own path replayed.
   *
   * @param {Map<string, RecordedKey>} seen
   * @param {Array<string|number>} segments  path of the object itself
   */
  function reportDuplicates(seen, segments) {
    const container = displayPath(segments);
    for (const [key, record] of seen) {
      if (record.count < 2) continue;
      if (duplicateKeys.length >= maxFindings) {
        truncated.duplicateKeys = true;
        return;
      }
      const keyPath = segments.concat([key]);
      const path = displayPath(keyPath);
      const pointer = pointerPath(keyPath);

      /** @type {KeyOccurrence[]} */
      const occurrences = record.kept.map((occ) => {
        // A value the input cut short ends wherever the scan stopped.
        const valueEnd = occ.valueEnd < 0 ? Math.min(i, n) : occ.valueEnd;
        const cut = occ.valueStart + maxValueChars;
        return {
          raw: src.slice(occ.keyStart, occ.keyEnd),
          escaped: occ.escaped,
          keyStart: occ.keyStart,
          keyEnd: occ.keyEnd,
          valueStart: occ.valueStart,
          valueEnd,
          value: src.slice(occ.valueStart, valueEnd > cut ? cut : valueEnd),
          valueTruncated: valueEnd > cut,
          ...positionAt(occ.keyStart),
        };
      });

      // Compared as text across the recorded occurrences: different bytes are
      // what makes receivers diverge, and normalizing them away would hide the
      // very thing this module exists to show.
      const spellings = new Set(occurrences.map((occ) => occ.raw));
      const values = new Set(occurrences.map((occ) => src.slice(occ.valueStart, occ.valueEnd)));

      duplicateKeys.push({
        kind: 'duplicate-key',
        key,
        path,
        pointer,
        container,
        count: record.count,
        occurrences,
        occurrencesTruncated: record.count > occurrences.length,
        valuesDiffer: values.size > 1,
        spellingsDiffer: spellings.size > 1,
      });
    }
  }

  /** @returns {{start:number, end:number}} */
  function scanValue() {
    if (++depth > maxDepth) fail('maximum nesting depth exceeded', i);
    try {
      const c = src[i];
      if (c === '{') return scanObject();
      if (c === '[') return scanArray();
      if (c === '"') {
        const s = scanString(false);
        return { start: s.start, end: s.end };
      }
      if (c === '-' || (c >= '0' && c <= '9')) return scanNumber();
      if (c === 't') return scanLiteral('true');
      if (c === 'f') return scanLiteral('false');
      if (c === 'n') return scanLiteral('null');
      return fail(i >= n ? 'unexpected end of input' : 'unexpected token', i);
    } finally {
      depth--;
    }
  }

  // ── run ───────────────────────────────────────────────────────────────────

  /** @type {{message:string,offset:number,line:number,col:number}|null} */
  let error = null;
  try {
    if (typeof text !== 'string') fail('input is not a string', 0);
    if (n === 0) fail('empty input', 0);
    if (src.charCodeAt(0) === 0xfeff) i = 1; // pasted payloads often carry a BOM
    skipWs();
    if (i >= n) fail('no JSON value found', i);
    scanValue();
    skipWs();
    if (i < n) fail('unexpected trailing content', i);
  } catch (e) {
    const at = e && typeof e.rawJsonOffset === 'number' ? e.rawJsonOffset : Math.min(i, n);
    const message =
      e && typeof e.rawJsonOffset === 'number'
        ? String(e.message)
        : 'internal scan error: ' + String(e && e.message);
    error = { message, offset: at, ...positionAt(at) };
    // Whatever the unwind skipped: report the objects the input left open.
    for (let k = openObjects.length - 1; k >= 0; k--) {
      const frame = openObjects[k];
      reportDuplicates(frame.seen, stack.slice(0, frame.depth));
    }
  }

  // Objects report on the way out, so nested findings arrive before their
  // parents. Callers highlight text — give them document order.
  duplicateKeys.sort((a, b) => a.occurrences[0].keyStart - b.occurrences[0].keyStart);

  return { ok: error === null, error, duplicateKeys, unsafeNumbers, truncated };
}

/**
 * @param {string} text
 * @param {Partial<ScanLimits>} [options]
 * @returns {DuplicateKeyFinding[]}
 */
function findDuplicateKeys(text, options) {
  return scanRawJson(text, options).duplicateKeys;
}

/**
 * @param {string} text
 * @param {Partial<ScanLimits>} [options]
 * @returns {UnsafeNumberFinding[]}
 */
function findUnsafeNumbers(text, options) {
  return scanRawJson(text, options).unsafeNumbers;
}

module.exports = {
  scanRawJson,
  findDuplicateKeys,
  findUnsafeNumbers,
  UNSAFE_REASONS,
  DEFAULT_LIMITS,
};
