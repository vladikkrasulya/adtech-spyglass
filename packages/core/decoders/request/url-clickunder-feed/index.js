'use strict';

/**
 * Decoder: URL-style clickunder/pop feed `GET .../feed?format=cu...`.
 *
 * Host-independent by design. The stable signature is the endpoint family
 * (`/feed`) plus a pop-format query value (`cu`, `pop`, `pops`,
 * `popunder`, `clickunder`). Real integrations vary parameter names for
 * page/user/ip, so decode normalises only the fields that map cleanly to the
 * canonical URL request shape and preserves everything else in `_raw`.
 */

const { makeCanonicalUrlRequest } = require('../_canonical');
const { isPopFormat, normaliseFormatName } = require('../../../non-iab-formats');

const ID = 'url-clickunder-feed';
const PATH = '/feed';
const FORMAT_ALIASES = new Set(['cu', 'clickunder', 'pop', 'pops', 'popup', 'popunder']);

function normalisedQueryFormat(q) {
  const raw = q.get('format') || q.get('ad_format') || q.get('type') || q.get('adtype') || '';
  return normaliseFormatName(raw);
}

function detect(_text, parsedUrl) {
  if (parsedUrl.pathname.replace(/\/+$/, '') !== PATH) return false;
  const q = parsedUrl.searchParams;
  const fmt = normalisedQueryFormat(q);
  return FORMAT_ALIASES.has(fmt) || isPopFormat(fmt);
}

function isIPv6(s) {
  return typeof s === 'string' && s.includes(':');
}

function firstParam(q, names) {
  for (const name of names) {
    const value = q.get(name);
    if (value) return value;
  }
  return null;
}

function decode(text, parsedUrl) {
  const can = makeCanonicalUrlRequest(ID, text);
  can.endpoint = `${parsedUrl.hostname}${parsedUrl.pathname}`;
  can.format = 'pops';

  const q = parsedUrl.searchParams;
  const raw = {};
  for (const [k, v] of q.entries()) raw[k] = v;
  can._raw = raw;

  const ip = firstParam(q, ['ip', 'user_ip', 'userip', 'uip']);
  if (ip) {
    if (isIPv6(ip)) can.device.ipv6 = ip;
    else can.device.ip = ip;
  }

  const ua = firstParam(q, ['ua', 'user_agent', 'useragent']);
  if (ua) can.device.ua = ua;

  const lang = firstParam(q, ['language', 'lang']);
  if (lang) can.device.language = lang;

  const refUrl = firstParam(q, ['page', 'url', 'site', 'ref']);
  if (refUrl) can.site.page = refUrl;

  const userId = firstParam(q, ['uid', 'user_id', 'subid', 'sub_id']);
  if (userId) can.user.id = userId;

  return can;
}

module.exports = {
  id: ID,
  description: 'URL-style clickunder/pop feed GET request decoder.',
  detect,
  decode,
};
