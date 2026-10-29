'use strict';

/**
 * Regression gate for the 2026-10-29 audit (P2-1): GET /api/v1/sample
 * synthesizes a BidRequest for every BidResponse specimen. The synthesized
 * request used `id: 'demo-' + sample.id`, so crosscheck (which requires the
 * request and response ids to be identical) raised a critical
 * `crosscheck.id_mismatch` on the reference "clean" specimens.
 *
 * Every response specimen served by the endpoint must pair with its own
 * synthesized request without any critical cross-check finding. Assertions are
 * on stable finding ids and levels, never on message text.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('@ortbtools/core');
const sampleModule = require('../modules/sample/handler');

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const handleSample = sampleModule.routes.find((r) => r.path === '/api/v1/sample').handler;

function fetchSample(type) {
  let status = 0;
  let body = '';
  const res = {
    writeHead(code) {
      status = code;
    },
    setHeader() {},
    end(chunk) {
      body += chunk || '';
    },
  };
  handleSample({ url: '/api/v1/sample?type=' + encodeURIComponent(type), headers: {} }, res);
  assert.equal(status, 200, 'sample ' + type + ' must be served');
  return JSON.parse(body);
}

const responseSpecimens = fs
  .readdirSync(SAMPLES_DIR)
  .filter((f) => f.startsWith('synthetic-') && f.endsWith('.json'))
  .filter((f) =>
    Array.isArray(JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, f), 'utf8')).seatbid),
  )
  .map((f) => f.replace(/^synthetic-/, '').replace(/\.json$/, ''));

test('the catalog contains response specimens to cover', () => {
  assert.ok(responseSpecimens.includes('clean-banner'));
});

test('clean-banner request id equals the response id', () => {
  const sample = fetchSample('clean-banner');
  assert.equal(sample.bid_request.id, sample.bid_response.id);
});

for (const slug of responseSpecimens) {
  test('synthetic-' + slug + ': synthesized request keeps the response id (no id_mismatch)', () => {
    const sample = fetchSample(slug);
    assert.equal(sample.bid_request.id, sample.bid_response.id);
    const findings = core.crosscheck(sample.bid_request, sample.bid_response, { locale: 'en' });
    assert.equal(
      findings.find((f) => f.id === 'crosscheck.id_mismatch'),
      undefined,
    );
    assert.deepEqual(
      findings.filter((f) => f.level === 'crit').map((f) => f.id),
      [],
    );
  });
}
