'use strict';

/**
 * Decoder: URL-style authenticated JSON search-feed GET request.
 *
 * Detection is deliberately host-agnostic and shape-based. `/search` by
 * itself is far too generic, so the decoder requires the endpoint path plus
 * the JSON/feed/auth/query parameter signature. Account identifiers and
 * vendor hostnames do not belong in this module.
 */

const { decodeAuthenticatedJsonFeed } = require('../_authenticated-json-feed');
const { pathEquals, getParam, hasParam, valueEquals } = require('../_signature');

const ID = 'url-search-feed';
const PATH = '/search';

function detect(_text, parsedUrl) {
  // URL feeds are HTTP requests. Reject userinfo and fragments: neither is
  // part of the observed wire shape, and a fragment is never sent upstream.
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return false;
  if (parsedUrl.username || parsedUrl.password || parsedUrl.hash) return false;
  // Case-insensitive throughout: a pasted `/SEARCH?FORMAT=json` is the same
  // feed. Matching is loose, the URL itself is preserved exactly — see
  // `_signature.js`.
  if (!pathEquals(parsedUrl.pathname, PATH)) return false;
  const q = parsedUrl.searchParams;
  return (
    valueEquals(getParam(q, 'format'), 'json') &&
    hasParam(q, 'feed') &&
    hasParam(q, 'auth') &&
    hasParam(q, 'query')
  );
}

function decode(text, parsedUrl) {
  // Search-feed responses can carry text/native-like listings. Do not infer
  // an ad format from `format=json`, which describes serialization only.
  return decodeAuthenticatedJsonFeed(ID, text, parsedUrl);
}

module.exports = {
  id: ID,
  description: 'URL-style authenticated JSON search-feed GET request decoder.',
  detect,
  decode,
};
