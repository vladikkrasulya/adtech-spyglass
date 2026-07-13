'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function probeEnabled(env) {
  const script = `
    const { isClickHouseAnalyticsEnabled } = require('./lib/analytics-enabled');
    console.log(isClickHouseAnalyticsEnabled() ? '1' : '0');
  `;
  const r = spawnSync('node', ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

test('analytics enabled when ClickHouse creds present', () => {
  assert.equal(
    probeEnabled({
      CLICKHOUSE_URL: 'http://clickhouse:8123',
      CLICKHOUSE_USER: 'admin',
      CLICKHOUSE_PASSWORD: 'secret',
      ORTBTOOLS_ANALYTICS_DISABLED: undefined,
    }),
    '1',
  );
});

test('analytics disabled when CLICKHOUSE_USER unset', () => {
  assert.equal(
    probeEnabled({
      CLICKHOUSE_URL: 'http://clickhouse:8123',
      CLICKHOUSE_USER: '',
      ORTBTOOLS_ANALYTICS_DISABLED: undefined,
    }),
    '0',
  );
});

test('analytics disabled when ORTBTOOLS_ANALYTICS_DISABLED=1', () => {
  assert.equal(
    probeEnabled({
      CLICKHOUSE_URL: 'http://clickhouse:8123',
      CLICKHOUSE_USER: 'admin',
      CLICKHOUSE_PASSWORD: 'secret',
      ORTBTOOLS_ANALYTICS_DISABLED: '1',
    }),
    '0',
  );
});
