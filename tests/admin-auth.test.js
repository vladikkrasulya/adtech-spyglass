'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  requireAdminBearer,
  tokensMatch,
  resetAdminAuthFailures,
  MAX_FAILURES,
} = require('../lib/admin-auth');

const TOKEN = 'unit-test-admin-token-0123456789abcdef';

function res() {
  return {
    statusCode: 0,
    body: '',
    writeHead(s) {
      this.statusCode = s;
    },
    end(b) {
      this.body += b || '';
    },
  };
}
const request = (token, ip = '203.0.113.5') => ({
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  socket: { remoteAddress: ip },
});

test.beforeEach(() => {
  process.env.ADMIN_STATS_TOKEN = TOKEN;
  resetAdminAuthFailures();
});
test.after(() => {
  delete process.env.ADMIN_STATS_TOKEN;
});

test('tokensMatch is exact and tolerates any length without throwing', () => {
  assert.equal(tokensMatch(TOKEN, TOKEN), true);
  assert.equal(tokensMatch(TOKEN + 'x', TOKEN), false);
  assert.equal(tokensMatch('', TOKEN), false);
  assert.equal(tokensMatch('x'.repeat(100_000), TOKEN), false);
});

test('503 when no token is configured, with the caller-supplied code', () => {
  delete process.env.ADMIN_STATS_TOKEN;
  const r = res();
  assert.equal(requireAdminBearer(request(TOKEN), r, { disabledCode: 'x_disabled' }), false);
  assert.equal(r.statusCode, 503);
  assert.match(r.body, /x_disabled/);
});

test('missing, malformed and wrong credentials are 401; the right one passes', () => {
  for (const req of [
    request(undefined),
    request(''),
    request('nope'),
    { headers: { authorization: TOKEN }, socket: { remoteAddress: '203.0.113.6' } },
  ]) {
    const r = res();
    assert.equal(requireAdminBearer(req, r), false);
    assert.equal(r.statusCode, 401);
  }
  const ok = res();
  assert.equal(requireAdminBearer(request(TOKEN, '203.0.113.7'), ok), true);
  assert.equal(ok.statusCode, 0, 'no response is written on success');
});

test('the lockout starts at MAX_FAILURES, is per address, and ignores a later right token', () => {
  const ip = '203.0.113.8';
  for (let i = 0; i < MAX_FAILURES; i++) {
    const r = res();
    requireAdminBearer(request(`bad${i}`, ip), r);
    assert.equal(r.statusCode, 401);
  }
  const locked = res();
  assert.equal(requireAdminBearer(request(TOKEN, ip), locked), false);
  assert.equal(locked.statusCode, 429);
  assert.equal(requireAdminBearer(request(TOKEN, '203.0.113.9'), res()), true);
});

test('every operator route goes through the shared gate (no inline comparison left)', () => {
  const root = path.join(__dirname, '..');
  for (const file of [
    'modules/admin/handler.js',
    'modules/admin/blog.js',
    'modules/telemetry/handler.js',
  ]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(src.includes('requireAdminBearer'), `${file} must use the shared gate`);
    assert.ok(!/provided\s*!==\s*expected/.test(src), `${file} must not compare tokens inline`);
  }
});
