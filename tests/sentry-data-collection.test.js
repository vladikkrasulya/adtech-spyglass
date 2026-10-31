'use strict';

/**
 * Error reports must not carry data about the caller.
 *
 * tests/fixtures/sentry-probe.js boots lib/logger.js against a local stub that
 * stands in for the Sentry-compatible server, attaches request data (session
 * cookie, query value, forwarded client address, Authorization header) to the
 * scope the way an instrumented server does, triggers one captured error and
 * prints what the stub received.
 *
 * The check is only meaningful if the probe can see a leak, so the same flow is
 * also run with the SDK's own `dataCollection` defaults (the project settings
 * removed): there the values must show up. If the SDK ever stops attaching
 * request data, the control run fails instead of letting the main run pass
 * vacuously.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const COOKIE = 'COOKIESENTINEL';
const QUERY = 'QUERYSENTINEL';
const AUTH = 'AUTHSENTINEL';
const IP = '203.0.113.77';

function runProbe(mode) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'sentry-probe.js')], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, PROBE_MODE: mode },
  });
  assert.equal(run.status, 0, `probe failed: ${run.stderr || run.error}`);
  const out = JSON.parse(run.stdout);
  assert.equal(out.ready, true, 'the SDK should accept the stub DSN');
  assert.equal(out.events.length, 1, 'exactly one error event is delivered');
  return out;
}

test('control: with the SDK defaults the probe sees cookie, query and client address', () => {
  const { raw, events } = runProbe('defaults');
  assert.ok(raw.includes(COOKIE), 'cookie value reaches the stub with default settings');
  assert.ok(raw.includes(QUERY), 'query value reaches the stub with default settings');
  assert.ok(raw.includes(IP), 'client address reaches the stub with default settings');
  assert.equal(events[0].user?.ip_address, IP);
});

test('project settings: captured errors reach the stub without caller data', () => {
  const { raw, events } = runProbe('production');
  const event = events[0];
  for (const value of [COOKIE, QUERY, AUTH, IP]) {
    assert.ok(!raw.includes(value), `${value} must not appear anywhere in the envelope`);
  }
  assert.equal(event.user?.ip_address, undefined, 'no client address on the user');
  assert.equal(event.request?.cookies, undefined, 'no cookies');
  assert.equal(event.request?.query_string, undefined, 'no query string');
  assert.equal(event.request?.url, 'http://127.0.0.1/probe', 'URL carries no query string');
  const headers = Object.keys(event.request?.headers || {}).map((h) => h.toLowerCase());
  for (const forbidden of ['cookie', 'x-forwarded-for']) {
    assert.ok(!headers.includes(forbidden), `${forbidden} header is not collected`);
  }
  assert.equal(event.contexts?.request?.method, 'POST', 'caller-supplied context is kept');
  assert.equal(event.contexts?.request?.url, '/probe', 'context URL has no query string');
});
