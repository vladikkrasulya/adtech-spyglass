'use strict';

const {
  isVendorEndpoint,
  decodeVendorFeed,
  nonblank,
  unsignedInteger,
  serialization,
} = require('../_vendor-feed');

const ID = 'url-ppcmate-feed';
const requiredParameters = ['pubid', 'ip', 'useragent', 'domain'];
const parameterValidators = {
  pubid: unsignedInteger,
  ip: nonblank,
  useragent: nonblank,
  domain: nonblank,
  feedid: unsignedInteger,
  subscription_timestamp: unsignedInteger,
  'impression-number': unsignedInteger,
  'max-banners': (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value),
  format: serialization,
};

function detect(_text, parsedUrl) {
  return (
    isVendorEndpoint(parsedUrl, '/') &&
    requiredParameters.every((key) => parsedUrl.searchParams.has(key))
  );
}

function decode(text, parsedUrl) {
  const can = decodeVendorFeed(ID, text, parsedUrl, {
    ua: 'useragent',
    language: 'lang',
    page: 'domain',
    user: 'user_id',
  });
  const fields = can.meta.vendorRequest;
  const push = Object.hasOwn(fields, 'subscription_timestamp');
  const pop = Object.hasOwn(fields, 'impression-number');
  // JSON/XML names select serialization, not the endpoint's inventory type.
  if (push !== pop) can.format = push ? 'push' : 'pops';
  else can.meta.formatAmbiguous = true;
  return can;
}

module.exports = {
  id: ID,
  description: 'PPCmate-shaped publisher feed GET request.',
  detect,
  decode,
  requiredParameters,
  parameterValidators,
};
