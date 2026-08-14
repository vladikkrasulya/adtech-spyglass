'use strict';

/**
 * tests/unknown-fields.test.js — packages/core/unknown-fields.js
 *
 * The module answers "which keys will the receiver silently ignore, and does
 * any of them look like it was meant to be a real field?". Two properties
 * matter more than the rest and are pinned hardest here:
 *
 *   1. A well-formed request produces ZERO findings. A detector of silent
 *      failures that cries wolf gets switched off, and then the real defect is
 *      silent again. Every clean-payload assertion below is a regression guard
 *      on a registry entry someone might forget to add.
 *   2. `ext` is never reported, at any depth. It is the extension surface by
 *      specification; unlabelled vendor extensions are already handled, as
 *      non-blocking questions, by rules/dialects-questions.
 *
 * Privacy: every payload here is synthetic — reserved example domains, made-up
 * ids, no partner-supplied capture.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findUnknownFields,
  damerauLevenshtein,
  similarity,
  MAX_SIBLING_DISTANCE,
  MIN_SIBLING_SIMILARITY,
  MAX_SPEC_DISTANCE,
  MIN_SPEC_SIMILARITY,
} = require('@ortbtools/core/unknown-fields');

/** @typedef {import('@ortbtools/core/unknown-fields').UnknownFieldFinding} UnknownFieldFinding */

/**
 * @param {UnknownFieldFinding[]} findings
 * @param {string} path
 * @returns {UnknownFieldFinding|null}
 */
function at(findings, path) {
  return findings.find((f) => f.path === path) || null;
}

/** @param {UnknownFieldFinding[]} findings */
function paths(findings) {
  return findings.map((f) => f.path);
}

// A fully-populated, well-formed 2.6 BidRequest. Deliberately wide: it touches
// Imp, Banner, Format, Video, Audio, Native, Pmp, Deal, Site, Publisher,
// Content, Producer, Device, Geo, UserAgent, BrandVersion, User, Data, Segment,
// Eid, Uid, Source, SupplyChain, SupplyChainNode and Regs in one payload.
const CLEAN_REQUEST_26 = {
  id: 'req-0001',
  at: 2,
  tmax: 120,
  cur: ['USD'],
  bcat: ['IAB25'],
  badv: ['blocked.example'],
  test: 0,
  imp: [
    {
      id: '1',
      tagid: 'slot-a',
      bidfloor: 0.5,
      bidfloorcur: 'USD',
      secure: 1,
      instl: 0,
      rwdd: 1,
      banner: {
        w: 300,
        h: 250,
        pos: 1,
        battr: [1, 3],
        format: [
          { w: 300, h: 250 },
          { w: 320, h: 50 },
        ],
      },
      pmp: {
        private_auction: 1,
        deals: [{ id: 'deal-1', bidfloor: 1.5, bidfloorcur: 'USD', at: 3 }],
      },
    },
    {
      id: '2',
      video: {
        mimes: ['video/mp4'],
        minduration: 5,
        maxduration: 30,
        protocols: [2, 3, 5, 6],
        plcmt: 1,
        w: 640,
        h: 480,
        startdelay: 0,
        playbackmethod: [1],
        companionad: [{ w: 300, h: 250 }],
        companiontype: [1, 2],
      },
    },
    {
      id: '3',
      audio: { mimes: ['audio/mp4'], minduration: 10, maxduration: 60, protocols: [9] },
    },
    {
      id: '4',
      native: { request: '{"native":{"ver":"1.2","assets":[]}}', ver: '1.2' },
    },
  ],
  site: {
    id: 'site-1',
    domain: 'publisher.example',
    page: 'https://publisher.example/article',
    cattax: 6,
    cat: ['IAB1'],
    publisher: { id: 'pub-1', name: 'Publisher', domain: 'publisher.example' },
    content: {
      id: 'content-1',
      title: 'Episode',
      language: 'en',
      producer: { id: 'prod-1', name: 'Producer' },
      network: { id: 'net-1', name: 'Network' },
      channel: { id: 'chan-1', name: 'Channel' },
      data: [{ id: 'seg-provider', name: 'Provider', segment: [{ id: 's1', value: 'v1' }] }],
    },
  },
  device: {
    ua: 'Mozilla/5.0 Test',
    ip: '192.0.2.10',
    devicetype: 2,
    os: 'Windows',
    language: 'en',
    geo: { country: 'USA', type: 2, lat: 1.5, lon: 2.5 },
    sua: {
      browsers: [{ brand: 'Test Browser', version: ['1', '0'] }],
      platform: { brand: 'Windows', version: ['10'] },
      mobile: 0,
      source: 2,
    },
  },
  user: {
    id: 'user-1',
    buyeruid: 'buyer-1',
    consent: 'SYNTHETIC-TC-STRING',
    data: [{ id: 'dp-1', segment: [{ id: 's2', name: 'age', value: '25' }] }],
    eids: [{ source: 'idprovider.example', uids: [{ id: 'uid-1', atype: 3 }] }],
  },
  source: {
    fd: 1,
    tid: 'txn-1',
    schain: {
      complete: 1,
      ver: '1.0',
      nodes: [{ asi: 'exchange.example', sid: 'seller-1', hp: 1, rid: 'req-0001' }],
    },
  },
  regs: { coppa: 0, gdpr: 1, gpp: 'SYNTHETIC-GPP', gpp_sid: [2] },
};

// ── The measured defect ─────────────────────────────────────────────────────

// docs/silent-failures-research-2026-08-13.md §3.3, verbatim.
const MEASURED_DEFECT = {
  imp: [{ video: { protcols: [2, 3], mimes: ['video/mp4'] } }],
  bidfloorcurr: 'USD',
};

test('measured defect: protcols and bidfloorcurr are both named, with the right fix', () => {
  const findings = findUnknownFields(MEASURED_DEFECT);
  assert.deepEqual(paths(findings).sort(), ['bidfloorcurr', 'imp[0].video.protcols']);

  const protcols = at(findings, 'imp[0].video.protcols');
  assert.equal(protcols.field, 'protcols');
  assert.equal(protcols.object, 'Video');
  assert.equal(protcols.reason, 'likely_typo');
  assert.equal(protcols.suggestion, 'protocols');
  assert.deepEqual(protcols.candidates, ['protocols']);
  assert.equal(protcols.distance, 1);
  assert.ok(protcols.confidence > 0.85, `confidence ${protcols.confidence}`);

  const cur = at(findings, 'bidfloorcurr');
  assert.equal(cur.object, 'BidRequest');
  assert.equal(cur.reason, 'likely_typo');
  assert.equal(cur.suggestion, 'bidfloorcur');
  assert.equal(cur.distance, 1);
  // The measured payload puts the typo at BidRequest level, where the field it
  // was meant to be does not live at all — so the match comes from the
  // spec-wide pass and the finding says where the real field belongs.
  assert.equal(cur.suggestionScope, 'spec');
  assert.deepEqual(cur.knownOn, ['Deal', 'Imp']);
});

test('same typo one level down matches a sibling instead of the whole spec', () => {
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', bidfloor: 1.2, bidfloorcurr: 'USD' }],
  });
  const cur = at(findings, 'imp[0].bidfloorcurr');
  assert.equal(cur.suggestion, 'bidfloorcur');
  assert.equal(cur.suggestionScope, 'sibling');
  assert.equal(cur.object, 'Imp');
});

// ── No false positives ──────────────────────────────────────────────────────

test('clean 2.6 request: zero findings', () => {
  assert.deepEqual(findUnknownFields(CLEAN_REQUEST_26), []);
});

test('clean 2.6 request: still zero when the version is stated explicitly', () => {
  assert.deepEqual(findUnknownFields(CLEAN_REQUEST_26, { kind: 'request', version: '2.6' }), []);
});

test('clean 2.5 request: 2.5-era fields are not reported as unknown', () => {
  // Everything here predates 2.6, including the four Banner size fields
  // deprecated back in 2.4 that long-lived integrations still send.
  const request = {
    id: 'req-25',
    imp: [
      {
        id: '1',
        banner: { w: 300, h: 250, wmin: 200, wmax: 320, hmin: 50, hmax: 250, btype: [1] },
        video: { mimes: ['video/mp4'], protocol: 2, placement: 1, boxingallowed: 1 },
        metric: [{ type: 'viewability', value: 0.8, vendor: 'measurement.example' }],
      },
    ],
    app: { id: 'app-1', bundle: 'com.example.app', storeurl: 'https://store.example/app' },
    user: { id: 'u', yob: 1990, gender: 'M', customdata: 'x' },
    device: { ua: 'Mozilla/5.0 Test', dnt: 0, lmt: 0, ifa: '00000000-0000-0000-0000-000000000000' },
    source: { fd: 0, pchain: 'synthetic' },
    regs: { coppa: 0 },
  };
  assert.deepEqual(findUnknownFields(request), []);
});

test('clean BidResponse: zero findings', () => {
  const response = {
    id: 'req-0001',
    bidid: 'resp-1',
    cur: 'USD',
    seatbid: [
      {
        seat: 'dsp-1',
        group: 0,
        bid: [
          {
            id: 'bid-1',
            impid: '1',
            price: 1.25,
            adid: 'creative-1',
            adm: '<div>synthetic</div>',
            adomain: ['advertiser.example'],
            crid: 'crid-1',
            cid: 'cid-1',
            w: 300,
            h: 250,
            mtype: 1,
            attr: [1],
            exp: 300,
          },
        ],
      },
    ],
  };
  assert.deepEqual(findUnknownFields(response), []);
});

// ── ext is the extension surface, at every depth ────────────────────────────

test('ext: unknown keys anywhere inside it produce no findings', () => {
  const request = {
    id: 'r',
    ext: { vendorFlag: 1, nested: { deeper: { anything: 'goes' } } },
    imp: [
      {
        id: '1',
        ext: { allowMT: true, sizeID: [0], gpid: '/1234/slot' },
        banner: { w: 1, h: 1, ext: { vendorSize: 'pop' } },
        video: { mimes: ['video/mp4'], ext: { vendorMode: 'x' } },
      },
    ],
    // The pre-2.6 homes for schain / consent / eids all live under ext, and
    // their whole subtree has to stay silent too.
    source: { ext: { schain: { complete: 1, nodes: [{ asi: 'a.example', sid: 's', hp: 1 }] } } },
    user: { ext: { consent: 'SYNTHETIC', eids: [{ source: 's', uids: [{ id: 'u' }] }] } },
    regs: { ext: { gdpr: 1, us_privacy: '1YNN' } },
    site: { content: { ext: { anythingAtAll: true } } },
  };
  assert.deepEqual(findUnknownFields(request), []);
});

test('ext: a typo in a core field is still caught in a payload full of ext', () => {
  const findings = findUnknownFields({
    id: 'r',
    ext: { vendorFlag: 1 },
    imp: [{ id: '1', ext: { gpid: 'x' }, video: { mimes: ['video/mp4'], protcols: [2] } }],
  });
  assert.deepEqual(paths(findings), ['imp[0].video.protcols']);
});

// ── Signal strength: the four reasons look different ────────────────────────

test('alien name: reported, but with no suggestion and zero confidence', () => {
  const findings = findUnknownFields({ id: 'r', imp: [{ id: '1', qwertyzxcv: 42 }] });
  const alien = at(findings, 'imp[0].qwertyzxcv');
  assert.equal(alien.reason, 'unrecognized');
  assert.equal(alien.suggestion, null);
  assert.deepEqual(alien.candidates, []);
  assert.equal(alien.suggestionScope, null);
  assert.equal(alien.distance, null);
  assert.equal(alien.confidence, 0);
});

test('short alien name: no suggestion, because a short name carries no evidence', () => {
  // `zz` is one edit from nothing useful; `ca` is one edit from `cat`, which
  // the similarity floor rejects at 0.67. Both must stay suggestion-free.
  for (const key of ['zz', 'ca']) {
    const findings = findUnknownFields({ id: 'r', imp: [{ id: '1', [key]: 1 }] });
    assert.equal(findings.length, 1, key);
    assert.equal(findings[0].suggestion, null, key);
    assert.equal(findings[0].reason, 'unrecognized', key);
  }
});

test('real field in the wrong object is known_elsewhere, not a typo', () => {
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', banner: { w: 300, h: 250, bundle: 'com.example.app' } }],
  });
  const misplaced = at(findings, 'imp[0].banner.bundle');
  assert.equal(misplaced.reason, 'known_elsewhere');
  assert.equal(misplaced.distance, 0);
  assert.equal(misplaced.suggestion, null);
  assert.deepEqual(misplaced.knownOn, ['App', 'Bid']);
});

test('a tie is reported as a tie — never resolved by coin flip', () => {
  // `mixbitrate` is one edit from minbitrate and one from maxbitrate. Naming
  // either would be a guess about a min/max inversion.
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', video: { mimes: ['video/mp4'], mixbitrate: 500 } }],
  });
  const tie = at(findings, 'imp[0].video.mixbitrate');
  assert.equal(tie.reason, 'likely_typo');
  assert.equal(tie.suggestion, null);
  assert.deepEqual(tie.candidates, ['maxbitrate', 'minbitrate']);
  assert.equal(tie.confidence, 0);
});

test('camelCase spellings of real fields are caught, with the lowercase fix', () => {
  // The single most common real-world source of this defect: a Prebid-side
  // object serialized straight onto the wire.
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', bidFloor: 1, bidFloorCur: 'USD', tagId: 'slot' }],
  });
  assert.deepEqual(
    findings.map((f) => [f.field, f.suggestion]),
    [
      ['bidFloor', 'bidfloor'],
      ['bidFloorCur', 'bidfloorcur'],
      ['tagId', 'tagid'],
    ],
  );
});

// ── Version mismatch is not a typo ──────────────────────────────────────────

test('2.5-only field on a confirmed 2.6 payload is a version mismatch', () => {
  // imp[].rwdd is one of detect.js's hard 2.6 markers, so the version is known
  // rather than guessed. video.protocol was removed in 2.6 — see
  // migrate/rules.js, ortb26.video.protocols.
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', rwdd: 1, video: { mimes: ['video/mp4'], protocol: 2 } }],
  });
  const mismatch = at(findings, 'imp[0].video.protocol');
  assert.equal(mismatch.reason, 'version_mismatch');
  assert.deepEqual(mismatch.knownIn, ['2.5']);
  assert.equal(mismatch.suggestion, 'protocols');
});

test('version mismatch without a near replacement carries no suggestion', () => {
  // content.videoquality was replaced by prodq, which is nowhere near it by
  // edit distance. The 2.5→2.6 rewrite belongs to migrate/, not here.
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', rwdd: 1 }],
    site: { content: { videoquality: 1 } },
  });
  const mismatch = at(findings, 'site.content.videoquality');
  assert.equal(mismatch.reason, 'version_mismatch');
  assert.deepEqual(mismatch.knownIn, ['2.5']);
  assert.equal(mismatch.suggestion, null);
});

test('a guessed version never produces a version finding', () => {
  // No 2.6 marker anywhere, so detectVersion answers 2.5 at low confidence —
  // which cannot exclude 2.6, since 2.6 is a superset. Silence is the only
  // honest answer.
  const payload = { id: 'r', imp: [{ id: '1', video: { mimes: ['video/mp4'], protocol: 2 } }] };
  assert.deepEqual(findUnknownFields(payload), []);
  // The caller who actually knows the version gets the finding.
  const stated = findUnknownFields(payload, { version: '2.6' });
  assert.equal(stated.length, 1);
  assert.equal(stated[0].reason, 'version_mismatch');
});

// ── Traversal: depth, arrays, holes ─────────────────────────────────────────

test('deep nesting: the path names every step down to the key', () => {
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1' }],
    site: {
      content: {
        producer: { namee: 'Producer' },
        data: [{ id: 'd', segment: [{ id: 's', valu: 'x' }] }],
      },
    },
    device: { geo: { countrie: 'USA' } },
    user: { eids: [{ source: 's', uids: [{ id: 'u', atyp: 3 }] }] },
  });
  assert.deepEqual(paths(findings).sort(), [
    'device.geo.countrie',
    'site.content.data[0].segment[0].valu',
    'site.content.producer.namee',
    'user.eids[0].uids[0].atyp',
  ]);
  assert.equal(at(findings, 'site.content.producer.namee').suggestion, 'name');
  assert.equal(at(findings, 'device.geo.countrie').suggestion, 'country');
});

test('arrays: every element is indexed, and only the bad ones are reported', () => {
  const findings = findUnknownFields({
    id: 'r',
    imp: [
      {
        id: '1',
        banner: {
          format: [
            { w: 300, h: 250 },
            { w: 320, h: 50, wratioo: 1 },
          ],
        },
      },
      { id: '2', bidfloor: 1 },
      { id: '3', pmp: { deals: [{ id: 'd1' }, { id: 'd2', bidfloorcurr: 'EUR' }] } },
    ],
  });
  assert.deepEqual(paths(findings), [
    'imp[0].banner.format[1].wratioo',
    'imp[2].pmp.deals[1].bidfloorcurr',
  ]);
  assert.equal(at(findings, 'imp[2].pmp.deals[1].bidfloorcurr').suggestion, 'bidfloorcur');
});

test('the same typo in several imps is reported once per imp, with its own path', () => {
  const findings = findUnknownFields({
    id: 'r',
    imp: [
      { id: '1', video: { protcols: [2] } },
      { id: '2', video: { protcols: [3] } },
    ],
  });
  assert.deepEqual(paths(findings), ['imp[0].video.protcols', 'imp[1].video.protcols']);
});

test('null values and empty objects: no crash, no invented findings', () => {
  const findings = findUnknownFields({
    id: 'r',
    site: null,
    device: {},
    user: { geo: null, data: [] },
    imp: [{ id: '1', banner: null, video: {}, pmp: { deals: null } }],
  });
  assert.deepEqual(findings, []);
});

test('a null-valued unknown key is still reported — the key is what gets dropped', () => {
  const findings = findUnknownFields({ id: 'r', imp: [{ id: '1', protcols: null }] });
  assert.deepEqual(paths(findings), ['imp[0].protcols']);
  assert.equal(findings[0].suggestion, 'protocols');
});

test('an unknown key is reported but never entered', () => {
  // We have no schema for a key we do not recognise, so its children cannot be
  // judged. One finding for the defect, not one per node underneath it.
  const findings = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', vidoe: { mimes: ['video/mp4'], zzz: 1, deeper: { alsoZzz: 2 } } }],
  });
  assert.deepEqual(paths(findings), ['imp[0].vidoe']);
  assert.equal(findings[0].suggestion, 'video');
});

test('native.request keeps its own vocabulary out of scope', () => {
  // Native Ad Request is a separate specification with separate field names.
  // It is not a declared child, whether it arrives as the spec-mandated string
  // or as the object some integrations send instead.
  const asString = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', native: { ver: '1.2', request: '{"native":{"assets":[{"id":1}]}}' } }],
  });
  const asObject = findUnknownFields({
    id: 'r',
    imp: [{ id: '1', native: { ver: '1.2', request: { assets: [{ id: 1, titel: {} }] } } }],
  });
  assert.deepEqual(asString, []);
  assert.deepEqual(asObject, []);
});

// ── Inputs the module refuses to judge ──────────────────────────────────────

test('non-objects and unrecognised payload types return no findings', () => {
  assert.deepEqual(findUnknownFields(null), []);
  assert.deepEqual(findUnknownFields(undefined), []);
  assert.deepEqual(findUnknownFields('a string'), []);
  assert.deepEqual(findUnknownFields(42), []);
  assert.deepEqual(findUnknownFields([{ id: '1' }]), []);
  assert.deepEqual(findUnknownFields({}), []);
  // A vendor feed response has a different vocabulary entirely.
  assert.deepEqual(findUnknownFields({ result: { status: 'BID', listing: { price: 1 } } }), []);
});

test('OpenRTB 3.0 gets silence, not a flood: there is no 3.0 registry here', () => {
  const envelope = {
    openrtb: { ver: '3.0', request: { id: 'r', item: [{ id: '1', flrr: 1 }] } },
  };
  assert.deepEqual(findUnknownFields(envelope), []);
  assert.deepEqual(
    findUnknownFields({ id: 'r', imp: [{ id: '1', zz: 1 }] }, { version: '3.0' }),
    [],
  );
});

test('kind override walks the requested registry regardless of detection', () => {
  const asResponse = findUnknownFields(
    { id: 'x', seat: 'dsp', adomains: ['a.example'] },
    {
      kind: 'response',
    },
  );
  assert.deepEqual(paths(asResponse).sort(), ['adomains', 'seat']);
  assert.equal(at(asResponse, 'adomains').suggestion, 'adomain');
  // An unknown kind is not a licence to guess.
  assert.deepEqual(findUnknownFields(CLEAN_REQUEST_26, { kind: 'vast' }), []);
});

// ── The similarity metric itself ────────────────────────────────────────────

test('damerauLevenshtein: the four single-character errors all cost 1', () => {
  assert.equal(damerauLevenshtein('protocols', 'protcols'), 1, 'deletion');
  assert.equal(damerauLevenshtein('bidfloorcur', 'bidfloorcurr'), 1, 'insertion');
  assert.equal(damerauLevenshtein('bidfloor', 'bidflooe'), 1, 'substitution');
  // Transposition of two adjacent characters — the case plain Levenshtein
  // charges 2 for and Damerau-Levenshtein charges 1.
  assert.equal(damerauLevenshtein('protocols', 'rpotocols'), 1, 'transposition');
  assert.equal(damerauLevenshtein('mimes', 'mimse'), 1, 'transposition');
});

test('damerauLevenshtein: identity, empty strings, symmetry', () => {
  assert.equal(damerauLevenshtein('bidfloor', 'bidfloor'), 0);
  assert.equal(damerauLevenshtein('', ''), 0);
  assert.equal(damerauLevenshtein('', 'imp'), 3);
  assert.equal(damerauLevenshtein('imp', ''), 3);
  assert.equal(damerauLevenshtein('protcols', 'mimes'), damerauLevenshtein('mimes', 'protcols'));
});

test('damerauLevenshtein: the ceiling bounds the answer, not just the work', () => {
  assert.equal(damerauLevenshtein('bidfloorcur', 'mimes', 2), 3, 'over the ceiling → ceiling + 1');
  assert.equal(damerauLevenshtein('protcols', 'protocols', 2), 1, 'under the ceiling → exact');
  assert.equal(damerauLevenshtein('w', 'bidfloorcur', 1), 2, 'length gap alone exceeds it');
});

test('similarity: normalised by the longer name, which is why the gate is length-aware', () => {
  assert.equal(similarity('protcols', 'protocols', 1), 1 - 1 / 9);
  assert.equal(similarity('bidfloorcurr', 'bidfloorcur', 1), 1 - 1 / 12);
  assert.equal(similarity('cat', 'car', 1), 1 - 1 / 3);
  assert.equal(similarity('w', 'h', 1), 0);
  assert.equal(similarity('', '', 0), 0);
});

test('thresholds: both measured defects clear their gate, short coincidences do not', () => {
  assert.ok(similarity('protcols', 'protocols', 1) >= MIN_SIBLING_SIMILARITY);
  assert.ok(similarity('bidfloorcurr', 'bidfloorcur', 1) >= MIN_SPEC_SIMILARITY);
  assert.ok(similarity('cat', 'car', 1) < MIN_SIBLING_SIMILARITY);
  assert.ok(similarity('id', 'ud', 1) < MIN_SIBLING_SIMILARITY);
  // The two-edit budget is self-limiting: 2/maxLength <= 0.25 means a name of
  // at least 8 characters, so the length rule falls out of the similarity rule
  // instead of being a second constant nobody can justify.
  const shortestTwoEditName = Math.ceil(MAX_SIBLING_DISTANCE / (1 - MIN_SIBLING_SIMILARITY));
  assert.equal(shortestTwoEditName, 8);
  assert.equal(Math.ceil(MAX_SPEC_DISTANCE / (1 - MIN_SPEC_SIMILARITY)), 7);
});
