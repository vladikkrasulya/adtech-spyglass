'use strict';

/**
 * packages/core/non-iab-formats.js — shared constants + helpers for the
 * non-IAB ad formats Spyglass recognises (pop family, push family).
 *
 * These formats live OUTSIDE the canonical oRTB 2.x spec: there's no
 * `imp.popunder` field, no `imp.video.protocols`-equivalent. Vendors
 * signal them via extension blobs — string keys like `ext.adtype`,
 * boolean flags like `ext.pop = true`, or shape heuristics on
 * `bid.adm` (a pop bid ships a `window.open` script, not banner HTML).
 *
 * Before 2026-05-12 the recognition lived inline in rules-request.js
 * with no response-side counterpart, which meant `detectFormat()`
 * (and the UI chips it drives) silently missed pop traffic. Pulling
 * it out gave both files a single source of truth so adding a new
 * pop-family vendor only needs one edit here.
 *
 * Consumers:
 *   - format-detect.js → adds FORMATS.POPS / FORMATS.PUSH tags
 *   - rules-request.js → emits `imp.non_standard_format` INFO findings
 *   - rules/imp-pop-fcap (and future pop-specific plugins) → gating
 *   - crosscheck.js → response-side pop sanity checks
 */

// Pop family: same UX pattern (new window/tab opens), mild semantic
// variations. Clickunder is a popunder triggered by any click on page.
const POP_FORMAT_NAMES = new Set(['pop', 'popup', 'popunder', 'clickunder']);

// Push family: device-notification + in-page widgets that look like
// system notifications. Native ad inventory adjacent.
const PUSH_FORMAT_NAMES = new Set(['push', 'pushunder', 'pushup', 'nativepush']);

// Anything we recognise as non-standard.
const ALL_NON_STANDARD = new Set([...POP_FORMAT_NAMES, ...PUSH_FORMAT_NAMES, 'bannerpop']);

// String keys vendors put their non-standard format declaration in.
// `imp.ext.adtype = "popunder"` is by far the most common shape.
const STRING_HINT_KEYS = ['adtype', 'format', 'type', 'ad_format'];

// Boolean / truthy flag keys vendors use as inline markers.
// `imp.ext.popunder = 1` instead of `imp.ext.adtype = "popunder"`.
const FLAG_HINT_KEYS = ['pop', 'popup', 'popunder', 'clickunder', 'pushunder', 'push', 'pushup'];

// Shape-fingerprint pop signals (mirrors dialects/shape-fingerprint.js): vendor
// allow-flags that pop SSPs send INSTEAD of a string adtype. Presence is the
// signal; the value is permissive (bool / 0 / 1 / "0" / "1" / "true" / "false").
// Lets pop RULES detect onclick/popunder traffic that carries only these
// markers (e.g. imp.ext.allowShock) and no canonical hint. `sizeID:[0]` is
// handled separately (array shape, not a flag value).
const POP_SHAPE_FLAG_KEYS = ['allowMT', 'allowLayer', 'allowShock', 'viewOnClick', 'directLink'];

/**
 * Normalise a format name for lookup: lowercase + strip hyphens/underscores
 * /whitespace. `pop_under`, `Pop-Under`, `popunder` all become `popunder`.
 *
 * @param {unknown} s
 * @returns {string}
 */
function normaliseFormatName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Scan an ext-like object for non-IAB format hints. Returns an array of
 * `{ format, path }` records, one per unique hint found.
 *
 * `path` is a string suffix the caller can append to a base (e.g. base
 * `'imp[0].ext'` + suffix `.adtype` → full path `imp[0].ext.adtype`).
 *
 * Detection sources, first-seen-wins per format name:
 *   P0 — user dialect mappings (when `userDialect` is supplied): any ext key
 *        whose saved `semantic_label` resolves to a non-standard format.
 *   - canonical string hints (`ext.adtype = "popunder"`) + boolean flag keys.
 *   P1 — shape signals shared with analyzeShape (`ext.allowShock`, `sizeID:[0]`
 *        …) → pop. These fire WITHOUT a dialect, so pop networks that signal
 *        only with vendor allow-flags (e.g. a numeric `ext.ad_type` mapped via
 *        a dialect, or bare allow* flags) are no longer invisible to the rules.
 *
 * @param {unknown} ext
 * @param {string} [basePath='ext']
 * @param {{lookupMapping?: Function}|null} [userDialect]
 * @returns {Array<{format: string, path: string}>}
 */
function scanExtForFormatHints(ext, basePath, userDialect) {
  if (!isObj(ext)) return [];
  const out = [];
  const base = basePath || 'ext';
  // Dedupe by format name — first-seen wins so the path points at the most
  // explicit signal (dialect mapping > string hint > flag > shape signal).
  const seen = new Set();
  const pushHint = (format, key) => {
    if (seen.has(format)) return;
    seen.add(format);
    out.push({ format, path: `${base}.${key}` });
  };

  // P0 — user dialect mappings. The dialect builder (rules/dialects-questions)
  // only ever emits two signal namespaces: `ext.<key>` (request-level ext) and
  // `imp[].ext.<key>` (per-imp ext). So P0 is meaningful only when the caller
  // identifies the scanned ext as one of those two — callers pass `basePath`
  // 'ext' or 'imp[].ext' accordingly. Other ext locations (imp[].banner.ext,
  // imp[].video.ext, bid[].ext) have no mapping namespace, so we skip P0 there
  // to avoid cross-namespace false positives. Value is passed RAW: lookupMapping
  // applies its own stringifyValue (objects → JSON), so passing String(v) here
  // broke object/array-valued mappings.
  const signalBase = base === 'imp[].ext' ? 'imp[].ext' : base === 'ext' ? 'ext' : null;
  if (signalBase && userDialect && typeof userDialect.lookupMapping === 'function') {
    for (const k of Object.keys(ext)) {
      const v = ext[k];
      if (v == null) continue;
      const mapping = userDialect.lookupMapping(`${signalBase}.${k}`, v);
      if (!mapping || !mapping.semantic_label) continue;
      const n = normaliseFormatName(mapping.semantic_label);
      if (ALL_NON_STANDARD.has(n)) pushHint(n, k);
    }
  }

  // Canonical string hints — `ext.adtype = "popunder"`.
  for (const k of STRING_HINT_KEYS) {
    const v = ext[k];
    if (typeof v !== 'string') continue;
    const n = normaliseFormatName(v);
    if (ALL_NON_STANDARD.has(n)) pushHint(n, k);
  }
  // Boolean / truthy flag hints — `ext.popunder = 1`.
  for (const k of FLAG_HINT_KEYS) {
    if (!ext[k]) continue;
    pushHint(normaliseFormatName(k), k);
  }

  // P1 — shape signals (pop family). A vendor allow-flag with a permissive
  // value, or a single-zero sizeID, marks pop intent on its own.
  for (const k of POP_SHAPE_FLAG_KEYS) {
    // Absent key → ext[k] is undefined, which isn't in the permitted set
    // below, so it's skipped — no separate presence check needed.
    const v = ext[k];
    if (
      v === true ||
      v === false ||
      v === 0 ||
      v === 1 ||
      v === '0' ||
      v === '1' ||
      v === 'true' ||
      v === 'false'
    ) {
      pushHint('pop', k);
    }
  }
  const sizeID = ext['sizeID'];
  if (Array.isArray(sizeID) && sizeID.length === 1 && sizeID[0] === 0) {
    pushHint('pop', 'sizeID');
  }

  return out;
}

/** True if a (normalised) name is a pop-family format. Excludes push. */
function isPopFormat(name) {
  return POP_FORMAT_NAMES.has(normaliseFormatName(name));
}

/** True if a (normalised) name is a push-family format. */
function isPushFormat(name) {
  return PUSH_FORMAT_NAMES.has(normaliseFormatName(name));
}

/**
 * Heuristic: does this bid.adm look like a pop creative? Pops don't ship
 * banner HTML — they ship one of:
 *   - a bare landing URL the SSP wraps in window.open at render time
 *   - a `<script>window.open(URL)</script>` blob
 *   - a `location.href = URL` / `top.location = URL` redirect
 *
 * False positives possible: a banner with a click-tracker that includes
 * `window.open` would match. But Spyglass uses this signal only when
 * other pop indicators are already present in the request — not as a
 * standalone classification.
 *
 * @param {unknown} adm
 * @returns {boolean}
 */
function admLooksLikePop(adm) {
  if (typeof adm !== 'string') return false;
  const s = adm.trim();
  if (!s) return false;
  // Bare URL — SSPs wrap it in window.open at render time.
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return true;
  // window.open(...)
  if (/window\.open\s*\(/i.test(s)) return true;
  // location.href = / location.replace(...) / location.assign(...)
  if (/location\.(href|replace|assign)\s*[=(]/i.test(s)) return true;
  // top.location = / parent.location =
  if (/(top|parent)\.location\s*[=.]/i.test(s)) return true;
  return false;
}

/**
 * Extract the landing-page hostname from a pop `bid.adm`. Returns null if
 * the adm doesn't reveal a URL clearly. Used by the crosscheck rule that
 * compares the landing host to `bid.adomain[]`.
 *
 * @param {unknown} adm
 * @returns {string | null}
 */
function extractPopLandingHost(adm) {
  if (typeof adm !== 'string') return null;
  const s = adm.trim();
  if (!s) return null;
  // Try direct URL first (bare URL adm shape).
  const direct = s.match(/^(https?:\/\/[^\s"'<>]+)/i);
  if (direct) {
    try {
      return new URL(direct[1]).hostname.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  // Try URL inside the redirect call sites that admLooksLikePop recognizes.
  // window.open(URL) / location.{href,replace,assign} / top.location / parent.location.
  // Keep these in sync with admLooksLikePop — otherwise pop is detected but
  // adomain-vs-landing crosscheck silently can't extract the host and the
  // security comparison is skipped.
  const inside = s.match(
    /(?:window\.open|(?:top|parent)\.location|location\.(?:href|replace|assign))\s*[=(]?\.?\s*\(?\s*['"`](https?:\/\/[^'"`]+)['"`]/i,
  );
  if (inside) {
    try {
      return new URL(inside[1]).hostname.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  return null;
}

module.exports = {
  POP_FORMAT_NAMES,
  PUSH_FORMAT_NAMES,
  ALL_NON_STANDARD,
  STRING_HINT_KEYS,
  FLAG_HINT_KEYS,
  normaliseFormatName,
  scanExtForFormatHints,
  isPopFormat,
  isPushFormat,
  admLooksLikePop,
  extractPopLandingHost,
};
