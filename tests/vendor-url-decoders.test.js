'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../packages/core');
const { loadCorpus } = require('./corpus/lib/load');

const PPC =
  'https://exchange.example/?pubid=12&ip=192.0.2.44&useragent=Agent%2F1&domain=publisher.example';
const KADAM = 'https://exchange.example/feed?sid=12&ua=Agent%2F1&ip=192.0.2.44&uid=user-1&pid=34';
const ADON3 = 'https://exchange.example/v1/feed/opaque-key?ip=192.0.2.44&ua=Agent%2F1';
const EXADS =
  'https://exchange.example/rtb.php?id=req-1&ip=192.0.2.44&language=en&type=push_notification&ua=Agent%2F1&url=https%3A%2F%2Fpublisher.example%2Fpage&user_id=user-1&export=json';

function validated(url, variant) {
  const result = Core.validate(url);
  assert.equal(result.type, 'URL Request');
  assert.equal(result.urlRequest?.variant, variant);
  assert.ok(!result.findings.some((f) => f.level === 'error'), JSON.stringify(result.findings));
  return result;
}

function finding(result, id, level, path) {
  const f = result.findings.find((item) => item.id === id && item.path === path);
  assert.ok(f, `${id}@${path}: ${JSON.stringify(result.findings)}`);
  assert.equal(f.level, level);
  return f;
}

for (const c of loadCorpus({ caseFilter: '', formatFilter: '' }).all) {
  const group = c.meta.knownGap?.id;
  if (
    typeof c.request !== 'string' ||
    !['DEF-106', 'DEF-107', 'DEF-108', 'DEF-441'].includes(group)
  )
    continue;
  const family =
    group === 'DEF-108'
      ? 'adon3'
      : group === 'DEF-106'
        ? 'exads'
        : c.request.includes('pubid=')
          ? 'ppcmate'
          : 'kadam';
  test(`vendor GET public regression: ${c.id}`, () => {
    const result = validated(c.request, `url-${family}-feed`);
    assert.equal(result.urlRequest.url, c.request);
    if (family === 'adon3') {
      assert.equal(result.urlRequest.meta.contractStatus, 'provisional-unsupported');
      finding(result, 'request.url.provisional_contract', 'warning', '');
    }
  });
}

test('PPCmate: optional feedid, independent host and distinct serialization/ad type', () => {
  for (const host of ['other.example', '127.0.0.1:9876', 'localhost:9876']) {
    const url =
      PPC.replace('exchange.example', host) + '&subscription_timestamp=1788739200&format=xml';
    const can = validated(url, 'url-ppcmate-feed').urlRequest;
    assert.equal(can.format, 'push');
    assert.equal(can.device.ua, 'Agent/1');
    assert.equal(can.device.ip, '192.0.2.44');
    assert.equal(can.site.page, 'publisher.example');
    assert.equal(can._raw.format, 'xml');
  }
  const pop = validated(PPC + '&format=json&impression-number=0', 'url-ppcmate-feed').urlRequest;
  assert.equal(pop.format, 'pops');
  const ambiguous = validated(PPC + '&format=json', 'url-ppcmate-feed');
  assert.equal(ambiguous.urlRequest.format, undefined);
  finding(ambiguous, 'request.url.format_ambiguous', 'warning', '');
});

test('PPCmate: conflicting subtype evidence stays ambiguous', () => {
  const result = validated(
    PPC + '&subscription_timestamp=1&impression-number=2',
    'url-ppcmate-feed',
  );
  assert.equal(result.urlRequest.format, undefined);
  finding(result, 'request.url.format_ambiguous', 'warning', '');
});

test('Kadam: skey is optional and omission of subscription age does not imply inpage', () => {
  const without = validated(KADAM, 'url-kadam-feed').urlRequest;
  const withAge = validated(KADAM + '&subage=2', 'url-kadam-feed').urlRequest;
  assert.equal(without.format, undefined);
  assert.equal(withAge.format, undefined);
  assert.equal(without.user.id, 'user-1');
  for (const token of ['native', 'teaser']) {
    assert.equal(
      validated(KADAM + `&format=${token}`, 'url-kadam-feed').urlRequest.format,
      'native',
    );
  }
  for (const token of ['cu', 'pops']) {
    const can = validated(KADAM + `&format=${token}`, 'url-clickunder-feed').urlRequest;
    assert.equal(can.format, 'pops', 'existing earlier decoder keeps precedence');
  }
});

test('Kadam: ipv6-only and both address families are retained', () => {
  const dual = validated(
    KADAM + '&ipv6=2001%3Adb8%3A%3A44&language=uk&page=publisher.example',
    'url-kadam-feed',
  ).urlRequest;
  assert.equal(dual.device.ip, '192.0.2.44');
  assert.equal(dual.device.ipv6, '2001:db8::44');
  assert.equal(dual.device.language, 'uk');
  assert.equal(dual.site.page, 'publisher.example');
  const v6 = validated(
    KADAM.replace('ip=192.0.2.44', 'ipv6=2001%3Adb8%3A%3A44'),
    'url-kadam-feed',
  ).urlRequest;
  assert.equal(v6.device.ip, undefined);
  assert.equal(v6.device.ipv6, '2001:db8::44');
});

test('EXADS: GET adapter shares request validation without requiring example account keys', () => {
  const can = validated(EXADS, 'url-exads-feed').urlRequest;
  assert.equal(can.device.ua, 'Agent/1');
  assert.equal(can.device.language, 'en');
  assert.equal(can.user.id, 'user-1');
  assert.equal(can.site.page, 'https://publisher.example/page');
  assert.equal(can.meta.vendorRequest.export, 'json');
  assert.equal(can._raw.url, 'https%3A%2F%2Fpublisher.example%2Fpage');
  assert.equal(can.meta.vendorRequest.idzone, undefined);
});

test('EXADS: GET sub is retained as a string without coercing strict JSON types', () => {
  const result = validated(EXADS + '&sub=123456', 'url-exads-feed');
  assert.equal(result.urlRequest.meta.vendorRequest.sub, '123456');
  assert.equal(result.urlRequest._raw.sub, '123456');
  const malformed = Core.validate(EXADS.replace('ua=Agent%2F1', 'ua=%20%09'));
  assert.equal(malformed.urlRequest.variant, 'url-exads-feed');
  assert.ok(malformed.findings.some((f) => f.level === 'error' && f.path === 'ua'));
});

test('Adon3: minimal request stays provisional and cannot infer format from feed key', () => {
  const result = validated(ADON3.replace('opaque-key', 'push-pop-native'), 'url-adon3-feed');
  assert.equal(result.status, 'warnings');
  assert.equal(result.urlRequest.format, undefined);
  assert.equal(result.urlRequest.meta.contractStatus, 'provisional-unsupported');
  finding(result, 'request.url.provisional_contract', 'warning', '');
  const lax = Core.validate(ADON3, { strictness: 'lax' });
  assert.equal(lax.urlRequest.meta.contractStatus, 'provisional-unsupported');
});

test('Adon3: explicit subtype fields and aliases preserve opaque decoded values', () => {
  const pop = validated(
    ADON3 +
      '&pop_type=under&ref=https%3A%2F%2Fpublisher.example%2F%3Fa%3D1%26b%3D2&uid=visit-1&lang=en-GB',
    'url-adon3-feed',
  ).urlRequest;
  assert.equal(pop.format, 'pops');
  assert.equal(pop.site.page, 'https://publisher.example/?a=1&b=2');
  assert.equal(pop.user.id, 'visit-1');
  assert.equal(pop.device.language, 'en-GB');
  const push = validated(
    ADON3 + '&image_size=360x240&icon_size=192x192',
    'url-adon3-feed',
  ).urlRequest;
  assert.equal(push.format, 'push');
  const conflict = validated(ADON3 + '&pop_type=over&img_size=360x240', 'url-adon3-feed');
  assert.equal(conflict.urlRequest.format, undefined);
  finding(conflict, 'request.url.format_ambiguous', 'warning', '');
});

test('new vendors preserve first values, encoding and damage warnings', () => {
  for (const [url, variant, key] of [
    [PPC, 'ppcmate', 'useragent'],
    [KADAM, 'kadam', 'ua'],
    [EXADS, 'exads', 'ua'],
    [ADON3, 'adon3', 'ua'],
  ]) {
    const input =
      url.replace(`${key}=Agent%2F1`, `${key}=First%2BAgent%26safe`) +
      `&${key}=Second&cb=%%CACHEBUSTER%%`;
    const result = validated(input, `url-${variant}-feed`);
    assert.equal(result.urlRequest.device.ua, 'First+Agent&safe');
    assert.equal(result.urlRequest._raw[key], 'First%2BAgent%26safe');
    assert.equal(result.urlRequest._raw.cb, '%%CACHEBUSTER%%');
    finding(result, 'request.url.query_value_decode_damage', 'warning', 'cb');
    const repair = validated(input.replaceAll('&', '&amp;'), `url-${variant}-feed`);
    assert.equal(repair.urlRequest.repairs[0].before, input.replaceAll('&', '&amp;'));
    assert.equal(repair.urlRequest._raw.cb, '%%CACHEBUSTER%%');
  }
});

test('encoded query names and double-encoded values are not decoded twice', () => {
  const input = PPC.replace('pubid=12', 'pub%69d=12').replace(
    'useragent=Agent%2F1',
    'useragent=A%252FB',
  );
  const can = validated(input, 'url-ppcmate-feed').urlRequest;
  assert.equal(can.device.ua, 'A%2FB');
  assert.equal(can._raw['pub%69d'], '12');
  assert.equal(can._raw.pubid, undefined);
});

test('new family claims reject unrelated paths, missing signatures, userinfo, fragments and wrong case', () => {
  const denied = [
    'https://exchange.example/?pubid=12&domain=publisher.example',
    'https://exchange.example/feed?sid=12&ua=Agent',
    'https://exchange.example/rtb.php?idzone=12&fid=key',
    ADON3.replace('/opaque-key', '/'),
    ADON3.replace('/opaque-key', '/a/b'),
    ADON3.replace('/opaque-key', '/a%2Fb'),
    ADON3.replace('/opaque-key', '/a%'),
  ];
  for (const url of [PPC, KADAM, EXADS, ADON3]) {
    denied.push(url.replace('https://', 'https://name:pass@'));
    denied.push(url + '#not-transmitted');
    if (url !== EXADS) denied.push(url.replace('ip=', 'IP='));
    denied.push(url.replace('exchange.example/', 'exchange.example/unrelated/'));
  }
  for (const url of denied) finding(Core.validate(url), 'request.url.no_decoder', 'error', '');
  for (const url of [PPC, KADAM, EXADS, ADON3]) {
    finding(
      Core.validate(url.replace('https:', 'ftp:')),
      'request.url.unsupported_scheme',
      'error',
      '',
    );
  }
  const wrongCase = Core.validate(EXADS.replace('ip=', 'IP='));
  assert.equal(wrongCase.urlRequest?.device?.ip, undefined);
  assert.ok(wrongCase.findings.some((f) => f.level === 'error' && f.path === 'ip'));
});

test('recognized families diagnose blank and invalid supplied values at original query paths', () => {
  for (const [url, key, value] of [
    [PPC, 'pubid', 'word'],
    [PPC, 'useragent', ' '],
    [PPC, 'domain', '\t'],
    [KADAM, 'sid', ''],
    [KADAM, 'uid', ' '],
    [KADAM, 'pid', '\n'],
    [ADON3, 'ip', ''],
    [ADON3, 'ua', ' '],
  ]) {
    const input = new URL(url);
    input.searchParams.set(key, value);
    finding(Core.validate(input.href), 'request.url.parameter_invalid', 'error', key);
  }
  for (const [url, key, value] of [
    [PPC, 'subscription_timestamp', 'tomorrow'],
    [PPC, 'format', 'yaml'],
    [KADAM, 'format', 'invented'],
    [ADON3, 'pop_type', 'middle'],
    [ADON3, 'format', 'yaml'],
  ]) {
    finding(Core.validate(url + `&${key}=${value}`), 'request.url.parameter_invalid', 'error', key);
  }
});
