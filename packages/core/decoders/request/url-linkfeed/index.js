'use strict';

/**
 * Decoder: URL-style JSON link-feed `GET …/link?format=json&feed=…&auth=…`.
 *
 * Detection is host-agnostic and shape-based (per the IAB-pure core policy:
 * vendors are recognised by request shape, never by a hardcoded vendor host).
 * The signature is a JSON feed pull carrying a feed id + auth token:
 *   GET http://<host>/link
 *     ?format=json
 *     &feed=<id>
 *     &auth=<token>
 *     &subid=<publisher_sub>
 *     &user_ip=<ipv4|ipv6>
 *     &ua=<urlencoded UA string>
 *     &url=<referring page URL>
 *     &ch-ua=<Sec-CH-UA verbatim>
 *     &ch-uafull=<Sec-CH-UA-Full-Version>
 *     &ch-platform=<Android|Windows|…>
 *     &ch-platformv=<platform version, can be empty>
 *     &ch-mobile=<?0|?1>
 *     &ch-model=<device model, can be empty>
 *     &ad_info=<flag>
 *     &lang=<ISO 639-1>
 *
 * Response shape (handled separately by rules-feed dispatch):
 *   { "result": { "link": [{ "bid": <float>, "url": "<click>", "seat": "<id>" }] } }
 */

const { decodeAuthenticatedJsonFeed } = require('../_authenticated-json-feed');
const { pathEquals, getParam, hasParam, valueEquals } = require('../_signature');

const ID = 'url-linkfeed';
const PATH = '/link';

function detect(_text, parsedUrl) {
  // Shape fingerprint: the /link path plus the JSON-feed param triad
  // (format=json + feed id + auth token). Host-independent so any vendor
  // shipping this URL-feed shape is decoded, and no vendor name lives in code.
  // Case-insensitive, and tolerant of a trailing slash, like its siblings.
  if (!pathEquals(parsedUrl.pathname, PATH)) return false;
  const q = parsedUrl.searchParams;
  return valueEquals(getParam(q, 'format'), 'json') && hasParam(q, 'feed') && hasParam(q, 'auth');
}

function decode(text, parsedUrl) {
  return decodeAuthenticatedJsonFeed(ID, text, parsedUrl, { format: 'pops' });
}

module.exports = {
  id: ID,
  description: 'URL-style link-feed GET request decoder.',
  detect,
  decode,
};
