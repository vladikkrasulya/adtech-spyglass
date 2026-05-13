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
 * @param {unknown} ext
 * @param {string} [basePath='ext']
 * @returns {Array<{format: string, path: string}>}
 */
function scanExtForFormatHints(ext, basePath) {
  if (!isObj(ext)) return [];
  const out = [];
  const base = basePath || 'ext';
  // Dedupe by format name. When a payload carries both a string hint
  // (`ext.adtype='pop'`) AND a matching flag hint (`ext.pop=true`), the
  // pre-dedup version would emit two records for the same format and
  // downstream consumers would surface two near-identical findings.
  // First-seen wins so the path points at the most explicit signal.
  const seen = new Set();
  for (const k of STRING_HINT_KEYS) {
    const v = ext[k];
    if (typeof v !== 'string') continue;
    const n = normaliseFormatName(v);
    if (ALL_NON_STANDARD.has(n) && !seen.has(n)) {
      seen.add(n);
      out.push({ format: n, path: `${base}.${k}` });
    }
  }
  for (const k of FLAG_HINT_KEYS) {
    if (!ext[k]) continue;
    const n = normaliseFormatName(k);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({ format: n, path: `${base}.${k}` });
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
  // Try URL inside window.open / location.href / etc.
  const inside = s.match(
    /(?:window\.open|location\.(?:href|replace|assign))\s*[=(]\s*['"`](https?:\/\/[^'"`]+)['"`]/i,
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
