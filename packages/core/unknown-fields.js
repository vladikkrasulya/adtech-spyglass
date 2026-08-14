'use strict';

/**
 * unknown-fields.js — name the fields an OpenRTB receiver will silently drop.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 *   {"imp":[{"video":{"protcols":[2,3],"mimes":["video/mp4"]}}],"bidfloorcurr":"USD"}
 *                      ^^^^^^^^                                 ^^^^^^^^^^^^
 *   effective protocols: undefined            effective bidfloorcur: undefined
 *
 * `protcols` is not `protocols`; `bidfloorcurr` is not `bidfloorcur`. OpenRTB's
 * forward-compatibility rule tells a receiver to ignore fields it does not
 * recognise, so that an old receiver does not break on a newer sender. The
 * consequence is that a typo is indistinguishable from a harmless future field:
 * the value never applies, and no schema validator has grounds to complain. The
 * bid goes out with no floor currency and no protocol list, and everything
 * downstream reports success.
 *
 * This module answers one question — "which keys in this payload is the
 * receiver going to ignore, and does any of them look like it was meant to be
 * a real field?"
 *
 * ── WHY THIS IS MOSTLY A NOISE-CONTROL PROBLEM ──────────────────────────────
 *
 * Reporting every unrecognised key is trivial and useless: real bid streams are
 * full of legitimate keys that are not in the IAB spec. Four rules keep the
 * output worth reading.
 *
 *  1. `ext` is never inspected — not the key, not one level of its subtree.
 *     `ext` IS the extension surface (oRTB 2.6 §3.1); a vendor key there is
 *     correct by construction. Unlabelled vendor extensions already have their
 *     own, deliberately non-blocking treatment in
 *     `rules/dialects-questions/index.js`, which emits `level:'question'`
 *     findings asking the operator which dialect they belong to. Warning about
 *     the same keys here would be both wrong and a second opinion on one fact.
 *
 *  2. We only judge keys inside objects whose schema we actually know. The
 *     walk descends exclusively along declared child paths (`imp[] → Imp`,
 *     `imp[].video → Video`, …). An unknown key is reported but never entered:
 *     we have no schema for its children, so its children cannot be wrong.
 *     `native.request` — a string carrying a whole separate Native Ad spec —
 *     and `bid.adm` are likewise opaque on purpose.
 *
 *  3. Signals of different strength come out looking different. See `reason`
 *     in the finding shape below: an exact spec name in the wrong place, a
 *     one-character miss, and a name that resembles nothing are three
 *     different claims and are labelled as three different claims.
 *
 *  4. A field that belongs to a DIFFERENT OpenRTB version is not a typo. It is
 *     a version mismatch, it is reported as one, and — see VERSION POSTURE —
 *     it is only reported when the version is known rather than guessed.
 *
 * ── WHERE THE REGISTRY COMES FROM ───────────────────────────────────────────
 *
 * The repo had no field registry to reuse. What it does have, and what is
 * reused here rather than restated:
 *
 *   - `detect.js` SIGNALS_2_6 — the repo's existing list of fields that mark a
 *     payload as 2.6. Every one of them is marked V26 below.
 *   - `migrate/rules.js` — the 2.5→2.6 migration table, which anchors
 *     `video.protocol` and `content.videoquality` as removed in 2.6, and
 *     `regs.gdpr` / `user.consent` / `user.eids` / `source.schain` /
 *     `content.prodq` as promoted into 2.6.
 *   - `detect.js` detectType/detectVersion — payload kind and version, so this
 *     module does not invent a second opinion on either axis.
 *
 * The object/field tables themselves are hand-entered from the IAB OpenRTB 2.5
 * and 2.6 object definitions. They are NOT machine-generated and are NOT
 * guaranteed complete; a missing field name produces a false positive, which is
 * the failure mode this module can least afford. Two deliberate consequences:
 *
 *   - Where a field's version boundary is not anchored in existing repo code,
 *     it is recorded as ALL (valid everywhere) rather than guessed. Being
 *     version-agnostic costs a missed signal; guessing wrong costs a false one.
 *   - OpenRTB 3.0 / AdCOM uses entirely different names (`item`, `spec`, `flr`,
 *     `flrcur`, …). There is no 3.0 registry here, so a 3.0 payload returns no
 *     findings at all rather than a flood of wrong ones.
 *
 * What this module does NOT do is propose the 2.5→2.6 rewrite. Naming
 * `content.videoquality` as a removed field is this module's job; knowing that
 * its value belongs in `prodq` is `migrate/rules.js`'s, and duplicating that
 * table here would create a second copy to drift.
 *
 * Sanity check over the repo's own 57 synthetic JSON specimens (`samples/`,
 * `tests/fixtures/`, `knowledge_base/`): 21 findings, of which 19 are the
 * `_note` / `_comment` annotation keys the fixture authors wrote inside the
 * payload and 2 are the invented `minadlen` / `maxadlen` in
 * `samples/synthetic-adpod-malformed.json` — a true positive. Not one real
 * oRTB field name was flagged anywhere in the corpus. Annotation keys land in
 * `unrecognized`, the weakest of the four claims, which is the right
 * disposition: a receiver really does drop them, and a caller that wants to
 * hide editorial noise can rank or filter on `reason` without losing the
 * strong signals.
 *
 * ── VERSION POSTURE ─────────────────────────────────────────────────────────
 *
 * OpenRTB is additive, so "2.6 field on a 2.5 request" is usually harmless and
 * always ambiguous — a 2.5-looking payload may simply be a 2.6 payload with no
 * 2.6-only field populated, which is exactly what `detectVersion` says when it
 * returns 2.5 at confidence 0.7 or 0.3. So the version axis is used ONLY when
 * it is certain: an auto-detected version is accepted at confidence 1 (a hard
 * 2.6 marker was seen) and otherwise discarded, in which case every field known
 * in ANY supported version counts as known and no version finding can fire. A
 * caller that knows the version for real — from the X-Openrtb-Version header,
 * say — can pass it in and get the full signal.
 *
 * ── SIMILARITY: WHY DAMERAU-LEVENSHTEIN, WHY THESE THRESHOLDS ───────────────
 *
 * Plain Levenshtein cannot see a swap of two adjacent characters, which is one
 * of the four classical typing errors and the one that leaves a name looking
 * most nearly right (`porotcols`). Damerau's 1964 study of keyed input found
 * that single insertion, deletion, substitution and transposition together
 * account for the large majority of human spelling errors — the two measured
 * defects are one deletion (`protcols`) and one insertion (`bidfloorcurr`).
 * `damerauLevenshtein()` below is the optimal-string-alignment variant, which
 * differs from unrestricted Damerau-Levenshtein only when an already-transposed
 * pair is edited again — impossible inside the 2-edit budget used here.
 *
 * Raw edit distance is the wrong gate on its own: distance 1 is decisive on
 * `bidfloorcurr` (12 chars) and meaningless on `w` (1 char, distance 1 from
 * `h`). The gate is therefore normalised similarity, `1 - distance/maxLength`:
 *
 *   sibling scope   distance <= 2  AND  similarity >= 0.75
 *   spec-wide scope distance <= 1  AND  similarity >= 0.85
 *
 * The 0.75 sibling floor is what makes distance 2 self-limiting: 2/maxLength
 * <= 0.25 requires a name of at least 8 characters, so the two-edit budget is
 * only ever spent on names long enough to carry that much evidence, and the
 * length rule falls out of the similarity rule instead of being a second
 * constant. It admits both measured defects (0.89 and 0.92) and rejects the
 * short-name coincidences that make this kind of check unusable — `cat`/`car`
 * scores 0.67, `id`/`ud` scores 0.5, any single character scores 0.
 *
 * The spec-wide scope is stricter because it searches 252 distinct names
 * instead of the ~20 in one object, so a chance neighbour is far likelier;
 * distance 1 at 0.85 needs a name of at least 7 characters. `bidfloorcurr` →
 * `bidfloorcur` clears it at 0.92, which is the point: the measured payload
 * puts that typo at BidRequest level, where the correct field does not live.
 *
 * Ambiguity is never resolved by picking one. If two known names tie at the
 * best distance the finding carries both in `candidates` and no `suggestion` —
 * `mixbitrate` is one edit from `minbitrate` and one from `maxbitrate`, and
 * naming either one would be a coin flip on a semantic inversion.
 *
 * ── CONTRACT ────────────────────────────────────────────────────────────────
 *
 * Pure, stateless, no I/O, no findings-factory. Findings are returned as plain
 * objects rather than through `makeFinding()` deliberately: a `makeFinding` id
 * is a repo-wide contract that requires a `spec-refs.json` entry and localized
 * text in `messages/*.json` before it may exist. Wiring these results into the
 * validator's finding stream is a separate step with those obligations.
 */

const { detectType, detectVersion, TYPES, VERSIONS } = require('./detect');

/** Field is valid in every OpenRTB 2.x version this module knows. */
const ALL = '*';
/** Field exists in 2.5 and was removed in 2.6. */
const V25 = '2.5';
/** Field was introduced in 2.6. */
const V26 = '2.6';

/** The one key whose subtree is never inspected. oRTB 2.6 §3.1. */
const EXT_KEY = 'ext';

const MAX_SIBLING_DISTANCE = 2;
const MIN_SIBLING_SIMILARITY = 0.75;
const MAX_SPEC_DISTANCE = 1;
const MIN_SPEC_SIMILARITY = 0.85;

/**
 * @typedef {object} OrtbObjectSchema
 * @property {Record<string, string>} fields  field name → ALL | V25 | V26
 * @property {Record<string, string>} children  field name → schema object name
 */

/**
 * The registry. `fields` lists every name the object may legally carry;
 * `children` lists the subset whose value is another registered object (arrays
 * of them included — the walker handles both shapes so a schema does not have
 * to declare arity).
 *
 * A name absent from `children` is opaque even when its value is an object.
 * That is how `native.request` (a nested Native Ad Request with its own
 * vocabulary) and `bid.adm` stay out of scope.
 *
 * @type {Record<string, OrtbObjectSchema>}
 */
const SCHEMA = {
  // ── Request ───────────────────────────────────────────────────────────────
  BidRequest: {
    fields: {
      id: ALL,
      imp: ALL,
      site: ALL,
      app: ALL,
      dooh: V26, // detect.js SIGNALS_2_6: 'dooh'
      device: ALL,
      user: ALL,
      test: ALL,
      at: ALL,
      tmax: ALL,
      wseat: ALL,
      bseat: ALL,
      allimps: ALL,
      cur: ALL,
      wlang: ALL,
      wlangb: ALL,
      acat: V26, // detect.js SIGNALS_2_6: 'acat'
      bcat: ALL,
      cattax: ALL,
      badv: ALL,
      bapp: ALL,
      source: ALL,
      regs: ALL,
      ext: ALL,
    },
    children: {
      imp: 'Imp',
      site: 'Site',
      app: 'App',
      dooh: 'Dooh',
      device: 'Device',
      user: 'User',
      source: 'Source',
      regs: 'Regs',
    },
  },

  Source: {
    fields: { fd: ALL, tid: ALL, pchain: ALL, schain: V26, ext: ALL },
    children: { schain: 'SupplyChain' },
  },

  Regs: {
    fields: {
      coppa: ALL,
      gdpr: V26, // migrate/rules.js: ortb26.regs.gdpr
      us_privacy: ALL,
      gpp: V26, // detect.js SIGNALS_2_6: 'regs.gpp'
      gpp_sid: V26, // detect.js SIGNALS_2_6: 'regs.gpp_sid'
      ext: ALL,
    },
    children: {},
  },

  Imp: {
    fields: {
      id: ALL,
      metric: ALL,
      banner: ALL,
      video: ALL,
      audio: ALL,
      native: ALL,
      pmp: ALL,
      displaymanager: ALL,
      displaymanagerver: ALL,
      instl: ALL,
      tagid: ALL,
      bidfloor: ALL,
      bidfloorcur: ALL,
      clickbrowser: ALL,
      secure: ALL,
      iframebuster: ALL,
      exp: ALL,
      qty: V26, // detect.js SIGNALS_2_6: 'imp[].qty'
      dt: ALL,
      refresh: V26, // detect.js SIGNALS_2_6: 'imp[].refresh'
      rwdd: V26, // detect.js SIGNALS_2_6 + migrate/rules.js: ortb26.imp.rwdd
      ssai: V26, // detect.js SIGNALS_2_6: 'imp[].ssai'
      ext: ALL,
    },
    children: {
      metric: 'Metric',
      banner: 'Banner',
      video: 'Video',
      audio: 'Audio',
      native: 'Native',
      pmp: 'Pmp',
      qty: 'Qty',
      refresh: 'Refresh',
    },
  },

  Metric: {
    fields: { type: ALL, value: ALL, vendor: ALL, ext: ALL },
    children: {},
  },

  Qty: {
    fields: { multiplier: ALL, sourcetype: ALL, vendor: ALL, ext: ALL },
    children: {},
  },

  Refresh: {
    fields: { refsettings: ALL, count: ALL, ext: ALL },
    children: { refsettings: 'RefSettings' },
  },

  RefSettings: {
    fields: { reftype: ALL, minint: ALL, ext: ALL },
    children: {},
  },

  Banner: {
    fields: {
      format: ALL,
      w: ALL,
      h: ALL,
      // Deprecated in 2.4, still sent by long-lived integrations. Listed so
      // they read as legacy rather than as unknown.
      wmax: ALL,
      hmax: ALL,
      wmin: ALL,
      hmin: ALL,
      btype: ALL,
      battr: ALL,
      pos: ALL,
      mimes: ALL,
      topframe: ALL,
      expdir: ALL,
      api: ALL,
      id: ALL,
      vcm: ALL,
      ext: ALL,
    },
    children: { format: 'Format' },
  },

  Format: {
    fields: { w: ALL, h: ALL, wratio: ALL, hratio: ALL, wmin: ALL, ext: ALL },
    children: {},
  },

  Video: {
    fields: {
      mimes: ALL,
      minduration: ALL,
      maxduration: ALL,
      startdelay: ALL,
      maxseq: ALL,
      poddur: ALL,
      protocols: ALL,
      protocol: V25, // migrate/rules.js: ortb26.video.protocols removes it
      w: ALL,
      h: ALL,
      podid: ALL,
      podseq: ALL,
      rqddurs: ALL,
      placement: ALL,
      plcmt: V26, // detect.js SIGNALS_2_6: 'imp[].video.plcmt'
      linearity: ALL,
      skip: ALL,
      skipmin: ALL,
      skipafter: ALL,
      sequence: ALL,
      slotinpod: ALL,
      mincpmpersec: ALL,
      battr: ALL,
      maxextended: ALL,
      minbitrate: ALL,
      maxbitrate: ALL,
      boxingallowed: ALL,
      playbackmethod: ALL,
      playbackend: ALL,
      delivery: ALL,
      pos: ALL,
      companionad: ALL,
      api: ALL,
      companiontype: ALL,
      poddedupe: V26, // detect.js SIGNALS_2_6: 'imp[].video.poddedupe'
      durfloors: ALL,
      ext: ALL,
    },
    children: { companionad: 'Banner', durfloors: 'DurFloors' },
  },

  Audio: {
    fields: {
      mimes: ALL,
      minduration: ALL,
      maxduration: ALL,
      poddur: ALL,
      protocols: ALL,
      startdelay: ALL,
      rqddurs: ALL,
      podid: ALL,
      podseq: ALL,
      sequence: ALL,
      slotinpod: ALL,
      mincpmpersec: ALL,
      battr: ALL,
      maxextended: ALL,
      minbitrate: ALL,
      maxbitrate: ALL,
      delivery: ALL,
      companionad: ALL,
      api: ALL,
      companiontype: ALL,
      maxseq: ALL,
      feed: ALL,
      stitched: ALL,
      nvol: ALL,
      durfloors: ALL,
      ext: ALL,
    },
    children: { companionad: 'Banner', durfloors: 'DurFloors' },
  },

  DurFloors: {
    fields: { mindur: ALL, maxdur: ALL, bidfloor: ALL, ext: ALL },
    children: {},
  },

  // `request` carries the Native Ad Request as a JSON string with a vocabulary
  // of its own. Not a declared child: we do not judge names we do not hold.
  Native: {
    fields: { request: ALL, ver: ALL, api: ALL, battr: ALL, ext: ALL },
    children: {},
  },

  Pmp: {
    fields: { private_auction: ALL, deals: ALL, ext: ALL },
    children: { deals: 'Deal' },
  },

  Deal: {
    fields: {
      id: ALL,
      bidfloor: ALL,
      bidfloorcur: ALL,
      at: ALL,
      wseat: ALL,
      wadomain: ALL,
      guar: ALL,
      mincpmpersec: ALL,
      durfloors: ALL,
      ext: ALL,
    },
    children: { durfloors: 'DurFloors' },
  },

  Site: {
    fields: {
      id: ALL,
      name: ALL,
      domain: ALL,
      cattax: V26, // detect.js SIGNALS_2_6: 'site.cattax'
      cat: ALL,
      sectioncat: ALL,
      pagecat: ALL,
      page: ALL,
      ref: ALL,
      search: ALL,
      mobile: ALL,
      privacypolicy: ALL,
      publisher: ALL,
      content: ALL,
      keywords: ALL,
      kwarray: ALL,
      inventorypartnerdomain: ALL,
      ext: ALL,
    },
    children: { publisher: 'Publisher', content: 'Content' },
  },

  App: {
    fields: {
      id: ALL,
      name: ALL,
      bundle: ALL,
      domain: ALL,
      storeurl: ALL,
      cattax: V26, // detect.js SIGNALS_2_6: 'app.cattax'
      cat: ALL,
      sectioncat: ALL,
      pagecat: ALL,
      ver: ALL,
      privacypolicy: ALL,
      paid: ALL,
      publisher: ALL,
      content: ALL,
      keywords: ALL,
      kwarray: ALL,
      inventorypartnerdomain: ALL,
      ext: ALL,
    },
    children: { publisher: 'Publisher', content: 'Content' },
  },

  Dooh: {
    fields: {
      id: ALL,
      name: ALL,
      venuetype: ALL,
      venuetypetax: ALL,
      publisher: ALL,
      domain: ALL,
      keywords: ALL,
      content: ALL,
      ext: ALL,
    },
    children: { publisher: 'Publisher', content: 'Content' },
  },

  Publisher: {
    fields: {
      id: ALL,
      name: ALL,
      cat: ALL,
      cattax: V26, // detect.js SIGNALS_2_6: 'site.publisher.cattax'
      domain: ALL,
      ext: ALL,
    },
    children: {},
  },

  Content: {
    fields: {
      id: ALL,
      episode: ALL,
      title: ALL,
      series: ALL,
      season: ALL,
      artist: ALL,
      genre: ALL,
      album: ALL,
      isrc: ALL,
      producer: ALL,
      url: ALL,
      cattax: ALL,
      cat: ALL,
      prodq: V26, // migrate/rules.js: ortb26.content.prodq
      videoquality: V25, // migrate/rules.js: removed, replaced by prodq
      context: ALL,
      contentrating: ALL,
      userrating: ALL,
      qagmediarating: ALL,
      keywords: ALL,
      kwarray: ALL,
      livestream: ALL,
      sourcerelationship: ALL,
      len: ALL,
      language: ALL,
      langb: ALL,
      embeddable: ALL,
      data: ALL,
      network: ALL,
      channel: ALL,
      ext: ALL,
    },
    children: {
      producer: 'Producer',
      data: 'Data',
      network: 'Network',
      channel: 'Channel',
    },
  },

  Producer: {
    fields: { id: ALL, name: ALL, cat: ALL, cattax: ALL, domain: ALL, ext: ALL },
    children: {},
  },

  Network: {
    fields: { id: ALL, name: ALL, domain: ALL, ext: ALL },
    children: {},
  },

  Channel: {
    fields: { id: ALL, name: ALL, domain: ALL, ext: ALL },
    children: {},
  },

  Device: {
    fields: {
      ua: ALL,
      sua: V26, // detect.js SIGNALS_2_6: 'device.sua'
      geo: ALL,
      dnt: ALL,
      lmt: ALL,
      ip: ALL,
      ipv6: ALL,
      devicetype: ALL,
      make: ALL,
      model: ALL,
      os: ALL,
      osv: ALL,
      hwv: ALL,
      h: ALL,
      w: ALL,
      ppi: ALL,
      pxratio: ALL,
      js: ALL,
      geofetch: ALL,
      flashver: ALL,
      language: ALL,
      langb: ALL,
      carrier: ALL,
      mccmnc: ALL,
      connectiontype: ALL,
      ifa: ALL,
      didsha1: ALL,
      didmd5: ALL,
      dpidsha1: ALL,
      dpidmd5: ALL,
      macsha1: ALL,
      macmd5: ALL,
      ext: ALL,
    },
    children: { geo: 'Geo', sua: 'UserAgent' },
  },

  Geo: {
    fields: {
      lat: ALL,
      lon: ALL,
      type: ALL,
      accuracy: ALL,
      lastfix: ALL,
      ipservice: ALL,
      country: ALL,
      region: ALL,
      regionfips104: ALL,
      metro: ALL,
      city: ALL,
      zip: ALL,
      utcoffset: ALL,
      ext: ALL,
    },
    children: {},
  },

  User: {
    fields: {
      id: ALL,
      buyeruid: ALL,
      yob: ALL,
      gender: ALL,
      keywords: ALL,
      kwarray: ALL,
      customdata: ALL,
      geo: ALL,
      data: ALL,
      consent: V26, // migrate/rules.js: ortb26.user.consent
      eids: V26, // migrate/rules.js: ortb26.user.eids
      ext: ALL,
    },
    children: { geo: 'Geo', data: 'Data', eids: 'Eid' },
  },

  Data: {
    fields: { id: ALL, name: ALL, segment: ALL, ext: ALL },
    children: { segment: 'Segment' },
  },

  Segment: {
    fields: { id: ALL, name: ALL, value: ALL, ext: ALL },
    children: {},
  },

  Eid: {
    fields: { source: ALL, uids: ALL, inserter: ALL, matcher: ALL, mm: ALL, ext: ALL },
    children: { uids: 'Uid' },
  },

  Uid: {
    fields: { id: ALL, atype: ALL, ext: ALL },
    children: {},
  },

  UserAgent: {
    fields: {
      browsers: ALL,
      platform: ALL,
      mobile: ALL,
      architecture: ALL,
      bitness: ALL,
      model: ALL,
      source: ALL,
      ext: ALL,
    },
    children: { browsers: 'BrandVersion', platform: 'BrandVersion' },
  },

  BrandVersion: {
    fields: { brand: ALL, version: ALL, ext: ALL },
    children: {},
  },

  SupplyChain: {
    fields: { complete: ALL, nodes: ALL, ver: ALL, ext: ALL },
    children: { nodes: 'SupplyChainNode' },
  },

  SupplyChainNode: {
    fields: { asi: ALL, sid: ALL, rid: ALL, name: ALL, domain: ALL, hp: ALL, ext: ALL },
    children: {},
  },

  // ── Response ──────────────────────────────────────────────────────────────
  BidResponse: {
    fields: {
      id: ALL,
      seatbid: ALL,
      bidid: ALL,
      cur: ALL,
      customdata: ALL,
      nbr: ALL,
      ext: ALL,
    },
    children: { seatbid: 'SeatBid' },
  },

  SeatBid: {
    fields: { bid: ALL, seat: ALL, group: ALL, ext: ALL },
    children: { bid: 'Bid' },
  },

  Bid: {
    fields: {
      id: ALL,
      impid: ALL,
      price: ALL,
      adid: ALL,
      nurl: ALL,
      burl: ALL,
      lurl: ALL,
      adm: ALL,
      adomain: ALL,
      bundle: ALL,
      iurl: ALL,
      cid: ALL,
      crid: ALL,
      tactic: ALL,
      cattax: V26, // detect.js SIGNALS_2_6: 'seatbid[].bid[].cattax'
      cat: ALL,
      attr: ALL,
      apis: V26, // detect.js SIGNALS_2_6: 'seatbid[].bid[].apis'
      api: ALL,
      protocol: ALL,
      qagmediarating: ALL,
      language: ALL,
      langb: ALL,
      dealid: ALL,
      w: ALL,
      h: ALL,
      wratio: ALL,
      hratio: ALL,
      exp: ALL,
      dur: ALL,
      mtype: V26, // detect.js SIGNALS_2_6: 'seatbid[].bid[].mtype'
      slotinpod: ALL,
      ext: ALL,
    },
    children: {},
  },
};

const ROOT_OBJECT = { request: 'BidRequest', response: 'BidResponse' };

/**
 * field name → the schema objects that declare it, sorted. Derived once from
 * SCHEMA; immutable, so the module still holds no mutable state. Powers the
 * "this name is real, but not here" and spec-wide near-match branches.
 *
 * @type {Map<string, string[]>}
 */
const FIELD_OWNERS = (() => {
  /** @type {Map<string, string[]>} */
  const owners = new Map();
  for (const objectName of Object.keys(SCHEMA)) {
    for (const field of Object.keys(SCHEMA[objectName].fields)) {
      if (field === EXT_KEY) continue;
      const list = owners.get(field);
      if (list) list.push(objectName);
      else owners.set(field, [objectName]);
    }
  }
  for (const list of owners.values()) list.sort();
  return owners;
})();

/** Every field name in the registry, sorted — the spec-wide search space. */
const ALL_FIELD_NAMES = Object.freeze([...FIELD_OWNERS.keys()].sort());

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * Damerau-Levenshtein edit distance, optimal-string-alignment variant:
 * insertion, deletion, substitution and transposition of two ADJACENT
 * characters each cost 1.
 *
 * `max` bounds the work and the answer — anything beyond it returns `max + 1`,
 * which is all a threshold test needs and lets the length pre-check reject most
 * candidates without allocating.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} [max]  distance ceiling (default: no ceiling)
 * @returns {number}
 */
function damerauLevenshtein(a, b, max) {
  const la = a.length;
  const lb = b.length;
  const ceiling = typeof max === 'number' ? max : Infinity;
  if (Math.abs(la - lb) > ceiling) return ceiling + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  /** @type {number[]} */
  let prev2 = [];
  /** @type {number[]} */
  let prev = new Array(lb + 1);
  /** @type {number[]} */
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;

  for (let i = 1; i <= la; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      curr[j] = best;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > ceiling) return ceiling + 1;
    prev2 = prev;
    prev = curr;
    curr = new Array(lb + 1);
  }
  return prev[lb];
}

/**
 * Normalised similarity in [0, 1]: `1 - distance / max(len(a), len(b))`.
 * Length-aware by construction, which is the whole reason the thresholds are
 * expressed in it rather than in raw distance.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} distance
 * @returns {number}
 */
function similarity(a, b, distance) {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - distance / longest;
}

/**
 * Best near-matches for `name` among `candidateNames`.
 *
 * Returns EVERY name tied at the best distance. A tie is reported as a tie —
 * `mixbitrate` sits one edit from both `minbitrate` and `maxbitrate`, and
 * choosing one would be a guess about min-versus-max semantics.
 *
 * @param {string} name
 * @param {Iterable<string>} candidateNames
 * @param {number} maxDistance
 * @param {number} minSimilarity
 * @returns {{ candidates: string[], distance: number, similarity: number }|null}
 */
function nearestNames(name, candidateNames, maxDistance, minSimilarity) {
  let bestDistance = Infinity;
  /** @type {string[]} */
  let best = [];
  for (const candidate of candidateNames) {
    if (candidate === name) continue;
    if (Math.abs(candidate.length - name.length) > maxDistance) continue;
    const distance = damerauLevenshtein(name, candidate, maxDistance);
    if (distance > maxDistance) continue;
    if (similarity(name, candidate, distance) < minSimilarity) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [candidate];
    } else if (distance === bestDistance) {
      best.push(candidate);
    }
  }
  if (!best.length) return null;
  best.sort();
  return {
    candidates: best,
    distance: bestDistance,
    similarity: similarity(name, best[0], bestDistance),
  };
}

/**
 * @typedef {object} UnknownFieldFinding
 * @property {string} path        `imp[0].video.protcols`
 * @property {string} field       the unknown key itself
 * @property {string} object      registry object the key sits in (`Video`)
 * @property {'likely_typo'|'version_mismatch'|'known_elsewhere'|'unrecognized'} reason
 * @property {string|null} suggestion   the likely intended name, or null when
 *                                      there is none or the best match is tied
 * @property {string[]} candidates      every name tied at the best distance
 * @property {'sibling'|'spec'|null} suggestionScope  where the match was found
 * @property {number|null} distance     Damerau-Levenshtein distance, when matched
 * @property {number} confidence        0..1 in `suggestion`; 0 without one
 * @property {string[]} knownIn         versions declaring `field` here
 *                                      (version_mismatch only)
 * @property {string[]} knownOn         registry objects that declare the name
 *                                      the finding points at
 */

/**
 * @param {string} declared  ALL | V25 | V26
 * @param {string|null} version  resolved version, or null when unknown
 * @returns {boolean}
 */
function validInVersion(declared, version) {
  if (declared === ALL) return true;
  // No trustworthy version: every version's vocabulary counts as known, so a
  // version mismatch cannot be claimed on a guess.
  if (version === null) return true;
  return declared === version;
}

/**
 * Classify one key that the object's schema does not accept.
 *
 * @param {string} key
 * @param {string} path
 * @param {string} objectName
 * @param {string|null} version
 * @returns {UnknownFieldFinding}
 */
function classify(key, path, objectName, version) {
  const schema = SCHEMA[objectName];
  const siblings = Object.keys(schema.fields).filter(
    (name) => name !== EXT_KEY && validInVersion(schema.fields[name], version),
  );

  // 1. Declared here, but only in the other version. Not a typo — a version
  //    mismatch. A same-version replacement is offered when one is near
  //    (`video.protocol` → `protocols`), because that is the actual fix.
  if (own(schema.fields, key)) {
    const near = nearestNames(key, siblings, MAX_SIBLING_DISTANCE, MIN_SIBLING_SIMILARITY);
    const unique = near !== null && near.candidates.length === 1;
    return {
      path,
      field: key,
      object: objectName,
      reason: 'version_mismatch',
      suggestion: unique ? near.candidates[0] : null,
      candidates: near ? near.candidates : [],
      suggestionScope: near ? 'sibling' : null,
      distance: near ? near.distance : null,
      confidence: unique ? near.similarity : 0,
      knownIn: [schema.fields[key]],
      knownOn: [objectName],
    };
  }

  // 2. An exact spec name in the wrong object. Distance-0 evidence, so it is
  //    settled before any fuzzy match is considered.
  const owners = FIELD_OWNERS.get(key);
  if (owners) {
    return {
      path,
      field: key,
      object: objectName,
      reason: 'known_elsewhere',
      suggestion: null,
      candidates: [],
      suggestionScope: null,
      distance: 0,
      confidence: 0,
      knownIn: [],
      knownOn: owners.slice(),
    };
  }

  // 3. Near-match among this object's own fields — the strongest fuzzy signal,
  //    because the search space is ~20 names, not the whole spec.
  const sibling = nearestNames(key, siblings, MAX_SIBLING_DISTANCE, MIN_SIBLING_SIMILARITY);
  if (sibling) {
    const unique = sibling.candidates.length === 1;
    return {
      path,
      field: key,
      object: objectName,
      reason: 'likely_typo',
      suggestion: unique ? sibling.candidates[0] : null,
      candidates: sibling.candidates,
      suggestionScope: 'sibling',
      distance: sibling.distance,
      confidence: unique ? sibling.similarity : 0,
      knownIn: [],
      knownOn: unique ? [objectName] : [],
    };
  }

  // 4. Near-match anywhere in the spec, on a stricter gate. This is the branch
  //    that catches `bidfloorcurr` at BidRequest level, where the field it was
  //    meant to be does not belong in the first place.
  const spec = nearestNames(key, ALL_FIELD_NAMES, MAX_SPEC_DISTANCE, MIN_SPEC_SIMILARITY);
  if (spec) {
    const unique = spec.candidates.length === 1;
    return {
      path,
      field: key,
      object: objectName,
      reason: 'likely_typo',
      suggestion: unique ? spec.candidates[0] : null,
      candidates: spec.candidates,
      suggestionScope: 'spec',
      distance: spec.distance,
      confidence: unique ? spec.similarity : 0,
      knownIn: [],
      knownOn: unique ? (FIELD_OWNERS.get(spec.candidates[0]) || []).slice() : [],
    };
  }

  // 5. Resembles nothing. Still silently dropped by the receiver, so it is
  //    still reported — just as the weakest of the four claims.
  return {
    path,
    field: key,
    object: objectName,
    reason: 'unrecognized',
    suggestion: null,
    candidates: [],
    suggestionScope: null,
    distance: null,
    confidence: 0,
    knownIn: [],
    knownOn: [],
  };
}

/**
 * Walk one registered object. Reports unknown keys; descends only along
 * declared child paths.
 *
 * Termination does not need a depth cap: the walker follows the schema graph,
 * which is finite and acyclic, so input nesting cannot drive recursion — a
 * self-referential object simply runs out of declared children.
 *
 * @param {Record<string, unknown>} node
 * @param {string} objectName
 * @param {string} prefix
 * @param {string|null} version
 * @param {UnknownFieldFinding[]} out
 */
function walkObject(node, objectName, prefix, version, out) {
  const schema = SCHEMA[objectName];
  for (const key of Object.keys(node)) {
    // The extension surface. Not inspected, not reported, not entered.
    if (key === EXT_KEY) continue;

    const path = prefix ? `${prefix}.${key}` : key;
    const declared = own(schema.fields, key) ? schema.fields[key] : null;

    if (declared !== null && validInVersion(declared, version)) {
      if (own(schema.children, key)) {
        descend(node[key], schema.children[key], path, version, out);
      }
      continue;
    }

    // Reported, and NOT entered: one finding per defect. Descending into a key
    // that is already wrong would cascade its whole subtree into the report.
    out.push(classify(key, path, objectName, version));
  }
}

/**
 * Enter a declared child. Handles both an object and an array of objects so a
 * schema entry never has to declare arity — a wrong-shaped value is a type
 * error, which `rules-request.js` owns, not this module.
 *
 * @param {unknown} value
 * @param {string} objectName
 * @param {string} path
 * @param {string|null} version
 * @param {UnknownFieldFinding[]} out
 */
function descend(value, objectName, path, version, out) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const element = value[i];
      if (isPlainObject(element)) {
        walkObject(element, objectName, `${path}[${i}]`, version, out);
      }
    }
    return;
  }
  if (isPlainObject(value)) walkObject(value, objectName, path, version, out);
}

/**
 * Resolve which root schema to walk.
 *
 * @param {unknown} payload
 * @param {string|undefined} explicit  'request' | 'response'
 * @returns {string|null}  registry object name, or null when there is nothing
 *                         this module can honestly say
 */
function resolveRoot(payload, explicit) {
  if (explicit) return own(ROOT_OBJECT, explicit) ? ROOT_OBJECT[explicit] : null;
  const type = detectType(payload);
  if (type === TYPES.ORTB_REQUEST) return ROOT_OBJECT.request;
  if (type === TYPES.ORTB_RESPONSE) return ROOT_OBJECT.response;
  // Vendor feed, JSON feed, URL request, unknown — a different vocabulary
  // entirely. Silence beats a report built on the wrong registry.
  return null;
}

/**
 * Resolve the version to judge against.
 *
 * An auto-detected version is used only at confidence 1, i.e. only when a
 * 2.6-only marker was actually seen. `detectVersion` never returns 2.5 above
 * 0.7 by design — "2.5 markers only" cannot exclude 2.6, since 2.6 is a
 * superset — so with auto-detection alone the version axis reports removals
 * (2.5-only fields on a confirmed 2.6 payload) and stays quiet otherwise.
 *
 * @param {unknown} payload
 * @param {string|undefined} explicit
 * @returns {{ version: string|null, unsupported: boolean }}
 */
function resolveVersion(payload, explicit) {
  if (explicit) {
    if (explicit === VERSIONS.V_2_5 || explicit === VERSIONS.V_2_6) {
      return { version: explicit, unsupported: false };
    }
    return { version: null, unsupported: true };
  }
  const detected = detectVersion(payload);
  if (detected.version === VERSIONS.V_3_0) return { version: null, unsupported: true };
  if (detected.confidence >= 1 && detected.version === VERSIONS.V_2_6) {
    return { version: VERSIONS.V_2_6, unsupported: false };
  }
  return { version: null, unsupported: false };
}

/**
 * Find the fields an OpenRTB receiver will ignore.
 *
 * @param {unknown} payload  a PARSED BidRequest or BidResponse
 * @param {{ kind?: string, version?: string }} [options]
 *   `kind` and `version` override detection. `kind` accepts 'request' or
 *   'response'; `version` accepts '2.5' or '2.6'. Anything else — including
 *   '3.0' — yields no findings, because there is no registry for it.
 * @returns {UnknownFieldFinding[]}  in document order
 */
function findUnknownFields(payload, options) {
  /** @type {UnknownFieldFinding[]} */
  const out = [];
  if (!isPlainObject(payload)) return out;

  const opts = options || {};
  const root = resolveRoot(payload, opts.kind);
  if (!root) return out;

  const { version, unsupported } = resolveVersion(payload, opts.version);
  if (unsupported) return out;

  walkObject(payload, root, '', version, out);
  return out;
}

module.exports = {
  findUnknownFields,
  damerauLevenshtein,
  similarity,
  SCHEMA,
  MAX_SIBLING_DISTANCE,
  MIN_SIBLING_SIMILARITY,
  MAX_SPEC_DISTANCE,
  MIN_SPEC_SIMILARITY,
};
