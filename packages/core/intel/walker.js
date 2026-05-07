'use strict';

/**
 * Discovery walker — Phase 7a foundation.
 *
 * Pure function. Given a parsed oRTB payload (request OR response), returns
 * a flat list of `{path, type, valueShape}` entries representing every
 * value found inside `*.ext.*` subtrees. The observer in
 * public/modules/intel/observer.js feeds these into IndexedDB to build the
 * field-frequency model.
 *
 * Why ext-only:
 *   The IAB spec treats `.ext` as the legitimate vendor-extension surface;
 *   anything outside ext is either canonical (validated by rules-request /
 *   rules-response) or sensitive (creative bytes, user IDs, IPs). Walking
 *   only ext-trees gives us discovery without exfiltrating PII or
 *   creative content.
 *
 * Path normalization:
 *   Array indices collapse to a singular form so `imp[0].ext.subage` and
 *   `imp[3].ext.subage` both report as `imp.ext.subage`. This is crucial
 *   for frequency aggregation — otherwise every multi-imp request would
 *   pollute the field index with index-specific buckets.
 *
 * PII filtering:
 *   Path components in PII_TOKENS are skipped entirely (no descent, no
 *   leaf record). A small allow-list of patterns also skips path
 *   components matching consent / token / *uid* shapes — defensive
 *   against future ext schemas that bury identifiers in vendor blobs.
 *
 * Depth cap:
 *   Hard cap at MAX_DEPTH levels of recursion below the ext entrypoint.
 *   Malicious payloads can self-nest; capping bounds CPU + storage.
 */

const { fingerprintValue } = require('./fingerprint');

const MAX_DEPTH = 4;
const MAX_VALUE_CHARS = 200;

// Path components we never descend into, even inside ext. The denylist
// is intentionally narrow — over-blocking hurts discovery utility.
// Anything deemed PII or creative-content bypasses fingerprinting.
const PII_TOKENS = new Set([
  // Direct identifiers
  'ip',
  'ipv6',
  'ifa',
  'dpidsha1',
  'dpidmd5',
  'macsha1',
  'macmd5',
  'didsha1',
  'didmd5',
  'buyeruid',
  // Consent / privacy strings (TCF, GPP, USP)
  'consent',
  'gpp',
  'gpp_sid',
  'usp',
  'us_privacy',
  // Auth / session
  'token',
  'session_id',
  'sessionid',
  'auth',
  'cookie',
]);

// Regex denylist for fuzzier matches — vendor-specific consent / token
// fields that don't share a fixed name.
const PII_PATTERNS = [
  /^.*consent.*$/i,
  /^.*token.*$/i,
  /^.*uid$/i, // *_uid, useruid, etc.
  /^.*_id$/i, // user_id, click_id — narrow but consistent denial
];

/**
 * Entry points: every place inside a payload where ext lives. The
 * walker enters AT each ext object, never above it — so canonical
 * fields like `bid.id` / `imp.banner.w` / `user.id` are never seen.
 */
function findExtEntryPoints(payload) {
  const entries = []; // [{ logicalPath, value }]
  if (!payload || typeof payload !== 'object') return entries;

  const tryAdd = (logicalPath, val) => {
    if (val && typeof val === 'object') entries.push({ logicalPath, value: val });
  };

  // Request-side
  tryAdd('req.ext', payload.ext);
  tryAdd('req.site.ext', payload.site && payload.site.ext);
  tryAdd('req.app.ext', payload.app && payload.app.ext);
  tryAdd('req.user.ext', payload.user && payload.user.ext);
  tryAdd('req.device.ext', payload.device && payload.device.ext);
  tryAdd('req.regs.ext', payload.regs && payload.regs.ext);
  tryAdd('req.source.ext', payload.source && payload.source.ext);
  if (Array.isArray(payload.imp)) {
    for (const imp of payload.imp) {
      tryAdd('req.imp.ext', imp && imp.ext);
      // Nested imp.{banner,video,native,audio}.ext are all accepted;
      // collapse to logical singular form.
      tryAdd('req.imp.banner.ext', imp && imp.banner && imp.banner.ext);
      tryAdd('req.imp.video.ext', imp && imp.video && imp.video.ext);
      tryAdd('req.imp.native.ext', imp && imp.native && imp.native.ext);
      tryAdd('req.imp.audio.ext', imp && imp.audio && imp.audio.ext);
    }
  }

  // Response-side
  tryAdd('res.ext', payload.ext);
  if (Array.isArray(payload.seatbid)) {
    for (const sb of payload.seatbid) {
      tryAdd('res.seatbid.ext', sb && sb.ext);
      if (Array.isArray(sb && sb.bid)) {
        for (const b of sb.bid) {
          tryAdd('res.bid.ext', b && b.ext);
        }
      }
    }
  }

  return entries;
}

function isPiiPath(component) {
  if (PII_TOKENS.has(component)) return true;
  for (const re of PII_PATTERNS) {
    if (re.test(component)) return true;
  }
  return false;
}

/**
 * Recursively walk an ext-rooted subtree. emits leaf paths via `out.push`.
 * Stops at MAX_DEPTH to bound CPU and protect against pathological nesting.
 */
function walkSubtree(value, basePath, depth, out, seen) {
  if (depth > MAX_DEPTH) return;
  if (value == null) return;
  // Cycle guard. Pathological self-referential JSON is rare but a probe
  // wouldn't be wise to loop forever on it.
  if (typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
  }

  if (Array.isArray(value)) {
    out.push({ path: basePath, type: 'array', valueShape: fingerprintValue(value) });
    return;
  }

  if (typeof value === 'object') {
    // For objects we record the leaf value of each key. We don't record
    // the parent object itself as a leaf — only its keyed children.
    for (const k of Object.keys(value)) {
      if (isPiiPath(k)) continue;
      const child = value[k];
      const childPath = basePath + '.' + k;
      // Strings beyond MAX_VALUE_CHARS are considered "creative-ish"
      // (URLs, encoded payloads) and only their length is recorded —
      // never their content.
      if (typeof child === 'string' && child.length > MAX_VALUE_CHARS) {
        out.push({
          path: childPath,
          type: 'string',
          valueShape: { len: child.length, oversize: true },
        });
        continue;
      }
      // Primitives — record directly with shape.
      if (typeof child !== 'object' || child === null) {
        out.push({ path: childPath, type: typeof child, valueShape: fingerprintValue(child) });
        continue;
      }
      // Nested arrays / objects — recurse, but also record the
      // structural shape (so the analyst sees "this field has a
      // schema-ish object" without descending forever).
      out.push({
        path: childPath,
        type: Array.isArray(child) ? 'array' : 'object',
        valueShape: fingerprintValue(child),
      });
      walkSubtree(child, childPath, depth + 1, out, seen);
    }
  }
  // primitives at the entrypoint level (rare — ext should be an object)
  // are intentionally ignored: ext itself shouldn't be a scalar.
}

/**
 * Public entrypoint. Returns `Array<{path, type, valueShape}>`.
 *
 * @param {object} payload  parsed oRTB request OR response
 * @returns {Array<{path: string, type: string, valueShape: object}>}
 */
function extractFields(payload) {
  const entries = findExtEntryPoints(payload);
  const out = [];
  const seen = new WeakSet();
  for (const { logicalPath, value } of entries) {
    walkSubtree(value, logicalPath, 1, out, seen);
  }
  return out;
}

/**
 * Bucket the payload into one of {display, inapp, push, unknown}. Used
 * by the observer to namespace observations so push-traffic patterns
 * don't bleed into display-traffic ones (different field vocabularies
 * in the wild).
 */
function bucketize(payload) {
  if (!payload || typeof payload !== 'object') return 'unknown';

  // Push detection: any imp.ext carries Kadam-style subage hints, OR
  // site.ext.idzone matches push pattern (mirrors dialects/kadam.js
  // detection logic).
  if (Array.isArray(payload.imp)) {
    for (const imp of payload.imp) {
      const e = (imp && imp.ext) || {};
      if (e.subage != null || e.subage0 != null || e.subage_dt || e.subage_ts) {
        return 'push';
      }
    }
  }
  const sitePush =
    payload.site && payload.site.ext && payload.site.ext.idzone && String(payload.site.ext.idzone);
  if (sitePush && /push|sub/i.test(sitePush)) return 'push';

  // In-app: bundle is set on app
  if (payload.app && typeof payload.app.bundle === 'string' && payload.app.bundle.length > 0) {
    return 'inapp';
  }

  // Default: display
  return 'display';
}

module.exports = {
  extractFields,
  bucketize,
  // Exposed for tests + future inspection UIs:
  MAX_DEPTH,
  MAX_VALUE_CHARS,
  PII_TOKENS,
};
