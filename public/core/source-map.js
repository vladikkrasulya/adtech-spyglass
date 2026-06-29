/**
 * source-map.js — dependency-free JSON source mapper.
 *
 * Maps the EXACT original JSON text to RFC 6901 JSON-Pointer addressed
 * key/value/node ranges so a finding's path can be highlighted at its true
 * position in what the user actually pasted — never against a re-serialized
 * copy. All ranges are UTF-16 `[start, end)` half-open offsets into the input
 * string (so they drop straight into `String.prototype.slice` /
 * `setSelectionRange`); astral characters count as their two UTF-16 units.
 *
 * Pure + isomorphic: this single canonical source runs unchanged in Node
 * (`module.exports`) and the browser (`window.SpyglassSourceMap`). It has NO
 * dependencies and performs NO I/O, DOM, or network access. (Stage-1 CP2:
 * the browser overlay is not wired yet; this module is the shared core.)
 *
 * Tokenizer accepts a superset of `JSON.parse` (it tolerates raw control
 * characters inside strings) so it never refuses a payload the server
 * accepted; structurally invalid input yields `{ ok:false, error }` rather
 * than throwing — the caller degrades to a disabled jump.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpyglassSourceMap = factory();
})(globalThis, function () {
  'use strict';

  /**
   * @typedef {Object} SourceEntry
   * @property {string} pointer            RFC 6901 pointer ('' = whole document)
   * @property {number|null} keyStart      UTF-16 offset of the key's opening quote (null for array elems / root)
   * @property {number|null} keyEnd        UTF-16 offset just past the key's closing quote
   * @property {number} valueStart         UTF-16 offset of the value's first char
   * @property {number} valueEnd           UTF-16 offset just past the value's last char
   */

  /** RFC 6901 §3 — escape a reference token: '~'->'~0', '/'->'~1'. */
  function escapeToken(key) {
    return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
  }
  /** RFC 6901 §4 — unescape a reference token: '~1'->'/', '~0'->'~'. */
  function unescapeToken(token) {
    return String(token).replace(/~1/g, '/').replace(/~0/g, '~');
  }

  /**
   * Build a full pointer→range index for `text`.
   * @param {string} text
   * @returns {{ ok: boolean, error: ({message:string,offset:number,line:number,col:number}|null), index: Map<string, SourceEntry>, positionAt: (o:number)=>{line:number,col:number}, resolve: (p:string)=>(SourceEntry|null), length:number }}
   */
  function buildSourceMap(text) {
    text = typeof text === 'string' ? text : '';
    const n = text.length;
    /** @type {Map<string, SourceEntry>} */
    const index = new Map();

    // Lazy line-start table for positionAt(); computed once on first use.
    /** @type {number[]|null} */
    let lineStarts = null;
    function ensureLines() {
      if (lineStarts) return;
      lineStarts = [0];
      for (let k = 0; k < n; k++) if (text.charCodeAt(k) === 0x0a) lineStarts.push(k + 1);
    }
    /** @param {number} offset @returns {{line:number,col:number}} */
    function positionAt(offset) {
      ensureLines();
      const ls = /** @type {number[]} */ (lineStarts);
      if (offset < 0) offset = 0;
      if (offset > n) offset = n;
      // binary search for the greatest line start <= offset
      let lo = 0;
      let hi = ls.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ls[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, col: offset - ls[lo] + 1 };
    }

    let i = 0;
    if (n && text.charCodeAt(0) === 0xfeff) i = 1; // skip BOM

    /** @param {string} msg @param {number} at @returns {never} */
    function fail(msg, at) {
      throw Object.assign(new Error(msg), { offset: at });
    }
    function skipWs() {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
        else break;
      }
    }

    /** Parse a string starting at the opening quote. @returns {{start:number,end:number,value:string}} */
    function parseString() {
      const start = i;
      i++; // opening quote
      let out = '';
      while (i < n) {
        const ch = text[i];
        if (ch === '"') {
          i++;
          return { start: start, end: i, value: out };
        }
        if (ch === '\\') {
          i++;
          if (i >= n) fail('unterminated escape', start);
          const e = text[i];
          if (e === '"') out += '"';
          else if (e === '\\') out += '\\';
          else if (e === '/') out += '/';
          else if (e === 'b') out += '\b';
          else if (e === 'f') out += '\f';
          else if (e === 'n') out += '\n';
          else if (e === 'r') out += '\r';
          else if (e === 't') out += '\t';
          else if (e === 'u') {
            const hex = text.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid \\u escape', i - 1);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else fail('invalid string escape', i - 1);
          i++;
        } else {
          // Lenient: accept raw chars (incl. control) so we never reject a
          // payload the server's JSON.parse may have been fed loosely.
          out += ch;
          i++;
        }
      }
      return fail('unterminated string', start);
    }

    const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

    /** @param {string} pointer @returns {SourceEntry} */
    function ent(pointer) {
      let e = index.get(pointer);
      if (!e) {
        e = { pointer: pointer, keyStart: null, keyEnd: null, valueStart: 0, valueEnd: 0 };
        index.set(pointer, e);
      }
      return e;
    }

    /** @param {string} pointer */
    function parseValue(pointer) {
      skipWs();
      if (i >= n) fail('unexpected end of input', i);
      const c = text[i];
      const valueStart = i;
      if (c === '{') {
        i++;
        skipWs();
        if (text[i] === '}') {
          i++;
        } else {
          for (;;) {
            skipWs();
            if (text[i] !== '"') fail('expected object key', i);
            const k = parseString();
            skipWs();
            if (text[i] !== ':') fail("expected ':'", i);
            i++;
            const childPtr = pointer + '/' + escapeToken(k.value);
            parseValue(childPtr);
            const ce = ent(childPtr); // last duplicate key wins (JSON.parse semantics)
            ce.keyStart = k.start;
            ce.keyEnd = k.end;
            skipWs();
            const d = text[i];
            if (d === ',') {
              i++;
              continue;
            }
            if (d === '}') {
              i++;
              break;
            }
            fail("expected ',' or '}'", i);
          }
        }
      } else if (c === '[') {
        i++;
        skipWs();
        if (text[i] === ']') {
          i++;
        } else {
          let idx = 0;
          for (;;) {
            parseValue(pointer + '/' + idx);
            idx++;
            skipWs();
            const d = text[i];
            if (d === ',') {
              i++;
              continue;
            }
            if (d === ']') {
              i++;
              break;
            }
            fail("expected ',' or ']'", i);
          }
        }
      } else if (c === '"') {
        parseString();
      } else if (text.startsWith('true', i)) {
        i += 4;
      } else if (text.startsWith('false', i)) {
        i += 5;
      } else if (text.startsWith('null', i)) {
        i += 4;
      } else {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(text);
        if (!m || m.index !== i) fail('unexpected token', i);
        i += m[0].length;
      }
      const e = ent(pointer);
      e.valueStart = valueStart;
      e.valueEnd = i;
      return e;
    }

    try {
      skipWs();
      parseValue('');
      skipWs();
      if (i < n) fail('trailing characters after JSON value', i);
    } catch (err) {
      const at = typeof (err && err.offset) === 'number' ? err.offset : i;
      const pos = positionAt(at);
      return {
        ok: false,
        error: {
          message: (err && err.message) || 'parse error',
          offset: at,
          line: pos.line,
          col: pos.col,
        },
        index: index,
        positionAt: positionAt,
        resolve: function () {
          return null;
        },
        length: n,
      };
    }

    /** @param {string} pointer @returns {SourceEntry|null} */
    function resolve(pointer) {
      if (typeof pointer !== 'string') return null;
      return index.get(pointer) || null;
    }

    return {
      ok: true,
      error: null,
      index: index,
      positionAt: positionAt,
      resolve: resolve,
      length: n,
    };
  }

  /**
   * Exact query-parameter locator for URL-style requests. Works on the RAW
   * URL text (what the user pasted) and returns UTF-16 ranges — never a fuzzy
   * substring jump. Parses `?a=b&c=d` deterministically; keys are percent-
   * decoded for comparison but ranges stay in the raw text. Returns the FIRST
   * match (stable) or null if the param is absent.
   * @param {string} rawUrl
   * @param {string} key  raw query-parameter name to find
   * @returns {{ keyStart:number, keyEnd:number, valStart:number, valEnd:number }|null}
   */
  function locateUrlParam(rawUrl, key) {
    if (typeof rawUrl !== 'string' || typeof key !== 'string' || !key) return null;
    const q = rawUrl.indexOf('?');
    const from = q < 0 ? 0 : q + 1;
    // stop the query at the first '#' (fragment) if present
    let end = rawUrl.indexOf('#', from);
    if (end < 0) end = rawUrl.length;
    let i = from;
    while (i < end) {
      let amp = rawUrl.indexOf('&', i);
      if (amp < 0 || amp > end) amp = end;
      const eq = rawUrl.indexOf('=', i);
      const keyStart = i;
      const keyEnd = eq >= 0 && eq < amp ? eq : amp;
      const valStart = eq >= 0 && eq < amp ? eq + 1 : amp;
      const valEnd = amp;
      const rawKey = rawUrl.slice(keyStart, keyEnd);
      let decoded = rawKey;
      try {
        decoded = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch (_e) {
        /* malformed %xx — fall back to the raw key */
      }
      if (decoded === key || rawKey === key) {
        return { keyStart: keyStart, keyEnd: keyEnd, valStart: valStart, valEnd: valEnd };
      }
      i = amp + 1;
    }
    return null;
  }

  return {
    buildSourceMap: buildSourceMap,
    locateUrlParam: locateUrlParam,
    escapeToken: escapeToken,
    unescapeToken: unescapeToken,
  };
});
