'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('origin response hardening keeps the exact baseline header contract', () => {
  const functionMatch = SERVER_SOURCE.match(
    /function applyBaselineHeaders\(res\) \{([\s\S]*?)\n\}/u,
  );
  assert.ok(functionMatch, 'applyBaselineHeaders must remain an explicit origin boundary');
  const body = functionMatch[1];
  const expected = new Map([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'SAMEORIGIN'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'geolocation=(), camera=(), microphone=()'],
    ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
  ]);

  for (const [name, value] of expected) {
    const exactCall = `res.setHeader('${name}', '${value}');`;
    assert.equal(body.includes(exactCall), true, `${name} baseline drifted`);
  }
  assert.match(body, /res\.setHeader\('Content-Security-Policy', CSP\);/u);
  assert.match(SERVER_SOURCE, /applyBaselineHeaders\(res\);/u);
});

test('CSP directives remain structural containment and are not treated as Blog sanitization', () => {
  const cspMatch = SERVER_SOURCE.match(/const CSP = \[([\s\S]*?)\n\]\.join\('; '\);/u);
  assert.ok(cspMatch, 'CSP must remain a reviewable fixed directive array');
  const directives = [...cspMatch[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(directives, [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' data: blob:",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ]);
  assert.equal(
    directives.includes("script-src 'self' 'unsafe-inline'"),
    true,
    'the body regression must prove inert DOM independently of CSP',
  );
});
