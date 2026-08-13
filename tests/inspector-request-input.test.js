'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserEsmLoader } = require('./browser-esm-loader');

async function loadSubject(salt) {
  const loader = createBrowserEsmLoader({ realmSalt: salt });
  return loader.import('/modules/inspector/request-input.js');
}

test('Inspector request input preserves a raw legacy-feed URL across History', async () => {
  const { parseRequestInput, serializeRequestInput } = await loadSubject(
    'inspector-request-input-url',
  );
  const raw =
    '  http://feed.example/search?feed=123&auth=redacted&url=https%3A%2F%2Fpublisher.example  ';

  const parsed = parseRequestInput(raw);
  assert.equal(
    parsed,
    'http://feed.example/search?feed=123&auth=redacted&url=https%3A%2F%2Fpublisher.example',
  );
  assert.equal(serializeRequestInput(parsed), parsed, 'History must not add JSON string quotes');
  assert.equal(parseRequestInput(serializeRequestInput(parsed)), parsed);
});

test('Inspector request input still parses and pretty-prints OpenRTB JSON', async () => {
  const { parseRequestInput, serializeRequestInput } = await loadSubject(
    'inspector-request-input-json',
  );
  const parsed = parseRequestInput('{"id":"r1","imp":[]}');

  assert.deepEqual(parsed, { id: 'r1', imp: [] });
  assert.equal(serializeRequestInput(parsed), '{\n  "id": "r1",\n  "imp": []\n}');
});

test('Inspector request input rejects malformed non-URL text', async () => {
  const { parseRequestInput } = await loadSubject('inspector-request-input-invalid');
  assert.throws(() => parseRequestInput('not JSON and not a URL'), SyntaxError);
  assert.throws(() => parseRequestInput('http://'), SyntaxError);
});
