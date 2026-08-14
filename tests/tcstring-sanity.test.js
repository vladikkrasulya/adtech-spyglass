'use strict';

/**
 * tests/tcstring-sanity.test.js — packages/core/tcstring-sanity.js
 *
 * The module answers one question about an IAB TCF v2 consent string: could a
 * conforming CMP have written these bits? Two properties matter most here and
 * the suite is organised around them.
 *
 * 1. No false positives. A warning about a healthy string is worse than no
 *    check at all, because it trains the operator to ignore the check. The
 *    "healthy strings" section is the one that must never be weakened.
 * 2. No exceptions. The module is called from validators, so every input —
 *    garbage, empty, non-string, hostile — has to come back as findings.
 *
 * Privacy: every string here is synthetic or taken from public IAB
 * documentation. No consent record belonging to a real user appears in this
 * repo, and none should be added.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkTcString, LEVELS } = require('@ortbtools/core/tcstring-sanity');

/**
 * The IAB's own documentation example. Decodes to version 2, cmpId 681,
 * cmpVersion 0, consentLanguage EN, vendorListVersion 29, policyVersion 2,
 * purposes {1,2} and empty vendor sections, created and updated 2020-03-24.
 */
const BASE = 'COwxsONOwxsONKpAAAENAdCAAMAAAAAAAAAAAAAAAAAA';

/**
 * Every check that consults a clock takes `now` from options, so the whole
 * suite is deterministic and none of it starts failing on a future date.
 * `BASE` is stamped 2020-03-24, comfortably inside the plausible window.
 */
const NOW = Date.UTC(2026, 7, 14);
const opts = (extra) => ({ now: NOW, ...extra });

/** Replace one character, leaving the length alone. */
const swap = (s, index, ch) => s.slice(0, index) + ch + s.slice(index + 1);

const codes = (result) => result.findings.map((f) => f.code);

// ── The healthy string: zero findings ────────────────────────────────────────
//
// This is the most important test in the file. Every bound in the module is
// deliberately set loose enough that the IAB's own published example clears it
// without a single remark — including the ones a stricter reading would trip:
// `cmpVersion` 0, `publisherCC` "AA" (user-assigned, not a real country) and a
// `created` timestamp that predates the TCF v2 launch.

test('valid TC string: zero findings', () => {
  const result = checkTcString(BASE, opts());
  assert.deepEqual(result.findings, [], 'a conforming string must produce no remarks at all');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'clean');
});

test('valid TC string: fields decode to the documented values', () => {
  const { core } = checkTcString(BASE, opts());
  assert.equal(core.version, 2);
  assert.equal(core.cmpId, 681);
  assert.equal(core.consentLanguage, 'EN');
  assert.equal(core.vendorListVersion, 29);
  assert.equal(core.policyVersion, 2);
  assert.deepEqual(core.purposesConsent, [1, 2]);
  assert.deepEqual(core.purposesLITransparency, []);
  assert.equal(core.vendorConsent.maxVendorId, 0);
});

test('valid TC string: round-trips without a Global Vendor List', () => {
  const { roundTrip } = checkTcString(BASE, opts());
  assert.equal(roundTrip.attempted, true, 'the round-trip must actually run, not be skipped');
  assert.equal(roundTrip.matched, true);
  assert.equal(roundTrip.reason, null);
});

// A 36-bit timestamp does not survive JavaScript's 32-bit bitwise operators.
// Getting that wrong made the re-encode disagree with the input on every
// healthy string — a false positive on 100% of real traffic — so it gets a
// regression test of its own rather than living only inside the round-trip.
test('valid TC string: 36-bit timestamps survive the re-encode', () => {
  const { core } = checkTcString(BASE, opts());
  assert.ok(core.created > 0xffffffff, 'the fixture must exercise the >32-bit path');
  assert.equal(core.createdMs, Date.UTC(2020, 2, 24, 17, 43, 29, 300));
  assert.equal(core.lastUpdatedMs, core.createdMs);
});

/**
 * Synthetic optional segments, built to the spec rather than guessed.
 *
 * `DISCLOSED_VENDORS` — type 1, maxVendorId 8, bitfield encoding, vendors 1-2.
 * `PUBLISHER_TC`      — type 3, publisher purposes 1-2, no custom purposes.
 */
const DISCLOSED_VENDORS = 'IAEMA';
const PUBLISHER_TC = 'eAAAAAAAAA';

test('healthy variations stay clean: every legal segment combination', () => {
  /** @type {Array<{input: string, kinds: string[]}>} */
  const combinations = [
    { input: `${BASE}.${PUBLISHER_TC}`, kinds: ['core', 'publisherTC'] },
    { input: `${BASE}.${DISCLOSED_VENDORS}`, kinds: ['core', 'disclosedVendors'] },
    {
      input: `${BASE}.${DISCLOSED_VENDORS}.${PUBLISHER_TC}`,
      kinds: ['core', 'disclosedVendors', 'publisherTC'],
    },
  ];
  for (const { input, kinds } of combinations) {
    const result = checkTcString(input, opts());
    assert.deepEqual(codes(result), [], `${kinds.join('+')} must be clean`);
    assert.deepEqual(
      result.segments.map((s) => s.kind),
      kinds,
    );
  }
});

// ── Corrupted characters: the silent-failure cases ───────────────────────────
//
// The brief named four windows — 16, 20, 24, 28 — measured against the base
// string above. Two things turned up when the module was run against them and
// both are recorded here rather than smoothed over.
//
// First, the *effects* the brief describes (consentLanguage EN→ZZ,
// policyVersion 2→25, and two bit sets growing entries) sit two characters to
// the right of the numbers quoted: the language pair is at 18-19, the policy
// version at 22. Both readings are covered — the effects by name below, the
// literal indices in the table after them.
//
// Second, index 16 lands inside `cmpVersion`, and `cmpVersion` has no
// plausibility envelope: every value 0..4095 is a legal version number for a
// CMP to claim. All 63 possible substitutions there are undetectable, and the
// table says so explicitly instead of quietly omitting the case.

test('corruption at 18-19: consentLanguage EN → ZZ is caught', () => {
  const result = checkTcString(swap(swap(BASE, 18, 'Z'), 19, 'Z'), opts());
  const finding = result.findings.find((f) => f.code === 'core.consent_language_not_iso639');
  assert.ok(finding, `expected an ISO 639-1 finding, got ${codes(result).join(', ') || 'none'}`);
  assert.equal(finding.level, LEVELS.ERROR);
  assert.equal(finding.value, 'ZZ');
  assert.match(finding.expected, /ISO 639-1/);
  assert.deepEqual(finding.bitRange, [108, 120], 'the finding points at the language bits');
  assert.equal(result.ok, false);
});

test('corruption at 22: policyVersion 2 → 25 is caught', () => {
  const result = checkTcString(swap(BASE, 22, 'Z'), opts());
  const finding = result.findings.find((f) => f.code === 'core.policy_version_unknown');
  assert.ok(
    finding,
    `expected a policy-version finding, got ${codes(result).join(', ') || 'none'}`,
  );
  assert.equal(finding.value, 25);
  assert.equal(finding.expected, '<= 5');
  assert.equal(result.ok, false);
});

test('corruption at 24: reserved special-feature bits are caught', () => {
  const result = checkTcString(swap(BASE, 24, 'Z'), opts());
  const finding = result.findings.find((f) => f.code === 'core.special_feature_reserved_bit_set');
  assert.ok(
    finding,
    `expected a special-feature finding, got ${codes(result).join(', ') || 'none'}`,
  );
  // TCF v2.2 defines special features 1 and 2; bits 3..12 are reserved.
  assert.deepEqual(finding.value, [6, 7, 10]);
  assert.equal(result.ok, false);
});

test('corruption at 28: reserved purpose bits are caught', () => {
  const result = checkTcString(swap(BASE, 28, 'Z'), opts());
  const finding = result.findings.find((f) => f.code === 'core.purpose_reserved_bit_set');
  assert.ok(finding, `expected a purpose finding, got ${codes(result).join(', ') || 'none'}`);
  const reported = /** @type {number[]} */ (finding.value);
  assert.ok(reported.length > 0);
  assert.ok(
    reported.every((id) => id > 11),
    'only purposes above the defined range are reported',
  );
  assert.equal(result.ok, false);
});

test('corruption in the literal windows 16/20/24/28: measured coverage', () => {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /**
   * `caught` is the number of the 63 possible single-character substitutions
   * at that index that produce at least one finding. These are measurements,
   * not aspirations: if a change to the module moves them, the report about
   * what this check actually detects has moved too and must be re-read.
   */
  const WINDOWS = [
    { index: 16, caught: 0, field: 'cmpVersion — no plausibility envelope exists' },
    { index: 20, caught: 48, field: 'vendorListVersion, high bits' },
    { index: 24, caught: 63, field: 'specialFeatureOptIns, reserved bits' },
    { index: 28, caught: 63, field: 'purposesConsent, reserved bits' },
  ];

  for (const { index, caught, field } of WINDOWS) {
    let detected = 0;
    for (const ch of ALPHABET) {
      if (ch === BASE[index]) continue;
      if (checkTcString(swap(BASE, index, ch), opts()).findings.length) detected += 1;
    }
    assert.equal(detected, caught, `index ${index} (${field}): detection rate changed`);
  }
});

test('corruption elsewhere: two thirds of single-character flips are caught', () => {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let tried = 0;
  let detected = 0;
  for (let index = 0; index < BASE.length; index += 1) {
    for (const ch of ALPHABET) {
      if (ch === BASE[index]) continue;
      tried += 1;
      if (checkTcString(swap(BASE, index, ch), opts()).findings.length) detected += 1;
    }
  }
  assert.equal(tried, 2772);
  // Measured, not aspirational. The gap is real and is documented: bit flips
  // that land inside cmpId, cmpVersion, consentScreen or the *defined* purpose
  // bits produce values that are indistinguishable from legitimate choices.
  assert.equal(detected, 1850);
});

// ── Field-level checks in isolation ──────────────────────────────────────────
//
// Each check gets a hand-built string so a failure names the check rather than
// a character index. `mutate` rewrites one field in place at the bit level.

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The TC string as a '0'/'1' string. */
function toBits(s) {
  let bits = '';
  for (const ch of s) bits += B64URL.indexOf(ch).toString(2).padStart(6, '0');
  return bits;
}

/** Inverse of {@link toBits}. */
function toString64(bits) {
  let out = '';
  for (let i = 0; i < bits.length; i += 6) out += B64URL[parseInt(bits.slice(i, i + 6), 2)];
  return out;
}

/** Write `value` into `[offset, offset+length)` of the base string. */
function mutate(offset, length, value) {
  const bits = toBits(BASE);
  let remaining = Math.max(0, Math.trunc(value));
  let field = '';
  for (let i = 0; i < length; i += 1) {
    field = (remaining % 2 === 0 ? '0' : '1') + field;
    remaining = Math.floor(remaining / 2);
  }
  return toString64(bits.slice(0, offset) + field + bits.slice(offset + length));
}

test('version: anything but 2 is an error', () => {
  const result = checkTcString(mutate(0, 6, 1), opts());
  const finding = result.findings.find((f) => f.code === 'core.version_unsupported');
  assert.ok(finding);
  assert.equal(finding.level, LEVELS.ERROR);
  assert.equal(finding.value, 1);
});

test('cmpId: zero is reserved and never identifies a CMP', () => {
  const result = checkTcString(mutate(78, 12, 0), opts());
  const finding = result.findings.find((f) => f.code === 'core.cmp_id_zero');
  assert.ok(finding);
  assert.equal(finding.level, LEVELS.ERROR);
});

test('cmpId: the plausibility ceiling is off by default and opt-in', () => {
  const high = mutate(78, 12, 3000);
  assert.deepEqual(
    codes(checkTcString(high, opts())),
    [],
    'default must not warn — the register grows',
  );
  const tightened = checkTcString(high, opts({ maxCmpId: 2000 }));
  assert.deepEqual(codes(tightened), ['core.cmp_id_implausible']);
});

test('vendorListVersion: zero is impossible, implausibly high is a warning', () => {
  const zero = checkTcString(mutate(120, 12, 0), opts());
  assert.ok(zero.findings.find((f) => f.code === 'core.vendor_list_version_zero'));

  const high = checkTcString(mutate(120, 12, 4000), opts());
  const finding = high.findings.find((f) => f.code === 'core.vendor_list_version_implausible');
  assert.ok(finding);
  assert.equal(finding.level, LEVELS.WARNING, 'a future list version must not be a hard error');
  assert.equal(finding.value, 4000);
});

test('policyVersion: below 2 is an error, above the known range is a warning', () => {
  const low = checkTcString(mutate(132, 6, 1), opts());
  const lowFinding = low.findings.find((f) => f.code === 'core.policy_version_too_low');
  assert.equal(lowFinding.level, LEVELS.ERROR);

  const high = checkTcString(mutate(132, 6, 9), opts());
  const highFinding = high.findings.find((f) => f.code === 'core.policy_version_unknown');
  assert.equal(highFinding.level, LEVELS.WARNING);

  // Policy version 4 is TCF v2.2 and must stay silent.
  assert.deepEqual(codes(checkTcString(mutate(132, 6, 4), opts())), []);
});

test('consentLanguage: real ISO 639-1 codes pass, invented ones do not', () => {
  for (const code of ['EN', 'DE', 'UK', 'ZH', 'FR', 'PT', 'SV']) {
    const first = code.charCodeAt(0) - 65;
    const second = code.charCodeAt(1) - 65;
    const s = mutate(108, 12, first * 64 + second);
    assert.deepEqual(codes(checkTcString(s, opts())), [], `${code} is a language and must pass`);
  }
  for (const code of ['ZZ', 'QQ', 'XX']) {
    const first = code.charCodeAt(0) - 65;
    const second = code.charCodeAt(1) - 65;
    const s = mutate(108, 12, first * 64 + second);
    assert.deepEqual(codes(checkTcString(s, opts())), ['core.consent_language_not_iso639'], code);
  }
});

test('consentLanguage: a value outside A-Z is not a code at all', () => {
  // 6-bit value 40 has no letter; the finding must say so rather than claim
  // some mojibake pair is "not a language".
  const result = checkTcString(mutate(108, 12, 40 * 64 + 4), opts());
  const finding = result.findings.find((f) => f.code === 'core.consent_language_not_letters');
  assert.ok(finding);
  assert.deepEqual(finding.value, [40, 4]);
});

test('purpose 1 can never rest on legitimate interest', () => {
  // Bit 176 is purpose 1 of purposesLITransparency.
  const result = checkTcString(mutate(176, 24, 1 << 23), opts());
  const finding = result.findings.find((f) => f.code === 'core.purpose_one_legitimate_interest');
  assert.ok(finding);
  assert.equal(finding.level, LEVELS.ERROR);
});

test('timestamps: future, prehistoric and out-of-order are all caught', () => {
  const future = Math.floor((NOW + 90 * 24 * 3600 * 1000) / 100);
  const inFuture = checkTcString(mutate(6, 36, future), opts());
  assert.ok(inFuture.findings.find((f) => f.code === 'core.timestamp_in_future'));

  const ancient = checkTcString(mutate(6, 36, Math.floor(Date.UTC(2005, 0, 1) / 100)), opts());
  assert.ok(ancient.findings.find((f) => f.code === 'core.timestamp_too_old'));

  // lastUpdated dragged back a year behind created.
  const earlier = Math.floor(Date.UTC(2019, 5, 1) / 100);
  const backwards = checkTcString(mutate(42, 36, earlier), opts());
  assert.ok(backwards.findings.find((f) => f.code === 'core.last_updated_before_created'));
});

test('timestamps: a small clock skew is tolerated', () => {
  // Written "an hour from now" by a device whose clock runs fast. Real, and
  // not worth a finding — the default tolerance is a day.
  const slightlyAhead = Math.floor((NOW + 3600 * 1000) / 100);
  const s = toString64(
    toBits(mutate(6, 36, slightlyAhead)).slice(0, 42) +
      toBits(mutate(6, 36, slightlyAhead)).slice(6, 42) +
      toBits(BASE).slice(78),
  );
  assert.deepEqual(codes(checkTcString(s, opts())), []);
});

// ── Vendor sections and publisher restrictions ───────────────────────────────
//
// The base string carries two empty vendor sections, so these are built from
// its fixed header plus hand-written sections. `buildCore` keeps the header
// (version, timestamps, cmpId, language, purposes) and replaces everything
// from bit 213 on, which is where the variable-length structures live.

/** Fixed-width unsigned int as bits. */
const u = (value, length) => value.toString(2).padStart(length, '0');

/** An empty vendor section: maxVendorId 0, bitfield encoding, no bits. */
const EMPTY_SECTION = u(0, 16) + '0';

// A publisher restriction's vendor list is NOT a vendor section: it carries no
// MaxVendorId and no encoding flag, only NumEntries(12) and the ranges. Using
// EMPTY_SECTION here encoded sixteen bits that do not exist in the format, which
// is exactly the misparse this fixture now guards against.
const EMPTY_RESTRICTION_VENDORS = u(0, 12);

/**
 * One range entry naming a single vendor, in restriction-entry layout.
 *
 * @param {number} vendorId
 * @returns {string}
 */
const restrictionVendor = (vendorId) => u(1, 12) + '0' + u(vendorId, 16);

/**
 * A range-encoded vendor section.
 * @param {number} maxVendorId
 * @param {Array<{start:number, end:number, asRange:boolean}>} entries
 */
const rangeSection = (maxVendorId, entries) =>
  u(maxVendorId, 16) +
  '1' +
  u(entries.length, 12) +
  entries
    .map((e) => (e.asRange ? '1' + u(e.start, 16) + u(e.end, 16) : '0' + u(e.start, 16)))
    .join('');

/** The base string's header with new variable-length sections spliced on. */
const buildCore = (vendorConsent, vendorLI = EMPTY_SECTION, restrictions = u(0, 12)) =>
  toString64(toBits(BASE).slice(0, 213) + vendorConsent + vendorLI + restrictions);

test('vendor sections: well-formed ones are clean and round-trip', () => {
  const healthy = [
    ['a range', rangeSection(100, [{ start: 10, end: 20, asRange: true }])],
    [
      'two single ids',
      rangeSection(100, [
        { start: 5, end: 5, asRange: false },
        { start: 9, end: 9, asRange: false },
      ]),
    ],
    // A one-element range written as a range rather than as a single id is
    // conforming. Normalising it on re-encode would make the round-trip
    // disagree with a healthy string — the regression this case guards.
    ['a one-element range', rangeSection(100, [{ start: 7, end: 7, asRange: true }])],
    ['a bitfield', u(8, 16) + '0' + '11000000'],
  ];
  for (const [label, section] of healthy) {
    const result = checkTcString(buildCore(section), opts());
    assert.deepEqual(codes(result), [], `${label} must be clean`);
    assert.equal(result.roundTrip.matched, true, `${label} must round-trip`);
  }
});

test('vendor sections: malformed range tables are reported', () => {
  const cases = [
    ['vendor.range_inverted', rangeSection(100, [{ start: 50, end: 10, asRange: true }])],
    ['vendor.range_start_zero', rangeSection(100, [{ start: 0, end: 5, asRange: true }])],
    ['vendor.range_exceeds_max', rangeSection(10, [{ start: 5, end: 900, asRange: true }])],
    [
      'vendor.ranges_not_ascending',
      rangeSection(100, [
        { start: 50, end: 60, asRange: true },
        { start: 10, end: 20, asRange: true },
      ]),
    ],
    ['vendor.entries_without_max', rangeSection(0, [{ start: 5, end: 5, asRange: false }])],
  ];
  for (const [code, section] of cases) {
    const result = checkTcString(buildCore(section), opts());
    assert.ok(
      result.findings.find((f) => f.code === code),
      `expected ${code}, got ${codes(result).join(', ') || 'none'}`,
    );
  }
});

test('vendor sections: parsed ids are exposed for the caller', () => {
  const { core } = checkTcString(
    buildCore(rangeSection(100, [{ start: 3, end: 6, asRange: true }])),
    opts(),
  );
  assert.deepEqual(core.vendorConsent.ids, [3, 4, 5, 6]);
  assert.equal(core.vendorConsent.isRangeEncoding, true);

  const bitfield = checkTcString(buildCore(u(8, 16) + '0' + '11000000'), opts());
  assert.deepEqual(bitfield.core.vendorConsent.ids, [1, 2]);
  assert.equal(bitfield.core.vendorConsent.isRangeEncoding, false);
});

test('publisher restrictions: a legal one is clean, an impossible one is not', () => {
  const restriction = (purposeId, type) =>
    u(1, 12) + u(purposeId, 6) + u(type, 2) + EMPTY_RESTRICTION_VENDORS;

  // Purpose 2, "require consent" — an ordinary publisher restriction.
  const legal = buildCore(EMPTY_SECTION, EMPTY_SECTION, restriction(2, 1));
  assert.deepEqual(codes(checkTcString(legal, opts())), []);

  // Restriction type 3 is encodable and undefined by TCF v2.
  const undefinedType = checkTcString(
    buildCore(EMPTY_SECTION, EMPTY_SECTION, restriction(3, 3)),
    opts(),
  );
  assert.ok(undefinedType.findings.find((f) => f.code === 'core.restriction_type_undefined'));

  // Purpose ids are 1-based, so a restriction on purpose 0 describes nothing.
  const purposeZero = checkTcString(
    buildCore(EMPTY_SECTION, EMPTY_SECTION, restriction(0, 1)),
    opts(),
  );
  assert.ok(purposeZero.findings.find((f) => f.code === 'core.restriction_purpose_zero'));
});

// ── Structural checks the field layer cannot see ─────────────────────────────

test('non-zero Base64 padding is reported', () => {
  // The core string consumes 259 of its 264 bits; the last five are padding
  // and the spec says they are zero. Setting one is invisible to every
  // field-level check and is a genuine "not written by a conforming encoder".
  const bits = toBits(BASE);
  const tampered = toString64(bits.slice(0, 263) + '1');
  const result = checkTcString(tampered, opts());
  assert.ok(result.findings.find((f) => f.code === 'core.non_zero_padding'));
});

test('trailing content beyond the declared structure is reported', () => {
  const result = checkTcString(`${BASE}AAAA`, opts());
  const finding = result.findings.find((f) => f.code === 'segment.unconsumed_bits');
  assert.ok(finding, `expected unconsumed bits, got ${codes(result).join(', ') || 'none'}`);
  assert.equal(finding.level, LEVELS.WARNING);
});

test('segments: a second core segment is out of position', () => {
  const result = checkTcString(`${BASE}.${BASE}`, opts());
  assert.ok(result.findings.find((f) => f.code === 'segment.core_out_of_position'));
});

test('segments: an undefined type discriminator is reported', () => {
  // Types 4-7 are encodable in the 3-bit discriminator and defined by nothing.
  for (const type of [4, 5, 6, 7]) {
    const segment = toString64(u(type, 3) + EMPTY_SECTION);
    const result = checkTcString(`${BASE}.${segment}`, opts());
    assert.ok(
      result.findings.find((f) => f.code === 'segment.type_unknown'),
      `type ${type}: got ${codes(result).join(', ') || 'none'}`,
    );
  }
});

test('segments: more than four is not one TC string', () => {
  const result = checkTcString([BASE, BASE, BASE, BASE, BASE].join('.'), opts());
  assert.ok(result.findings.find((f) => f.code === 'input.too_many_segments'));
});

test('segments: an empty one between dots is reported', () => {
  const result = checkTcString(`${BASE}..${PUBLISHER_TC}`, opts());
  assert.ok(result.findings.find((f) => f.code === 'input.empty_segment'));
});

// ── Truncated, empty, garbage, non-string ────────────────────────────────────

test('truncated string: reported, not thrown', () => {
  for (const length of [1, 10, 26, 43]) {
    const result = checkTcString(BASE.slice(0, length), opts());
    assert.ok(result.findings.length > 0, `${length} chars produced no finding`);
    assert.equal(result.ok, false);
    assert.ok(
      result.findings.find((f) => f.code === 'core.truncated'),
      `${length} chars: expected core.truncated, got ${codes(result).join(', ')}`,
    );
  }
});

test('empty string', () => {
  const result = checkTcString('', opts());
  assert.deepEqual(codes(result), ['input.empty']);
  assert.equal(result.ok, false);
  assert.equal(result.core, null);
});

test('whitespace only: one finding, not two', () => {
  // "it has stray spaces" is not useful advice about a value that holds
  // nothing, so emptiness is decided first.
  assert.deepEqual(codes(checkTcString('   \t\n ', opts())), ['input.empty']);
});

test('surrounding whitespace on an otherwise healthy string is a warning, not an error', () => {
  const result = checkTcString(`  ${BASE}\n`, opts());
  assert.deepEqual(codes(result), ['input.surrounding_whitespace']);
  assert.equal(result.status, 'warnings');
  assert.equal(result.core.consentLanguage, 'EN', 'the value is still checked after trimming');
});

test('garbage: characters outside the Base64URL alphabet', () => {
  for (const junk of ['!!!!', '<script>alert(1)</script>', '{"json":true}', 'привіт світ']) {
    const result = checkTcString(junk, opts());
    assert.ok(result.findings.length > 0, `${junk} produced no finding`);
    assert.ok(
      result.findings.find((f) => f.code === 'input.not_base64url'),
      `${junk}: got ${codes(result).join(', ')}`,
    );
  }
});

test('garbage: standard Base64 gets its own diagnosis', () => {
  // `+` and `/` mean something re-encoded the value in transit, which is a
  // different problem from a corrupt consent record and deserves saying so.
  const result = checkTcString(swap(BASE, 2, '+'), opts());
  const finding = result.findings.find((f) => f.code === 'input.standard_base64');
  assert.ok(finding);
  assert.match(finding.detail, /Base64URL/);
});

test('garbage: valid alphabet, meaningless content', () => {
  const result = checkTcString('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', opts());
  assert.ok(result.findings.length > 0);
  // All-zero bits are a version 0 string with a zero cmpId and a 1970 stamp.
  assert.ok(result.findings.find((f) => f.code === 'core.version_unsupported'));
  assert.ok(result.findings.find((f) => f.code === 'core.cmp_id_zero'));
});

test('non-string input never throws', () => {
  const inputs = [
    null,
    undefined,
    0,
    42,
    NaN,
    true,
    false,
    {},
    [],
    [BASE],
    () => BASE,
    Symbol('x'),
  ];
  for (const input of inputs) {
    const result = checkTcString(input, opts());
    assert.deepEqual(codes(result), ['input.not_a_string'], `input ${String(input)}`);
    assert.equal(result.ok, false);
    assert.equal(result.core, null);
    assert.equal(result.roundTrip.attempted, false);
  }
});

test('hostile length is refused rather than walked', () => {
  const result = checkTcString('A'.repeat(200000), opts());
  assert.deepEqual(codes(result), ['input.too_long']);
});

test('options themselves are never trusted', () => {
  // A caller passing nonsense must not be able to make the module throw.
  for (const bad of [null, undefined, 0, 'nope', [], { now: 'yesterday' }, { maxPurpose: NaN }]) {
    // @ts-ignore — intentional wrong type for robustness testing
    assert.doesNotThrow(() => checkTcString(BASE, bad));
  }
});

// ── Optional Global Vendor List cross-check ──────────────────────────────────
//
// The GVL is supplied by the caller as already-parsed data. The module must
// never fetch it: a checker that reaches the network is not one a validator
// can call.

test('GVL: absent by default, and its absence costs nothing', () => {
  assert.deepEqual(codes(checkTcString(BASE, opts())), []);
  assert.deepEqual(codes(checkTcString(BASE, opts({ gvl: undefined }))), []);
  assert.deepEqual(codes(checkTcString(BASE, opts({ gvl: null }))), []);
});

test('GVL: a string claiming a list version newer than the one supplied', () => {
  const result = checkTcString(BASE, opts({ gvl: { vendorListVersion: 12, vendors: {} } }));
  const finding = result.findings.find((f) => f.code === 'gvl.vendor_list_version_ahead');
  assert.ok(finding);
  assert.equal(finding.value, 29);
});

test('GVL: an older supplied list is fine — strings outlive list versions', () => {
  const result = checkTcString(BASE, opts({ gvl: { vendorListVersion: 400, vendors: {} } }));
  assert.deepEqual(codes(result), []);
});

test('GVL: unknown vendor ids are reported against a current list', () => {
  const withVendors = buildCore(rangeSection(100, [{ start: 3, end: 4, asRange: true }]));
  const current = { vendorListVersion: 29, vendors: { 3: {}, 4: {} } };
  assert.deepEqual(codes(checkTcString(withVendors, opts({ gvl: current }))), []);

  const missing = { vendorListVersion: 29, vendors: { 3: {} } };
  const result = checkTcString(withVendors, opts({ gvl: missing }));
  const finding = result.findings.find((f) => f.code === 'gvl.unknown_vendor_id');
  assert.ok(finding);
  assert.deepEqual(finding.value, [4]);
});

test('GVL: a stale list never accuses a newer string of unknown vendors', () => {
  // Vendors are added to the GVL over time. Checking a string written against
  // list 29 with a copy of list 10 would report every vendor registered in
  // between as unknown — a warning about a healthy string, caused entirely by
  // the caller handing over a stale list.
  const withVendors = buildCore(rangeSection(100, [{ start: 3, end: 4, asRange: true }]));
  const stale = { vendorListVersion: 10, vendors: {} };
  assert.deepEqual(codes(checkTcString(withVendors, opts({ gvl: stale }))), [
    'gvl.vendor_list_version_ahead',
  ]);
});

test('GVL: a malformed vendor list is ignored, not fatal', () => {
  for (const gvl of ['not-a-gvl', 42, [], { vendors: 'nope' }, { vendorListVersion: 'x' }]) {
    // @ts-ignore — intentional wrong type for robustness testing
    assert.deepEqual(codes(checkTcString(BASE, opts({ gvl }))), [], String(gvl));
  }
});

// ── Contract: purity and totality ────────────────────────────────────────────

test('the same input and options always give the same answer', () => {
  const a = checkTcString(BASE, opts());
  const b = checkTcString(BASE, opts());
  assert.deepEqual(a.findings, b.findings);
  assert.deepEqual(a.core, b.core);
});

test('every finding is self-describing', () => {
  // The findings do not go through messages/<locale>.json, so each one has to
  // carry enough on its own for a caller to render it.
  const corrupted = swap(swap(swap(swap(BASE, 18, 'Z'), 22, 'Z'), 24, 'Z'), 28, 'Z');
  const result = checkTcString(corrupted, opts());
  assert.ok(result.findings.length >= 4, 'four corrupted characters must produce findings');
  for (const finding of result.findings) {
    assert.equal(typeof finding.code, 'string');
    assert.ok(finding.code.includes('.'), `${finding.code} should be dotted`);
    assert.ok(Object.values(LEVELS).includes(finding.level), `bad level ${finding.level}`);
    assert.equal(typeof finding.segment, 'string');
    assert.equal(typeof finding.field, 'string');
    assert.ok('value' in finding, `${finding.code} must report what it read`);
    assert.equal(typeof finding.expected, 'string');
    assert.ok(finding.expected.length > 0, `${finding.code} must say what it expected`);
    assert.ok(finding.detail.length > 20, `${finding.code} must explain itself`);
  }
});

test('status rolls up the way the rest of the core does', () => {
  assert.equal(checkTcString(BASE, opts()).status, 'clean');
  assert.equal(checkTcString(`  ${BASE}`, opts()).status, 'warnings');
  assert.equal(checkTcString('', opts()).status, 'errors');
});

test('no input reaches the module without an answer', () => {
  // A last sweep over shapes that have historically broken parsers.
  const inputs = [
    '.',
    '..',
    '...',
    '....',
    '.'.repeat(50),
    BASE + '.',
    '.' + BASE,
    '-'.repeat(44),
    '_'.repeat(44),
    // Written as escapes, not raw bytes: the string in memory is identical,
    // but an invisible character is visible in a diff and to a reviewer.
    '\u0000'.repeat(44),
    BASE.toLowerCase(),
    BASE.toUpperCase(),
    BASE + '\u200b',
  ];
  for (const input of inputs) {
    let result = checkTcString(BASE, opts());
    assert.doesNotThrow(
      () => {
        result = checkTcString(input, opts());
      },
      `threw on ${JSON.stringify(input)}`,
    );
    assert.equal(typeof result.ok, 'boolean');
    assert.ok(Array.isArray(result.findings));
    assert.ok(result.findings.length > 0, `${JSON.stringify(input)} was silently accepted`);
  }
});

test('publisher restrictions: the vendor list is range-only, not a vendor section', () => {
  // Regression. This section was parsed with the VendorConsents reader, which
  // expects MaxVendorId(16) plus an encoding flag. A RestrictionEntry has
  // neither, so sixteen bits that are not in the format were consumed and
  // everything after shifted — surfacing as a spurious `segment.unconsumed_bits`
  // rather than as a failure.
  //
  // The round trip did not catch it: the writer was symmetric with the reader,
  // so the string re-encoded to its own misreading. A faithful reader/writer
  // pair round-trips anything the reader accepts. Cross-checking a second
  // implementation is what found it.
  const body = u(1, 12) + u(3, 6) + u(0, 2) + restrictionVendor(755);
  // `toString64` drops whatever does not fill the final 6-bit group, so pad the
  // block explicitly. Without it the vendor id loses its last two bits and reads
  // as 752 — which would look like a parser bug rather than a fixture one.
  const total = 213 + EMPTY_SECTION.length * 2 + body.length;
  const restriction = body + '0'.repeat((6 - (total % 6)) % 6);
  const result = checkTcString(buildCore(EMPTY_SECTION, EMPTY_SECTION, restriction), opts());
  // `core.non_zero_padding` is an artefact of this hand-built fixture's length
  // landing off a base64 boundary, not a parse problem. What matters is that no
  // structural finding appears — a misparse showed up as unconsumed bits.
  assert.deepEqual(
    codes(result).filter((c) => c !== 'core.non_zero_padding'),
    [],
    'a well-formed restriction reads clean',
  );
  assert.equal(result.core.publisherRestrictions.length, 1);
  assert.equal(result.core.publisherRestrictions[0].purposeId, 3);
  assert.equal(result.core.publisherRestrictions[0].restrictionType, 0);
  assert.deepEqual(
    result.core.publisherRestrictions[0].vendors.ids,
    [755],
    'the vendor named by the range, not a bitfield read off the wrong offset',
  );
  assert.equal(result.roundTrip.matched, true);
});
