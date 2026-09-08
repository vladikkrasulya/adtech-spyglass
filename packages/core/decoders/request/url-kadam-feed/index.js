'use strict';

const { isVendorEndpoint, decodeVendorFeed, nonblank } = require('../_vendor-feed');

const ID = 'url-kadam-feed';
const requiredParameters = ['sid', 'ua', 'uid', 'pid'];
const parameterValidators = {
  sid: nonblank,
  ua: nonblank,
  uid: nonblank,
  pid: nonblank,
  ip: nonblank,
  ipv6: nonblank,
  format: (value) => ['push', 'native', 'teaser', 'cu', 'pops'].includes(value),
};

function detect(_text, parsedUrl) {
  const q = parsedUrl.searchParams;
  return (
    isVendorEndpoint(parsedUrl, '/feed') &&
    requiredParameters.every((key) => q.has(key)) &&
    (q.has('ip') || q.has('ipv6'))
  );
}

function decode(text, parsedUrl) {
  const can = decodeVendorFeed(ID, text, parsedUrl, {
    ua: 'ua',
    language: 'language',
    page: 'page',
    user: 'uid',
  });
  const format = can.meta.vendorRequest.format;
  if (format === 'native' || format === 'teaser') can.format = 'native';
  else if (format === 'cu' || format === 'pops') can.format = 'pops';
  else if (format === 'push') can.format = 'push';
  // Missing subscription age is also allowed for push; it does not establish
  // on-site push. Account provisioning is absent from the pasted wire.
  else if (format === undefined) can.meta.formatAmbiguous = true;
  return can;
}

module.exports = {
  id: ID,
  description: 'Kadam-shaped endpoint feed GET request.',
  detect,
  decode,
  requiredParameters,
  parameterValidators,
};
