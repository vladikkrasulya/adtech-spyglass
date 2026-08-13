/**
 * vast-shape.js — the two VAST sniffing helpers, and nothing else.
 *
 * They used to live in format-detect.js, and still reach every existing caller
 * from there: `format-detect` requires this file and re-exports both names, so
 * there is still exactly ONE anchored definition of "is this string a VAST
 * tag", which is the whole reason they were centralised in the first place.
 *
 * They live in their own file because the browser needs them. The VAST timeline
 * extractor runs in the page, and `format-detect.js` pulls in
 * `non-iab-formats.js` — together 600+ lines of pop/push heuristics that a
 * timeline view has no use for. Mirroring all of that to get two five-line
 * functions would be paying a lot to ship code nobody calls.
 *
 * ── WHY THIS IS A SCANNER AND NOT A REGEX ──────────────────────────────────
 * Both helpers used to be one regex each. `detectVastVersion` was
 *
 *     /<VAST\b[^>]*\sversion\s*=\s*["'](\d+(?:\.\d+)?)["']/i
 *
 * and it is quadratic: every `<VAST` in the input is a start position from
 * which `[^>]*` runs to the end of the string when no `>` follows. A creative
 * whose `adm` is `'<VAST '.repeat(n)` inside CDATA made it O(n²) —
 *
 *     12 KB → 20 ms · 48 KB → 279 ms · 192 KB → 4.2 s · 2 MiB → ~8 minutes
 *
 * — and `detectFormat()` calls it on `bid.adm` for anything that sniffs like
 * VAST, so an unauthenticated `/api/analyze` POST could pin a core for minutes.
 * A scanner that walks the document once cannot be made to do that.
 *
 * The scan also fixes two correctness bugs the regexes had:
 *
 *   - A leading comment or a second processing instruction — which ad servers
 *     routinely prepend — made `isVastShape` return false for perfectly valid
 *     VAST. `detectFormat` then tagged the creative as no format at all and
 *     `validateVast` never ran, so a broken tag came back reporting nothing.
 *     Legal XML prolog content (XML 1.0 §2.8) is now skipped properly.
 *   - `detectVastVersion` matched a `version=` attribute ANYWHERE, including
 *     inside CDATA, so a URL containing the text `<VAST version="2.0"` set the
 *     detected version of a document whose root carried none. The version is
 *     now read only from the root element's own start tag.
 *
 * Isomorphic on purpose: this one canonical source runs unchanged in Node
 * (`module.exports`) and in the browser (`window.OrtbtoolsVastShape`), and
 * scripts/gen-browser-core.js mirrors it verbatim into public/core/ behind a CI
 * parity guard.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrtbtoolsVastShape = factory();
})(globalThis, function () {
  'use strict';

  /** `<VAST`, `<vast:VAST`, `<v:VAST` — an optional namespace prefix, then the name. */
  const ROOT_NAME = /^<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?VAST(?![A-Za-z0-9_.-])/i;
  const VERSION_ATTR = /(?:^|\s)version\s*=\s*(?:"(\d+(?:\.\d+)?)"|'(\d+(?:\.\d+)?)')/i;

  function isWhitespace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  /**
   * Walk past legal prolog content — whitespace, comments, processing
   * instructions and a DOCTYPE — and return the index of the root element's
   * `<`, or -1. Linear: each construct is skipped with one indexOf, and the
   * cursor only ever moves forward.
   *
   * A DOCTYPE is skipped rather than rejected. Deciding whether to allow one is
   * the parser's job, and it gives an accurate reason; refusing here would only
   * turn that into "this is not VAST", which is both wrong and unhelpful.
   */
  function rootElementStart(s) {
    let i = 0;
    const n = s.length;
    for (;;) {
      while (i < n && isWhitespace(s[i])) i++;
      if (i >= n || s[i] !== '<') return -1;

      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4);
        if (end < 0) return -1;
        i = end + 3;
        continue;
      }
      if (s.startsWith('<?', i)) {
        const end = s.indexOf('?>', i + 2);
        if (end < 0) return -1;
        i = end + 2;
        continue;
      }
      if (/^<!DOCTYPE/i.test(s.slice(i, i + 9))) {
        // An internal subset may contain '>' characters, so step over it first.
        const bracket = s.indexOf('[', i);
        const close = s.indexOf('>', i);
        if (close < 0) return -1;
        if (bracket >= 0 && bracket < close) {
          const subsetEnd = s.indexOf(']', bracket + 1);
          if (subsetEnd < 0) return -1;
          const after = s.indexOf('>', subsetEnd + 1);
          if (after < 0) return -1;
          i = after + 1;
        } else {
          i = close + 1;
        }
        continue;
      }
      return i;
    }
  }

  /**
   * The attribute text of the start tag beginning at `start`, or null. Quotes
   * are honoured so a `>` inside an attribute value does not end the tag early.
   */
  function startTagAttributes(s, start) {
    const nameMatch = ROOT_NAME.exec(s.slice(start, start + 64));
    if (!nameMatch) return null;
    let i = start + nameMatch[0].length;
    const from = i;
    let quote = '';
    for (; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '>') return s.slice(from, i);
    }
    return null; // unterminated start tag — the parser will say so properly
  }

  /**
   * True when the string's ROOT element is `VAST`, ignoring any legal prolog.
   * Anchored on purpose: a string that merely mentions `<VAST` deep inside HTML
   * is not a VAST document (audit 2026-05-10 finding B-12).
   */
  function isVastShape(s) {
    if (typeof s !== 'string') return false;
    const start = rootElementStart(s);
    if (start < 0) return false;
    return ROOT_NAME.test(s.slice(start, start + 64));
  }

  /**
   * The `version` attribute of the ROOT element, as a `major.minor` string, or
   * null. Only the root's own start tag is read — never the rest of the
   * document, and never CDATA.
   */
  function detectVastVersion(s) {
    if (typeof s !== 'string') return null;
    const start = rootElementStart(s);
    if (start < 0) return null;
    const attributes = startTagAttributes(s, start);
    if (attributes === null) return null;
    const m = VERSION_ATTR.exec(attributes);
    return m ? m[1] || m[2] : null;
  }

  return { isVastShape, detectVastVersion };
});
