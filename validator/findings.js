'use strict';

/**
 * Finding factory and level constants.
 *
 * Findings are i18n-neutral: they carry a stable `id`, structured `params`
 * for interpolation, the JSON `path` they apply to, and the severity `level`.
 * Localized message text is resolved at presentation time by messages/index.js
 * — never inline in the validator.
 *
 * Levels (per ARCHITECTURE.md §3.2):
 *   error   — spec violation that an exchange will reject (fail the bid)
 *   warning — spec violation tolerated by most exchanges (reduces fill)
 *   info    — best-practice / recommendation
 *
 * Crosscheck findings additionally carry `ok` (passed/failed) and use:
 *   ok=true  level=ok      — green check
 *   ok=false level=warn    — soft mismatch (won't block, but worth knowing)
 *   ok=false level=crit    — hard mismatch (this bid would be filtered)
 */

const LEVELS = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };
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
  if (findings.some((f) => f.level === LEVELS.ERROR)) return 'errors';
  if (findings.some((f) => f.level === LEVELS.WARNING)) return 'warnings';
  return 'clean'; // info-only
}

module.exports = { LEVELS, CROSS_LEVELS, makeFinding, makeCross, rollupStatus };
