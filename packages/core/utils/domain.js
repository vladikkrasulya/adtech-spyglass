'use strict';

/**
 * Shared domain-name validator.
 *
 * Accepts: openx.com, ad.example.co.uk, doubleclick.net
 * Rejects: bare labels (localhost), labels with underscores, URLs,
 *          strings with spaces, null/undefined.
 *
 * Intentionally minimal — no DNS lookup, no punycode expansion, no
 * trailing-dot tolerance. The goal is to catch obvious typos and
 * non-domain strings that slip into domain fields.
 */

// Each label: starts+ends with alnum, may contain hyphens internally.
// Require at least one dot (so localhost fails) and a TLD of ≥2 alpha chars.
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Returns true when  looks like a plausible domain name.
 * @param {unknown} v
 * @returns {boolean}
 */
function isValidDomain(v) {
  return typeof v === 'string' && v.length > 0 && DOMAIN_RE.test(v);
}

module.exports = { isValidDomain, DOMAIN_RE };
