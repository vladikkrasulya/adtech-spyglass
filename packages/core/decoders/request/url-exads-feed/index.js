'use strict';

const { isExadsRequest, exadsRequestFormat } = require('../../../vendor-exads');
const { isVendorEndpoint, readQueryFields, decodeVendorFeed } = require('../_vendor-feed');

const ID = 'url-exads-feed';

function detect(_text, parsedUrl) {
  // Account credentials in the documentation examples are not required
  // signature fields. The shared owner recognizes actual field presence.
  return isVendorEndpoint(parsedUrl, '/rtb.php') && isExadsRequest(readQueryFields(parsedUrl));
}

function decode(text, parsedUrl) {
  const can = decodeVendorFeed(ID, text, parsedUrl, {
    ua: 'ua',
    language: 'language',
    page: 'url',
    user: 'user_id',
  });
  const format = exadsRequestFormat(can.meta.vendorRequest);
  if (format) can.format = format;
  return can;
}

module.exports = { id: ID, description: 'EXADS-shaped proprietary GET request.', detect, decode };
