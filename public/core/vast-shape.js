/**
 * vast-shape.js — the two VAST sniffing helpers, and nothing else.
 *
 * They used to live in format-detect.js, and still reach every existing caller
 * from there: `format-detect` requires this file and re-exports both names, so
 * there is still exactly ONE anchored regex for "is this string a VAST tag",
 * which is the whole reason they were centralised in the first place.
 *
 * They live in their own file because the browser needs them. The VAST timeline
 * extractor runs in the page, and `format-detect.js` pulls in
 * `non-iab-formats.js` — together 600+ lines of pop/push heuristics that a
 * timeline view has no use for. Mirroring all of that to get two five-line
 * functions would be paying a lot to ship code nobody calls.
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

  /**
   * `isVastShape` is anchored at start (allowing whitespace) so a string
   * mentioning `<VAST` deep inside HTML doesn't false-positive. `detect`
   * returns the major.minor string from the version attribute, or null.
   */
  function isVastShape(s) {
    if (typeof s !== 'string') return false;
    // Anchor on `<VAST` directly, OR `<?xml` prefix immediately followed by
    // `<VAST` (allowing the XML declaration). Pre-fix any `<?xml` prefix
    // matched, which false-positive'd on SVG / other XML-shaped creatives
    // (audit 2026-05-10 finding B-12). Now only an actual VAST root passes.
    return /^\s*(?:<\?xml[^?]*\?>\s*)?<VAST\b/i.test(s);
  }

  function detectVastVersion(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(/<VAST\b[^>]*\sversion\s*=\s*["'](\d+(?:\.\d+)?)["']/i);
    return m ? m[1] : null;
  }

  return { isVastShape, detectVastVersion };
});
