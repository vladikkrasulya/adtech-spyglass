'use strict';

/**
 * lib/asset-fetch.js: ASSET_TIMEOUT_MS is a socket IDLE timeout, so a host that
 * drips a byte every few seconds never tripped it and one request could hold a
 * socket open for hours. A wall-clock deadline now ends it.
 *
 * No network: DNS and http.request are stubbed. The deadline is shortened
 * through the env var, which is read when the module loads.
 */

process.env.ASSET_TOTAL_TIMEOUT_MS = '150';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const dns = require('node:dns');
const http = require('node:http');

const originalLookup = dns.promises.lookup;
const originalRequest = http.request;
const { fetchAsset } = require('../lib/asset-fetch');

test('a host that never finishes is cut off by the wall-clock deadline', async () => {
  // A public-looking address, so the SSRF guard lets the request through.
  dns.promises.lookup = /** @type {any} */ (async () => [{ address: '93.184.216.34', family: 4 }]);
  let destroyed = false;
  http.request = /** @type {any} */ (
    (_opts, onResponse) => {
      const req = new EventEmitter();
      Object.assign(req, {
        end() {
          // Answer 200 image/png, then keep the body open forever.
          const res = Object.assign(new EventEmitter(), {
            statusCode: 200,
            headers: { 'content-type': 'image/png' },
            destroy() {},
          });
          onResponse(res);
          const drip = setInterval(() => res.emit('data', Buffer.from('x')), 20);
          req.once('close', () => clearInterval(drip));
        },
        destroy() {
          destroyed = true;
          req.emit('close');
        },
      });
      return req;
    }
  );
  try {
    const started = Date.now();
    await assert.rejects(
      () => fetchAsset('http://cdn.example.net/slow.png'),
      (/** @type {any} */ e) => e.code === 'timeout',
    );
    assert.ok(Date.now() - started < 2000, 'must not wait for the (never-ending) body');
    assert.ok(destroyed, 'the request must be torn down');
  } finally {
    dns.promises.lookup = originalLookup;
    http.request = originalRequest;
  }
});
