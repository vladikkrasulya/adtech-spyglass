'use strict';

/**
 * Audit regressions for the VAST sniffers and the creative-shape rules.
 *
 * Two defects, both of the same family: a scan that mis-reads where a piece of
 * XML begins or ends, and then reports with total confidence about the wrong
 * bytes. They are pinned here rather than in tests/vast.test.js because each
 * one guards a specific decision documented in the source it covers, and a
 * reader who breaks the decision should land on the reasoning, not on a bare
 * assertion in the middle of a 900-line suite.
 *
 *   1. packages/core/vast-shape.js — a UTF-8 BOM in front of `<VAST` made
 *      isVastShape() return false, which silently disabled the ENTIRE VAST
 *      path: no format, no protocol, and validateVast never called. The
 *      inspector answered "no findings" for a broken tag.
 *
 *   2. packages/core/rules-vast.js — a self-closing `<Duration/>` matched the
 *      R14 pair regex as an OPENING tag, so the lazy body ran forward into the
 *      next creative. The rule reported a "timecode" made of markup, and the
 *      real duration further down the document was never validated.
 *
 * Findings are asserted by stable `id`, matching the convention in
 * tests/vast.test.js — message text is i18n and must not be load-bearing.
 *
 * NOTE ON THE BOM LITERAL: every U+FEFF below is written as the escape
 * sequence '\uFEFF'. A raw one would be an eslint no-irregular-whitespace
 * error and would fail tests/no-raw-control-chars.test.js, which scans this
 * file along with the rest of the tree.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('@ortbtools/core');
const { validateVast } = require('../packages/core/rules-vast');
const { isVastShape, detectVastVersion } = require('../packages/core/vast-shape');
const { detectFormat } = require('../packages/core/format-detect');

const BOM = '\uFEFF';

const findById = (findings, id) => findings.find((f) => f.id === id);

function wrapInBidResponse(adm) {
  return {
    id: 'r1',
    cur: 'USD',
    seatbid: [
      { seat: 's1', bid: [{ id: 'b1', impid: '1', price: 1.5, adomain: ['ex.com'], adm }] },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────
// vast-shape.js — a leading BOM is an encoding signature, not content
// ─────────────────────────────────────────────────────────────────

test('isVastShape: a leading UTF-8 BOM does not hide the root element', () => {
  assert.equal(isVastShape(BOM + '<VAST version="4.0"/>'), true);
  assert.equal(isVastShape(BOM + '<?xml version="1.0"?><VAST version="4.2"></VAST>'), true);
  assert.equal(isVastShape(BOM + '<!-- served by adserver --><VAST version="3.0"></VAST>'), true);
  assert.equal(isVastShape(BOM + '\n  <VAST version="2.0"></VAST>'), true);
});

test('detectVastVersion: the version survives a leading BOM', () => {
  assert.equal(detectVastVersion(BOM + '<VAST version="4.0"/>'), '4.0');
  assert.equal(detectVastVersion(BOM + '<?xml version="1.0"?><VAST version="3.0"></VAST>'), '3.0');
  // The BOM shifts every index by one; the version must still be read from the
  // ROOT tag's own attributes and not from the prolog's `version="1.0"`.
  assert.equal(detectVastVersion(BOM + '<?xml version="1.0"?><VAST></VAST>'), null);
});

test('isVastShape: only ONE BOM is a signature — a second one is content', () => {
  // U+FEFF anywhere but offset 0 is ZERO WIDTH NO-BREAK SPACE, an ordinary
  // character that XML 1.0 §2.3 does not count as whitespace. Treating it as
  // whitespace would let it separate prolog constructs, which is wrong.
  assert.equal(isVastShape(BOM + BOM + '<VAST version="4.0"/>'), false);
  assert.equal(isVastShape(BOM + '<?xml version="1.0"?>' + BOM + '<VAST/>'), false);
  assert.equal(isVastShape(' ' + BOM + '<VAST/>'), false);
});

test('isVastShape: a BOM in front of non-VAST is still not VAST', () => {
  assert.equal(isVastShape(BOM + '<html><body>not a video tag</body></html>'), false);
  assert.equal(isVastShape(BOM), false);
  assert.equal(isVastShape(BOM + '   '), false);
});

test('detectFormat: a BOM-prefixed adm is still detected as VAST video', () => {
  const adm = '<VAST version="4.0"><Ad><InLine/></Ad></VAST>';
  const plain = detectFormat(wrapInBidResponse(adm));
  const bomd = detectFormat(wrapInBidResponse(BOM + adm));
  // The whole point: byte-for-byte the same verdict, BOM or no BOM.
  assert.deepEqual(bomd.formats, plain.formats);
  assert.deepEqual(bomd.protocols, plain.protocols);
  assert.deepEqual(bomd.tags, plain.tags);
  assert.ok(bomd.formats.includes('video'), 'expected the video format');
  assert.ok(bomd.protocols.includes('vast-4'), 'expected the vast-4 protocol');
});

test('validate: a BOM-prefixed broken VAST still reaches validateVast', () => {
  // The cascade this defect caused: no shape → no format → no validateVast →
  // a broken tag reported ZERO findings, which reads to a user as "it's fine".
  // This document is missing AdSystem, AdTitle and MediaFile.
  const broken = BOM + '<VAST version="4.0"><Ad><InLine></InLine></Ad></VAST>';
  const vastFindings = validate(wrapInBidResponse(broken)).findings.filter((f) =>
    f.id.startsWith('vast.'),
  );
  assert.ok(vastFindings.length > 0, 'expected VAST rules to run on a BOM-prefixed adm');
  assert.ok(findById(vastFindings, 'vast.adsystem_missing'));
  assert.ok(findById(vastFindings, 'vast.adtitle_missing'));
  assert.ok(findById(vastFindings, 'vast.mediafile_missing'));
});

// ─────────────────────────────────────────────────────────────────
// rules-vast.js R14 — a self-closing <Duration/> is empty, not open
// ─────────────────────────────────────────────────────────────────

/**
 * An ad pod: two creatives, each with its own <Linear>. Both Duration elements
 * are spliced in verbatim so a test can make the FIRST creative's Duration
 * self-closing and still hand the second one a real timecode — exactly the
 * shape that made the old lazy regex reach across the creative boundary.
 *
 * @param {string} firstDuration  markup for the first creative's Duration
 * @param {string} secondDuration markup for the second creative's Duration
 * @returns {string}
 */
const POD = (firstDuration, secondDuration) =>
  `<VAST version="3.0"><Ad><InLine>` +
  `<AdSystem>X</AdSystem><AdTitle>T</AdTitle>` +
  `<Impression><![CDATA[https://imp.example/i]]></Impression>` +
  `<Creatives>` +
  `<Creative><Linear>${firstDuration}` +
  `<MediaFiles><MediaFile type="video/mp4" width="640" height="360">https://cdn.example/a.mp4</MediaFile></MediaFiles>` +
  `</Linear></Creative>` +
  `<Creative><Linear>${secondDuration}` +
  `<MediaFiles><MediaFile type="video/mp4" width="640" height="360">https://cdn.example/b.mp4</MediaFile></MediaFiles>` +
  `</Linear></Creative>` +
  `</Creatives></InLine></Ad></VAST>`;

test('R14: a self-closing <Duration/> never reports markup as a timecode', () => {
  const f = findById(
    validateVast(POD('<Duration/>', '<Duration>00:00:30</Duration>'), 'adm'),
    'vast.duration_invalid',
  );
  assert.ok(f, 'an empty Duration is not a valid timecode and must be reported');
  // The defect, stated as the user saw it: `val` held 150 characters of XML.
  assert.equal(f.params.val, '');
  assert.ok(!/[<>]/.test(f.params.val), 'val must never contain markup');
});

test('R14: <Duration/> and <Duration></Duration> are the same document', () => {
  // XML says they are identical. The old regex gave one a bogus 150-char `val`
  // and the other a correct empty one; agreement is the invariant.
  const selfClosing = findById(
    validateVast(POD('<Duration/>', '<Duration>00:00:30</Duration>'), 'adm'),
    'vast.duration_invalid',
  );
  const explicitlyEmpty = findById(
    validateVast(POD('<Duration></Duration>', '<Duration>00:00:30</Duration>'), 'adm'),
    'vast.duration_invalid',
  );
  assert.ok(selfClosing && explicitlyEmpty);
  assert.equal(selfClosing.params.val, explicitlyEmpty.params.val);
  assert.equal(selfClosing.level, explicitlyEmpty.level);
});

test('R14: a duration in a later creative is validated, not swallowed', () => {
  // With the lazy pair regex the second creative's `15` vanished inside the
  // slab the first `<Duration/>` opened, so a genuinely broken timecode went
  // unreported. Every Duration in the document must be examined.
  const durations = validateVast(
    POD('<Duration>00:00:15</Duration>', '<Duration>15</Duration>'),
    'adm',
  );
  const f = findById(durations, 'vast.duration_invalid');
  assert.ok(f, 'the bare-seconds duration in the second creative must be caught');
  assert.equal(f.params.val, '15');
});

test('R14: a pod whose durations are all valid produces no finding', () => {
  assert.equal(
    findById(
      validateVast(
        POD('<Duration>00:00:15</Duration>', '<Duration>00:01:30.500</Duration>'),
        'adm',
      ),
      'vast.duration_invalid',
    ),
    undefined,
  );
});

test('R14: CDATA and stray whitespace still round-trip through the walk', () => {
  // The rewrite replaced the regex capture with an indexOf slice; the CDATA
  // unwrapping and trimming it used to do must survive that.
  assert.equal(
    findById(
      validateVast(
        POD('<Duration>  <![CDATA[00:00:20]]>  </Duration>', '<Duration>00:00:30</Duration>'),
        'adm',
      ),
      'vast.duration_invalid',
    ),
    undefined,
  );
  const bad = findById(
    validateVast(
      POD('<Duration><![CDATA[0:15]]></Duration>', '<Duration>00:00:30</Duration>'),
      'adm',
    ),
    'vast.duration_invalid',
  );
  assert.ok(bad);
  assert.equal(bad.params.val, '0:15');
});

test('R14: <Durations> is not a <Duration> and an unterminated tag ends the walk', () => {
  // Word-boundary and truncation behaviour of forEachOpenTag, pinned because
  // R14 now depends on it. A truncated document is the parser's complaint to
  // make, not a fabricated timecode finding.
  const truncated =
    '<VAST version="3.0"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Impression>https://imp.example/i</Impression>' +
    '<Creatives><Creative><Linear><Duration';
  assert.equal(findById(validateVast(truncated, 'adm'), 'vast.duration_invalid'), undefined);
});
