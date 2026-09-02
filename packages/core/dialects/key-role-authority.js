'use strict';

/**
 * key-role-authority — the authority oracle: adjudication evidence → the
 * exact role-confidence score the spec REQUIRES (016 §Confidence and
 * authority oracle; FR-007, FR-026).
 *
 * Pure function, no I/O. The generator writes the derived score into the
 * adjudication manifest and CI recomputes it from the stored evidence — the
 * double-entry check of R-04. The result is required, not a maximum an
 * adjudicator may lower arbitrarily.
 *
 * The deterministic role layer returns ONLY these exact scores:
 * 0.90, 0.80, 0.70, 0.60, 0.40. The remaining band values belong to the
 * model's calibration contract, never to this table.
 */

/** The only scores the deterministic layer may emit. @type {readonly number[]} */
const EXACT_SCORES = Object.freeze([0.9, 0.8, 0.7, 0.6, 0.4]);

/**
 * One evidence attestation, reduced to what the oracle reads.
 *
 * @typedef {object} Attestation
 * @property {'schema'|'extension'} position  where the name was attested
 * @property {string} vendor                  attesting vendor/bidder (breadth key)
 * @property {boolean} semantic               source-written semantics (a real description
 *   or adapter behaviour), not mere presence of the name
 * @property {boolean} trusted                literal status is verified/confirmed;
 *   unverified attestations may support a candidate but cannot raise the
 *   score above 0.40
 */

/**
 * Derive the required exact score for a SINGULAR resolved role, or null when
 * the evidence does not establish one (the caller then records `abstain`;
 * conflicts are the caller's job and yield `ambiguous` before this runs).
 *
 * Rules, top row first, then every applicable cap (016 oracle table):
 *  0.90 — semantics in BOTH positions, ≥2 independent vendors, ≥1 trusted
 *          extension citation
 *  0.80 — extension-position semantics from ≥2 independent vendors
 *  0.60 — publisher-configuration semantics from ≥2 independent
 *          source-written descriptions
 *  0.40 — one admissible semantic attestation, or unverified-only support
 *          that still establishes one role
 *  null — nothing semantic at all
 *
 * Caps: repeated observations from one vendor add no breadth;
 * unverified-only support caps at 0.40; a generic key name caps at 0.40
 * (the caller passes `genericKey` from the named-rule `cap` outcome).
 *
 * @param {Attestation[]} attestations
 * @param {{genericKey?: boolean}} [opts]
 * @returns {number|null}
 */
function deriveScore(attestations, opts = {}) {
  const semantic = (attestations || []).filter((a) => a && a.semantic);
  if (semantic.length === 0) return null;

  const vendors = (list) => new Set(list.map((a) => a.vendor)).size;
  const ext = semantic.filter((a) => a.position === 'extension');
  const sch = semantic.filter((a) => a.position === 'schema');
  const anyTrusted = semantic.some((a) => a.trusted);
  const trustedExt = ext.some((a) => a.trusted);

  let score;
  if (ext.length && sch.length && vendors(semantic) >= 2 && trustedExt) score = 0.9;
  else if (vendors(ext) >= 2) score = 0.8;
  else if (vendors(sch) >= 2) score = 0.6;
  else score = 0.4;

  // Caps are a final pass, lowest applicable wins (mirrors the persona's
  // own ceiling discipline — a cap is a maximum, not a target).
  if (!anyTrusted) score = Math.min(score, 0.4);
  if (opts.genericKey) score = Math.min(score, 0.4);

  return score;
}

module.exports = { deriveScore, EXACT_SCORES };
