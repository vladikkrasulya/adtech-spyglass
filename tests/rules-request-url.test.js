'use strict';

/**
 * tests/rules-request-url.test.js — packages/core/rules-request-url.js
 *
 * Each of the 4 base findings in isolation + clean-canonical → 0 findings
 * + null-canonical → decode_failed.
 *
 * Inputs are raw canonical shapes (the registry's output), built inline
 * so each test pins exactly one signal.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateUrlRequest } = require('@kyivtech/spyglass-core/rules-request-url');
const { makeCanonicalUrlRequest } = require('@kyivtech/spyglass-core/decoders/request/_canonical');

function baseCanonical(extra) {
  const c = makeCanonicalUrlRequest('pushub-link', 'http://xml.pushub.net/link?x=1');
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
