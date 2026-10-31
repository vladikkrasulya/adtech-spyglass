'use strict';

/**
 * Error reports must not carry data about the caller. A real request with a
 * session cookie, an Authorization header, a forwarded client address, a token
 * in the query string and a JSON body triggers one captured error; the event
 * that reaches a local stub server must contain none of those values.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SENTINELS = [
  'COOKIESENTINEL',
  'AUTHSENTINEL',
  'QUERYSENTINEL',
  'BODYSENTINEL',
  '203.0.113.77',
];

function runProbe() {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'sentry-probe.js')], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `probe failed: ${run.stderr || run.error}`);
  return JSON.parse(run.stdout);
}

test('captured errors reach the stub without caller data', () => {
  const out = runProbe();
  assert.equal(out.ready, true, 'the SDK should accept the stub DSN');
  assert.equal(out.events.length, 1, 'exactly one error event is delivered');
  const serialized = JSON.stringify(out.events[0]);
  for (const value of SENTINELS) {
    assert.ok(!out.raw.includes(value), `${value} must not appear anywhere in the envelope`);
    assert.ok(!serialized.includes(value), `${value} must not appear in the event`);
  }
  const event = out.events[0];
  assert.equal(event.user?.ip_address, undefined, 'no client address on the user');
  assert.equal(event.request?.cookies, undefined, 'no cookies');
  assert.equal(event.request?.data, undefined, 'no request body');
  assert.equal(event.request?.query_string, undefined, 'no query string');
  const headers = Object.keys(event.request?.headers || {}).map((h) => h.toLowerCase());
  for (const forbidden of ['cookie', 'authorization', 'x-forwarded-for']) {
    assert.ok(!headers.includes(forbidden), `${forbidden} header is not collected`);
  }
  assert.equal(event.contexts?.request?.method, 'POST', 'caller-supplied context is kept');
  assert.equal(event.contexts?.request?.url, '/probe', 'context URL has no query string');
});
