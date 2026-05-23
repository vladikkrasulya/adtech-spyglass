'use strict';

/**
 * Decoder: pushub `xml.pushub.net/link` endpoint.
 *
 * Pushub clickunder/teaser request signature (observed 2026-05-21):
 *   GET http://xml.pushub.net/link
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
 * Response shape (handled separately by rules-feed dispatch — pending
 * pushub entry there too):
 *   { "result": { "link": [{ "bid": <float>, "url": "<click>", "seat": "<id>" }] } }
 */

const { makeCanonicalUrlRequest } = require('../_canonical');

const ID = 'pushub-link';
const HOST = 'xml.pushub.net';
const PATH = '/link';

function detect(_text, parsedUrl) {
  return parsedUrl.hostname === HOST && parsedUrl.pathname === PATH;
}

function isIPv6(s) {
  return typeof s === 'string' && s.includes(':');
}

function decode(text, parsedUrl) {
  const can = makeCanonicalUrlRequest(ID, text);
  can.endpoint = `${parsedUrl.hostname}${parsedUrl.pathname}`;

  const q = parsedUrl.searchParams;
  const raw = {};
  for (const [k, v] of q.entries()) raw[k] = v;
  can._raw = raw;

  const ip = q.get('user_ip');
  if (ip) {
    if (isIPv6(ip)) can.device.ipv6 = ip;
    else can.device.ip = ip;
  }

  const ua = q.get('ua');
  if (ua) can.device.ua = ua;

  const lang = q.get('lang');
  if (lang) can.device.language = lang;

  const sua = {};
  if (q.get('ch-ua')) sua.brands = q.get('ch-ua');
  if (q.get('ch-uafull')) sua.fullVersion = q.get('ch-uafull');
  if (q.get('ch-platform')) sua.platform = q.get('ch-platform');
  if (q.get('ch-platformv')) sua.platformVersion = q.get('ch-platformv');
  if (q.get('ch-mobile')) sua.mobile = q.get('ch-mobile');
  if (q.get('ch-model')) sua.model = q.get('ch-model');
  if (Object.keys(sua).length) can.device.sua = sua;

  const refUrl = q.get('url');
  if (refUrl) can.site.page = refUrl;

  const subid = q.get('subid');
  if (subid) can.user.id = subid;

  return can;
}

module.exports = {
  id: ID,
  description: 'Pushub clickunder/teaser GET request (xml.pushub.net/link).',
  detect,
  decode,
};
