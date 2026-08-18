'use strict';

/**
 * tests/payload-dos-guards.test.js
 *
 * Regression locks for two remotely-triggerable resource exhaustion paths
 * found in the 2026-08-18 engine audit. Both were reachable from the public,
 * unauthenticated /api/analyze with a payload well under the 2MB body cap,
 * so the cap was never a bound on the work either one performed.
 *
 *   1. rules-vast.js — `<tag\b[^>]*>` patterns backtracked across the whole
 *      document once per open-tag start. Measured before the fix: 27KB
 *      104ms, 54KB 381ms, 107KB 1507ms, 215KB 6070ms — quadratic, so the
 *      2MB ceiling permitted minutes of blocked event loop.
 *
 *   2. tcstring-sanity.js — range-encoded vendor sections expanded every
 *      range into individual ids with no aggregate ceiling. `numEntries` is
 *      12 bits (4095) and each range spans up to 65535 ids, so a 5.5KB
 *      consent string materialised ~268M array entries: 2850ms and 2518MB
 *      RSS measured before the fix.
 *
 * These assert BOTH halves of each fix: that the work is now bounded, and
 * that the findings the slow path used to produce are still produced. A
 * guard that silently drops diagnostics would pass a timing test and fail
 * the users it was written for.
 *
 * Thresholds are deliberately loose — an order of magnitude below the old
 * numbers and far above the new ones — so this catches a reintroduced
 * blowup without flaking on a loaded CI box.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../packages/core');
const { validateVast } = require('../packages/core/rules-vast');
const { checkTcString } = require('../packages/core/tcstring-sanity');

// ── 1. VAST tag scanning is linear ───────────────────────────────────

/** Open-tag starts with no `>` anywhere — the shape that triggered backtracking. */
function unclosedTagAdm(count) {
  return '<VAST version="4.0"><Ad><InLine>' + '<MediaFile '.repeat(count) + '</InLine></Ad></VAST>';
}

function timeVastValidate(adm) {
  const t0 = Date.now();
  validate(
    {
      id: '1',
      seatbid: [{ bid: [{ id: '1', impid: '1', price: 1, adm, adomain: ['a.com'], crid: 'c' }] }],
    },
    { type: 'bidresponse' },
  );
  return Date.now() - t0;
}

test('VAST: 215KB of unclosed tags does not blow up (was 6070ms)', () => {
  const adm = unclosedTagAdm(20000);
  assert.ok(adm.length > 200 * 1024, 'fixture should exceed 200KB');
  const ms = timeVastValidate(adm);
  assert.ok(ms < 600, `expected well under 600ms, took ${ms}ms`);
});

test('VAST: cost grows linearly, not quadratically, with input size', () => {
  // Quadratic would put the 8x input at ~64x the time. Allowing 12x leaves
  // generous headroom for timer noise while still failing a real regression.
  const small = unclosedTagAdm(2500);
  const large = unclosedTagAdm(20000);
  // Warm up so JIT compilation is not attributed to the first measurement.
  timeVastValidate(small);
  const tSmall = Math.max(1, timeVastValidate(small));
  const tLarge = timeVastValidate(large);
  assert.ok(
    tLarge < tSmall * 12,
    `8x the input took ${tLarge}ms vs ${tSmall}ms — growth looks super-linear`,
  );
});

test('VAST: the fix did not cost us real findings', () => {
  const adm =
    '<VAST version="3.0"><Ad><InLine><Creatives><Creative><Linear><MediaFiles>' +
    '<MediaFile delivery="progressive" type="video/mp4" apiFramework="VPAID">' +
    '<![CDATA[http://insecure.example/v.mp4]]></MediaFile>' +
    '</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  const ids = validateVast(adm, 'seatbid[0].bid[0].adm').map((f) => f.id);
  assert.ok(ids.includes('vast.insecure_url'), 'insecure http:// URL must still be reported');
});

test('VAST: a self-closing tag no longer swallows the next element', () => {
  // The old lazy `[\s\S]*?` ran past an empty `<MediaFile/>` to the NEXT
  // `</MediaFile>`, hiding the insecure URL in between.
  const adm =
    '<VAST version="3.0"><Ad><InLine><Creatives><Creative><Linear><MediaFiles>' +
    '<MediaFile/>' +
    '<MediaFile delivery="progressive" type="video/mp4">' +
    '<![CDATA[http://insecure.example/v.mp4]]></MediaFile>' +
    '</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  const hit = validateVast(adm, 'p').find((f) => f.id === 'vast.insecure_url');
  assert.ok(hit, 'insecure URL after a self-closing tag must be reported');
  assert.equal(hit.params.sampleUrl, 'http://insecure.example/v.mp4');
});

// ── 2. TC string range expansion is bounded ──────────────────────────

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const bits = (n, w) => n.toString(2).padStart(w, '0');

/**
 * A Core String whose vendorConsent section is range-encoded with
 * `numEntries` maximal-width ranges. Every range spans 1..65535, so the
 * naive expansion is numEntries * 65535 ids.
 */
function maximalRangeTcString(numEntries) {
  const now = Math.floor(Date.now() / 100);
  let s = '';
  s += bits(2, 6); // version
  s += bits(now, 36); // created
  s += bits(now, 36); // lastUpdated
  s += bits(7, 12); // cmpId
  s += bits(1, 12); // cmpVersion
  s += bits(1, 6); // consentScreen
  s += bits(4, 6) + bits(13, 6); // consentLanguage 'EN'
  s += bits(100, 12); // vendorListVersion
  s += bits(2, 6); // policyVersion
  s += '0'; // isServiceSpecific
  s += '0'; // useNonStandardTexts
  s += bits(0, 12); // specialFeatureOptIns
  s += bits(0, 24); // purposesConsent
  s += bits(0, 24); // purposesLITransparency
  s += '0'; // purposeOneTreatment
  s += bits(3, 6) + bits(4, 6); // publisherCC 'DE'
  s += bits(65535, 16); // vendorConsent.maxVendorId
  s += '1'; // isRangeEncoding
  s += bits(numEntries, 12);
  for (let i = 0; i < numEntries; i += 1) s += '1' + bits(1, 16) + bits(65535, 16);
  s += bits(0, 16) + '0'; // vendorLegitimateInterest: empty
  s += bits(0, 12); // publisherRestrictions: none
  while (s.length % 6) s += '0';
  let out = '';
  for (let i = 0; i < s.length; i += 6) out += B64URL[parseInt(s.slice(i, i + 6), 2)];
  return out;
}

test('TC string: maximal range entries stay cheap (was 2850ms / 2518MB)', () => {
  const tc = maximalRangeTcString(1000);
  assert.ok(tc.length < 8 * 1024, `fixture should be small, is ${tc.length} chars`);
  const before = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  const res = checkTcString(tc);
  const ms = Date.now() - t0;
  const grewMb = (process.memoryUsage().heapUsed - before) / 1048576;
  assert.ok(ms < 500, `expected well under 500ms, took ${ms}ms`);
  // The unbounded version allocated gigabytes; a few hundred MB of headroom
  // still fails hard on a reintroduced blowup without flaking on GC timing.
  assert.ok(grewMb < 400, `heap grew ${Math.round(grewMb)}MB`);
  assert.ok(res && Array.isArray(res.findings), 'must still return findings, never throw');
});

test('TC string: the ceiling does not silence the diagnostics', () => {
  // Every per-entry check reads the `ranges` array, which the fix leaves
  // untouched — only the flattened id list is capped. Overlapping maximal
  // ranges must therefore still report as non-ascending, one per entry.
  const res = checkTcString(maximalRangeTcString(1000));
  const codes = res.findings.map((f) => f.code);
  const nonAscending = codes.filter((c) => c === 'vendor.ranges_not_ascending');
  assert.ok(nonAscending.length > 900, `expected ~999 range findings, got ${nonAscending.length}`);
});

test('TC string: the maximum entry count is handled without blowing up', () => {
  // numEntries is a 12-bit field, so 4095 is the largest a string can claim.
  const t0 = Date.now();
  const res = checkTcString(maximalRangeTcString(4000));
  const ms = Date.now() - t0;
  assert.ok(ms < 800, `expected well under 800ms, took ${ms}ms`);
  assert.ok(res.findings.length > 0, 'a hostile string should not analyse clean');
});

test('TC string: a normal range-encoded string is unaffected', () => {
  // Three small ascending ranges — what a conforming CMP actually emits.
  const now = Math.floor(Date.now() / 100);
  let s = '';
  s += bits(2, 6) + bits(now, 36) + bits(now, 36) + bits(7, 12) + bits(1, 12) + bits(1, 6);
  s += bits(4, 6) + bits(13, 6) + bits(100, 12) + bits(2, 6) + '0' + '0';
  s += bits(0, 12) + bits(0, 24) + bits(0, 24) + '0' + bits(3, 6) + bits(4, 6);
  s += bits(50, 16) + '1' + bits(3, 12);
  s += '1' + bits(1, 16) + bits(10, 16);
  s += '1' + bits(20, 16) + bits(30, 16);
  s += '0' + bits(50, 16);
  s += bits(0, 16) + '0' + bits(0, 12);
  while (s.length % 6) s += '0';
  let tc = '';
  for (let i = 0; i < s.length; i += 6) tc += B64URL[parseInt(s.slice(i, i + 6), 2)];

  const res = checkTcString(tc);
  const codes = res.findings.map((f) => f.code);
  assert.ok(
    !codes.includes('vendor.ranges_not_ascending'),
    `a well-formed ascending string must not be flagged: ${codes.join(', ')}`,
  );
});
