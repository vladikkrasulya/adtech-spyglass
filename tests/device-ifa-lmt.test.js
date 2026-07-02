'use strict';

/**
 * tests/device-ifa-lmt.test.js — device.ifa and device.lmt validation for OpenRTB 2.x.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('@kyivtech/spyglass-core');
const { validRequest } = require('./fixtures');

const findById = (findings, id) => findings.find((f) => f.id === id);

function requestWithDevice(devicePatch) {
  const req = validRequest();
  req.device = Object.assign({}, req.device, devicePatch);
  return req;
}

// ── Omitted fields ──────────────────────────────────────────────────────────

test('device: omitted ifa and lmt → no findings', () => {
  const { findings } = validate(validRequest());
  assert.equal(findById(findings, 'request.device.ifa_invalid'), undefined);
  assert.equal(findById(findings, 'request.device.lmt_enabled'), undefined);
  assert.equal(findById(findings, 'request.device.lmt_invalid'), undefined);
});

// ── device.ifa ──────────────────────────────────────────────────────────────

test('device.ifa: valid non-empty string', () => {
  const { findings } = validate(requestWithDevice({ ifa: '38400000-8CF0-11BD-B23E-10DE66E00000' }));
  assert.equal(findById(findings, 'request.device.ifa_invalid'), undefined);
});

for (const [label, value] of [
  ['null', null],
  ['empty string', ''],
  ['number', 123],
  ['object', {}],
]) {
  test(`device.ifa: invalid ${label}`, () => {
    const { findings } = validate(requestWithDevice({ ifa: value }));
    const f = findById(findings, 'request.device.ifa_invalid');
    assert.ok(f);
    assert.equal(f.level, 'error');
    assert.equal(f.path, 'device.ifa');
  });
}

// ── device.lmt ──────────────────────────────────────────────────────────────

test('device.lmt: 0 → no finding', () => {
  const { findings } = validate(requestWithDevice({ lmt: 0 }));
  assert.equal(findById(findings, 'request.device.lmt_enabled'), undefined);
  assert.equal(findById(findings, 'request.device.lmt_invalid'), undefined);
});

test('device.lmt: 1 → lmt_enabled INFO', () => {
  const { findings } = validate(requestWithDevice({ lmt: 1 }));
  const f = findById(findings, 'request.device.lmt_enabled');
  assert.ok(f);
  assert.equal(f.level, 'info');
  assert.equal(f.path, 'device.lmt');
  assert.equal(findById(findings, 'request.device.lmt_invalid'), undefined);
});

for (const [label, value] of [
  ['null', null],
  ['-1', -1],
  ['2', 2],
  ['1.5', 1.5],
  ['string "1"', '1'],
]) {
  test(`device.lmt: invalid ${label}`, () => {
    const { findings } = validate(requestWithDevice({ lmt: value }));
    const f = findById(findings, 'request.device.lmt_invalid');
    assert.ok(f);
    assert.equal(f.level, 'error');
    assert.equal(f.path, 'device.lmt');
    assert.equal(findById(findings, 'request.device.lmt_enabled'), undefined);
  });
}

test('device: lmt=1 with valid ifa → no conflict finding', () => {
  const { findings } = validate(
    requestWithDevice({
      lmt: 1,
      ifa: '38400000-8CF0-11BD-B23E-10DE66E00000',
    }),
  );
  assert.ok(findById(findings, 'request.device.lmt_enabled'));
  assert.equal(findById(findings, 'request.device.ifa_invalid'), undefined);
  assert.equal(findById(findings, 'request.device.lmt_invalid'), undefined);
});

// ── validate() integration ────────────────────────────────────────────────────

test('validate(): device.ifa_invalid surfaces on public API', () => {
  const result = validate(requestWithDevice({ ifa: '' }));
  assert.equal(result.status, 'errors');
  const f = result.findings.find((x) => x.id === 'request.device.ifa_invalid');
  assert.ok(f);
  assert.equal(f.path, 'device.ifa');
  assert.equal(typeof f.msg, 'string');
  assert.ok(f.msg.length > 0);
});
