'use strict';

/**
 * key-role-vocabulary — the ONE normative enumeration of canonical key roles
 * and storable semantic labels (016 FR-019/FR-024, ADR-015).
 *
 * Every surface that lists labels imports from here: the save route
 * (modules/dialects/handler.js), the model response schema (lib/ollama.js),
 * the browser picker (via the generated mirror in
 * public/core/key-role-vocabulary.js, gated by a byte-equality test — the
 * no-bundler IIFE cannot require this module), and any export. No consumer
 * declares its own array; that is how FR-024's "no surface can disagree"
 * stays a property instead of a hope.
 *
 * ── Roles are not labels ─────────────────────────────────────────────────
 * A canonical ROLE says what kind of thing a field is. A storable LABEL is
 * what the operator may persist. Nine roles project to themselves;
 * `format-declaration` is deliberately not storable — it projects to the
 * existing `custom` while the private value stays unknown, and to a specific
 * format label only when independent value evidence resolves the value.
 * In v1 no path produces such evidence, so `valueStatus: 'resolved'` is a
 * RESERVED state (FR-010) — tests assert the role layer never emits it.
 *
 * ── Format recognition is an allowlist ───────────────────────────────────
 * FORMAT_LABELS is the complete set of labels that may ever feed format
 * recognition. Membership HERE is the test — never "is an accepted stored
 * label". A plausible role name reads as harmless where a wrong format label
 * would not (FR-022's quiet failure mode), so each of the nine new roles is
 * inert by construction and asserted inert by test.
 */

/**
 * The ten canonical key roles. Closed set (016 §Closed role vocabulary).
 * @type {readonly string[]}
 */
const CANONICAL_ROLES = Object.freeze([
  'format-declaration',
  'identifier',
  'credential',
  'metadata',
  'media-property',
  'pricing',
  'targeting',
  'privacy-consent',
  'delivery-control',
  'measurement',
]);

/**
 * The eleven pre-existing semantic labels — the normative subject of the
 * FR-021/SC-010 compatibility floor. Order matches the historical picker.
 * @type {readonly string[]}
 */
const LEGACY_LABELS = Object.freeze([
  'pop',
  'native',
  'banner',
  'video',
  'audio',
  'in-page-push',
  'push',
  'interstitial-banner',
  'ignore',
  'informational',
  'custom',
]);

/**
 * The nine new storable role labels (ADR-015). Each projects to itself.
 * @type {readonly string[]}
 */
const ROLE_LABELS = Object.freeze([
  'identifier',
  'credential',
  'metadata',
  'media-property',
  'pricing',
  'targeting',
  'privacy-consent',
  'delivery-control',
  'measurement',
]);

/**
 * Everything an operator may save: exactly twenty labels.
 * @type {readonly string[]}
 */
const STORABLE_LABELS = Object.freeze([...LEGACY_LABELS, ...ROLE_LABELS]);

/**
 * The complete allowlist of labels that participate in format recognition.
 * `ignore`, `informational`, `custom` and all nine role labels are absent
 * by design — they are inert (FR-022).
 * @type {readonly string[]}
 */
const FORMAT_LABELS = Object.freeze([
  'pop',
  'native',
  'banner',
  'video',
  'audio',
  'in-page-push',
  'push',
  'interstitial-banner',
]);

/**
 * Identifiers this specification family uses that are NOT storable labels
 * and must be rejected by every accepting surface (FR-019): the neutral
 * role, the resolution states, and the valueStatus members.
 * @type {readonly string[]}
 */
const NON_LABEL_IDENTIFIERS = Object.freeze([
  'format-declaration',
  'resolved',
  'ambiguous',
  'abstain',
  'unknown',
  'not-applicable',
]);

/**
 * Project a canonical role onto the label an operator may save.
 *
 * @param {string} role  one of CANONICAL_ROLES
 * @param {{valueStatus: 'resolved'|'unknown'|'not-applicable', valueLabel?: string}} value
 * @returns {string|null} the storable label, or null when no projection
 *   applies (unknown role, or a value claim the vocabulary cannot honour)
 */
function projectRoleToLabel(role, value) {
  if (!CANONICAL_ROLES.includes(role)) return null;
  if (role === 'format-declaration') {
    if (value && value.valueStatus === 'resolved') {
      // Reserved branch (FR-010): reachable only when future value evidence
      // exists AND names an actual format label. Guarded, not trusted.
      return typeof value.valueLabel === 'string' && FORMAT_LABELS.includes(value.valueLabel)
        ? value.valueLabel
        : null;
    }
    return 'custom';
  }
  // The nine role labels project to themselves and carry no value claim.
  return role;
}

/**
 * Is this string a label the save route may accept?
 * @param {string} label
 * @returns {boolean}
 */
function isStorableLabel(label) {
  return STORABLE_LABELS.includes(label);
}

module.exports = {
  CANONICAL_ROLES,
  LEGACY_LABELS,
  ROLE_LABELS,
  STORABLE_LABELS,
  FORMAT_LABELS,
  NON_LABEL_IDENTIFIERS,
  projectRoleToLabel,
  isStorableLabel,
};
