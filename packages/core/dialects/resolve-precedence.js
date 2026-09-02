'use strict';

/**
 * resolve-precedence — the FR-001 matrix: combines the classified legacy
 * resolver verdict with the key-role layer's state into one final outcome
 * (016 §Resolver precedence, contracts/key-role-layer.md).
 *
 * Pure. `savedMapping` is supplied BY THE CALLER, already resolved — Core
 * has no database and performs no lookup (R-11); the ai-label handler
 * resolves it from the authenticated operator's default dialect.
 *
 * The two load-bearing guarantees:
 *   1. No demotion — a role-layer `abstain` never turns a previously
 *      deterministic answer into a model call.
 *   2. No overrule of accepted format evidence — `terminal-flag` stays
 *      terminal; a `specific-format` verdict is preserved or escalated to
 *      deterministic ambiguity, never silently replaced.
 *
 * `route` names the SC-002 counter the outcome lands in:
 * exact-format | role-resolved | role-ambiguous | preserved-legacy | model.
 */

const { projectRoleToLabel } = require('./key-role-vocabulary');

/**
 * Build the operator-facing answer for a role-layer `resolved` state.
 * @param {any} role  a resolved role-layer state (narrowed by the caller)
 * @param {{conflict?: object}} [extra]
 */
function roleAnswer(role, extra = {}) {
  const valueStatus = role.role === 'format-declaration' ? 'unknown' : 'not-applicable';
  const label = projectRoleToLabel(role.role, { valueStatus });
  return {
    resolutionStatus: 'resolved',
    role: role.role,
    roleConfidence: role.score,
    valueStatus,
    label,
    // The pre-existing field stays for compatibility and equals
    // roleConfidence: the projected label makes no specific value claim
    // (016 §Public response compatibility).
    confidence: role.score,
    reason: role.reason,
    source: 'lexicon',
    evidence: role.evidence,
    ...(extra.conflict ? { conflict: extra.conflict } : {}),
  };
}

/**
 * @param {any} role  an ambiguous shape (narrowed by the caller)
 * @param {object[]} [extraEvidence]
 */
function ambiguousAnswer(role, extraEvidence = []) {
  return {
    resolutionStatus: 'ambiguous',
    roleCandidates: role.roleCandidates,
    reason: role.reason,
    source: 'lexicon',
    evidence: [...role.evidence, ...extraEvidence],
  };
}

/**
 * Combine per the FR-001 matrix.
 *
 * @param {object} input
 * @param {object|null} input.savedMapping  pre-resolved by the caller; never looked up here
 * @param {{kind:'terminal-flag'|'specific-format'|'guarded-contradiction'|'broad-heuristic'|'abstain',
 *          suggestion: object|null}} input.legacy
 * @param {{state:'resolved'|'ambiguous'|'abstain', role?:string, score?:number,
 *          roleCandidates?:string[], reason?:string, evidence:object[]}} input.role
 * @returns {{outcome:'saved'|'resolved'|'ambiguous'|'legacy'|'model',
 *            route:'exact-format'|'role-resolved'|'role-ambiguous'|'preserved-legacy'|'model',
 *            answer: object|null}}
 */
function combine({ savedMapping, legacy, role }) {
  // Row 1: an exact saved mapping outranks everything, unconditionally
  // (FR-016) — returned as the saved-mapping variant, deliberately without
  // a numeric confidence: the operator confirmed it, and a score would
  // misrepresent certainty as measurement.
  if (savedMapping) {
    return {
      outcome: 'saved',
      route: 'exact-format',
      answer: {
        label: savedMapping.semantic_label,
        source: 'saved-mapping',
        ...(savedMapping.notes ? { notes: savedMapping.notes } : {}),
      },
    };
  }

  const roleResolved = role.state === 'resolved';
  const roleAmbiguous = role.state === 'ambiguous';
  const roleFormat = roleResolved && role.role === 'format-declaration';

  switch (legacy.kind) {
    case 'terminal-flag':
      // Accepted format-naming flags and shape flags stay terminal; stop.
      return { outcome: 'legacy', route: 'exact-format', answer: legacy.suggestion };

    case 'specific-format':
      if (roleResolved && !roleFormat) {
        // The word says a format, the reviewed role says something else —
        // deterministic ambiguity with both evidence sets; never a guess.
        return {
          outcome: 'ambiguous',
          route: 'role-ambiguous',
          answer: ambiguousAnswer(
            {
              roleCandidates: ['format-declaration', role.role],
              reason: role.reason,
              evidence: role.evidence,
            },
            [{ type: 'legacy-specific-format', suggestion: legacy.suggestion }],
          ),
        };
      }
      if (roleAmbiguous) {
        return {
          outcome: 'ambiguous',
          route: 'role-ambiguous',
          answer: ambiguousAnswer(role, [
            { type: 'legacy-specific-format', suggestion: legacy.suggestion },
          ]),
        };
      }
      // format-declaration or abstain: preserve the current verdict and its
      // existing shape calibration; stop.
      return { outcome: 'legacy', route: 'exact-format', answer: legacy.suggestion };

    case 'guarded-contradiction':
      if (roleFormat) {
        // The role stands on the key name; the value/shape conflict is
        // surfaced, never raising confidence, never decoding (FR-013).
        return {
          outcome: 'resolved',
          route: 'role-resolved',
          answer: roleAnswer(role, {
            conflict: { type: 'value-shape-contradiction', detail: 'legacy guarded rejection' },
          }),
        };
      }
      if (roleResolved || roleAmbiguous) {
        const amb = roleAmbiguous
          ? role
          : {
              roleCandidates: ['format-declaration', role.role],
              reason: role.reason,
              evidence: role.evidence,
            };
        return {
          outcome: 'ambiguous',
          route: 'role-ambiguous',
          answer: ambiguousAnswer(amb, [{ type: 'legacy-guarded-contradiction' }]),
        };
      }
      // abstain: preserve the current model fallback.
      return { outcome: 'model', route: 'model', answer: null };

    case 'broad-heuristic':
      if (roleResolved) {
        // The more specific alphabet role supersedes the broad legacy
        // ignore/informational heuristic; stop.
        return { outcome: 'resolved', route: 'role-resolved', answer: roleAnswer(role) };
      }
      if (roleAmbiguous) {
        return { outcome: 'ambiguous', route: 'role-ambiguous', answer: ambiguousAnswer(role) };
      }
      // No demotion: the legacy deterministic answer is preserved.
      return { outcome: 'legacy', route: 'preserved-legacy', answer: legacy.suggestion };

    default:
      // Legacy abstains.
      if (roleResolved) {
        return { outcome: 'resolved', route: 'role-resolved', answer: roleAnswer(role) };
      }
      if (roleAmbiguous) {
        return { outcome: 'ambiguous', route: 'role-ambiguous', answer: ambiguousAnswer(role) };
      }
      return { outcome: 'model', route: 'model', answer: null };
  }
}

module.exports = { combine };
