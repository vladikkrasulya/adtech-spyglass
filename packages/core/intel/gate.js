'use strict';

/**
 * Discovery security gate — pure predicate.
 *
 * Discovery only learns from "clean" bids. The gate filters out anything
 * that already triggered an ERROR-level signal so malicious patterns can
 * never normalise into the field index. Per the Phase 7 R&D doc:
 *
 *   1. validation.status === 'errors'  → reject
 *   2. any behavior.malicious.* finding present → reject
 *   3. any behavior.static.* finding at ERROR level → reject
 *
 * For Phase 7a foundation we gate on (1) only — validate findings are
 * available synchronously at /api/analyze response time. Behavior + static
 * findings arrive asynchronously via /api/analyze-behavior; tightening the
 * gate to consider them is Phase 7b once the post-analyze re-evaluation
 * loop lands.
 *
 * Returns: { allow: bool, reason: string|null }
 *   allow=true  → observer should record this bid
 *   allow=false → reason explains why (logged at debug level by observer)
 */

function isLearnable(validation, behaviorFindings) {
  if (!validation || typeof validation !== 'object') {
    return { allow: false, reason: 'no-validation' };
  }
  if (validation.status === 'errors' || validation.status === 'invalid') {
    return { allow: false, reason: 'validation-' + validation.status };
  }

  // Optional: check behavior findings if caller passed them. Phase 7a
  // typically calls without this arg.
  if (Array.isArray(behaviorFindings) && behaviorFindings.length > 0) {
    for (const f of behaviorFindings) {
      if (!f || typeof f.id !== 'string') continue;
      if (f.id.startsWith('behavior.malicious.')) {
        return { allow: false, reason: 'behavior-malicious:' + f.id };
      }
      if (f.id.startsWith('behavior.static.') && f.level === 'error') {
        return { allow: false, reason: 'static-error:' + f.id };
      }
    }
  }

  return { allow: true, reason: null };
}

module.exports = { isLearnable };
