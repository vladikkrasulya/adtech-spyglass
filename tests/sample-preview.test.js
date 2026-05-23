'use strict';

/**
 * tests/sample-preview.test.js — modules/sample/handler.js handlePreview
 *
 * The "Try with sample" hero CTA hits GET /api/sample-preview/:id with one
 * of three whitelisted IDs. Unknown IDs must 404 (the URL is a public
 * surface; arbitrary slugs shouldn't 500 or expose filesystem errors).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const sampleModule = require('../modules/sample/handler');

function fakeRes() {
  const headers = {};
  return {
    statusCode: 0,
    body: null,
    headers,
    setHeader(k, v) {
      headers[k] = v;
    },
    writeHead(code, hdrs) {
      this.statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return this;
    },
    end(s) {
      if (s != null) this.body = s;
      return this;
    },
  };
}

const previewRoute = sampleModule.routes.find(
  (r) => r.path === '/api/sample-preview/:id' && r.method === 'GET',
);

test('sample-preview: route is registered', () => {
  assert.ok(previewRoute, 'GET /api/sample-preview/:id is registered on sample module');
});

for (const id of ['banner26', 'video26', 'env30']) {
  test(`sample-preview: ${id} → 200 with wrapped fixture`, () => {
    const res = fakeRes();
    previewRoute.handler({}, res, null, { params: { id } });
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.id, id);
    assert.ok(typeof payload.label === 'string' && payload.label.length > 0);
    assert.ok(payload.json && typeof payload.json === 'object');
    // Each fixture is a BidRequest with at least `id` and `imp[]`/`openrtb`.
    const hasReqShape =
      typeof payload.json.id === 'string' ||
      Array.isArray(payload.json.imp) ||
      (payload.json.openrtb && typeof payload.json.openrtb === 'object');
    assert.ok(hasReqShape, `${id} payload looks like a BidRequest`);
    assert.equal(res.headers['Cache-Control'], 'public, max-age=3600');
  });
}

test('sample-preview: unknown id → 404 unknown_preview', () => {
  const res = fakeRes();
  previewRoute.handler({}, res, null, { params: { id: 'nonexistent' } });
  assert.equal(res.statusCode, 404);
  const payload = JSON.parse(res.body);
  assert.equal(payload.success, false);
  assert.equal(payload.code, 'unknown_preview');
});

test('sample-preview: missing match → 404 (defensive)', () => {
  const res = fakeRes();
  previewRoute.handler({}, res, null, undefined);
  assert.equal(res.statusCode, 404);
});
