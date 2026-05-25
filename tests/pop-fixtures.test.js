'use strict';

/**
 * tests/pop-fixtures.test.js — pin the four synthetic-pop-*.json fixtures
 * to the behaviour the pop-request / pop-response plugins promise.
 *
 * The fixtures double as:
 *   - Stream/replay seeds via samples/synthetic-generator.js (which picks
 *     every .json in this directory round-robin).
 *   - Demo-loader options in the inspector UI ("🎲 example ▾" dropdown).
 *   - Regression anchors for these tests — if a future rule change
 *     accidentally suppresses or duplicates a finding on the canonical
 *     pop shape, this file is what catches it.
 *
 * What's checked per fixture:
 *   clean-request    detectFormat tags pops; pop-request emits 0 findings
 *                    (no fcap_missing, battr_popup_blocked, instl_conflict,
 *                    or secure_may_block_landing — all precautions met)
 *   clean-response   detectFormat tags pops; pop-response emits 0
 *                    (adm shape is window.open script — valid pop)
 *   broken-adm       detectFormat tags pops; pop-response emits exactly
 *                    one bid.pop.adm_not_redirect ERROR
 *   popunder-feed    detectFormat tags pops on the JSON-feed single-object
 *                    shape (no banner artefacts, redirecturl present)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { detectFormat, FORMATS } = require('@kyivtech/spyglass-core/format-detect');
const popReq = require('@kyivtech/spyglass-core/rules/pop-request');
const popResp = require('@kyivtech/spyglass-core/rules/pop-response');

const SAMPLES = path.join(__dirname, '..', 'samples');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SAMPLES, name), 'utf8'));

test('fixture: synthetic-pop-clean-request → tagged pops + 0 pop-request findings', () => {
  const req = load('synthetic-pop-clean-request.json');
  const fmt = detectFormat(req);
  assert.ok(fmt.formats.includes(FORMATS.POPS), 'must tag pops');
  const out = popReq.validate(req);
  const popIds = out.filter((f) => f.id.startsWith('imp.pop.')).map((f) => f.id);
  assert.deepEqual(
    popIds,
    [],
    `pop-request should emit 0 findings on a clean fixture, got: ${popIds.join(', ')}`,
  );
});

test('fixture: synthetic-pop-clean-response → tagged pops + 0 pop-response findings', () => {
  const res = load('synthetic-pop-clean-response.json');
  const fmt = detectFormat(res);
  assert.ok(fmt.formats.includes(FORMATS.POPS), 'must tag pops');
  const out = popResp.validate(res);
  const popIds = out.filter((f) => f.id.startsWith('bid.pop.')).map((f) => f.id);
  assert.deepEqual(
    popIds,
    [],
    `pop-response should emit 0 findings on a clean fixture, got: ${popIds.join(', ')}`,
  );
});

test('fixture: synthetic-pop-broken-adm → exactly one bid.pop.adm_not_redirect ERROR', () => {
  const res = load('synthetic-pop-broken-adm.json');
  const fmt = detectFormat(res);
  assert.ok(fmt.formats.includes(FORMATS.POPS), 'must still tag pops via bid.ext.adtype');
  const out = popResp.validate(res);
  const hits = out.filter((f) => f.id === 'bid.pop.adm_not_redirect');
  assert.equal(hits.length, 1, `expected exactly 1 adm_not_redirect, got ${hits.length}`);
  assert.equal(hits[0].level, 'error');
  assert.equal(hits[0].path, 'seatbid[0].bid[0].adm');
});

test('fixture: synthetic-popunder-feed → detectFormat tags pops on JSON-feed shape', () => {
  const feed = load('synthetic-popunder-feed.json');
  const fmt = detectFormat(feed);
  assert.ok(
    fmt.formats.includes(FORMATS.POPS),
    'JSON-feed single-object with redirecturl must tag pops',
  );
});

test('fixture: all four pop fixtures parse as JSON and have a _note comment', () => {
  const names = [
    'synthetic-pop-clean-request.json',
    'synthetic-pop-clean-response.json',
    'synthetic-pop-broken-adm.json',
    'synthetic-popunder-feed.json',
  ];
  for (const n of names) {
    const obj = load(n);
    assert.ok(
      typeof obj._note === 'string' && obj._note.length > 0,
      `${n} should carry a non-empty _note explaining what it tests`,
    );
  }
});
