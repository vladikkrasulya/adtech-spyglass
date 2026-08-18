'use strict';

/**
 * tcstring-sanity.js — structural plausibility of a decoded IAB TCF v2 string.
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────
 * A TC string is a packed bit array wearing Base64URL. Nothing inside it is
 * self-describing and nothing is checksummed: every bit pattern of the right
 * length is *some* valid-looking consent record. So the two failure modes look
 * nothing alike.
 *
 *   loud   — truncate the string, or feed it a `+` from a mis-transported
 *            standard-Base64 payload, and any decoder throws immediately.
 *   silent — flip four characters in the middle and a decoder returns, with no
 *            exception at all, a record whose `consentLanguage` is now `ZZ`,
 *            whose `policyVersion` is 25, and whose purpose bit sets have
 *            grown entries nobody consented to.
 *
 * The silent case is the dangerous one: downstream it is indistinguishable
 * from a real user decision. This module is the missing integrity layer. It
 * asks, of an already-unpacked string, "could a conforming CMP have produced
 * these bits?" and answers with structured findings — never an exception,
 * never a boolean.
 *
 * ── WHY WE READ THE BITS OURSELVES ─────────────────────────────────────────
 * The obvious implementation sits on top of `@iabtcf/core`. We deliberately do
 * not, for three reasons:
 *
 *   1. It is not a dependency of this repo (absent from package.json, from
 *      package-lock.json and from node_modules), and adding a runtime
 *      dependency to ship a format check is a poor trade.
 *   2. It is the very projection whose silence we are compensating for. A
 *      checker built on it can only see the fields it chose to surface, and
 *      only in the normalised form it chose to surface them. Segment
 *      boundaries, reserved bits, trailing padding and range-encoding
 *      internals — the places corruption actually shows up — are exactly what
 *      that layer smooths away.
 *   3. Its `TCString.encode()` needs a Global Vendor List, i.e. a network
 *      fetch, which puts a round-trip out of reach for a pure module. Reading
 *      and writing the bits ourselves makes the round-trip free (see below).
 *
 * The reader here is faithful to IAB TCF Consent String v2 §Core String and
 * follows the raw-bytes-are-truth stance the rest of the repo takes: we parse
 * every bit and account for every bit, rather than lifting the handful of
 * fields we happen to want.
 *
 * ── THE ROUND-TRIP, WITHOUT A VENDOR LIST ──────────────────────────────────
 * `checkTcString` re-encodes the model it just parsed and compares the result
 * to the input bit for bit. No GVL is needed because we re-serialise the
 * literal structure we read — the same ranges, the same encoding choice, the
 * same padding — instead of re-deriving vendor ranges from a vendor list the
 * way a general-purpose encoder must.
 *
 * What that buys, honestly stated: a faithful reader/writer pair round-trips
 * anything the reader accepts, so this is not a checksum. Its value is that it
 * proves the parse *explained every bit of the input*. A string carrying data
 * we did not model — an unknown extension, a non-canonical range encoding,
 * non-zero Base64 padding, a section that overruns — cannot survive it. That
 * is a real and otherwise-invisible class of corruption.
 *
 * ── FALSE POSITIVES ARE THE EXPENSIVE FAILURE ──────────────────────────────
 * A warning about a healthy string is worse than no check at all, because it
 * teaches the operator to ignore the check. Every bound below is therefore set
 * against the loosest thing a conforming CMP may legitimately emit, not
 * against what is common, and anything that could plausibly be widened by a
 * future IAB policy is an `options` knob with a documented default and a
 * `warning` rather than an `error` level. Two checks a stricter reading would
 * include are deliberately absent, each marked WHY-NOT below.
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────
 * Pure: no I/O, no network, no filesystem, no module-level state. The single
 * ambient read is `Date.now()` for the "timestamp in the future" bound, and
 * passing `options.now` removes even that.
 *
 * Total: `checkTcString` never throws, for any input — garbage, empty string,
 * non-string, hostile length. Everything it has to say it says in `findings`.
 *
 * Findings here are self-describing (`code` / `value` / `expected`) rather
 * than `findings.js` `makeFinding()` records, because those resolve their text
 * from `messages/<locale>.json` at presentation time. Wiring these into the
 * localised pipeline means adding message ids there; until then a caller can
 * render `detail` directly and lose nothing.
 */

/** Base64URL alphabet, in value order. Index === the 6-bit value. */
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** @type {Record<string, number>} */
const B64URL_VALUES = Object.create(null);
for (let i = 0; i < B64URL.length; i += 1) B64URL_VALUES[B64URL[i]] = i;

const LEVELS = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };

/**
 * Fixed-width Core String header, `field: [bitOffset, bitLength]`.
 * Everything from bit 213 on is variable-length and parsed by hand.
 */
const CORE_LAYOUT = {
  version: [0, 6],
  created: [6, 36],
  lastUpdated: [42, 36],
  cmpId: [78, 12],
  cmpVersion: [90, 12],
  consentScreen: [102, 6],
  consentLanguage: [108, 12],
  vendorListVersion: [120, 12],
  policyVersion: [132, 6],
  isServiceSpecific: [138, 1],
  useNonStandardTexts: [139, 1],
  specialFeatureOptIns: [140, 12],
  purposesConsent: [152, 24],
  purposesLITransparency: [176, 24],
  purposeOneTreatment: [200, 1],
  publisherCC: [201, 12],
};

/** First bit after the fixed header — where VendorConsent begins. */
const CORE_VARIABLE_START = 213;

/**
 * The shortest legal Core String: the fixed header, two empty vendor sections
 * (16-bit maxVendorId + 1-bit encoding flag each) and an empty publisher
 * restriction count. 259 bits — 44 Base64URL characters once padded.
 */
const CORE_MIN_BITS = CORE_VARIABLE_START + 17 + 17 + 12;

/** Non-core segment types, by the 3-bit discriminator that opens them. */
const SEGMENT_TYPES = { 0: 'core', 1: 'disclosedVendors', 2: 'allowedVendors', 3: 'publisherTC' };

/**
 * ISO 639-1 alpha-2, complete, plus the four codes ISO withdrew or replaced
 * (`bh`, `sh`, and the legacy `in`/`iw`/`ji` spellings of `id`/`he`/`yi`).
 * The withdrawn ones are in on purpose: real CMPs still emit them, and this
 * list exists to avoid false positives, not to police vocabulary. TCF encodes
 * the code as two 6-bit letters, so we compare case-insensitively.
 */
const ISO_639_1 = new Set(
  (
    'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv ' +
    'cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ' +
    'ht hu hy hz ia id ie ig ii ik in io is it iu iw ja ji jv ka kg ki kj kk kl km kn ko kr ks ' +
    'ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn ' +
    'no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg sh si sk sl sm ' +
    'sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo ' +
    'wa wo xh yi yo za zh zu'
  ).split(' '),
);

/**
 * Defaults for every bound a future IAB policy revision could legitimately
 * widen. Each is overridable through `options`; each drives a `warning`, never
 * an `error`, precisely because it is a judgement about the future rather than
 * a fact about the format.
 */
const DEFAULTS = {
  /**
   * Highest TCF policy version we recognise. 2 = TCF v2.0/2.1, 4 = v2.2.
   * Headroom to 5 so a policy bump does not immediately warn on healthy
   * strings; 25 (the measured corruption value) is nowhere near it.
   */
  maxPolicyVersion: 5,
  /**
   * Highest purpose id TCF v2.2 defines. Purposes 12–24 are encodable but
   * undefined, so a bit set there is a corruption signal rather than a choice.
   */
  maxPurpose: 11,
  /** Same, for special features: v2.2 defines 1 and 2; 3–12 are reserved. */
  maxSpecialFeature: 2,
  /**
   * Global Vendor List versions increment roughly weekly and stood in the low
   * hundreds through 2026. 1000 is over a decade of headroom while still
   * catching the high-order bit flips that push the field into the thousands.
   */
  maxVendorListVersion: 1000,
  /**
   * The IAB CMP register held well under two thousand ids in 2026, but the
   * field is 12 bits and the register only grows, so the default is the
   * encodable maximum: a plain cmpId bound would go stale and start warning
   * about healthy strings. Tighten it deliberately if you have a current list.
   */
  maxCmpId: 4095,
  /** Clock-skew tolerance for the "timestamp in the future" bound, in ms. */
  futureSkewMs: 24 * 60 * 60 * 1000,
  /**
   * Nothing before this can be a v2 string: TCF v2.0 was first published in
   * August 2019. The floor sits below the IAB's own documentation example,
   * which is stamped 2020-03-24 — a tighter floor would warn about the very
   * string the spec ships as correct.
   */
  minTimestampMs: Date.UTC(2019, 0, 1),
  /** Refuse to walk pathological input rather than allocating for it. */
  maxInputLength: 100000,
};

/**
 * @typedef {object} TcFinding
 * @property {string} code       stable dotted identifier
 * @property {string} level      'error' | 'warning' | 'info'
 * @property {string} segment    which segment the finding is about
 * @property {string} field      the field or structure at fault
 * @property {unknown} value     what we actually read
 * @property {string} expected   what a conforming CMP would have written
 * @property {number[]} [bitRange] `[startBit, endBitExclusive]` within the segment
 * @property {string} detail     one-sentence English explanation
 */

/**
 * @typedef {object} TcRangeEntry
 * @property {number} start
 * @property {number} end
 * @property {boolean} isRange whether the entry was *written* as a range; kept
 *   so the round-trip re-emits it the way it arrived. A one-element range may
 *   legitimately be encoded either as a single id or as a range whose start
 *   equals its end, and normalising that on the way out would make the
 *   round-trip disagree with a perfectly conforming string.
 */

/**
 * @typedef {object} TcVendorSection
 * @property {number} maxVendorId
 * @property {boolean} isRangeEncoding
 * @property {number[]} ids                vendor ids the section asserts
 * @property {TcRangeEntry[]} ranges       entries, range encoding only
 * @property {string} [bitfield]           raw bits, bitfield encoding only
 */

// ── Finding helper ───────────────────────────────────────────────────────────

/**
 * @param {TcFinding[]} out
 * @param {string} code
 * @param {string} level
 * @param {string} segment
 * @param {string} field
 * @param {unknown} value
 * @param {string} expected
 * @param {string} detail
 * @param {number[]} [bitRange]
 */
function push(out, code, level, segment, field, value, expected, detail, bitRange) {
  /** @type {TcFinding} */
  const finding = { code, level, segment, field, value, expected, detail };
  if (bitRange) finding.bitRange = bitRange;
  out.push(finding);
}

// ── Bit plumbing ─────────────────────────────────────────────────────────────

/**
 * Base64URL characters to a string of '0'/'1'. Returns the offending character
 * instead of bits when the alphabet is violated, so the caller can name it.
 *
 * `+`, `/` and `=` get their own diagnosis: that is standard Base64, and a TC
 * string arriving in that alphabet almost always means something re-encoded it
 * in transit rather than that the consent record itself is bad.
 *
 * @param {string} segment
 * @returns {{ bits: string } | { badChar: string, index: number, standardBase64: boolean }}
 */
function segmentToBits(segment) {
  let bits = '';
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    const value = B64URL_VALUES[ch];
    if (value === undefined) {
      return { badChar: ch, index: i, standardBase64: ch === '+' || ch === '/' || ch === '=' };
    }
    bits += value.toString(2).padStart(6, '0');
  }
  return { bits };
}

/** Inverse of {@link segmentToBits}; input length must be a multiple of 6. */
function bitsToSegment(bits) {
  let out = '';
  for (let i = 0; i < bits.length; i += 6) out += B64URL[parseInt(bits.slice(i, i + 6), 2)];
  return out;
}

/**
 * Forward-only bit cursor. A read past the end sets `short` and returns null
 * forever after, so truncation degrades into one reported finding instead of
 * a cascade of nonsense values or an exception.
 *
 * @param {string} bits
 */
function makeReader(bits) {
  return { bits, at: 0, short: false };
}

/** @returns {string|null} */
function readBits(reader, length) {
  if (reader.short) return null;
  if (length < 0 || reader.at + length > reader.bits.length) {
    reader.short = true;
    return null;
  }
  const slice = reader.bits.slice(reader.at, reader.at + length);
  reader.at += length;
  return slice;
}

/** @returns {number|null} */
function readInt(reader, length) {
  const slice = readBits(reader, length);
  return slice === null ? null : parseInt(slice, 2);
}

/**
 * Fixed-width unsigned int emitter, the inverse of {@link readInt}.
 *
 * Deliberately arithmetic rather than bitwise: `created` and `lastUpdated` are
 * 36-bit deciseconds, and JavaScript's bitwise operators coerce to 32 bits.
 * A `>>> 0` here silently truncates every timestamp after 1974, which makes
 * the round-trip below disagree with the input on *every* healthy string —
 * the exact false positive this module exists to avoid.
 */
function writeInt(value, length) {
  let remaining = Math.max(0, Math.trunc(Number(value) || 0));
  let bits = '';
  for (let i = 0; i < length; i += 1) {
    bits = (remaining % 2 === 0 ? '0' : '1') + bits;
    remaining = Math.floor(remaining / 2);
  }
  return bits;
}

/** Set bit positions in a bitfield string, as 1-based ids. */
/**
 * Ceiling on how many vendor ids a range-encoded section may expand to.
 *
 * Vendor ids are a 16-bit field, so a TC string can name at most 65535
 * DISTINCT vendors. Expanding past that is therefore never information —
 * it is duplicates produced by overlapping ranges, which is exactly what a
 * hostile string sends.
 *
 * Why a ceiling is needed at all: `numEntries` is itself a 12-bit field
 * (up to 4095 entries), and each entry may span a full 1..65535 range.
 * Nothing bounded the product, so ~5.6KB of consent string expanded to
 * roughly 268 million array elements — measured at 2.5GB RSS before this
 * change, reached from the public /api/analyze with no authentication.
 * The pre-existing comment at the expansion site reasoned that "a corrupt
 * 16-bit range can span 65535 ids, which is bounded and fine" — true of one
 * range, and the loop runs over all of them.
 *
 * Findings are unaffected: every per-entry check (range_start_zero,
 * range_inverted, range_exceeds_max, ranges_not_ascending) fires from the
 * `ranges` array, which is still recorded in full. Only the flattened id
 * list — used for GVL cross-checks that sample the first 16 hits — stops
 * growing.
 */
const MAX_EXPANDED_VENDOR_IDS = 65535;

function bitsToIds(bitfield) {
  /** @type {number[]} */
  const ids = [];
  for (let i = 0; i < bitfield.length; i += 1) if (bitfield[i] === '1') ids.push(i + 1);
  return ids;
}

/**
 * Two 6-bit letters to a two-character code. TCF stores `A`–`Z` as 0–25, so a
 * value above 25 is not a letter at all and cannot be rendered; the caller
 * needs to know which half went out of range, hence the split return.
 *
 * @param {number} packed 12-bit field
 */
function unpackLetterPair(packed) {
  const first = (packed >> 6) & 0x3f;
  const second = packed & 0x3f;
  const ok = first <= 25 && second <= 25;
  return {
    ok,
    first,
    second,
    text: ok ? String.fromCharCode(65 + first) + String.fromCharCode(65 + second) : null,
  };
}

/** Deciseconds-since-epoch, as TCF stores timestamps, to milliseconds. */
const dsToMs = (deciseconds) => deciseconds * 100;

// ── Vendor sections ──────────────────────────────────────────────────────────

/**
 * Parse a VendorConsent / VendorLegitimateInterest / disclosed / allowed
 * section: a 16-bit maxVendorId, a 1-bit encoding flag, then either a
 * maxVendorId-long bitfield or a run of range entries.
 *
 * Structural complaints are collected rather than thrown — a corrupt range
 * table is exactly what we are here to report.
 *
 * @param {ReturnType<makeReader>} reader
 * @param {TcFinding[]} out
 * @param {string} segmentName
 * @param {string} field
 * @returns {TcVendorSection|null}
 */
/**
 * Vendors named by a publisher restriction.
 *
 * This is NOT the layout used by VendorConsents and VendorLegitimateInterests.
 * Those carry MaxVendorId(16) and an encoding flag, and may be a bitfield. A
 * RestrictionEntry carries neither: the vendor list is always range-encoded, so
 * the section is NumEntries(12) followed by the ranges.
 *
 * Reading it with the other parser consumed sixteen bits that are not there and
 * misaligned everything after, which surfaced as a spurious
 * `segment.unconsumed_bits` finding rather than as a failure. The round trip did
 * not catch it either: the writer was symmetric with the reader, so the string
 * re-encoded to its own misreading. A faithful reader/writer pair round-trips
 * anything the reader accepts — it proves the parse is self-consistent, not that
 * it is right. Cross-checking against a second implementation is what found it.
 *
 * @param {any} reader
 * @param {Array<Object>} out
 * @param {string} segmentName
 * @param {string} field
 * @returns {any}
 */
function parseRestrictionVendors(reader, out, segmentName, field) {
  const section = /** @type {TcVendorSection} */ ({
    maxVendorId: 0,
    isRangeEncoding: true,
    ids: [],
    ranges: [],
  });
  const numEntries = readInt(reader, 12);
  if (numEntries === null) return null;

  /** @type {number[]} */
  const ids = [];
  for (let i = 0; i < numEntries; i += 1) {
    const entryBit = reader.at;
    const isRange = readInt(reader, 1);
    const start = readInt(reader, 16);
    if (isRange === null || start === null) return null;
    const end = isRange === 1 ? readInt(reader, 16) : start;
    if (end === null) return null;
    section.ranges.push({ start, end, isRange: isRange === 1 });

    if (start === 0) {
      push(
        out,
        'vendor.range_start_zero',
        LEVELS.ERROR,
        segmentName,
        `${field}.ranges[${i}].startVendorId`,
        start,
        '>= 1',
        'Vendor ids start at 1, so a range entry beginning at 0 cannot describe any vendor.',
        [entryBit, reader.at],
      );
    }
    if (end < start) {
      push(
        out,
        'vendor.range_inverted',
        LEVELS.ERROR,
        segmentName,
        `${field}.ranges[${i}]`,
        [start, end],
        'endVendorId >= startVendorId',
        'A range whose end precedes its start describes no vendors at all.',
        [entryBit, reader.at],
      );
      continue;
    }
    // Capped: see MAX_EXPANDED_VENDOR_IDS. `ranges` above keeps the full
    // picture, so no per-entry finding loses its evidence.
    for (let id = start; id <= end && ids.length < MAX_EXPANDED_VENDOR_IDS; id += 1) {
      ids.push(id);
    }
  }
  section.ids = ids;
  // Tracked with a loop, not Math.max(...ids): spreading a large array into
  // an argument list throws RangeError (Maximum call stack size exceeded) —
  // measured here from about a million elements up.
  let maxSeen = 0;
  for (const id of ids) if (id > maxSeen) maxSeen = id;
  section.maxVendorId = maxSeen;
  return section;
}

function parseVendorSection(reader, out, segmentName, field) {
  const startBit = reader.at;
  const maxVendorId = readInt(reader, 16);
  const encodingFlag = readInt(reader, 1);
  if (maxVendorId === null || encodingFlag === null) return null;

  /** @type {TcVendorSection} */
  const section = { maxVendorId, isRangeEncoding: encodingFlag === 1, ids: [], ranges: [] };

  if (!section.isRangeEncoding) {
    const bitfield = readBits(reader, maxVendorId);
    if (bitfield === null) return null;
    section.bitfield = bitfield;
    section.ids = bitsToIds(bitfield);
    return section;
  }

  const numEntries = readInt(reader, 12);
  if (numEntries === null) return null;

  /** @type {number[]} */
  const ids = [];
  let previousEnd = 0;
  for (let i = 0; i < numEntries; i += 1) {
    const entryBit = reader.at;
    const isRange = readInt(reader, 1);
    const start = readInt(reader, 16);
    if (isRange === null || start === null) return null;
    const end = isRange === 1 ? readInt(reader, 16) : start;
    if (end === null) return null;

    section.ranges.push({ start, end, isRange: isRange === 1 });

    // Vendor ids are 1-based; 0 is not a vendor, so a range that starts there
    // is a bit pattern, not a decision.
    if (start === 0) {
      push(
        out,
        'vendor.range_start_zero',
        LEVELS.ERROR,
        segmentName,
        `${field}.ranges[${i}].startVendorId`,
        start,
        '>= 1',
        'Vendor ids start at 1, so a range entry beginning at 0 cannot describe any vendor.',
        [entryBit, reader.at],
      );
    }
    if (end < start) {
      push(
        out,
        'vendor.range_inverted',
        LEVELS.ERROR,
        segmentName,
        `${field}.ranges[${i}]`,
        [start, end],
        'endVendorId >= startVendorId',
        'A range entry ends before it starts, which no conforming encoder emits.',
        [entryBit, reader.at],
      );
    }
    if (maxVendorId > 0 && end > maxVendorId) {
      push(
        out,
        'vendor.range_exceeds_max',
        LEVELS.ERROR,
        segmentName,
        `${field}.ranges[${i}].endVendorId`,
        end,
        `<= maxVendorId (${maxVendorId})`,
        'A range entry names a vendor id above the maximum the section declared.',
        [entryBit, reader.at],
      );
    }
    if (start <= previousEnd && i > 0) {
      push(
        out,
        'vendor.ranges_not_ascending',
        LEVELS.WARNING,
        segmentName,
        `${field}.ranges[${i}].startVendorId`,
        start,
        `> previous endVendorId (${previousEnd})`,
        'Range entries overlap or run backwards; encoders emit them in ascending order.',
        [entryBit, reader.at],
      );
    }
    previousEnd = Math.max(previousEnd, end);

    // Guard the id expansion, not the report: a corrupt 16-bit range can span
    // 65535 ids, which is bounded and fine, but we still only expand sane ones.
    if (start >= 1 && end >= start) {
      for (let id = start; id <= end && ids.length < MAX_EXPANDED_VENDOR_IDS; id += 1) {
        ids.push(id);
      }
    }
  }

  section.ids = ids;
  if (maxVendorId === 0 && numEntries > 0) {
    push(
      out,
      'vendor.entries_without_max',
      LEVELS.ERROR,
      segmentName,
      `${field}.maxVendorId`,
      0,
      '>= the highest id in the section',
      'The section declares no vendors yet carries range entries naming some.',
      [startBit, startBit + 16],
    );
  }
  return section;
}

/**
 * Re-emit a vendor section exactly as it was read.
 *
 * Note the reliance on `entry.isRange` rather than a `start === end` test: a
 * single vendor may conformingly be written either as a single id or as a
 * range whose ends coincide. Picking the shorter form on the way out would
 * make the round-trip report a mismatch on a perfectly healthy string.
 */
function writeVendorSection(section) {
  let bits = writeInt(section.maxVendorId, 16) + (section.isRangeEncoding ? '1' : '0');
  if (!section.isRangeEncoding) return bits + (section.bitfield || '');
  bits += writeInt(section.ranges.length, 12);
  for (const entry of section.ranges) {
    bits += entry.isRange
      ? '1' + writeInt(entry.start, 16) + writeInt(entry.end, 16)
      : '0' + writeInt(entry.start, 16);
  }
  return bits;
}

// ── Core segment ─────────────────────────────────────────────────────────────

/**
 * Read the Core String into a model. Field-level judgement happens later, in
 * {@link checkCoreValues}; this function only reports structural faults it
 * cannot parse past.
 *
 * @param {string} bits
 * @param {TcFinding[]} out
 */
function parseCore(bits, out) {
  const reader = makeReader(bits);
  /** @type {Record<string, number>} */
  const raw = {};
  for (const [field, [offset, length]] of Object.entries(CORE_LAYOUT)) {
    reader.at = offset;
    const value = readInt(reader, length);
    if (value === null) return { core: null, reader, truncatedAt: offset };
    raw[field] = value;
  }
  reader.at = CORE_VARIABLE_START;

  const vendorConsent = parseVendorSection(reader, out, 'core', 'vendorConsent');
  const vendorLegitimateInterest = vendorConsent
    ? parseVendorSection(reader, out, 'core', 'vendorLegitimateInterest')
    : null;
  if (!vendorConsent || !vendorLegitimateInterest) {
    return { core: null, reader, truncatedAt: reader.at };
  }

  const restrictionsBit = reader.at;
  const numRestrictions = readInt(reader, 12);
  if (numRestrictions === null) return { core: null, reader, truncatedAt: restrictionsBit };

  /** @type {Array<{purposeId:number, restrictionType:number, vendors:TcVendorSection|null}>} */
  const publisherRestrictions = [];
  for (let i = 0; i < numRestrictions; i += 1) {
    const entryBit = reader.at;
    const purposeId = readInt(reader, 6);
    const restrictionType = readInt(reader, 2);
    if (purposeId === null || restrictionType === null) {
      return { core: null, reader, truncatedAt: entryBit };
    }
    // Restriction types are 0 (not allowed), 1 (require consent) and 2
    // (require legitimate interest). 3 is encodable and undefined.
    if (restrictionType === 3) {
      push(
        out,
        'core.restriction_type_undefined',
        LEVELS.ERROR,
        'core',
        `publisherRestrictions[${i}].restrictionType`,
        3,
        '0, 1 or 2',
        'Restriction type 3 is not defined by TCF v2; only 0, 1 and 2 exist.',
        [entryBit + 6, entryBit + 8],
      );
    }
    if (purposeId === 0) {
      push(
        out,
        'core.restriction_purpose_zero',
        LEVELS.ERROR,
        'core',
        `publisherRestrictions[${i}].purposeId`,
        0,
        '>= 1',
        'Purpose ids start at 1, so a restriction on purpose 0 describes nothing.',
        [entryBit, entryBit + 6],
      );
    }
    const vendors = parseRestrictionVendors(
      reader,
      out,
      'core',
      `publisherRestrictions[${i}].vendors`,
    );
    if (!vendors) return { core: null, reader, truncatedAt: entryBit };
    publisherRestrictions.push({ purposeId, restrictionType, vendors });
  }

  const language = unpackLetterPair(raw.consentLanguage);
  const publisherCC = unpackLetterPair(raw.publisherCC);

  const core = {
    version: raw.version,
    created: raw.created,
    lastUpdated: raw.lastUpdated,
    createdMs: dsToMs(raw.created),
    lastUpdatedMs: dsToMs(raw.lastUpdated),
    cmpId: raw.cmpId,
    cmpVersion: raw.cmpVersion,
    consentScreen: raw.consentScreen,
    consentLanguage: language.text,
    consentLanguageRaw: language,
    vendorListVersion: raw.vendorListVersion,
    policyVersion: raw.policyVersion,
    isServiceSpecific: raw.isServiceSpecific === 1,
    useNonStandardTexts: raw.useNonStandardTexts === 1,
    specialFeatureOptIns: bitsToIds(writeInt(raw.specialFeatureOptIns, 12)),
    purposesConsent: bitsToIds(writeInt(raw.purposesConsent, 24)),
    purposesLITransparency: bitsToIds(writeInt(raw.purposesLITransparency, 24)),
    purposeOneTreatment: raw.purposeOneTreatment === 1,
    publisherCC: publisherCC.text,
    publisherCCRaw: publisherCC,
    vendorConsent,
    vendorLegitimateInterest,
    publisherRestrictions,
    _raw: raw,
  };
  return { core, reader, truncatedAt: -1 };
}

/** Re-emit the Core String from a parsed model, bit for bit. */
function writeCore(core) {
  let bits = '';
  for (const [field, [, length]] of Object.entries(CORE_LAYOUT))
    bits += writeInt(core._raw[field], length);
  bits += writeVendorSection(core.vendorConsent);
  bits += writeVendorSection(core.vendorLegitimateInterest);
  bits += writeInt(core.publisherRestrictions.length, 12);
  for (const restriction of core.publisherRestrictions) {
    bits += writeInt(restriction.purposeId, 6);
    bits += writeInt(restriction.restrictionType, 2);
    // Range-only, matching parseRestrictionVendors: no MaxVendorId, no flag.
    bits += writeInt(restriction.vendors.ranges.length, 12);
    for (const entry of restriction.vendors.ranges) {
      bits += entry.isRange
        ? '1' + writeInt(entry.start, 16) + writeInt(entry.end, 16)
        : '0' + writeInt(entry.start, 16);
    }
  }
  return bits;
}

// ── Field plausibility ───────────────────────────────────────────────────────

/**
 * Everything a conforming CMP could not have written, given a Core String we
 * successfully parsed.
 *
 * @param {ReturnType<parseCore>['core']} core
 * @param {TcFinding[]} out
 * @param {typeof DEFAULTS & {now:number}} limits
 */
function checkCoreValues(core, out, limits) {
  const at = (field) => [CORE_LAYOUT[field][0], CORE_LAYOUT[field][0] + CORE_LAYOUT[field][1]];

  // — version —
  if (core.version !== 2) {
    push(
      out,
      'core.version_unsupported',
      LEVELS.ERROR,
      'core',
      'version',
      core.version,
      '2',
      'Only TCF v2 strings have this layout; another version number means the bits were read against the wrong spec.',
      at('version'),
    );
  }

  // — policyVersion —
  if (core.policyVersion < 2) {
    push(
      out,
      'core.policy_version_too_low',
      LEVELS.ERROR,
      'core',
      'policyVersion',
      core.policyVersion,
      '>= 2',
      'TCF v2 strings start at policy version 2; anything lower belongs to a format that never used this layout.',
      at('policyVersion'),
    );
  } else if (core.policyVersion > limits.maxPolicyVersion) {
    push(
      out,
      'core.policy_version_unknown',
      LEVELS.WARNING,
      'core',
      'policyVersion',
      core.policyVersion,
      `<= ${limits.maxPolicyVersion}`,
      'No TCF policy version this high has been published; the field most likely took a bit flip.',
      at('policyVersion'),
    );
  }

  // — consentLanguage —
  if (!core.consentLanguageRaw.ok) {
    push(
      out,
      'core.consent_language_not_letters',
      LEVELS.ERROR,
      'core',
      'consentLanguage',
      [core.consentLanguageRaw.first, core.consentLanguageRaw.second],
      'two 6-bit values in 0..25 (A-Z)',
      'The language field holds values outside A-Z, so it does not spell a code at all.',
      at('consentLanguage'),
    );
  } else if (!ISO_639_1.has(core.consentLanguage.toLowerCase())) {
    push(
      out,
      'core.consent_language_not_iso639',
      LEVELS.ERROR,
      'core',
      'consentLanguage',
      core.consentLanguage,
      'an ISO 639-1 alpha-2 language code',
      'TCF requires an ISO 639-1 code here, and this pair of letters is not one.',
      at('consentLanguage'),
    );
  }

  // — publisherCC —
  // WHY-NOT: checked for letter shape only, never against an ISO 3166-1 list.
  // `AA` is user-assigned rather than a real country and is exactly what the
  // IAB's own documentation example carries, so a country-list check would
  // warn about the reference string. Add the ISO 3166 table and you also
  // inherit its churn — new assignments, `XK`, and the `EU` some CMPs emit.
  if (!core.publisherCCRaw.ok) {
    push(
      out,
      'core.publisher_cc_not_letters',
      LEVELS.ERROR,
      'core',
      'publisherCC',
      [core.publisherCCRaw.first, core.publisherCCRaw.second],
      'two 6-bit values in 0..25 (A-Z)',
      'The publisher country field holds values outside A-Z, so it does not spell a code at all.',
      at('publisherCC'),
    );
  }

  // — cmpId —
  // Unsigned 12 bits, so "negative" is unrepresentable by construction; 0 is
  // the reserved "no CMP" value and never identifies a registered one.
  if (core.cmpId === 0) {
    push(
      out,
      'core.cmp_id_zero',
      LEVELS.ERROR,
      'core',
      'cmpId',
      0,
      '>= 1',
      'CMP id 0 is reserved and identifies no registered CMP.',
      at('cmpId'),
    );
  } else if (core.cmpId > limits.maxCmpId) {
    push(
      out,
      'core.cmp_id_implausible',
      LEVELS.WARNING,
      'core',
      'cmpId',
      core.cmpId,
      `<= ${limits.maxCmpId}`,
      'The CMP id sits above the highest id the caller considers plausible.',
      at('cmpId'),
    );
  }

  // — vendorListVersion —
  if (core.vendorListVersion === 0) {
    push(
      out,
      'core.vendor_list_version_zero',
      LEVELS.ERROR,
      'core',
      'vendorListVersion',
      0,
      '>= 1',
      'Every TCF v2 string is written against a published Global Vendor List, and versions start at 1.',
      at('vendorListVersion'),
    );
  } else if (core.vendorListVersion > limits.maxVendorListVersion) {
    push(
      out,
      'core.vendor_list_version_implausible',
      LEVELS.WARNING,
      'core',
      'vendorListVersion',
      core.vendorListVersion,
      `<= ${limits.maxVendorListVersion}`,
      'No Global Vendor List version this high has been published; a high-order bit flip produces exactly this.',
      at('vendorListVersion'),
    );
  }

  // — reserved purpose / special-feature bits —
  // These are the strongest cheap checks in the file. TCF v2.2 defines
  // purposes 1..11 and special features 1..2, but the fields are 24 and 12
  // bits wide, so every bit above those is reserved and a conforming CMP
  // leaves it at 0. Corruption inside a bit set almost always lights one up.
  const reservedPurposes = (ids, field) => {
    const reserved = ids.filter((id) => id > limits.maxPurpose);
    if (!reserved.length) return;
    push(
      out,
      'core.purpose_reserved_bit_set',
      LEVELS.WARNING,
      'core',
      field,
      reserved,
      `purpose ids <= ${limits.maxPurpose}`,
      'Bits are set for purpose ids TCF v2.2 does not define, which no CMP writes deliberately.',
      at(field),
    );
  };
  reservedPurposes(core.purposesConsent, 'purposesConsent');
  reservedPurposes(core.purposesLITransparency, 'purposesLITransparency');

  const reservedFeatures = core.specialFeatureOptIns.filter((id) => id > limits.maxSpecialFeature);
  if (reservedFeatures.length) {
    push(
      out,
      'core.special_feature_reserved_bit_set',
      LEVELS.WARNING,
      'core',
      'specialFeatureOptIns',
      reservedFeatures,
      `special feature ids <= ${limits.maxSpecialFeature}`,
      'Bits are set for special features TCF v2.2 does not define, which no CMP writes deliberately.',
      at('specialFeatureOptIns'),
    );
  }

  // — purpose 1 has no legitimate-interest basis —
  // Stable across v2.0, v2.1 and v2.2: storing and accessing information on a
  // device may only ever be based on consent. A CMP that sets this bit is
  // either broken or the bits are not what the CMP wrote.
  // WHY-NOT: purposes 3-6 are consent-only under the v2.2 policy too, but that
  // is a policy-version-dependent rule, and applying it to a legitimately
  // older v2.0 string would warn about a string that was correct when written.
  if (core.purposesLITransparency.includes(1)) {
    push(
      out,
      'core.purpose_one_legitimate_interest',
      LEVELS.ERROR,
      'core',
      'purposesLITransparency',
      1,
      'purpose 1 bit clear',
      'Purpose 1 may only be based on consent under every TCF v2 policy, so it can never carry legitimate interest.',
      at('purposesLITransparency'),
    );
  }

  // — timestamps —
  const stamp = (field, ms, raw) => {
    if (ms > limits.now + limits.futureSkewMs) {
      push(
        out,
        'core.timestamp_in_future',
        LEVELS.ERROR,
        'core',
        field,
        new Date(ms).toISOString(),
        `<= ${new Date(limits.now + limits.futureSkewMs).toISOString()}`,
        'The timestamp is in the future, which a record of a decision already taken cannot be.',
        at(field),
      );
      return;
    }
    if (ms < limits.minTimestampMs) {
      push(
        out,
        'core.timestamp_too_old',
        LEVELS.ERROR,
        'core',
        field,
        raw === 0 ? 0 : new Date(ms).toISOString(),
        `>= ${new Date(limits.minTimestampMs).toISOString()}`,
        'The timestamp predates TCF v2 itself, so no v2 string was written at that moment.',
        at(field),
      );
    }
  };
  stamp('created', core.createdMs, core.created);
  stamp('lastUpdated', core.lastUpdatedMs, core.lastUpdated);

  if (core.lastUpdatedMs < core.createdMs) {
    push(
      out,
      'core.last_updated_before_created',
      LEVELS.ERROR,
      'core',
      'lastUpdated',
      new Date(core.lastUpdatedMs).toISOString(),
      `>= created (${new Date(core.createdMs).toISOString()})`,
      'A record cannot have been updated before it was created.',
      at('lastUpdated'),
    );
  }
}

// ── Optional Global Vendor List cross-check ──────────────────────────────────

/**
 * Extra checks that only a vendor list can answer. Entirely opt-in: pass the
 * parsed GVL JSON as `options.gvl` and this module reads it as data. It is
 * never fetched here — a module that reaches the network is not a module you
 * can call from a validator.
 *
 * @param {ReturnType<parseCore>['core']} core
 * @param {TcFinding[]} out
 * @param {{vendorListVersion?:number, tcfPolicyVersion?:number, vendors?:Record<string,unknown>}} gvl
 */
function checkAgainstGvl(core, out, gvl) {
  if (!gvl || typeof gvl !== 'object') return;

  if (typeof gvl.vendorListVersion === 'number' && core.vendorListVersion > gvl.vendorListVersion) {
    push(
      out,
      'gvl.vendor_list_version_ahead',
      LEVELS.WARNING,
      'core',
      'vendorListVersion',
      core.vendorListVersion,
      `<= the supplied list version (${gvl.vendorListVersion})`,
      'The string claims a Global Vendor List newer than the one supplied, which cannot have existed when it was written.',
    );
  }

  const vendors = gvl.vendors;
  if (!vendors || typeof vendors !== 'object') return;

  // Only a list at least as new as the one the string was written against can
  // answer "is this a real vendor". Vendors are added to the GVL over time, so
  // checking a v300 string against a v250 list would report every vendor
  // registered in between as unknown — a warning about a perfectly healthy
  // string, produced entirely by the caller's stale input.
  if (typeof gvl.vendorListVersion === 'number' && gvl.vendorListVersion < core.vendorListVersion) {
    return;
  }

  const unknown = [];
  for (const id of core.vendorConsent.ids) {
    if (!Object.prototype.hasOwnProperty.call(vendors, String(id))) unknown.push(id);
    if (unknown.length >= 16) break; // report a sample, not a flood
  }
  if (unknown.length) {
    push(
      out,
      'gvl.unknown_vendor_id',
      LEVELS.WARNING,
      'core',
      'vendorConsent.ids',
      unknown,
      'vendor ids present in the supplied Global Vendor List',
      'Consent is asserted for vendor ids the supplied vendor list does not contain.',
    );
  }
}

// ── Non-core segments ────────────────────────────────────────────────────────

/**
 * Disclosed-vendors (type 1), allowed-vendors (type 2) and publisher-TC
 * (type 3) segments. Their only fixed field is the 3-bit discriminator.
 *
 * @param {string} bits
 * @param {number} index
 * @param {TcFinding[]} out
 * @param {typeof DEFAULTS} limits
 */
function parseNonCoreSegment(bits, index, out, limits) {
  const reader = makeReader(bits);
  const segmentType = readInt(reader, 3);
  const name = `segment[${index}]`;
  if (segmentType === null) {
    push(
      out,
      'segment.truncated',
      LEVELS.ERROR,
      name,
      'segmentType',
      bits.length,
      '>= 3 bits',
      'The segment is too short to even name its own type.',
    );
    return null;
  }

  const kind = SEGMENT_TYPES[segmentType];
  if (segmentType === 0) {
    push(
      out,
      'segment.core_out_of_position',
      LEVELS.ERROR,
      name,
      'segmentType',
      0,
      '1, 2 or 3',
      'Type 0 is the core segment, and it may only appear first.',
    );
    return null;
  }
  if (!kind) {
    push(
      out,
      'segment.type_unknown',
      LEVELS.ERROR,
      name,
      'segmentType',
      segmentType,
      '1 (disclosed vendors), 2 (allowed vendors) or 3 (publisher TC)',
      'TCF v2 defines no segment with this type discriminator.',
    );
    return null;
  }

  if (segmentType === 3) {
    const purposesConsent = readInt(reader, 24);
    const purposesLI = readInt(reader, 24);
    const numCustomPurposes = readInt(reader, 6);
    if (purposesConsent === null || purposesLI === null || numCustomPurposes === null) {
      push(
        out,
        'segment.truncated',
        LEVELS.ERROR,
        name,
        kind,
        bits.length,
        '>= 57 bits',
        'The publisher-TC segment ends inside its fixed header.',
      );
      return null;
    }
    const customConsent = readBits(reader, numCustomPurposes);
    const customLI = readBits(reader, numCustomPurposes);
    if (customConsent === null || customLI === null) {
      push(
        out,
        'segment.truncated',
        LEVELS.ERROR,
        name,
        `${kind}.customPurposes`,
        numCustomPurposes,
        'as many bits as the segment declared',
        'The publisher-TC segment declares more custom purposes than it carries bits for.',
      );
      return null;
    }
    const reserved = bitsToIds(writeInt(purposesConsent, 24)).filter(
      (id) => id > limits.maxPurpose,
    );
    if (reserved.length) {
      push(
        out,
        'segment.purpose_reserved_bit_set',
        LEVELS.WARNING,
        name,
        `${kind}.pubPurposesConsent`,
        reserved,
        `purpose ids <= ${limits.maxPurpose}`,
        'Bits are set for purpose ids TCF v2.2 does not define.',
      );
    }
    return {
      kind,
      consumed: reader.at,
      bits: bits.length,
      encoded:
        writeInt(segmentType, 3) +
        writeInt(purposesConsent, 24) +
        writeInt(purposesLI, 24) +
        writeInt(numCustomPurposes, 6) +
        customConsent +
        customLI,
    };
  }

  const section = parseVendorSection(reader, out, name, kind);
  if (!section) {
    push(
      out,
      'segment.truncated',
      LEVELS.ERROR,
      name,
      kind,
      bits.length,
      'enough bits for the vendor section it declares',
      'The segment ends inside the vendor section it declares.',
    );
    return null;
  }
  return {
    kind,
    consumed: reader.at,
    bits: bits.length,
    encoded: writeInt(segmentType, 3) + writeVendorSection(section),
  };
}

// ── Trailing bits ────────────────────────────────────────────────────────────

/**
 * Whatever follows the last field the parser read.
 *
 * This used to fire on *length*: more than five trailing bits was treated as
 * unmodelled content, on the assumption that a conforming encoder pads to the
 * nearest six-bit boundary and no further. Measured against `@iabtcf/core`, the
 * reference implementation: every string it produces trips that rule. A minimal
 * one carries fifteen trailing zero bits in its publisher segment, because the
 * encoder emits twelve base64 characters where ten would hold the fields. Seven
 * of seven generated strings were reported as suspect — a rule that warns about
 * every valid input is worse than no rule, because it gets switched off and then
 * nothing is reported at all.
 *
 * So the test is the content, not the count. Zeros are padding however many
 * there are; a set bit is a field this parser did not model, however few. That
 * distinction is also the one the spec actually makes.
 *
 * @param {TcFinding[]} out
 * @param {string} segmentName
 * @param {string} bits Full segment bit string.
 * @param {number} consumed Index the parser stopped at.
 */
function checkTrailingBits(out, segmentName, bits, consumed) {
  const trailing = bits.slice(consumed);
  if (!trailing.includes('1')) return;
  const isPaddingWidth = trailing.length < 6;
  push(
    out,
    isPaddingWidth
      ? `${segmentName === 'core' ? 'core' : 'segment'}.non_zero_padding`
      : 'segment.unconsumed_bits',
    LEVELS.WARNING,
    segmentName,
    'trailing',
    trailing.length,
    'zero padding',
    isPaddingWidth
      ? 'The padding after the last field is not zero, so the string was not written by a conforming encoder.'
      : 'The segment holds set bits past its declared structure — content this parser did not model.',
    [consumed, bits.length],
  );
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Judge whether a TC string's unpacked fields could have come from a
 * conforming CMP.
 *
 * Never throws. Never touches the network or the filesystem.
 *
 * `ok` is true only when nothing failed to add up at all — it is the answer to
 * "may I trust this record", so a warning clears it. Callers that want to act
 * on hard impossibilities alone should read `status`, which rolls the findings
 * up the way `findings.js` does: `'clean'`, `'warnings'` or `'errors'`.
 *
 * @param {unknown} input the TC string, as received
 * @param {object} [options]
 * @param {number} [options.now] milliseconds since epoch; supply it to make the result fully deterministic
 * @param {object} [options.gvl] parsed Global Vendor List JSON, for the optional cross-check
 * @param {number} [options.maxPolicyVersion]
 * @param {number} [options.maxPurpose]
 * @param {number} [options.maxSpecialFeature]
 * @param {number} [options.maxVendorListVersion]
 * @param {number} [options.maxCmpId]
 * @param {number} [options.futureSkewMs]
 * @param {number} [options.minTimestampMs]
 * @param {number} [options.maxInputLength]
 * @returns {{ok:boolean, status:string, findings:TcFinding[], core:object|null, segments:Array<object>, roundTrip:{attempted:boolean, matched:boolean, reason:string|null}}}
 */
function checkTcString(input, options) {
  /** @type {TcFinding[]} */
  const findings = [];
  /** @type {Array<object>} */
  const segments = [];
  /** @type {{attempted:boolean, matched:boolean, reason:string|null}} */
  const roundTrip = { attempted: false, matched: false, reason: null };
  const result = {
    ok: false,
    status: 'errors',
    findings,
    core: null,
    segments,
    roundTrip,
  };

  /** Roll the findings up once, at every exit, so no path can disagree. */
  const settle = () => {
    if (!findings.length) result.status = 'clean';
    else if (findings.some((f) => f.level === LEVELS.ERROR)) result.status = 'errors';
    else result.status = 'warnings';
    result.ok = findings.length === 0;
    return result;
  };

  try {
    const opts = options && typeof options === 'object' ? options : {};
    /** @type {typeof DEFAULTS & {now: number}} */
    const limits = { ...DEFAULTS, now: 0 };
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof opts[key] === 'number' && Number.isFinite(opts[key])) limits[key] = opts[key];
    }
    limits.now = typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : Date.now();

    // — input shape —
    if (typeof input !== 'string') {
      push(
        findings,
        'input.not_a_string',
        LEVELS.ERROR,
        'input',
        'input',
        input === null ? null : typeof input,
        'a string',
        'A TC string arrives as text; anything else was never a consent record.',
      );
      return settle();
    }
    if (input.length === 0) {
      push(
        findings,
        'input.empty',
        LEVELS.ERROR,
        'input',
        'input',
        '',
        'a non-empty Base64URL string',
        'The input is empty, so there is nothing to check.',
      );
      return settle();
    }
    if (input.length > limits.maxInputLength) {
      push(
        findings,
        'input.too_long',
        LEVELS.ERROR,
        'input',
        'input.length',
        input.length,
        `<= ${limits.maxInputLength}`,
        'The input is far longer than any TC string and is refused rather than walked.',
      );
      return settle();
    }
    // Emptiness is decided before whitespace is complained about: a
    // whitespace-only value is one problem, not two, and "it has stray spaces"
    // is not useful advice about a value that holds nothing.
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      push(
        findings,
        'input.empty',
        LEVELS.ERROR,
        'input',
        'input',
        input,
        'a non-empty Base64URL string',
        'The input is whitespace only, so there is nothing to check.',
      );
      return settle();
    }
    if (trimmed !== input) {
      push(
        findings,
        'input.surrounding_whitespace',
        LEVELS.WARNING,
        'input',
        'input',
        input.length,
        'no leading or trailing whitespace',
        'The value carries surrounding whitespace, which decoders disagree about; it was trimmed before checking.',
      );
    }

    // — segmentation —
    const parts = trimmed.split('.');
    if (parts.length > 4) {
      push(
        findings,
        'input.too_many_segments',
        LEVELS.ERROR,
        'input',
        'segments',
        parts.length,
        '<= 4 (core, disclosed vendors, allowed vendors, publisher TC)',
        'TCF v2 defines four segments; more means the value is not one TC string.',
      );
    }
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].length === 0) {
        push(
          findings,
          'input.empty_segment',
          LEVELS.ERROR,
          `segment[${i}]`,
          'segment',
          '',
          'a non-empty Base64URL segment',
          'A dot separator has nothing on one side of it, so a segment is missing.',
        );
      }
    }

    /** @type {string[]} */
    const segmentBits = [];
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].length === 0) {
        segmentBits.push('');
        continue;
      }
      const decoded = segmentToBits(parts[i]);
      if ('badChar' in decoded) {
        push(
          findings,
          decoded.standardBase64 ? 'input.standard_base64' : 'input.not_base64url',
          LEVELS.ERROR,
          `segment[${i}]`,
          'segment',
          decoded.badChar,
          'characters from A-Z a-z 0-9 - _',
          decoded.standardBase64
            ? 'The value uses the standard Base64 alphabet; TC strings are Base64URL, so something re-encoded it in transit.'
            : 'The segment holds a character that is not in the Base64URL alphabet.',
          [decoded.index * 6, decoded.index * 6 + 6],
        );
        segmentBits.push('');
        continue;
      }
      segmentBits.push(decoded.bits);
    }

    // — core segment —
    const coreBits = segmentBits[0] || '';
    if (coreBits.length === 0) {
      return settle();
    }
    if (coreBits.length < CORE_MIN_BITS) {
      push(
        findings,
        'core.truncated',
        LEVELS.ERROR,
        'core',
        'segment',
        `${parts[0].length} chars / ${coreBits.length} bits`,
        `>= ${CORE_MIN_BITS} bits (${Math.ceil(CORE_MIN_BITS / 6)} chars)`,
        'The core segment is shorter than the mandatory header plus its two empty vendor sections.',
      );
      return settle();
    }

    const parsed = parseCore(coreBits, findings);
    if (!parsed.core) {
      push(
        findings,
        'core.truncated',
        LEVELS.ERROR,
        'core',
        'segment',
        `${coreBits.length} bits`,
        'enough bits for every section it declares',
        `The core segment ends inside a section that begins at bit ${parsed.truncatedAt}.`,
      );
      return settle();
    }
    result.core = parsed.core;
    segments.push({ index: 0, kind: 'core', chars: parts[0].length, bits: coreBits.length });

    checkCoreValues(parsed.core, findings, limits);
    if (opts.gvl) checkAgainstGvl(parsed.core, findings, opts.gvl);

    // — accounting: trailing bits and the round-trip —
    checkTrailingBits(findings, 'core', coreBits, parsed.reader.at);

    const reencodedCore = writeCore(parsed.core);
    roundTrip.attempted = true;
    if (coreBits.startsWith(reencodedCore) && reencodedCore.length === parsed.reader.at) {
      roundTrip.matched = true;
    } else {
      roundTrip.matched = false;
      roundTrip.reason = 're-encoded core segment differs from the input bits';
      push(
        findings,
        'core.round_trip_mismatch',
        LEVELS.ERROR,
        'core',
        'segment',
        bitsToSegment(reencodedCore.padEnd(Math.ceil(reencodedCore.length / 6) * 6, '0')),
        parts[0],
        'Re-encoding exactly what we parsed does not reproduce the input, so the string holds structure this parser could not account for.',
      );
    }

    // — remaining segments —
    /** @type {Set<string>} */
    const seenKinds = new Set();
    for (let i = 1; i < segmentBits.length; i += 1) {
      if (!segmentBits[i]) continue;
      const segment = parseNonCoreSegment(segmentBits[i], i, findings, limits);
      if (!segment) continue;
      if (seenKinds.has(segment.kind)) {
        push(
          findings,
          'segment.duplicate_type',
          LEVELS.ERROR,
          `segment[${i}]`,
          'segmentType',
          segment.kind,
          'each segment type at most once',
          'The same segment type appears twice, and a TC string carries each at most once.',
        );
      }
      seenKinds.add(segment.kind);
      segments.push({ index: i, kind: segment.kind, chars: parts[i].length, bits: segment.bits });

      checkTrailingBits(findings, `segment[${i}]`, segmentBits[i], segment.consumed);
      if (!segmentBits[i].startsWith(segment.encoded)) {
        roundTrip.matched = false;
        roundTrip.reason = `re-encoded segment[${i}] differs from the input bits`;
        push(
          findings,
          'segment.round_trip_mismatch',
          LEVELS.ERROR,
          `segment[${i}]`,
          'segment',
          segment.kind,
          parts[i],
          'Re-encoding exactly what we parsed does not reproduce the input, so the segment holds structure this parser could not account for.',
        );
      }
    }

    return settle();
  } catch (error) {
    // The contract is "never throws". If the parser has a bug, the caller
    // still gets a finding rather than a stack trace out of a validator.
    push(
      findings,
      'internal.unexpected_error',
      LEVELS.ERROR,
      'input',
      'input',
      error && error.message ? String(error.message) : String(error),
      'a check that completes',
      'The sanity check itself failed; treat the string as unverified rather than sound.',
    );
    return settle();
  }
}

module.exports = { checkTcString, LEVELS };
