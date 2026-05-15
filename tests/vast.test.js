'use strict';

/**
 * VAST 2.x/3.x/4.x rules.
 *
 * Tested at two levels:
 *   - validateVast() directly (unit) for fast structural checks
 *   - validate() over a BidResponse (integration) so we exercise the
 *     wiring in rules-response.js
 *
 * Findings are asserted by stable `id`, not by message text — i18n
 * edits don't break the suite. Sample-file integrity is exercised
 * separately so the demo dropdown can never silently rot.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validate } = require('@kyivtech/spyglass-core');
const { validateVast, isVastShape } = require('../packages/core/rules-vast');
const { isVastShape: detectShape, detectVastVersion } = require('../packages/core/format-detect');

// Helpers
const findById = (findings, id) => findings.find((f) => f.id === id);
const filterVast = (findings) => findings.filter((f) => f.id.startsWith('vast.'));

function wrapInBidResponse(adm) {
  return {
    id: 'r1',
    cur: 'USD',
    seatbid: [
      {
        seat: 's1',
        bid: [
          {
            id: 'b1',
            impid: '1',
            price: 1.5,
            adomain: ['ex.com'],
            adm,
          },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────
// isVastShape / detectVastVersion (anchored sniffers)
// ─────────────────────────────────────────────────────────────────

test('isVastShape: <?xml prefix matches', () => {
  assert.equal(isVastShape('<?xml version="1.0"?><VAST version="4.2"></VAST>'), true);
  assert.equal(detectShape('<?xml version="1.0"?><VAST version="4.2"></VAST>'), true);
});

test('isVastShape: bare <VAST matches', () => {
  assert.equal(isVastShape('<VAST version="3.0"></VAST>'), true);
});

test('isVastShape: leading whitespace tolerated', () => {
  assert.equal(isVastShape('   \n<VAST version="2.0"></VAST>'), true);
});

test('isVastShape: HTML mentioning <VAST inside is NOT VAST', () => {
  assert.equal(isVastShape('<div>see <VAST></VAST></div>'), false);
});

test('isVastShape: non-string returns false', () => {
  assert.equal(isVastShape(null), false);
  assert.equal(isVastShape(123), false);
  assert.equal(isVastShape({}), false);
});

test('detectVastVersion: extracts 4.2 / 3.0 / 2.0', () => {
  assert.equal(detectVastVersion('<VAST version="4.2"></VAST>'), '4.2');
  assert.equal(detectVastVersion('<VAST version="3.0"></VAST>'), '3.0');
  assert.equal(detectVastVersion("<VAST version='2.0'></VAST>"), '2.0');
});

test('detectVastVersion: missing returns null', () => {
  assert.equal(detectVastVersion('<VAST></VAST>'), null);
  assert.equal(detectVastVersion(null), null);
});

// ─────────────────────────────────────────────────────────────────
// validateVast() — unit
// ─────────────────────────────────────────────────────────────────

test('validateVast: clean InLine emits 0 findings', () => {
  // Clean = all required InLine tags present (AdSystem, AdTitle,
  // MediaFile with dimensions, Impression) AND Linear has Duration AND
  // TrackingEvents (R13 added tracking_events_missing for InLine Linear).
  const adm =
    '<?xml version="1.0"?><VAST version="4.2"><Ad><InLine>' +
    '<AdSystem>X</AdSystem><AdTitle>Title</AdTitle>' +
    '<UniversalAdId idRegistry="ad-id.org">abc123</UniversalAdId>' +
    '<Impression><![CDATA[https://i.example/i]]></Impression>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration>' +
    '<TrackingEvents><Tracking event="start"><![CDATA[https://trk.example/start]]></Tracking></TrackingEvents>' +
    '<MediaFiles>' +
    '<MediaFile delivery="progressive" type="video/mp4" width="640" height="360">' +
    '<![CDATA[https://cdn.example/v.mp4]]></MediaFile>' +
    '</MediaFiles></Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.equal(f.length, 0);
});

test('validateVast: missing version → vast.version_missing ERROR', () => {
  const adm =
    '<VAST><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle><MediaFile/></InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  const m = findById(f, 'vast.version_missing');
  assert.ok(m);
  assert.equal(m.level, 'error');
});

test('validateVast: unknown major version → vast.version_unknown WARN', () => {
  const adm =
    '<VAST version="1.0"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle><MediaFile/></InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  const m = findById(f, 'vast.version_unknown');
  assert.ok(m);
  assert.equal(m.level, 'warning');
  assert.equal(m.params.ver, '1.0');
});

test('validateVast: neither InLine nor Wrapper → vast.inline_or_wrapper_required', () => {
  const adm = '<VAST version="4.2"><Ad></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.ok(findById(f, 'vast.inline_or_wrapper_required'));
});

test('validateVast: InLine without AdSystem → vast.adsystem_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdTitle>T</AdTitle><MediaFile/></InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.ok(findById(f, 'vast.adsystem_missing'));
});

test('validateVast: InLine without AdTitle → vast.adtitle_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><MediaFile/></InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.ok(findById(f, 'vast.adtitle_missing'));
});

test('validateVast: InLine without MediaFile → vast.mediafile_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle></InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.ok(findById(f, 'vast.mediafile_missing'));
});

test('validateVast: Wrapper without VASTAdTagURI → vast.wrapper_no_tag_uri', () => {
  const adm = '<VAST version="3.0"><Ad><Wrapper><AdSystem>X</AdSystem></Wrapper></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.ok(findById(f, 'vast.wrapper_no_tag_uri'));
});

test('validateVast: Wrapper WITH VASTAdTagURI does not fire', () => {
  const adm =
    '<VAST version="3.0"><Ad><Wrapper><AdSystem>X</AdSystem><VASTAdTagURI><![CDATA[https://w.example/v]]></VASTAdTagURI></Wrapper></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.equal(findById(f, 'vast.wrapper_no_tag_uri'), undefined);
});

test('validateVast: insecure http:// in MediaFile + ClickThrough → vast.insecure_url WARN with count', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine>' +
    '<AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<MediaFile><![CDATA[http://media.example/v.mp4]]></MediaFile>' +
    '<ClickThrough><![CDATA[http://click.example/c]]></ClickThrough>' +
    '<ClickThrough><![CDATA[https://click2.example/c]]></ClickThrough>' +
    '</InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  const m = findById(f, 'vast.insecure_url');
  assert.ok(m);
  assert.equal(m.level, 'warning');
  assert.equal(m.params.count, 2);
  assert.match(m.params.sampleUrl, /^http:\/\//);
});

test('validateVast: all-https creative fires no insecure_url', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine>' +
    '<AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<MediaFile><![CDATA[https://cdn.example/v.mp4]]></MediaFile>' +
    '<Impression><![CDATA[https://i.example/i]]></Impression>' +
    '</InLine></Ad></VAST>';
  const f = validateVast(adm, 'adm');
  assert.equal(findById(f, 'vast.insecure_url'), undefined);
});

// New rules in v0.14.0 — VPAID, ad-pod, Linear duration, Impression tracking

test('validateVast: ad-pod (multiple <Ad>) fires INFO with count', () => {
  const adm =
    '<VAST version="4.2">' +
    '<Ad><InLine><AdSystem>X</AdSystem><AdTitle>T1</AdTitle><MediaFile/></InLine></Ad>' +
    '<Ad><InLine><AdSystem>X</AdSystem><AdTitle>T2</AdTitle><MediaFile/></InLine></Ad>' +
    '<Ad><InLine><AdSystem>X</AdSystem><AdTitle>T3</AdTitle><MediaFile/></InLine></Ad>' +
    '</VAST>';
  const f = validateVast(adm, 'adm');
  const m = findById(f, 'vast.ad_pod');
  assert.ok(m);
  assert.equal(m.level, 'info');
  assert.equal(m.params.count, 3);
});

test('validateVast: single <Ad> does NOT fire ad_pod', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle><MediaFile/></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.ad_pod'), undefined);
});

test('validateVast: Linear without Duration → linear_duration_missing ERROR', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><MediaFiles><MediaFile/></MediaFiles></Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  const m = findById(validateVast(adm, 'adm'), 'vast.linear_duration_missing');
  assert.ok(m);
  assert.equal(m.level, 'error');
});

test('validateVast: Linear WITH Duration does not fire', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles><MediaFile/></MediaFiles></Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.linear_duration_missing'), undefined);
});

test('validateVast: apiFramework="VPAID" → vpaid_deprecated WARN', () => {
  const adm =
    '<VAST version="3.0"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><MediaFiles>' +
    '<MediaFile delivery="progressive" type="application/javascript" apiFramework="VPAID"><![CDATA[https://cdn.example/vpaid.js]]></MediaFile>' +
    '</MediaFiles></Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  const m = findById(validateVast(adm, 'adm'), 'vast.vpaid_deprecated');
  assert.ok(m);
  assert.equal(m.level, 'warning');
});

test('validateVast: apiFramework="OMID" does NOT fire vpaid_deprecated', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<MediaFile apiFramework="OMID"><![CDATA[https://cdn.example/v.mp4]]></MediaFile>' +
    '</InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.vpaid_deprecated'), undefined);
});

test('validateVast: InLine without Impression → impression_tracking_missing WARN', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<MediaFile/></InLine></Ad></VAST>';
  const m = findById(validateVast(adm, 'adm'), 'vast.impression_tracking_missing');
  assert.ok(m);
  assert.equal(m.level, 'warning');
});

test('validateVast: Wrapper without Impression does NOT fire (rule is InLine-only)', () => {
  const adm =
    '<VAST version="3.0"><Ad><Wrapper><AdSystem>X</AdSystem>' +
    '<VASTAdTagURI><![CDATA[https://w.example/v]]></VASTAdTagURI>' +
    '</Wrapper></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.impression_tracking_missing'), undefined);
});

test('samples: synthetic-vast-vpaid-deprecated.json fires vpaid_deprecated + linear_duration_missing', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-vast-vpaid-deprecated.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);
  assert.ok(findById(r.findings, 'vast.vpaid_deprecated'));
  assert.ok(findById(r.findings, 'vast.linear_duration_missing'));
});

// ─────────────────────────────────────────────────────────────────
// Integration through validate() — the wired-up rules-response path
// ─────────────────────────────────────────────────────────────────

test('integration: BidResponse with broken VAST emits 3 ERRORs (version + adsystem + mediafile)', () => {
  const adm =
    '<?xml version="1.0"?><VAST><Ad><InLine><AdTitle>T</AdTitle><Impression><![CDATA[https://i.example/i]]></Impression></InLine></Ad></VAST>';
  const r = validate(wrapInBidResponse(adm));
  const v = filterVast(r.findings);
  assert.equal(v.length, 3);
  assert.ok(findById(v, 'vast.version_missing'));
  assert.ok(findById(v, 'vast.adsystem_missing'));
  assert.ok(findById(v, 'vast.mediafile_missing'));
  for (const f of v) {
    assert.equal(f.params.sNum, 1);
    assert.equal(f.params.bNum, 1);
    assert.equal(f.path, 'seatbid[0].bid[0].adm');
  }
});

test('integration: BidResponse with banner adm does NOT trigger vast.* findings', () => {
  const adm = '<!DOCTYPE html><html><body><div class="banner">click</div></body></html>';
  const r = validate(wrapInBidResponse(adm));
  assert.equal(filterVast(r.findings).length, 0);
});

test('integration: VAST findings carry resolved msg (i18n decoration)', () => {
  const r = validate(wrapInBidResponse('<VAST><Ad></Ad></VAST>'), { locale: 'uk' });
  const f = findById(r.findings, 'vast.inline_or_wrapper_required');
  assert.ok(f);
  assert.ok(f.msg && f.msg.length > 10, 'msg should be a non-empty localized string');
});

test('integration: vast.* respects disabledRules option', () => {
  const adm = '<VAST><Ad><InLine></InLine></Ad></VAST>'; // emits version, adsystem, adtitle, mediafile
  const baseline = validate(wrapInBidResponse(adm));
  const baselineCount = filterVast(baseline.findings).length;
  assert.ok(baselineCount > 0);

  const filtered = validate(wrapInBidResponse(adm), { disabledRules: ['vast.*'] });
  assert.equal(filterVast(filtered.findings).length, 0);
});

// ─────────────────────────────────────────────────────────────────
// Sample-file integrity
// ─────────────────────────────────────────────────────────────────

test('samples: synthetic-vast-clean-inline.json fires 0 vast.* findings', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-vast-clean-inline.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);
  assert.equal(filterVast(r.findings).length, 0);
});

test('samples: synthetic-vast-broken-inline.json fires 3 vast.* ERRORs', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-vast-broken-inline.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);
  const v = filterVast(r.findings);
  assert.equal(v.length, 3);
  assert.ok(findById(v, 'vast.version_missing'));
  assert.ok(findById(v, 'vast.adsystem_missing'));
  assert.ok(findById(v, 'vast.mediafile_missing'));
});

test('samples: synthetic-vast-insecure-wrapper.json fires exactly 1 insecure_url WARN', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-vast-insecure-wrapper.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);
  const v = filterVast(r.findings);
  const insecure = v.filter((f) => f.id === 'vast.insecure_url');
  assert.equal(insecure.length, 1);
  assert.equal(insecure[0].level, 'warning');
  assert.equal(insecure[0].params.count, 3);
});

// ─────────────────────────────────────────────────────────────────
// R11 — vast.mediafile_no_dimensions
// ─────────────────────────────────────────────────────────────────

test('validateVast: MediaFile missing width → mediafile_no_dimensions WARN count=1', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles>' +
    '<MediaFile delivery="progressive" type="video/mp4" height="360"/>' +
    '</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.mediafile_no_dimensions');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.params.count, 1);
});

test('validateVast: MediaFile missing both width and height → fires', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles>' +
    '<MediaFile delivery="progressive" type="video/mp4"/>' +
    '</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.mediafile_no_dimensions');
  assert.ok(f);
  assert.equal(f.params.count, 1);
});

test('validateVast: MediaFile with both width and height → no mediafile_no_dimensions', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles>' +
    '<MediaFile delivery="progressive" type="video/mp4" width="640" height="360"/>' +
    '<MediaFile delivery="progressive" type="video/webm" width="1280" height="720"/>' +
    '</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.mediafile_no_dimensions'), undefined);
});

test('validateVast: no MediaFile elements → no mediafile_no_dimensions (R4 handles it)', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear/></Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.mediafile_no_dimensions'), undefined);
});

test('validateVast: mixed MediaFiles — count reflects only the bad ones', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles>' +
    '<MediaFile width="640" height="360" type="video/mp4"/>' +
    '<MediaFile width="640" type="video/webm"/>' +
    '<MediaFile type="video/ogg"/>' +
    '</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.mediafile_no_dimensions');
  assert.ok(f);
  assert.equal(f.params.count, 2);
});

// ─────────────────────────────────────────────────────────────────
// R12 — vast.skip_offset_invalid
// ─────────────────────────────────────────────────────────────────

test('validateVast: skipoffset HH:MM:SS → no skip_offset_invalid', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="00:00:05"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid'), undefined);
});

test('validateVast: skipoffset valid percentage → no skip_offset_invalid', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="20%"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid'), undefined);
});

test('validateVast: skipoffset bare number → skip_offset_invalid WARN with val', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="15"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.params.val, '15');
});

test('validateVast: skipoffset > 100% → skip_offset_invalid', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="150%"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid');
  assert.ok(f);
  assert.equal(f.params.val, '150%');
});

test('validateVast: skipoffset malformed timecode "0:15" → fires', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="0:15"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid');
  assert.ok(f);
  assert.equal(f.params.val, '0:15');
});

test('validateVast: skipoffset absent → no skip_offset_invalid (non-skippable is valid)', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid'), undefined);
});

test('validateVast: skipoffset edge — 0% and 100% are valid boundaries', () => {
  const adm0 =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="0%"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  const adm100 =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="100%"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm0, 'adm'), 'vast.skip_offset_invalid'), undefined);
  assert.equal(findById(validateVast(adm100, 'adm'), 'vast.skip_offset_invalid'), undefined);
});

test('validateVast: skipoffset out-of-range minutes "00:75:00" → fires', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="00:75:00"><Duration>00:01:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid');
  assert.ok(f);
  assert.equal(f.params.val, '00:75:00');
});

test('validateVast: skipoffset decimal percentage "33.33%" is valid', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<Linear skipoffset="33.33%"><Duration>00:00:30</Duration><MediaFiles><MediaFile/></MediaFiles></Linear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.skip_offset_invalid'), undefined);
});

// ─────────────────────────────────────────────────────────────────
// R13 — vast.tracking_events_missing
// ─────────────────────────────────────────────────────────────────

test('validateVast: InLine Linear without TrackingEvents → tracking_events_missing INFO', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration>' +
    '<MediaFiles><MediaFile/></MediaFiles></Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  const f = findById(validateVast(adm, 'adm'), 'vast.tracking_events_missing');
  assert.ok(f);
  assert.equal(f.level, 'info');
});

test('validateVast: InLine Linear WITH TrackingEvents → no tracking_events_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration>' +
    '<TrackingEvents><Tracking event="start"><![CDATA[https://trk.example/start]]></Tracking></TrackingEvents>' +
    '<MediaFiles><MediaFile/></MediaFiles></Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.tracking_events_missing'), undefined);
});

test('validateVast: Wrapper Linear without TrackingEvents → no tracking_events_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><Wrapper><AdSystem>X</AdSystem>' +
    '<VASTAdTagURI><![CDATA[https://ads.example/next.xml]]></VASTAdTagURI>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration></Linear></Creative></Creatives>' +
    '</Wrapper></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.tracking_events_missing'), undefined);
});

test('validateVast: InLine without Linear → no tracking_events_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Creatives><Creative>' +
    '<NonLinear><StaticResource creativeType="image/png"><![CDATA[https://cdn.example/img.png]]></StaticResource></NonLinear>' +
    '</Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.tracking_events_missing'), undefined);
});

// ─────────────────────────────────────────────────────────────────
// R14 — vast.duration_invalid
// ─────────────────────────────────────────────────────────────────

const SKEL = (dur) =>
  `<VAST version="4.2"><Ad><InLine>` +
  `<AdSystem>X</AdSystem><AdTitle>T</AdTitle>` +
  `<Impression><![CDATA[https://imp.example/i]]></Impression>` +
  `<Creatives><Creative><Linear>` +
  `<Duration>${dur}</Duration>` +
  `<TrackingEvents><Tracking event="start"><![CDATA[https://trk.example/s]]></Tracking></TrackingEvents>` +
  `<MediaFiles><MediaFile width="640" height="360" type="video/mp4"><![CDATA[https://cdn.example/v.mp4]]></MediaFile></MediaFiles>` +
  `</Linear></Creative></Creatives>` +
  `</InLine></Ad></VAST>`;

test('validateVast: valid duration "00:00:15" → no duration_invalid', () => {
  assert.equal(findById(validateVast(SKEL('00:00:15'), 'adm'), 'vast.duration_invalid'), undefined);
});

test('validateVast: bare seconds "15" → duration_invalid fires', () => {
  const f = findById(validateVast(SKEL('15'), 'adm'), 'vast.duration_invalid');
  assert.ok(f);
  assert.equal(f.params.val, '15');
});

test('validateVast: out-of-range minutes "00:90:00" → duration_invalid fires', () => {
  const f = findById(validateVast(SKEL('00:90:00'), 'adm'), 'vast.duration_invalid');
  assert.ok(f);
  assert.equal(f.params.val, '00:90:00');
});

test('validateVast: out-of-range seconds "00:00:60" → duration_invalid fires', () => {
  const f = findById(validateVast(SKEL('00:00:60'), 'adm'), 'vast.duration_invalid');
  assert.ok(f);
  assert.equal(f.params.val, '00:00:60');
});

test('validateVast: CDATA-wrapped valid "00:01:30" → no duration_invalid', () => {
  assert.equal(
    findById(validateVast(SKEL('<![CDATA[00:01:30]]>'), 'adm'), 'vast.duration_invalid'),
    undefined,
  );
});

test('validateVast: CDATA-wrapped invalid "0:15" → duration_invalid fires', () => {
  const f = findById(validateVast(SKEL('<![CDATA[0:15]]>'), 'adm'), 'vast.duration_invalid');
  assert.ok(f);
  assert.equal(f.params.val, '0:15');
});

// ─────────────────────────────────────────────────────────────────
// R15 — vast.mediafile_type_invalid
// ─────────────────────────────────────────────────────────────────

// Helper: SKEL already uses type="video/mp4" → valid, so we need a variant
// that lets us inject a custom type attribute value.
const SKEL_TYPE = (mimeType) =>
  `<VAST version="4.2"><Ad><InLine>` +
  `<AdSystem>X</AdSystem><AdTitle>T</AdTitle>` +
  `<Impression><![CDATA[https://imp.example/i]]></Impression>` +
  `<Creatives><Creative><Linear>` +
  `<Duration>00:00:15</Duration>` +
  `<TrackingEvents><Tracking event="start"><![CDATA[https://trk.example/s]]></Tracking></TrackingEvents>` +
  `<MediaFiles><MediaFile width="640" height="360" type="${mimeType}"><![CDATA[https://cdn.example/v.mp4]]></MediaFile></MediaFiles>` +
  `</Linear></Creative></Creatives>` +
  `</InLine></Ad></VAST>`;

test('validateVast: valid MediaFile type "video/mp4" → no mediafile_type_invalid', () => {
  assert.equal(
    findById(validateVast(SKEL_TYPE('video/mp4'), 'adm'), 'vast.mediafile_type_invalid'),
    undefined,
  );
});

test('validateVast: valid MediaFile type "application/dash+xml" → no mediafile_type_invalid', () => {
  assert.equal(
    findById(validateVast(SKEL_TYPE('application/dash+xml'), 'adm'), 'vast.mediafile_type_invalid'),
    undefined,
  );
});

test('validateVast: invalid MediaFile type "video/avi" → mediafile_type_invalid WARNING', () => {
  const f = findById(validateVast(SKEL_TYPE('video/avi'), 'adm'), 'vast.mediafile_type_invalid');
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.params.type, 'video/avi');
});

test('validateVast: MediaFile without type attr → no mediafile_type_invalid', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Impression><![CDATA[https://i.example/i]]></Impression>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration>' +
    '<TrackingEvents><Tracking event="start"><![CDATA[https://t.example/s]]></Tracking></TrackingEvents>' +
    '<MediaFiles><MediaFile width="640" height="360"><![CDATA[https://cdn.example/v.mp4]]></MediaFile></MediaFiles>' +
    '</Linear></Creative></Creatives></InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.mediafile_type_invalid'), undefined);
});

test('validateVast: MediaFile type case-insensitive — "VIDEO/MP4" → no mediafile_type_invalid', () => {
  assert.equal(
    findById(validateVast(SKEL_TYPE('VIDEO/MP4'), 'adm'), 'vast.mediafile_type_invalid'),
    undefined,
  );
});

// ─────────────────────────────────────────────────────────────────
// R16 — vast.universaladid_missing
// ─────────────────────────────────────────────────────────────────

test('validateVast: VAST 4.x InLine without UniversalAdId → universaladid_missing INFO', () => {
  const f = findById(validateVast(SKEL('00:00:15'), 'adm'), 'vast.universaladid_missing');
  assert.ok(f);
  assert.equal(f.level, 'info');
});

test('validateVast: VAST 4.x InLine WITH UniversalAdId → no universaladid_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><InLine>' +
    '<AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<UniversalAdId idRegistry="ad-id.org">abc123</UniversalAdId>' +
    '<Impression><![CDATA[https://imp.example/i]]></Impression>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration>' +
    '<TrackingEvents><Tracking event="start"><![CDATA[https://trk.example/s]]></Tracking></TrackingEvents>' +
    '<MediaFiles><MediaFile width="640" height="360" type="video/mp4"><![CDATA[https://cdn.example/v.mp4]]></MediaFile></MediaFiles>' +
    '</Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.universaladid_missing'), undefined);
});

test('validateVast: VAST 3.x InLine without UniversalAdId → no universaladid_missing', () => {
  const adm =
    '<VAST version="3.0"><Ad><InLine>' +
    '<AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    '<Impression><![CDATA[https://imp.example/i]]></Impression>' +
    '<Creatives><Creative><Linear><Duration>00:00:15</Duration>' +
    '<TrackingEvents><Tracking event="start"><![CDATA[https://trk.example/s]]></Tracking></TrackingEvents>' +
    '<MediaFiles><MediaFile width="640" height="360" type="video/mp4"><![CDATA[https://cdn.example/v.mp4]]></MediaFile></MediaFiles>' +
    '</Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.universaladid_missing'), undefined);
});

test('validateVast: VAST 4.x Wrapper → no universaladid_missing', () => {
  const adm =
    '<VAST version="4.2"><Ad><Wrapper>' +
    '<AdSystem>X</AdSystem>' +
    '<VASTAdTagURI><![CDATA[https://w.example/v]]></VASTAdTagURI>' +
    '</Wrapper></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.universaladid_missing'), undefined);
});

// ─────────────────────────────────────────────────────────────────
// R17 — vast.videoclicks_no_clickthrough
// ─────────────────────────────────────────────────────────────────

// Helper: InLine with VideoClicks block, parameterised on ClickThrough presence.
const SKEL_CLICKS = (withClickThrough) =>
  '<VAST version="4.2"><Ad><InLine>' +
  '<AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
  '<UniversalAdId idRegistry="ad-id.org">abc</UniversalAdId>' +
  '<Impression><![CDATA[https://imp.example/i]]></Impression>' +
  '<Creatives><Creative><Linear><Duration>00:00:15</Duration>' +
  '<TrackingEvents><Tracking event="start"><![CDATA[https://trk.example/s]]></Tracking></TrackingEvents>' +
  '<VideoClicks>' +
  (withClickThrough ? '<ClickThrough><![CDATA[https://brand.example/lp]]></ClickThrough>' : '') +
  '<ClickTracking><![CDATA[https://trk.example/c]]></ClickTracking>' +
  '</VideoClicks>' +
  '<MediaFiles><MediaFile width="640" height="360" type="video/mp4"><![CDATA[https://cdn.example/v.mp4]]></MediaFile></MediaFiles>' +
  '</Linear></Creative></Creatives>' +
  '</InLine></Ad></VAST>';

test('validateVast: InLine VideoClicks WITH ClickThrough → no videoclicks_no_clickthrough', () => {
  assert.equal(
    findById(validateVast(SKEL_CLICKS(true), 'adm'), 'vast.videoclicks_no_clickthrough'),
    undefined,
  );
});

test('validateVast: InLine VideoClicks NO ClickThrough → videoclicks_no_clickthrough INFO', () => {
  const f = findById(validateVast(SKEL_CLICKS(false), 'adm'), 'vast.videoclicks_no_clickthrough');
  assert.ok(f);
  assert.equal(f.level, 'info');
});

test('validateVast: InLine WITHOUT VideoClicks → no videoclicks_no_clickthrough', () => {
  // SKEL() has no VideoClicks block at all
  assert.equal(
    findById(validateVast(SKEL('00:00:15'), 'adm'), 'vast.videoclicks_no_clickthrough'),
    undefined,
  );
});

test('validateVast: Wrapper with VideoClicks no ClickThrough → no videoclicks_no_clickthrough (exempt)', () => {
  const adm =
    '<VAST version="4.2"><Ad><Wrapper>' +
    '<AdSystem>X</AdSystem>' +
    '<VASTAdTagURI><![CDATA[https://w.example/v]]></VASTAdTagURI>' +
    '<VideoClicks><ClickTracking><![CDATA[https://trk.example/c]]></ClickTracking></VideoClicks>' +
    '</Wrapper></Ad></VAST>';
  assert.equal(findById(validateVast(adm, 'adm'), 'vast.videoclicks_no_clickthrough'), undefined);
});

// ─────────────────────────────────────────────────────────────────
// R18 — vast.nonlinear_no_dimensions
// ─────────────────────────────────────────────────────────────────

// Helper: InLine with a NonLinear overlay, parameterised on attribute string.
const SKEL_NONLINEAR = (nlAttrs) =>
  '<VAST version="4.2"><Ad><InLine>' +
  '<AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
  '<UniversalAdId idRegistry="ad-id.org">abc</UniversalAdId>' +
  '<Impression><![CDATA[https://imp.example/i]]></Impression>' +
  '<Creatives><Creative>' +
  '<NonLinearAds><NonLinear ' +
  nlAttrs +
  '>' +
  '<StaticResource creativeType="image/png"><![CDATA[https://cdn.example/overlay.png]]></StaticResource>' +
  '</NonLinear></NonLinearAds>' +
  '</Creative></Creatives>' +
  '</InLine></Ad></VAST>';

test('validateVast: NonLinear with width+height → no nonlinear_no_dimensions', () => {
  assert.equal(
    findById(
      validateVast(SKEL_NONLINEAR('width="300" height="250"'), 'adm'),
      'vast.nonlinear_no_dimensions',
    ),
    undefined,
  );
});

test('validateVast: NonLinear missing width → nonlinear_no_dimensions WARNING count=1', () => {
  const f = findById(
    validateVast(SKEL_NONLINEAR('height="250"'), 'adm'),
    'vast.nonlinear_no_dimensions',
  );
  assert.ok(f);
  assert.equal(f.level, 'warning');
  assert.equal(f.params.count, 1);
});

test('validateVast: NonLinear missing height → nonlinear_no_dimensions WARNING count=1', () => {
  const f = findById(
    validateVast(SKEL_NONLINEAR('width="300"'), 'adm'),
    'vast.nonlinear_no_dimensions',
  );
  assert.ok(f);
  assert.equal(f.params.count, 1);
});

test('validateVast: NonLinear missing both dimensions → nonlinear_no_dimensions count=1', () => {
  const f = findById(validateVast(SKEL_NONLINEAR(''), 'adm'), 'vast.nonlinear_no_dimensions');
  assert.ok(f);
  assert.equal(f.params.count, 1);
});
