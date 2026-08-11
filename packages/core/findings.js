'use strict';

/**
 * Finding factory and level constants.
 *
 * Findings are i18n-neutral: they carry a stable `id`, structured `params`
 * for interpolation, the JSON `path` they apply to, and the severity `level`.
 * Localized message text is resolved at presentation time by messages/index.js
 * — never inline in the validator.
 *
 * Levels (stable Core contract; see specs/000-platform-baseline/contracts/core-validator.md):
 *   error   — spec violation that an exchange will reject (fail the bid)
 *   warning — spec violation tolerated by most exchanges (reduces fill)
 *   info    — best-practice / recommendation
 *   question — non-blocking ambiguity that needs operator context
 *
 * Crosscheck findings additionally carry `ok` (passed/failed) and use:
 *   ok=true  level=ok      — green check
 *   ok=false level=warn    — soft mismatch (won't block, but worth knowing)
 *   ok=false level=crit    — hard mismatch (this bid would be filtered)
 */

const LEVELS = { ERROR: 'error', WARNING: 'warning', INFO: 'info', QUESTION: 'question' };
const CROSS_LEVELS = { OK: 'ok', WARN: 'warn', CRIT: 'crit' };

/**
 * @param {string} id - dotted finding id ("request.id_required")
 * @param {string} level - one of LEVELS.*
 * @param {string} path - JSON pointer-ish ("imp[0].banner")
 * @param {Record<string, unknown>} [params] - for ICU interpolation
 * @returns {{id:string,level:string,path:string,params:object}}
 */
function makeFinding(id, level, path, params) {
  return { id, level, path: path || '', params: params || {} };
}

/**
 * Crosscheck variant — same shape plus `ok` boolean and optional `detail`.
 * @param {boolean} ok
 * @param {string} level - one of CROSS_LEVELS.*
 */
function makeCross(id, ok, level, path, params, detail) {
  return { id, ok, level, path: path || '', params: params || {}, detail };
}

/**
 * Roll up a list of findings into a top-level status.
 * 'errors'   — at least one error
 * 'warnings' — only warnings/info
 * 'clean'    — empty
 * 'invalid'  — set explicitly when the payload could not be parsed
 */
function rollupStatus(findings) {
  if (!findings.length) return 'clean';
  // v8 — `question` findings are non-blocking user prompts; ignore them
  // in the top-level status so a payload full of vendor-extension
  // questions still rolls up to `clean` if no real spec violations exist.
  const real = findings.filter((f) => f.level !== LEVELS.QUESTION);
  if (!real.length) return 'clean';
  if (real.some((f) => f.level === LEVELS.ERROR)) return 'errors';
  if (real.some((f) => f.level === LEVELS.WARNING)) return 'warnings';
  return 'clean'; // info-only
}

// Severity rank for sortFindings. Crosscheck CRIT/WARN/OK get folded in so
// crosscheck output sorts on the same scale as schema findings.
const SEV_RANK = {
  error: 0,
  crit: 0,
  warning: 1,
  warn: 1,
  info: 2,
  question: 2.5, // v8 — between info and ok; visible but non-blocking
  ok: 3,
};

/**
 * Stable sort: severity DESC (errors first) → path ASC (lex) → id ASC.
 * Idempotent. Returns a new array; input is not mutated.
 *
 * Public API contract: callers can rely on this exact ordering.
 */
function sortFindings(findings) {
  return findings.slice().sort((a, b) => {
    const sa = SEV_RANK[a.level] != null ? SEV_RANK[a.level] : 99;
    const sb = SEV_RANK[b.level] != null ? SEV_RANK[b.level] : 99;
    if (sa !== sb) return sa - sb;
    const pa = a.path || '';
    const pb = b.path || '';
    if (pa !== pb) return pa < pb ? -1 : 1;
    const ia = a.id || '';
    const ib = b.id || '';
    if (ia !== ib) return ia < ib ? -1 : 1;
    return 0;
  });
}

/**
 * Collapse repeated (id, path) pairs into one finding. When more than one
 * copy was collapsed, the kept finding gets a `dedupCount` param. Order is
 * preserved (first occurrence stays where it was); first finding wins on
 * level/params/msg.
 *
 * Why `dedupCount` instead of `count`: existing rules already use `count`
 * for domain meaning (e.g. crosscheck.bid.native_complete uses count = number
 * of native assets present). We must not trample on it.
 *
 * Why only set when ≥2: keeping the param absent for singletons means i18n
 * templates won't accidentally render "×1".
 */
function dedupFindings(findings) {
  const seen = new Map();
  const out = [];
  for (const f of findings) {
    const key = (f.id || '') + '\u0000' + (f.path || '');
    if (seen.has(key)) {
      const idx = seen.get(key);
      const cur = out[idx];
      const nextCount = (cur.params && cur.params.dedupCount ? cur.params.dedupCount : 1) + 1;
      out[idx] = Object.assign({}, cur, {
        params: Object.assign({}, cur.params, { dedupCount: nextCount }),
      });
    } else {
      seen.set(key, out.length);
      out.push(f);
    }
  }
  return out;
}

/**
 * Apply `disabledRules` filter. Accepts exact ids or trailing-`*` prefixes:
 *   ['imp.bidfloorcur_missing']  — exact
 *   ['imp.*']                    — prefix (matches every imp.* rule)
 *   ['regs.*', 'crosscheck.id_*'] — multiple
 *
 * Empty / falsy disabledRules → input returned untouched.
 */
function applyDisabledRules(findings, disabledRules) {
  if (!Array.isArray(disabledRules) || !disabledRules.length) return findings;
  const exact = new Set();
  const prefixes = [];
  for (const r of disabledRules) {
    if (typeof r !== 'string' || !r) continue;
    if (r.endsWith('*')) prefixes.push(r.slice(0, -1));
    else exact.add(r);
  }
  return findings.filter((f) => {
    const id = f.id || '';
    if (exact.has(id)) return false;
    for (const p of prefixes) if (id.startsWith(p)) return false;
    return true;
  });
}

/**
 * Filter findings by strictness level.
 *   'lax'      — errors only (crosscheck: crit only)
 *   'normal'   — errors + warnings + questions (crosscheck: crit + warn)
 *   'pedantic' — everything (current behaviour, also the default)
 *
 * Works for both validator findings (error/warning/info/question) and
 * crosscheck findings (crit/warn/ok) because both are stored in f.level.
 */
function applyStrictness(findings, strictness) {
  const mode =
    strictness === 'lax' || strictness === 'normal' || strictness === 'pedantic'
      ? strictness
      : 'pedantic';

  if (mode === 'pedantic') return findings;

  const allowed =
    mode === 'lax'
      ? new Set([LEVELS.ERROR, CROSS_LEVELS.CRIT])
      : new Set([
          LEVELS.ERROR,
          LEVELS.WARNING,
          LEVELS.QUESTION,
          CROSS_LEVELS.CRIT,
          CROSS_LEVELS.WARN,
        ]);

  return findings.filter((f) => allowed.has(f.level));
}

module.exports = {
  LEVELS,
  CROSS_LEVELS,
  makeFinding,
  makeCross,
  rollupStatus,
  sortFindings,
  dedupFindings,
  applyDisabledRules,
  applyStrictness,
};
