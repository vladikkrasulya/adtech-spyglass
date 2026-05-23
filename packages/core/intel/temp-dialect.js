'use strict';

/**
 * Temporary-dialect runtime — Phase 7b. Pure function.
 *
 * Temporary dialects are the user-built validation overlays produced by
 * the Dialect Builder UI. They live entirely client-side: server's
 * /api/analyze never knows about them. After the IAB-baseline findings
 * arrive from the server, the client applies the active temp dialect's
 * predicates in-browser and merges the resulting findings into the
 * validation envelope before the inspector renders.
 *
 * Why client-side only:
 *   - Engine purity: the server-side validate() rule families remain a
 *     fixed taxonomy (IAB + vendor-dialect variants). Temp dialects are user
 *     experiments, not first-class engine extensions.
 *   - Privacy: temp dialect specs may encode field names a user discovered
 *     from sensitive traffic. Keeping them browser-local mirrors the
 *     Phase 7a privacy posture for field observations.
 *   - Velocity: a user can iterate on a temp dialect without a deploy.
 *
 * Spec format (stored in IndexedDB store `temporary_dialects`):
 *   {
 *     id: 'temp_<uuid>',
 *     name: 'Vendor Custom',
 *     domainBucket: 'push' | 'display' | 'inapp' | 'all',
 *     fields: [
 *       { path: 'req.imp.ext.subage', required: true, expectedType: 'number' },
 *       { path: 'res.bid.ext.vendor_macro', required: false }
 *     ],
 *     parentDialect: 'iab',         // server-side dialect to use as base
 *     createdAt: 1700000000000,
 *     validUntil: 1700000000000 + 30 * 86400000
 *   }
 *
 * Phase 7b validation surface (kept narrow on purpose):
 *   - required: true → emit ERROR if missing
 *   - expectedType: 'number'/'string'/'array'/'object'/'boolean' → emit
 *     WARNING if value present but wrong type
 *   - validUntil < now → emit INFO that the dialect has expired (still
 *     applies, but flagged)
 *
 * Phase 7c will add length / charClass enforcement + claimsBid support.
 * Phase 7c will also handle expiry via auto-deactivation rather than
 * just flagging.
 */

const TEMP_DIALECT_ID_PREFIX = 'temp:';

/**
 * Resolve a logical path against a payload pair (`req` for req.* paths,
 * `res` for res.* paths). Logical paths from the walker collapse array
 * indices, so we resolve by walking through arrays at the matching
 * segments. Returns the FIRST occurrence found — sufficient for
 * required-field checks; quantifiers come in 7c.
 *
 * Examples:
 *   resolvePath({req, res}, 'req.imp.ext.subage') →
 *     req.imp[0].ext.subage (or imp[1].ext.subage, etc. — first non-undefined)
 */
function resolvePath(payloadPair, logicalPath) {
  if (!logicalPath || typeof logicalPath !== 'string') return undefined;
  const segments = logicalPath.split('.');
  if (segments.length < 2) return undefined;
  const root =
    segments[0] === 'req' ? payloadPair.req : segments[0] === 'res' ? payloadPair.res : undefined;
  if (root == null) return undefined;
  return walkSegments(root, segments.slice(1));
}

function walkSegments(node, segments) {
  if (!segments.length) return node;
  if (node == null) return undefined;
  const [head, ...rest] = segments;
  if (Array.isArray(node)) {
    // Array walk: descend into each element looking for the head key.
    for (const elem of node) {
      const child = elem && elem[head];
      if (child !== undefined) {
        const r = walkSegments(child, rest);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  }
  if (typeof node === 'object') {
    const child = node[head];
    if (child === undefined) return undefined;
    return walkSegments(child, rest);
  }
  return undefined;
}

function checkType(value, expected) {
  if (value === undefined || value === null) return true; // null-handling is the required check, not the type check
  if (expected === 'number') return typeof value === 'number';
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'boolean') return typeof value === 'boolean';
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object')
    return typeof value === 'object' && !Array.isArray(value) && value !== null;
  return true; // unknown expected → don't flag
}

/**
 * Apply the temp-dialect spec to a (req, res) pair. Returns an array of
 * findings in the same shape as engine findings, ready to be merged into
 * `validation.findings`.
 *
 * Decoration responsibility: caller assigns localized `msg` strings (the
 * dialect name is user-provided so it can't be in the static i18n
 * dictionary). For 7b, the observer wraps each finding with a
 * synthetic msg derived from the spec.
 */
function applyTempDialect(spec, payloadPair) {
  if (!spec || !Array.isArray(spec.fields)) return [];
  const findings = [];
  const dialectName = String(spec.name || 'Custom');
  const now = Date.now();

  // Expiry tag — surfaces as INFO so user knows their dialect is stale
  // but it still applies. 7c will auto-deactivate.
  if (spec.validUntil && now > spec.validUntil) {
    findings.push({
      id: 'temp.dialect_expired',
      level: 'info',
      path: '',
      params: { dialectName, validUntil: new Date(spec.validUntil).toISOString() },
      msg: `Temporary dialect "${dialectName}" expired ${formatAge(now - spec.validUntil)} ago — still applied, but consider re-creating.`,
      specRef: null,
    });
  }

  for (let i = 0; i < spec.fields.length; i++) {
    const f = spec.fields[i];
    if (!f || typeof f.path !== 'string') continue;
    const value = resolvePath(payloadPair, f.path);

    if (f.required && value === undefined) {
      findings.push({
        id: 'temp.field_required',
        level: 'error',
        path: f.path,
        params: { dialectName, fieldPath: f.path },
        msg: `Required by "${dialectName}": missing \`${f.path}\``,
        specRef: null,
      });
      continue;
    }

    if (value !== undefined && f.expectedType && !checkType(value, f.expectedType)) {
      findings.push({
        id: 'temp.field_wrong_type',
        level: 'warning',
        path: f.path,
        params: {
          dialectName,
          fieldPath: f.path,
          expected: f.expectedType,
          actual: Array.isArray(value) ? 'array' : typeof value,
        },
        msg: `Custom rule "${dialectName}": \`${f.path}\` expected ${f.expectedType}, got ${Array.isArray(value) ? 'array' : typeof value}`,
        specRef: null,
      });
    }
  }

  return findings;
}

function formatAge(ms) {
  if (ms < 60_000) return Math.floor(ms / 1000) + 's';
  if (ms < 3600_000) return Math.floor(ms / 60_000) + 'm';
  if (ms < 86_400_000) return Math.floor(ms / 3600_000) + 'h';
  return Math.floor(ms / 86_400_000) + 'd';
}

/**
 * Roll a stable-ish ID for a new temp dialect. uses crypto.randomUUID
 * when available; falls back to time + random for older runtimes.
 */
function generateTempDialectId() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.randomUUID) {
      return TEMP_DIALECT_ID_PREFIX + globalThis.crypto.randomUUID();
    }
  } catch (_e) {
    /* */
  }
  return TEMP_DIALECT_ID_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isTempDialectId(s) {
  return typeof s === 'string' && s.startsWith(TEMP_DIALECT_ID_PREFIX);
}

module.exports = {
  applyTempDialect,
  resolvePath,
  generateTempDialectId,
  isTempDialectId,
  TEMP_DIALECT_ID_PREFIX,
};
