'use strict';

const { makeCanonicalUrlRequest } = require('./_canonical');
const { parseRawQuery, findDecodeDamage } = require('./_raw-query');

/** New vendor contracts use exact, case-sensitive protocol field names. */
function readQueryFields(parsedUrl) {
  const fields = Object.create(null);
  for (const [key, value] of parsedUrl.searchParams) {
    if (!Object.hasOwn(fields, key)) fields[key] = value;
  }
  return fields;
}

/** Authentication in userinfo and fragments are outside these GET contracts. */
function isVendorEndpoint(parsedUrl, path) {
  return (
    !parsedUrl.username && !parsedUrl.password && !parsedUrl.hash && parsedUrl.pathname === path
  );
}

const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;
const unsignedInteger = (value) => typeof value === 'string' && /^\d+$/.test(value);
const serialization = (value) => value === 'json' || value === 'xml';

/**
 * Preserve one decoded first-value reading alongside the authoritative encoded
 * query. Vendor owners supply only the field names that have a direct meaning.
 * No field is manufactured for an absent query key; in particular EXADS uses
 * actual key presence to recognize incomplete requests.
 */
function decodeVendorFeed(id, text, parsedUrl, mapping) {
  const can = makeCanonicalUrlRequest(id, text);
  can.endpoint = `${parsedUrl.hostname}${parsedUrl.pathname}`;
  can._raw = parseRawQuery(parsedUrl.search);
  for (const { key, decoded } of findDecodeDamage(parsedUrl.searchParams, can._raw)) {
    can.warnings.push({ code: 'query_value_decode_damage', param: key, decoded });
  }

  const fields = readQueryFields(parsedUrl);
  can.meta.vendorRequest = fields;
  const ip = fields.ip;
  if (ip) {
    if (ip.includes(':')) can.device.ipv6 = ip;
    else can.device.ip = ip;
  }
  if (fields.ipv6) can.device.ipv6 = fields.ipv6;
  for (const [source, destination] of [
    [mapping.ua, 'ua'],
    [mapping.language, 'language'],
  ]) {
    if (source && fields[source]) can.device[destination] = fields[source];
  }
  if (mapping.page && fields[mapping.page]) can.site.page = fields[mapping.page];
  if (mapping.user && fields[mapping.user]) can.user.id = fields[mapping.user];
  return can;
}

module.exports = {
  readQueryFields,
  isVendorEndpoint,
  decodeVendorFeed,
  nonblank,
  unsignedInteger,
  serialization,
};
