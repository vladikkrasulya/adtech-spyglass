'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../packages/core');
const { loadCorpus } = require('./corpus/lib/load');
const { runCore } = require('./corpus/lib/core-run');
const { evaluate } = require('./corpus/lib/oracle');

const required = ['id', 'ip', 'language', 'type', 'ua', 'url', 'user_id', 'export'];
/** @returns {Record<string, any>} */
const request = (type = 'push_notification') => ({
  id: 'exads-synthetic-request',
  ip: '192.0.2.19',
  language: 'en',
  type,
  ua: 'Synthetic EXADS fixture',
  url: 'https://publisher.example.test/article',
  user_id: 'synthetic-user',
  export: 'json',
  sub: 123456,
});
/** @returns {{bid: Record<string, any>}} */
const response = () => ({
  bid: {
    id: 'exads-synthetic-request',
    value: 0.0125,
    btype: 2,
    iconUrl: 'https://assets.example.test/icon.png',
    clickUrl: 'https://advertiser.example.test/landing',
    nUrl: 'https://notice.example.test/win',
    title: 'An original icon notice',
    description: 'Synthetic source-shaped response',
  },
});
const finding = (result, id, path) =>
  result.findings.find((f) => f.id === id && (path === undefined || f.path === path));

const originalIds = [
  'inpage-exads-wrapper',
  'pop-exads-wrapper',
  'push-exads-icon-cpc',
  'cover-vendor-banner-exads-json',
  'cover-vendor-inpage-exads-url',
  'cover-vendor-push-exads-url',
];
const originalCases = loadCorpus({ caseFilter: originalIds.join(','), formatFilter: '' }).all;
assert.equal(originalCases.length, originalIds.length);
for (const c of originalCases) {
  test(`EXADS public contract: original normative carrier ${c.id}`, () => {
    const before = structuredClone({ request: c.request, response: c.response });
    const actual = runCore(c);
    assert.deepEqual(evaluate(actual, c.meta.expect, { layers: ['core'] }).failures, []);
    assert.deepEqual({ request: c.request, response: c.response }, before);
  });
}

test('EXADS public request: each omitted required field stays recognized and diagnosed', () => {
  for (const field of required) {
    for (const omission of ['absent', 'undefined']) {
      const value = request();
      if (omission === 'absent') delete value[field];
      else value[field] = undefined;
      const result = Core.validate(value);
      assert.equal(result.type, 'EXADS RTB Request', `${field}: ${omission}`);
      assert.equal(result.version.version, 'unknown');
      assert.equal(finding(result, 'request.exads.field_required', field)?.level, 'error');
      assert.equal(finding(result, 'request.exads.field_invalid', field), undefined);
    }
  }
});

test('EXADS public request: invalid supplied required values do not become omissions', () => {
  for (const field of required) {
    for (const invalid of [null, false, 7, [], {}, '', ' \t\n ']) {
      const result = Core.validate({ ...request(), [field]: invalid });
      assert.equal(result.type, 'EXADS RTB Request', field);
      assert.equal(finding(result, 'request.exads.field_invalid', field)?.level, 'error');
      assert.equal(finding(result, 'request.exads.field_required', field), undefined);
    }
  }
});

test('EXADS public request: banner alone requires size; inpage and icon push omit it', () => {
  const banner = Core.validate(request('banner'));
  assert.equal(finding(banner, 'request.exads.field_required', 'size')?.level, 'error');
  assert.equal(Core.validate({ ...request('banner'), size: '300x250' }).status, 'clean');
  for (const type of ['push_notification', 'in_page_push_notification', 'popunder']) {
    assert.equal(Core.validate(request(type)).status, 'clean', type);
  }
  for (const size of [null, 300, {}, [], '']) {
    assert.equal(
      finding(Core.validate({ ...request('banner'), size }), 'request.exads.field_invalid', 'size')
        ?.level,
      'error',
    );
  }
});

test('EXADS public request: unsupported subtype remains visible, export enum stays strict', () => {
  const unknownType = Core.validate({ ...request(), type: 'unconfirmed-format' });
  assert.equal(unknownType.type, 'EXADS RTB Request');
  assert.equal(finding(unknownType, 'request.exads.type_unsupported', 'type')?.level, 'warning');
  assert.deepEqual(Core.detectFormat({ ...request(), type: 'unconfirmed-format' }).formats, []);
  assert.equal(Core.validate({ ...request(), export: 'xml' }).status, 'clean');
  assert.equal(
    finding(
      Core.validate({ ...request(), export: 'html' }),
      'request.exads.export_invalid',
      'export',
    )?.level,
    'error',
  );
});

test('EXADS public request: JSON sub is an integer; conflicting short examples get guidance', () => {
  for (const sub of ['123456', null, false, -1, 123456.5, NaN, Infinity, [], {}]) {
    assert.equal(
      finding(Core.validate({ ...request(), sub }), 'request.exads.field_invalid', 'sub')?.level,
      'error',
    );
  }
  for (const sub of [1234, 0, 12345678901]) {
    const result = Core.validate({ ...request(), sub });
    assert.equal(finding(result, 'request.exads.sub_nonstandard', 'sub')?.level, 'warning');
    assert.ok(result.findings.every((f) => f.level !== 'error'));
  }
  const omitted = request();
  delete omitted.sub;
  assert.equal(Core.validate(omitted).status, 'clean');
});

test('EXADS public response: numeric price and CPM/CPC type never coerce supplied values', () => {
  for (const value of ['0.0125', null, true, '', [], [1], {}, NaN, Infinity, -0.01]) {
    const payload = response();
    payload.bid.value = value;
    assert.equal(
      finding(Core.validate(payload), 'feed.exads.value_invalid', 'bid.value')?.level,
      'error',
    );
  }
  for (const btype of ['1', null, false, 0, 3, 1.5, NaN, [], {}]) {
    const payload = response();
    payload.bid.btype = btype;
    assert.equal(
      finding(Core.validate(payload), 'feed.exads.btype_invalid', 'bid.btype')?.level,
      'error',
    );
  }
  for (const value of [0, 0.0125, 100]) {
    for (const btype of [1, 2, undefined]) {
      const payload = response();
      payload.bid.value = value;
      if (btype === undefined) delete payload.bid.btype;
      else payload.bid.btype = btype;
      const before = structuredClone(payload);
      const result = Core.validate(payload);
      assert.equal(result.type, 'EXADS RTB Response');
      assert.equal(result.version.version, 'unknown');
      assert.equal(result.status, 'clean');
      assert.deepEqual(payload, before);
    }
  }
});

test('EXADS public response: missing fields are guidance, supplied malformed fields are errors', () => {
  for (const field of ['id', 'value']) {
    const payload = response();
    delete payload.bid[field];
    const result = Core.validate(payload);
    assert.equal(finding(result, 'feed.exads.field_missing', `bid.${field}`)?.level, 'warning');
    assert.ok(result.findings.every((f) => f.level !== 'error'));
  }
  for (const field of [
    'id',
    'imgUrl',
    'iconUrl',
    'clickUrl',
    'url',
    'nUrl',
    'title',
    'description',
  ]) {
    const payload = response();
    payload.bid[field] = null;
    assert.equal(
      finding(Core.validate(payload), 'feed.exads.field_invalid', `bid.${field}`)?.level,
      'error',
    );
  }
  const noticeOnly = { bid: { id: 'notice', value: 1, nUrl: 'https://notice.example.test/win' } };
  assert.equal(
    finding(Core.validate(noticeOnly), 'feed.exads.landing_missing', 'bid')?.level,
    'warning',
  );
  assert.deepEqual(Core.detectFormat(noticeOnly).formats, []);
});

test('EXADS public carrier: generic bid objects and malformed IAB markers are not captured', () => {
  for (const obj of [
    { bid: null },
    { bid: [] },
    { bid: 3 },
    { bid: {} },
    { bid: { id: 'other' } },
  ]) {
    const result = Core.validate(obj);
    assert.notEqual(result.type, 'EXADS RTB Response');
    assert.ok(!result.findings.some((f) => /nobid|no_bid/.test(f.id)));
  }
  const generic = { type: 'banner', export: 'json', id: 'ordinary-form', unrelated: true };
  assert.notEqual(Core.detectType(generic), Core.TYPES.VENDOR_REQUEST);
  for (const marker of ['imp', 'seatbid', 'openrtb']) {
    for (const invalid of [null, false, {}, 'malformed']) {
      const mixed = { ...request(), [marker]: invalid };
      assert.notEqual(Core.detectType(mixed), Core.TYPES.VENDOR_REQUEST, marker);
      assert.notEqual(Core.validate(mixed).type, 'EXADS RTB Request', marker);
      assert.ok(Core.crosscheck(mixed, response()).length > 0, marker);
    }
  }
});

test('EXADS public pair: proprietary CPM/CPC is not an IAB floor or currency comparison', () => {
  for (const btype of [1, 2]) {
    const req = request();
    const res = response();
    res.bid.btype = btype;
    const before = structuredClone({ req, res });
    assert.deepEqual(Core.crosscheck(req, res), []);
    assert.deepEqual({ req, res }, before);
    assert.equal(Object.hasOwn(res.bid, 'cur'), false);
    assert.equal(Object.hasOwn(req, 'imp'), false);
  }
});

test('EXADS public findings: locales and filters preserve IDs without exposing credential values', () => {
  const payload = { ...request(), export: 'https://secret-user:secret-password@example.test/' };
  for (const locale of ['en', 'uk', 'ru']) {
    const result = Core.validate(payload, { locale });
    const f = finding(result, 'request.exads.export_invalid', 'export');
    assert.equal(f?.level, 'error');
    assert.ok(f.specRef);
    assert.ok(f.msg && !f.msg.includes('[request.exads.export_invalid]'));
    assert.equal(JSON.stringify(result.findings).includes('secret-password'), false);
    assert.deepEqual(
      Core.validate(payload, { locale, disabledRules: ['request.exads.*'] }).findings,
      [],
    );
  }
});

test('EXADS public GET: invalid integer text errors while short digit strings retain guidance', () => {
  const url = new URL('https://feed.example.test/rtb.php');
  for (const [key, value] of Object.entries(request())) url.searchParams.set(key, String(value));
  for (const sub of ['abc', '1.2', '-123456', '+123456', ' 123456 ']) {
    url.searchParams.set('sub', sub);
    const result = Core.validate(url.href);
    assert.equal(result.type, Core.TYPES.URL_REQUEST);
    assert.equal(finding(result, 'request.exads.field_invalid', 'sub')?.level, 'error');
    assert.equal(finding(result, 'request.exads.sub_nonstandard', 'sub'), undefined);
  }
  url.searchParams.set('sub', '1234');
  const result = Core.validate(url.href);
  assert.equal(finding(result, 'request.exads.sub_nonstandard', 'sub')?.level, 'warning');
  assert.ok(result.findings.every((f) => f.level !== 'error'));
});

test('EXADS owner: GET projection accepts decimal sub text without relaxing JSON validation', () => {
  const {
    validateExadsRequest,
    validateExadsResponse,
    exadsResponseFormat,
  } = require('../packages/core/vendor-exads');
  const payload = { ...request(), sub: '123456' };
  assert.deepEqual(validateExadsRequest(payload, { transport: 'url' }).findings, []);
  assert.equal(
    finding(validateExadsRequest(payload), 'request.exads.field_invalid', 'sub')?.level,
    'error',
  );
  assert.equal(payload.sub, '123456');
  for (const sub of ['abc', '1.2', '-123456', '+123456', ' 123456 ', '', null, 123456]) {
    const invalid = validateExadsRequest({ ...payload, sub }, { transport: 'url' });
    assert.equal(finding(invalid, 'request.exads.field_invalid', 'sub')?.level, 'error');
    assert.equal(finding(invalid, 'request.exads.sub_nonstandard', 'sub'), undefined);
  }
  const short = validateExadsRequest({ ...payload, sub: '1234' }, { transport: 'url' });
  assert.equal(finding(short, 'request.exads.sub_nonstandard', 'sub')?.level, 'warning');
  assert.ok(short.findings.every((f) => f.level !== 'error'));
  for (const bad of [null, [], 3, 'wrong', undefined]) {
    assert.equal(
      finding(validateExadsResponse({ bid: bad }), 'feed.exads.bid_invalid', 'bid')?.level,
      'error',
    );
  }
  const ambiguous = {
    bid: {
      id: 'ambiguous',
      value: 1,
      imgUrl: 'https://assets.example.test/image.png',
      clickUrl: 'https://advertiser.example.test/',
      title: 'Visible copy',
    },
  };
  assert.equal(exadsResponseFormat(ambiguous), null);
});
