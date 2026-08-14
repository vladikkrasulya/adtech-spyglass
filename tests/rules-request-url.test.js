'use strict';

/**
 * tests/rules-request-url.test.js — packages/core/rules-request-url.js
 *
 * Each of the 4 base findings in isolation + clean-canonical → 0 findings
 * + null-canonical → decode_failed + the `warnings[]` projection.
 *
 * Inputs are raw canonical shapes (the registry's output), built inline
 * so each test pins exactly one signal.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateUrlRequest } = require('@ortbtools/core/rules-request-url');
const { makeCanonicalUrlRequest } = require('@ortbtools/core/decoders/request/_canonical');
const { rollupStatus } = require('@ortbtools/core/findings');
const { resolve } = require('@ortbtools/core/messages');

function baseCanonical(extra) {
  const c = makeCanonicalUrlRequest('url-linkfeed', 'https://feed.vendor.example/link?x=1');
  // Default sane shape — IPv4, no empty CH fields, no quoted ch-uafull,
  // no trailing-? in url. Each test mutates exactly one signal.
  c.device.ip = '192.0.2.1';
  c._raw = Object.assign(
    {
      format: 'json',
      user_ip: '192.0.2.1',
    },
    extra || {},
  );
  return c;
}

function findingIds(out) {
  return out.findings.map((f) => f.id);
}

// ── Decode failure ──────────────────────────────────────────────────────────

test('validateUrlRequest: null canonical → decode_failed ERROR', () => {
  const r = validateUrlRequest(null);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'request.url.decode_failed');
  assert.equal(r.findings[0].level, 'error');
});

test('validateUrlRequest: non-object canonical → decode_failed ERROR', () => {
  assert.equal(validateUrlRequest('not an object').findings[0].id, 'request.url.decode_failed');
  assert.equal(validateUrlRequest(42).findings[0].id, 'request.url.decode_failed');
});

// ── Clean canonical → 0 findings ────────────────────────────────────────────

test('validateUrlRequest: clean canonical → no findings', () => {
  const r = validateUrlRequest(baseCanonical());
  assert.deepEqual(r.findings, []);
});

// ── Plain HTTP transport → WARNING ────────────────────────────────────────

test('validateUrlRequest: plain HTTP → insecure_http WARNING without URL params', () => {
  const c = baseCanonical();
  c.url = 'http://feed.vendor.example/link?auth=synthetic-secret';
  const r = validateUrlRequest(c);
  const f = r.findings.find((x) => x.id === 'request.url.insecure_http');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.path, '', 'must not mispoint at the nested url= query parameter');
  assert.deepEqual(f.params, {});
});

test('validateUrlRequest: HTTPS → no insecure_http finding', () => {
  const r = validateUrlRequest(baseCanonical());
  assert.ok(!findingIds(r).includes('request.url.insecure_http'));
});

// ── IPv6 user_ip → INFO ─────────────────────────────────────────────────────

test('validateUrlRequest: IPv6 in device.ipv6 → user_ip_ipv6 INFO', () => {
  const c = baseCanonical();
  delete c.device.ip;
  c.device.ipv6 = '2001:db8::1';
  const r = validateUrlRequest(c);
  assert.ok(findingIds(r).includes('request.url.user_ip_ipv6'));
  const f = r.findings.find((x) => x.id === 'request.url.user_ip_ipv6');
  assert.equal(f.level, 'info');
  assert.equal(f.params.ip, '2001:db8::1');
});

// ── CH fields empty → WARNING ───────────────────────────────────────────────

test('validateUrlRequest: empty ch-platformv → ch_field_empty WARNING', () => {
  const r = validateUrlRequest(baseCanonical({ 'ch-platformv': '' }));
  const f = r.findings.find((x) => x.id === 'request.url.ch_field_empty');
  assert.ok(f, 'ch_field_empty fired');
  assert.equal(f.level, 'warning');
  assert.equal(f.params.field, 'ch-platformv');
});

test('validateUrlRequest: empty ch-model → ch_field_empty WARNING', () => {
  const r = validateUrlRequest(baseCanonical({ 'ch-model': '' }));
  const f = r.findings.find((x) => x.id === 'request.url.ch_field_empty');
  assert.ok(f, 'ch_field_empty fired');
  assert.equal(f.params.field, 'ch-model');
});

test('validateUrlRequest: ch-platformv with value → no ch_field_empty', () => {
  const r = validateUrlRequest(baseCanonical({ 'ch-platformv': '14' }));
  assert.ok(!findingIds(r).includes('request.url.ch_field_empty'));
});

test('validateUrlRequest: ch-platformv missing entirely → no ch_field_empty', () => {
  // The check fires only when the key is present-but-empty (spec violation),
  // not when it's absent (which means "client did not send it" — fine).
  const r = validateUrlRequest(baseCanonical());
  assert.ok(!findingIds(r).includes('request.url.ch_field_empty'));
});

// ── ch-uafull quoted → INFO ─────────────────────────────────────────────────

test('validateUrlRequest: quoted ch-uafull → ch_uafull_quoted INFO', () => {
  const r = validateUrlRequest(baseCanonical({ 'ch-uafull': '"147.0.7727.137"' }));
  const f = r.findings.find((x) => x.id === 'request.url.ch_uafull_quoted');
  assert.ok(f);
  assert.equal(f.level, 'info');
  assert.equal(f.params.value, '"147.0.7727.137"');
});

test('validateUrlRequest: bare ch-uafull → no ch_uafull_quoted', () => {
  const r = validateUrlRequest(baseCanonical({ 'ch-uafull': '147.0.7727.137' }));
  assert.ok(!findingIds(r).includes('request.url.ch_uafull_quoted'));
});

// ── url= trailing ? → WARNING ───────────────────────────────────────────────

test('validateUrlRequest: url= ending in ? → url_trailing_questionmark WARNING', () => {
  const r = validateUrlRequest(baseCanonical({ url: 'https://example.com/page?' }));
  const f = r.findings.find((x) => x.id === 'request.url.url_trailing_questionmark');
  assert.ok(f);
  assert.equal(f.level, 'warning');
});

test('validateUrlRequest: url= no trailing ? → no trailing_questionmark', () => {
  const r = validateUrlRequest(baseCanonical({ url: 'https://example.com/page' }));
  assert.ok(!findingIds(r).includes('request.url.url_trailing_questionmark'));
});

// ── canonical.warnings[] → findings ─────────────────────────────────────────
//
// Decoders wrote this array from the start and nothing read it. These tests
// pin the property that makes it a warning at all: it reaches the caller.

const DAMAGED = '%�CHEBUSTER%%';

function withWarning(warning, extra) {
  const c = baseCanonical(extra);
  c.warnings.push(warning);
  return c;
}

test('validateUrlRequest: decode-damage warning → mapped finding carrying raw and decoded', () => {
  const c = withWarning(
    {
      code: 'query_value_decode_damage',
      param: 'cb',
      detail: 'Percent-decoding replaced bytes in "cb"; raw value preserved in _raw.',
      decoded: DAMAGED,
    },
    { cb: '%%CACHEBUSTER%%' },
  );
  const f = validateUrlRequest(c).findings.find(
    (x) => x.id === 'request.url.query_value_decode_damage',
  );
  assert.ok(f, 'warning became a finding');
  assert.equal(f.level, 'warning');
  assert.equal(f.path, 'cb', 'points at the damaged parameter');
  assert.equal(f.params.param, 'cb');
  // The raw value is read from `_raw`, not echoed from the warning: `_raw` is
  // the source of truth and the warning does not carry it.
  assert.equal(f.params.raw, '%%CACHEBUSTER%%');
  assert.equal(f.params.decoded, DAMAGED);
});

test('validateUrlRequest: double-escape warning is mapped, not generic', () => {
  const c = withWarning({
    code: 'query_double_escaped_entity',
    param: 'b',
    detail: 'Input looks double-escaped; left as sent.',
  });
  const ids = findingIds(validateUrlRequest(c));
  assert.ok(ids.includes('request.url.query_double_escaped_entity'));
  assert.ok(!ids.includes('request.url.decoder_warning'), 'must not fall through to the generic');
});

test('validateUrlRequest: unmapped warning code still surfaces, verbatim', () => {
  // The point of the whole rule: a code this file has never heard of must not
  // vanish just because there is no phrasing for it yet.
  const c = withWarning({
    code: 'some_code_invented_after_this_test',
    param: 'zz',
    detail: 'Decoder said something new.',
  });
  const f = validateUrlRequest(c).findings.find((x) => x.id === 'request.url.decoder_warning');
  assert.ok(f, 'unknown code produced a finding');
  assert.equal(f.level, 'warning');
  assert.equal(f.path, 'zz');
  assert.equal(f.params.code, 'some_code_invented_after_this_test');
  assert.equal(f.params.detail, 'Decoder said something new.');
});

test('validateUrlRequest: an unmapped warning alone does not roll up to clean', () => {
  // WARNING rather than INFO is load-bearing: rollupStatus folds info-only
  // into `clean`, and a clean badge over input the decoder flagged is the
  // green-status-over-mutated-value defect this branch exists to remove.
  const c = withWarning({ code: 'unheard_of', param: 'zz', detail: 'x' });
  assert.equal(rollupStatus(validateUrlRequest(c).findings), 'warnings');
});

test('validateUrlRequest: empty warnings[] adds nothing', () => {
  const r = validateUrlRequest(baseCanonical());
  assert.deepEqual(r.findings, [], 'a clean canonical stays clean');
});

test('validateUrlRequest: malformed warnings[] entries never throw', () => {
  // Hand-built canonicals reach this validator through the API; it stays total.
  const c = baseCanonical();
  c.warnings = [null, 'not an object', 42, {}, { code: 'no_param' }];
  const r = validateUrlRequest(c);
  // null / string / number are skipped; the two objects each report.
  const generic = r.findings.filter((x) => x.id === 'request.url.decoder_warning');
  assert.equal(generic.length, 2);
  assert.equal(generic[0].params.code, 'unknown', 'a warning with no code still reports');
  assert.equal(generic[0].path, '');
  assert.equal(generic[1].params.code, 'no_param');
});

test('validateUrlRequest: non-array warnings is ignored, not fatal', () => {
  const c = baseCanonical();
  c.warnings = undefined;
  assert.deepEqual(validateUrlRequest(c).findings, []);
  // Deliberately off-contract: `warnings` is Array<Object> in the canonical
  // JSDoc, so the cast is what lets the test hand over the shape a careless
  // caller might.
  c.warnings = /** @type {any} */ ({ code: 'not an array' });
  assert.deepEqual(validateUrlRequest(c).findings, []);
});

test('warning messages resolve in all three locales (no raw key leaks)', () => {
  /** @type {Array<[string, Record<string, unknown>]>} */
  const cases = [
    ['request.url.query_value_decode_damage', { param: 'cb', raw: '%%CB%%', decoded: DAMAGED }],
    ['request.url.query_double_escaped_entity', { param: 'b' }],
    ['request.url.decoder_warning', { code: 'unheard_of', detail: 'Decoder said something.' }],
  ];
  for (const locale of ['en', 'uk', 'ru']) {
    for (const [id, params] of cases) {
      const msg = resolve(id, params, locale);
      assert.ok(msg && !msg.includes(id), `${locale}/${id}: fell back to the raw key`);
      assert.ok(!/\{\w+\}/.test(msg), `${locale}/${id}: unsubstituted param in "${msg}"`);
    }
  }
});

test('refusal messages resolve in all three locales', () => {
  // Phrased ahead of the emitter: `decodeRequest` computes these reasons but
  // nothing turns them into findings yet — `detect.js` drops a string that no
  // decoder claims, so the refusal never reaches a caller. The emission lands
  // with the input-repair work; the wording is here so it arrives translated.
  //
  // `no_decoder` is split in two because the parameter list can be empty, and
  // "query parameters: ." is not a sentence. Choosing the variant at the emit
  // site keeps every human-readable word in the catalogs — a shared id with an
  // English "none" substituted in would leak that word into uk and ru.
  /** @type {Array<[string, Record<string, unknown>]>} */
  const cases = [
    ['request.url.unparseable', { detail: 'Invalid URL' }],
    ['request.url.unsupported_scheme', { scheme: 'javascript:' }],
    [
      'request.url.no_decoder',
      { protocol: 'https:', host: 'news.example', pathname: '/feed', params: 'format, id' },
    ],
    [
      'request.url.no_decoder_no_params',
      { protocol: 'https:', host: 'news.example', pathname: '/feed' },
    ],
  ];
  for (const locale of ['en', 'uk', 'ru']) {
    for (const [id, params] of cases) {
      const msg = resolve(id, params, locale);
      assert.ok(msg && !msg.includes(id), `${locale}/${id}: fell back to the raw key`);
      assert.ok(!/\{\w+\}/.test(msg), `${locale}/${id}: unsubstituted param in "${msg}"`);
    }
  }
});
