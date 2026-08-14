'use strict';

/**
 * Findings for a consent bit that does not mean what reading it suggests.
 *
 * A TC string carries a per-vendor consent bit, and it is tempting to treat that
 * bit as the answer to "may this vendor process for this purpose". It is not.
 * The publisher can restrict a purpose for specific vendors from inside the same
 * string, and that restriction overrides the bit. Measured on a perfectly
 * ordinary string: the naive reading and the correct one disagreed on eight of
 * ten purposes, and nothing threw at any point.
 *
 * The part implemented here needs no vendor list and no network, because
 * publisher restrictions travel in the string itself. Verified directly: a
 * string decodes with `vendorConsents.has(755) === true` while its publisher
 * restriction for purpose 3 reads NOT_ALLOWED, with no GVL attached.
 *
 * The other half of a full permission decision — whether the vendor declares
 * that purpose under consent or legitimate interest at all — requires the Global
 * Vendor List, which requires a network fetch. That is deliberately out of
 * scope; this module reports the contradictions the string can prove on its own
 * and says nothing about the rest.
 *
 * Nothing here is an error. A restriction that contradicts a bit is a real and
 * common publisher configuration, not a malformed payload; what makes it worth
 * reporting is that a downstream reader checking only the bit will act on the
 * opposite of the truth.
 */

const { checkTcString } = require('./tcstring-sanity');
const { makeFinding, LEVELS } = require('./findings');

/** TCF restriction types, from the Consent String and Vendor List spec. */
const NOT_ALLOWED = 0;
const REQUIRE_CONSENT = 1;
const REQUIRE_LI = 2;

/** Where a TCF v2 string is carried in a bid request. */
const CONSENT_PATHS = [
  ['user', 'consent'],
  ['user', 'ext', 'consent'],
];

/**
 * @param {unknown} obj
 * @param {string[]} path
 * @returns {unknown}
 */
function at(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Vendor ids named by a section, whichever encoding it used.
 *
 * @param {{ids?: number[]}|null} section
 * @returns {Set<number>}
 */
function vendorIds(section) {
  return new Set(Array.isArray(section && section.ids) ? section.ids : []);
}

/**
 * Report vendors whose consent bit is contradicted by the same string.
 *
 * @param {unknown} payload Parsed bid request.
 * @returns {{ findings: Array<Object> }}
 */
function validateTcfPermission(payload) {
  const findings = [];
  if (payload === null || typeof payload !== 'object') return { findings };

  for (const path of CONSENT_PATHS) {
    const value = at(payload, path);
    if (typeof value !== 'string' || value.length === 0) continue;

    const result = checkTcString(value);
    const core = result && result.core;
    if (!core || !Array.isArray(core.publisherRestrictions)) continue;

    const consented = vendorIds(core.vendorConsent);
    const legitimate = vendorIds(core.vendorLegitimateInterest);
    const purposeConsented = new Set(
      Array.isArray(core.purposesConsent) ? core.purposesConsent : [],
    );
    const dotted = path.join('.');

    for (const restriction of core.publisherRestrictions) {
      const restricted = vendorIds(restriction.vendors);
      if (restricted.size === 0) continue;
      const purpose = restriction.purposeId;

      if (restriction.restrictionType === NOT_ALLOWED) {
        const contradicted = [...restricted].filter((v) => consented.has(v));
        if (contradicted.length) {
          findings.push(
            makeFinding('consent.tcf_restriction_overrides_consent', LEVELS.WARNING, dotted, {
              purpose,
              vendors: contradicted.slice(0, 12).join(', '),
              count: contradicted.length,
            }),
          );
        }
      }

      if (restriction.restrictionType === REQUIRE_LI) {
        const missingLi = [...restricted].filter((v) => consented.has(v) && !legitimate.has(v));
        if (missingLi.length) {
          findings.push(
            makeFinding('consent.tcf_requires_li_without_li', LEVELS.WARNING, dotted, {
              purpose,
              vendors: missingLi.slice(0, 12).join(', '),
              count: missingLi.length,
            }),
          );
        }
      }

      if (restriction.restrictionType === REQUIRE_CONSENT && !purposeConsented.has(purpose)) {
        findings.push(
          makeFinding('consent.tcf_requires_consent_without_purpose', LEVELS.WARNING, dotted, {
            purpose,
            count: restricted.size,
          }),
        );
      }
    }
  }

  return { findings };
}

module.exports = { validateTcfPermission, CONSENT_PATHS };
