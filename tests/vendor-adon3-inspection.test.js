'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('@ortbtools/core');
const {
  isAdon3Response,
  validateAdon3Response,
  adon3ResponseFormats,
} = require('../packages/core/vendor-adon3');
const { loadCorpus } = require('./corpus/lib/load');
const refs = loadCorpus().all.filter((c) =>
  ['pop-adon3-over-multi', 'pop-adon3-under', 'push-adon3-string-cpc'].includes(c.id),
);
const ad = () => ({
  url: 'https://advertiser.example.test/',
  price: '0.003825',
  imp_url: 'https://tracking.example.test/notice',
  pop_type: 'under',
});
/** @param {Record<string, unknown>} [row] */
const response = (row = ad()) => ({ rid: 'r', cur: 'USD', ads: [row] });

test('published Adon3 response references remain explicitly provisional in every locale', () => {
  assert.equal(refs.length, 3);
  for (const c of refs) {
    const before = JSON.stringify(c.response);
    for (const locale of ['en', 'uk', 'ru']) {
      const result = core.validate(c.response, { locale });
      assert.match(result.type, /Provisional/);
      assert.equal(result.status, 'warnings');
      assert.ok(
        result.findings.some(
          (f) => f.id === 'feed.adon3.provisional_contract' && f.level === 'warning',
        ),
      );
    }
    assert.equal(JSON.stringify(c.response), before);
    assert.match(core.validate(c.response, { strictness: 'lax' }).type, /Provisional/);
  }
});

test('provisional decimal prices are retained as strings and invalid supplied values remain errors', () => {
  for (const price of ['0.003825', '0.0310', '0', '9007199254740993.0001']) {
    const payload = response({ ...ad(), price });
    assert.ok(!core.validate(payload).findings.some((f) => f.level === 'error'));
    assert.equal(payload.ads[0].price, price);
  }
  for (const price of [0.003825, null, {}, '', '-0.1', '0.03oops', 'Infinity']) {
    assert.ok(
      core
        .validate(response({ ...ad(), price }))
        .findings.some((f) => f.level === 'error' && f.path === 'ads[0].price'),
    );
  }
});

test('provisional carrier checks are finite and never capture malformed OpenRTB', () => {
  for (const ads of [null, {}, '', [null], [3], []]) {
    assert.ok(
      core.validate({ rid: 'r', cur: 'USD', ads }).findings.some((f) => f.level === 'error'),
    );
  }
  for (const marker of ['imp', 'seatbid', 'openrtb']) {
    const payload = { ...response(), [marker]: [] };
    assert.ok(
      !core.validate(payload).findings.some((f) => f.id === 'feed.adon3.provisional_contract'),
    );
  }
  assert.equal(core.detectType({ ads: [], title: 'Unrelated JSON' }), core.TYPES.UNKNOWN);
});

test('Adon3 owner separates carrier presence from field validity and IAB precedence', () => {
  for (const ads of [null, false, 0, '', {}, [], [null], [false], [3], new Array(1)]) {
    const payload = { rid: 'r', cur: 'USD', ads };
    assert.equal(isAdon3Response(payload), true);
    const result = validateAdon3Response(payload);
    assert.equal(result.type, 'Provisional Adon3 Response');
    assert.ok(result.findings.some((f) => f.level === 'error'));
    assert.equal(
      result.findings.filter((f) => f.id === 'feed.adon3.provisional_contract').length,
      1,
    );
    assert.deepEqual(adon3ResponseFormats(payload), []);
  }
  for (const field of ['rid', 'cur', 'ads']) {
    const payload = response();
    delete payload[field];
    assert.equal(isAdon3Response(payload), false);
  }
  for (const field of ['imp', 'seatbid', 'openrtb']) {
    for (const value of [null, false, '', [], {}]) {
      const payload = { ...response(), [field]: value };
      assert.equal(isAdon3Response(payload), false);
      assert.deepEqual(adon3ResponseFormats(payload), []);
    }
  }
  assert.equal(isAdon3Response(Object.assign(Object.create(null), response())), true);
  assert.equal(isAdon3Response(Object.create(response())), false);
  for (const value of [null, false, 0, '', [], new Date()]) {
    assert.equal(isAdon3Response(value), false);
    assert.ok(validateAdon3Response(value).findings.some((f) => f.level === 'error'));
  }
});

test('Adon3 owner diagnoses required fields at original paths without altering the wire', () => {
  const invalidStrings = [undefined, null, false, 0, {}, [], '', ' ', '\t'];
  for (const field of ['rid', 'cur']) {
    for (const value of invalidStrings) {
      const payload = { ...response(), [field]: value };
      if (value === undefined) delete payload[field];
      assert.ok(
        validateAdon3Response(payload).findings.some(
          (f) => f.level === 'error' && f.path === field,
        ),
      );
    }
  }
  for (const field of ['url', 'imp_url']) {
    for (const value of [
      ...invalidStrings,
      'javascript:alert(1)',
      '/relative',
      'https://',
      'https://example.test/\u0000',
    ]) {
      const row = { ...ad(), [field]: value };
      if (value === undefined) delete row[field];
      assert.ok(
        validateAdon3Response(response(row)).findings.some(
          (f) => f.level === 'error' && f.path === `ads[0].${field}`,
        ),
      );
    }
  }
  const row = Object.freeze({
    ...ad(),
    url: 'https://advertiser.example.test/click?q=a%2Fb&unknown=preserved',
    price: '0000.0038250',
  });
  const payload = Object.freeze({ rid: 'r', cur: 'USD', ads: Object.freeze([row]) });
  const before = JSON.stringify(payload);
  assert.equal(
    validateAdon3Response(payload).findings.filter((f) => f.level === 'error').length,
    0,
  );
  assert.equal(JSON.stringify(payload), before);
});

test('Adon3 owner keeps arbitrary decimal precision with a finite string-only scan', () => {
  const longPrice = `${'9'.repeat(20000)}.0000000010`;
  for (const price of [longPrice, '0', '00.0', '0.003825', '9007199254740993.0001']) {
    const payload = response({ ...ad(), price });
    assert.ok(
      !validateAdon3Response(payload).findings.some((f) => f.id === 'feed.adon3.price_invalid'),
    );
    assert.equal(payload.ads[0].price, price);
  }
  for (const price of [
    undefined,
    null,
    0,
    0.03,
    false,
    {},
    [],
    '',
    '-0',
    '+1',
    '.1',
    '1.',
    '1..2',
    '1e3',
    'NaN',
    'Infinity',
    '1\n',
    ' 1',
    '1 ',
    '１.０',
    `${longPrice}x`,
  ]) {
    const row = { ...ad(), price };
    if (price === undefined) delete row.price;
    assert.ok(
      validateAdon3Response(response(row)).findings.some(
        (f) => f.id === 'feed.adon3.price_invalid' && f.path === 'ads[0].price',
      ),
    );
  }
});

test('Adon3 owner derives formats only from explicit pop or notification roles', () => {
  const { pop_type, ...link } = ad();
  assert.equal(pop_type, 'under');
  assert.deepEqual(adon3ResponseFormats(response(link)), []);
  assert.deepEqual(adon3ResponseFormats(response({ ...link, title: 'A card title' })), []);
  assert.deepEqual(
    adon3ResponseFormats(
      response({ ...link, title: ' ', icon: 'https://assets.example.test/icon.png' }),
    ),
    [],
  );
  assert.deepEqual(
    adon3ResponseFormats(
      response({ ...link, title: 'A card title', icon: 'https://assets.example.test/icon.png' }),
    ),
    ['push'],
  );
  for (const value of ['under', 'over']) {
    assert.deepEqual(adon3ResponseFormats(response({ ...link, pop_type: value })), ['pops']);
  }
  const future = { ...response({ ...link, pop_type: 'future-format' }), cur: 'EUR' };
  assert.deepEqual(adon3ResponseFormats(future), []);
  assert.ok(!validateAdon3Response(future).findings.some((f) => f.level === 'error'));
  assert.deepEqual(
    adon3ResponseFormats({
      rid: 'r',
      cur: 'USD',
      ads: [
        ad(),
        { ...link, title: 'A card title', image: 'https://assets.example.test/image.png' },
        ad(),
      ],
    }),
    ['pops', 'push'],
  );
  for (const field of ['cid', 'title', 'text', 'pop_type', 'image', 'icon', 'exp', 'freq_cap']) {
    assert.ok(
      validateAdon3Response(response({ ...ad(), [field]: null })).findings.some(
        (f) => f.level === 'error' && f.path === `ads[0].${field}`,
      ),
    );
  }
});
