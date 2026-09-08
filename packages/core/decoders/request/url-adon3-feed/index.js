'use strict';

const {
  isVendorEndpoint,
  decodeVendorFeed,
  nonblank,
  unsignedInteger,
  serialization,
} = require('../_vendor-feed');

const ID = 'url-adon3-feed';
const requiredParameters = ['ip', 'ua'];
const size = (value) => typeof value === 'string' && /^[1-9]\d*x[1-9]\d*$/.test(value);
const parameterValidators = {
  ip: nonblank,
  ua: nonblank,
  pop_type: (value) => value === 'under' || value === 'over',
  format: serialization,
  encoding: serialization,
  img_size: size,
  image_size: size,
  icon_size: size,
  sub_age: unsignedInteger,
  subscription_age: unsignedInteger,
  n: (value) => typeof value === 'string' && /^[1-5]$/.test(value),
};

function detect(_text, parsedUrl) {
  if (!isVendorEndpoint(parsedUrl, parsedUrl.pathname)) return false;
  const match = /^\/v1\/feed\/([^/]+)$/.exec(parsedUrl.pathname);
  if (!match) return false;
  // The provisioned key is opaque, but it is exactly one path segment.
  // Decode once solely to reject an escaped slash or malformed encoding.
  try {
    const key = decodeURIComponent(match[1]);
    if (
      key.includes('/') ||
      key.includes('\\') ||
      /\s/.test(key) ||
      [...key].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      return false;
  } catch {
    return false;
  }
  return requiredParameters.every((key) => parsedUrl.searchParams.has(key));
}

function decode(text, parsedUrl) {
  const can = decodeVendorFeed(ID, text, parsedUrl, { ua: 'ua', language: 'lang', user: 'uid' });
  const fields = can.meta.vendorRequest;
  const page = fields.referrer ?? fields.ref;
  if (page) can.site.page = page;
  can.meta.contractStatus = 'provisional-unsupported';
  const pop = Object.hasOwn(fields, 'pop_type');
  const push = ['img_size', 'image_size', 'icon_size', 'sub_age', 'subscription_age'].some((key) =>
    Object.hasOwn(fields, key),
  );
  if (pop !== push) can.format = pop ? 'pops' : 'push';
  else can.meta.formatAmbiguous = true;
  return can;
}

module.exports = {
  id: ID,
  description: 'Provisional Adon3-shaped feed inspection; vendor support unconfirmed.',
  detect,
  decode,
  requiredParameters,
  parameterValidators,
};
