'use strict';

/**
 * IAB OpenRTB 2.x BidRequest validation rules. Pure spec — no vendor-dialect (or any
 * other SSP) dialect concerns; those layer on top via ctx.dialect.
 *
 * Phase 2 will gate version-specific fields (rwdd, sua, regs.gpp, etc.) on
 * the version detected by detect.js — for now we accept the 2.5 baseline that
 * still dominates production traffic.
 */

const { isObj, isStr, isNum, ISO_3166_ALPHA3, ISO_639_ALPHA2 } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');
const { scanExtForFormatHints, ALL_NON_STANDARD } = require('./non-iab-formats');

const F = makeFinding;

const NATIVE_ASSET_SUBTYPES = ['title', 'img', 'video', 'data'];

// A slot dimension is a *positive* finite number. `isNum` from helpers.js is
// the wrong predicate for sizes: it answers true for 0 and for -300, and a
// banner declared 0×0 (or -300×-250, which is what a signed-integer overflow
// in an upstream adapter looks like on the wire) is not a slot any creative
// can fill. Kept local to this file — helpers.js `isNum` is the general
// numeric guard used for prices, floors and enum codes, where zero and
// negatives are legitimate values.
const isPosNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// oRTB §3.2.10 (Object: Format) — a single entry of `banner.format[]` is
// usable only if it actually carries a size: either the fixed pair w+h, or
// the relative-sizing pair wratio+hratio.
//
// wmin is deliberately NOT demanded alongside the ratios even though the spec
// lists the three together. Ratios on their own already tell the exchange
// which shape to send, the wmin-less form is widespread, and we have no
// separate finding id with which to say "ratios fine, wmin missing" — so
// requiring it would mean raising a hard ERROR on a payload that does
// communicate a size. Under-reporting one detail beats mislabelling the slot
// as sizeless.
function isUsableFormat(f) {
  if (!isObj(f)) return false;
  if (isPosNum(f.w) && isPosNum(f.h)) return true;
  return isPosNum(f.wratio) && isPosNum(f.hratio);
}

function validateRequest(req, ctx) {
  const findings = [];
  const dialect = (ctx && ctx.dialect) || null;

  // ── Root structure ───────────────────────────────────────────────────────
  if (!isStr(req.id)) findings.push(F('request.id_required', LEVELS.ERROR, 'id'));
  if (!Array.isArray(req.imp) || !req.imp.length) {
    findings.push(F('request.imp_required', LEVELS.ERROR, 'imp'));
  }
  // ── Distribution channel: exactly one of site / app / dooh ───────────────
  //
  // HISTORY. This rule knew two channels for as long as it existed, because
  // oRTB 2.5 had two. 2.6 §3.2.1 added a third — `dooh` (Object: DOOH,
  // §3.2.16) — for billboards, kiosks and transit screens: inventory that is
  // neither a web page nor an app. Every other part of this engine had
  // already learned about it. detect.js counts a `dooh` object as a 2.6
  // signal, format-detect.js emits CONTEXTS.DOOH, unknown-fields.js maps the
  // object to V26, the 3.0 rules filter over exactly ['site','app','dooh'],
  // and the knowledge base ships ortb-2.6/request/dooh/billboard-roadside.json
  // as a reference payload. Only this line stayed at two — so the engine's own
  // reference DOOH request came back with an ERROR saying it had no
  // distribution channel, on a payload the version detector had just
  // fingerprinted as 2.6 with confidence 1 *because of* that same `dooh`
  // object. Two parts of one engine reading the same field and disagreeing
  // about whether it exists.
  //
  // Written as a filter over a channel list rather than a chain of booleans
  // for two reasons: a fourth channel becomes one string instead of a new
  // branch, and "more than one channel present" now reports identically no
  // matter which pair collided (the old `else if` could only ever see the
  // site+app collision).
  const channels = ['site', 'app', 'dooh'].filter((k) => req[k]);
  if (channels.length === 0) {
    findings.push(F('request.no_site_or_app', LEVELS.ERROR, 'site/app'));
  } else if (channels.length > 1) {
    // oRTB §3.2.1: "site OR app, never both". Some SSPs reject; others
    // silently pick one and discard the other's targeting context.
    // Surface as WARNING — the request still has *some* targeting surface,
    // but the inventory side is ambiguous.
    findings.push(F('request.site_and_app_both', LEVELS.WARNING, 'site/app'));
  }
  // DOOH *alone* is what relaxes the client-identity checks further down. A
  // request carrying dooh together with site or app is already flagged as
  // ambiguous above, and one of those two channels does imply a real client
  // — so it keeps the strict device rules.
  const doohOnly = channels.length === 1 && channels[0] === 'dooh';

  // Impression ids must be unique within a request. A bid answers with
  // `bid.impid`, so two impressions sharing an id make that reference
  // ambiguous: the response cannot say which one it bid on, and two receivers
  // resolving it differently disagree about what was sold. Nothing rejects the
  // payload for it — the JSON is valid and every field is present.
  if (Array.isArray(req.imp)) {
    const seen = new Set();
    const duplicated = new Set();
    for (const imp of req.imp) {
      if (!imp || imp.id == null) continue;
      const id = String(imp.id);
      if (seen.has(id)) duplicated.add(id);
      seen.add(id);
    }
    for (const id of duplicated) {
      findings.push(F('request.imp_id_duplicated', LEVELS.ERROR, 'imp', { impid: id }));
    }
  }

  // Extended identifiers have two homes: `user.eids` since 2.6, and
  // `user.ext.eids` before it, which is still what most senders emit. Carrying
  // both is not itself wrong — but carrying both with different contents is,
  // because which one a receiver reads is implementation-defined. Measured:
  // Prebid Server discards the legacy array when the core one is present, while
  // Prebid.js merges and de-duplicates the two. One request, two outbound
  // identity sets, no error anywhere.
  if (
    req.user &&
    Array.isArray(req.user.eids) &&
    req.user.ext &&
    Array.isArray(req.user.ext.eids)
  ) {
    const fingerprint = (eids) =>
      JSON.stringify(
        eids
          .map(
            (e) =>
              // Array.isArray, not `|| []`: `uids` is an array per §3.2.27,
              // but a sender that emitted a single uid without the wrapper
              // hands us an object, and `({}).map` is a TypeError that takes
              // the whole verdict down instead of producing a finding.
              `${(e && e.source) || ''}|${(Array.isArray(e && e.uids) ? e.uids : []).map((u) => (u && u.id) || '').join(',')}`,
          )
          .sort(),
      );
    if (fingerprint(req.user.eids) !== fingerprint(req.user.ext.eids)) {
      findings.push(
        F('request.user.eids_disagree', LEVELS.WARNING, 'user.eids', {
          core: req.user.eids.length,
          legacy: req.user.ext.eids.length,
        }),
      );
    }
  }

  // at — auction type. ABSENT is not the same defect as PRESENT-BUT-BROKEN,
  // and the two used to share one branch and one level.
  //
  // The BidRequest table marks only `id` and `imp` required; `at` carries a
  // spec default of 2. A field with a default cannot be required — the default
  // exists precisely so the field can be omitted, and an exchange reading a
  // payload without `at` knows exactly what it means. Reporting that at ERROR
  // rolled the whole payload up to "errors" and told an operator their
  // spec-compliant request was broken, which is the same class of false alarm
  // as the 500+ carve-out below.
  //
  // Absent → INFO: worth knowing you are relying on the default, because many
  // SSPs do want it stated, but nothing is wrong.
  // Present with a non-numeric value ("first", null-ish object) → ERROR: that
  // is a real defect, the sender tried to say something and failed.
  //
  // The 500+ carve-out: oRTB §3.2.1 defines 1 (First Price) and 2 (Second
  // Price Plus) and then, in the same table row, says "Exchange-specific
  // auction types can be defined using values greater than 500." The old
  // membership test knew only the two enumerated values, so a request naming
  // a private auction type — at: 501, which the spec explicitly blesses —
  // came back as at_invalid. Telling an operator their spec-compliant
  // payload is non-standard is worse than saying nothing: it sends them
  // looking for a bug that is not there.
  //
  // The sibling rule for imp.video.protocols in this same file had already
  // carved the exchange-specific range out (`v < 500`) — this one had simply
  // not been updated with it. The threshold is spelled the same way here on
  // purpose, so the two cannot drift into disagreeing about where the
  // vendor range starts.
  if (req.at == null) {
    findings.push(F('request.at_required', LEVELS.INFO, 'at'));
  } else if (typeof req.at !== 'number') {
    findings.push(F('request.at_required', LEVELS.ERROR, 'at'));
  } else if (req.at !== 1 && req.at !== 2 && req.at < 500) {
    findings.push(F('request.at_invalid', LEVELS.WARNING, 'at', { at: req.at }));
  }

  // GDPR consent — oRTB 2.5 placed it at `regs.ext.gdpr=1` + `user.ext.consent`;
  // oRTB 2.6 §3.2.3+§3.2.18 promoted both to top-level `regs.gdpr=1` +
  // `user.consent`. Modern EU exchanges send the 2.6 form; accept either
  // path on both flag and string so a 2.6-compliant payload doesn't trigger
  // a false-positive `gdpr_consent_missing` finding.
  const gdprTopLevel = req.regs && req.regs.gdpr === 1;
  const gdprLegacy = req.regs && req.regs.ext && req.regs.ext.gdpr === 1;
  if (gdprTopLevel || gdprLegacy) {
    const consent =
      (req.user && req.user.consent) || (req.user && req.user.ext && req.user.ext.consent);
    if (!isStr(consent) || !consent.trim()) {
      findings.push(
        F(
          'regs.gdpr_consent_missing',
          LEVELS.WARNING,
          gdprTopLevel ? 'regs.gdpr' : 'regs.ext.gdpr',
        ),
      );
    }
  }

  // GPP / CCPA / COPPA — modern privacy framework rules. We surface the
  // INFO-level signals so users can see at a glance whether their request
  // talks to the right region's regulators. ERROR levels are deliberate:
  // CCPA `us_privacy` is an opaque 4-char string; if present and clearly
  // malformed, that *will* break SSP-side validation.

  // GPP (Global Privacy Platform) — oRTB 2.6 §3.2.3 added `regs.gpp` +
  // `regs.gpp_sid`. If GPP is signaled (gpp_sid present), gpp consent
  // string should be too. Inverse is also useful: gpp string without sids
  // is meaningless.
  if (req.regs) {
    const hasGppSid = Array.isArray(req.regs.gpp_sid) && req.regs.gpp_sid.length;
    const hasGppStr = isStr(req.regs.gpp) && req.regs.gpp.trim();
    if (hasGppSid && !hasGppStr) {
      findings.push(F('regs.gpp_sid_without_string', LEVELS.WARNING, 'regs.gpp'));
    } else if (hasGppStr && !hasGppSid) {
      findings.push(F('regs.gpp_string_without_sid', LEVELS.WARNING, 'regs.gpp_sid'));
    }
  }

  // CCPA `us_privacy` — IAB MSPA spec: 4-char string `<spec_version><opt_out_notice><opt_out><lspa_covered>`,
  // each char is `-`, `Y`, `N`, or (for spec_version) `1`. Anything else
  // is malformed and SSPs will reject.
  const usp = req.regs && req.regs.ext && req.regs.ext.us_privacy;
  if (usp != null) {
    if (!isStr(usp) || !/^[1-9][-YN][-YN][-YN]$/i.test(usp)) {
      findings.push(
        F('regs.us_privacy_invalid', LEVELS.WARNING, 'regs.ext.us_privacy', { usp: String(usp) }),
      );
    }
  }

  // COPPA — `regs.coppa=1` means the user is a child under 13. When set,
  // most exchanges require non-PII (no precise geo, no device.dnt, no
  // user.id/buyeruid). We surface the inconsistency.
  if (req.regs && req.regs.coppa === 1) {
    const userObj = req.user || {};
    const hasUid = isStr(userObj.id) || isStr(userObj.buyeruid);
    const hasGeo =
      req.device && req.device.geo && (req.device.geo.lat != null || req.device.geo.lon != null);
    if (hasUid || hasGeo) {
      findings.push(
        F('regs.coppa_pii_present', LEVELS.WARNING, 'regs.coppa', {
          hasUid: String(hasUid),
          hasGeo: String(hasGeo),
        }),
      );
    }
  }

  // ── Device ───────────────────────────────────────────────────────────────
  const dev = req.device || {};
  if (!isObj(req.device)) findings.push(F('request.device_required', LEVELS.ERROR, 'device'));
  // `ip` and `ua` are how a bidder reaches a *client*: geo and fraud scoring
  // off the address, browser and OS off the agent string. A DOOH panel has
  // neither in the sense those checks assume. The spec hedges on the agent
  // itself (§3.2.18 device.ua: "can be omitted if the device is not a
  // browser"), and a roadside billboard's egress IP says nothing about the
  // audience standing in front of it — `dooh.venuetype` and `device.geo` are
  // what carry that, and the 2.6 DOOH samples send exactly those.
  //
  // So the level moves rather than the rule: on a DOOH-only request these
  // drop to INFO. Dropping the checks entirely would lose the signal for an
  // operator who did mean to send an address; leaving them at ERROR is what
  // made every spec-shaped DOOH request roll up to "errors" and hid the
  // findings that were actually about the payload.
  if (!dev.ip && !dev.ipv6) {
    findings.push(
      F('request.device.ip_required', doohOnly ? LEVELS.INFO : LEVELS.ERROR, 'device.ip'),
    );
  }
  if (!isStr(dev.ua)) {
    findings.push(
      F('request.device.ua_required', doohOnly ? LEVELS.INFO : LEVELS.ERROR, 'device.ua'),
    );
  }
  if (dev.geo && dev.geo.country && !ISO_3166_ALPHA3.test(dev.geo.country)) {
    findings.push(
      F('request.device.geo.country_invalid', LEVELS.WARNING, 'device.geo.country', {
        country: dev.geo.country,
      }),
    );
  }
  if (dev.language && !ISO_639_ALPHA2.test(dev.language)) {
    findings.push(
      F('request.device.language_invalid', LEVELS.WARNING, 'device.language', {
        language: dev.language,
      }),
    );
  } else if (!dev.language) {
    findings.push(F('request.device.language_missing', LEVELS.INFO, 'device.language'));
  }
  if (isObj(req.device) && 'ifa' in req.device) {
    if (!isStr(dev.ifa) || !dev.ifa.length) {
      findings.push(F('request.device.ifa_invalid', LEVELS.ERROR, 'device.ifa'));
    }
  }
  if (isObj(req.device) && 'lmt' in req.device) {
    if (dev.lmt === 1) {
      findings.push(F('request.device.lmt_enabled', LEVELS.INFO, 'device.lmt'));
    } else if (dev.lmt !== 0) {
      findings.push(F('request.device.lmt_invalid', LEVELS.ERROR, 'device.lmt'));
    }
  }

  // ── User ─────────────────────────────────────────────────────────────────
  if (req.user && req.user.gender && !['M', 'F', 'O'].includes(req.user.gender)) {
    findings.push(
      F('request.user.gender_invalid', LEVELS.WARNING, 'user.gender', { gender: req.user.gender }),
    );
  }

  // ── Site / App ───────────────────────────────────────────────────────────
  if (req.site && !isStr(req.site.domain)) {
    findings.push(F('request.site.domain_missing', LEVELS.WARNING, 'site.domain'));
  }
  if (req.app && !isStr(req.app.bundle)) {
    findings.push(F('request.app.bundle_missing', LEVELS.WARNING, 'app.bundle'));
  }

  // ── bcat ─────────────────────────────────────────────────────────────────
  if (req.bcat && !Array.isArray(req.bcat)) {
    findings.push(F('request.bcat_invalid', LEVELS.WARNING, 'bcat'));
  }

  // ── Per-impression ───────────────────────────────────────────────────────
  // Array.isArray, not `|| []`. A bare object under `imp` is a shape we see
  // often enough to name — a sender that had one impression and forgot the
  // wrapper — and `({}).forEach` is a TypeError, not a finding. Nothing on
  // the way out catches it: core/index.js wraps runRulePlugins in a try but
  // not validateRequest, so the throw travelled all the way to the analyze
  // handler's catch and the operator's answer to "my imp is an object, is
  // that OK?" was an HTTP 400 quoting this line — no verdict, no findings,
  // no mention of imp. A payload whose field is present with the wrong type
  // is the first thing an inspector exists to catch; falling over on it is
  // the worst available outcome.
  //
  // The root check above already emits request.imp_required for exactly this
  // shape, so nothing here needs to report it. The loop only has to survive
  // long enough for that finding to be returned.
  const imps = Array.isArray(req.imp) ? req.imp : [];
  imps.forEach((imp, i) => {
    findings.push(...validateImp(imp, i));
  });

  // ── Non-IAB ad-format detection (pop / clickunder / pushunder / push) ────
  // These formats are NOT in canonical OpenRTB; networks signal them via
  // vendor-specific `ext.*`. We surface a single info-level finding per
  // unique format detected so the inspector can flag what's really being
  // bought without pretending it's spec-canonical.
  findings.push(...detectNonStandardFormats(req));

  // ── AdKernel-routed traffic (any of 49 aliased networks) ─────────────────
  // Multi-imp requests can fan out through several aliases at once; emit
  // one info finding per distinct alias so multi-alias traffic doesn't
  // hide behind the first detection.
  const adkernel = detectAdKernelRouting(req);
  if (adkernel) {
    for (const a of adkernel.aliases) {
      findings.push(
        F('info.adkernel.routed', LEVELS.INFO, a.signal, {
          alias: a.alias,
          signal: a.signal,
        }),
      );
    }
  }

  // ── Dialect overlay ──────────────────────────────────────────────────────
  if (dialect && typeof dialect.validateRequest === 'function') {
    findings.push(...dialect.validateRequest(req));
  }

  return findings;
}

// Pop/push detection constants + helpers moved to packages/core/non-iab-formats.js
// (2026-05-12) so format-detect.js + future plugins can share the same source
// of truth. `ALL_NON_STANDARD` and `scanExtForFormatHints` are imported above.

// AdKernel runs as a white-label engine across 49+ alias networks (Waardex,
// Monetix, Denakop, Türk Telekom, Display.io, …). All share the same wire
// format (oRTB 2.5) and Prebid adapter — only the `host` and `zoneId` differ.
// When we spot a Prebid-style `imp.ext.{alias}` block we surface a single
// info-level finding per request so the inspector can flag "this is AdKernel
// traffic — read the `zoneId` for tenant routing" without it being a true
// dialect (the bytes themselves are vanilla oRTB).
//
// Source: docs/jsonfeed-research-adkernel-2026-05-04.md §6 (alias list from
// Prebid.js adkernelBidAdapter.js v1.8).
const ADKERNEL_ALIASES = new Set([
  'adkernel',
  'waardex_ak',
  'turktelekom',
  'monetix',
  'denakop',
  'ergadx',
  'engageadx',
  'converge',
  'displayioads',
  'appmonsta',
  'spinx',
  'pixelpluses',
  'oppamedia',
  'houseofpubs',
  'urekamedia',
  'smartyexchange',
  'infinety',
  'unibots',
  'headbidding',
  'adsolut',
  'oftmediahb',
  'audiencemedia',
  'roqoon',
  'adbite',
  'torchad',
  'stringads',
  'bcm',
  'adomega',
  'rtbanalytica',
  'motionspots',
  'sonic_twist',
  'rtbdemand_com',
  'bidbuddy',
  'didnadisplay',
  'qortex',
  'adpluto',
  'headbidder',
  'digiad',
  'hyperbrainz',
  'voisetech',
  'global_sun',
  'rxnetwork',
  'revbid',
  'qohere',
  'blutonic',
  'intlscoop',
]);

function detectAdKernelRouting(req) {
  const imps = Array.isArray(req && req.imp) ? req.imp : [];

  // Helper: any AdKernel-shaped block has zoneId (always) and usually host.
  function looksLikeAdKernelParams(o) {
    return isObj(o) && o.zoneId != null;
  }

  // Multi-imp requests can fan out through different aliases (e.g.
  // imp[0].ext.monetix + imp[1].ext.denakop) — collect every unique alias
  // we see so the caller can surface all of them, not just the first.
  // Dedup by lowercased alias name; keep the first-seen signal path so
  // the finding points at a real location.
  const seen = new Map();
  const record = (alias, signal) => {
    const key = alias.toLowerCase();
    if (!seen.has(key)) seen.set(key, { alias, signal });
  };

  for (let i = 0; i < imps.length; i++) {
    const ext = imps[i] && imps[i].ext;
    if (!isObj(ext)) continue;

    // 1. Direct adapter key: imp.ext.adkernel = { zoneId, host } — what the
    //    AdKernel server adapter writes after routing.
    for (const k of Object.keys(ext)) {
      const lk = k.toLowerCase();
      if (ADKERNEL_ALIASES.has(lk) && looksLikeAdKernelParams(ext[k])) {
        record(k, 'imp.ext.' + k);
      }
    }

    // 2. Prebid-server style: imp.ext.bidder.<alias>
    if (isObj(ext.bidder)) {
      for (const k of Object.keys(ext.bidder)) {
        if (ADKERNEL_ALIASES.has(k.toLowerCase())) {
          record(k, 'imp.ext.bidder.' + k);
        }
      }
    }

    // 3. Prebid.js ext.prebid.bidder.<alias>
    if (isObj(ext.prebid) && isObj(ext.prebid.bidder)) {
      for (const k of Object.keys(ext.prebid.bidder)) {
        if (ADKERNEL_ALIASES.has(k.toLowerCase())) {
          record(k, 'imp.ext.prebid.bidder.' + k);
        }
      }
    }
  }
  if (seen.size === 0) return null;
  const aliases = Array.from(seen.values());
  // Caller-compat: keep `alias` + `signal` as the primary (first detected)
  // so existing single-alias display paths stay unchanged. Add `aliases`
  // array for callers that want the full list.
  return { alias: aliases[0].alias, signal: aliases[0].signal, aliases };
}

function detectNonStandardFormats(req) {
  const findings = [];
  const seen = new Map(); // format → first-seen { format, path }

  function harvest(ext, basePath) {
    for (const hint of scanExtForFormatHints(ext, basePath)) {
      if (!ALL_NON_STANDARD.has(hint.format)) continue;
      if (!seen.has(hint.format)) seen.set(hint.format, hint);
    }
  }

  harvest(req.ext, 'ext');
  // Same Array.isArray guard as the main per-impression loop: this pass runs
  // *after* it, so a non-array `imp` that no longer throws there must not
  // throw here either — otherwise the fix above just moves the crash twelve
  // lines down.
  (Array.isArray(req.imp) ? req.imp : []).forEach((imp, i) => {
    harvest(imp && imp.ext, `imp[${i}].ext`);
    if (imp && imp.banner) harvest(imp.banner.ext, `imp[${i}].banner.ext`);
    if (imp && imp.video) harvest(imp.video.ext, `imp[${i}].video.ext`);
  });

  for (const { format, path } of seen.values()) {
    findings.push(F('imp.non_standard_format', LEVELS.INFO, path, { format, path }));
  }
  return findings;
}

function validateImp(imp, i) {
  const findings = [];
  const p = `imp[${i}]`;
  const num = i + 1;

  // R4: tolerate a null/primitive imp entry (e.g. `imp:[null]`). Coerce to an
  // empty object so the field checks below fire `imp.id_required` /
  // `imp.format_required` instead of throwing on `.id`/`.banner`.
  if (!isObj(imp)) imp = {};

  if (!isStr(imp.id)) findings.push(F('imp.id_required', LEVELS.ERROR, `${p}.id`, { num }));
  if (imp.bidfloor != null && !isNum(imp.bidfloor)) {
    findings.push(F('imp.bidfloor_invalid', LEVELS.WARNING, `${p}.bidfloor`, { num }));
  }
  // bidfloor without bidfloorcur — currency defaults vary by exchange. Per
  // oRTB §3.2.4, always pair them. Only fires for positive numeric floors.
  if (isNum(imp.bidfloor) && imp.bidfloor > 0) {
    if (!isStr(imp.bidfloorcur) || !imp.bidfloorcur.trim()) {
      findings.push(F('imp.bidfloorcur_missing', LEVELS.WARNING, `${p}.bidfloor`, { num }));
    }
  }

  const hasFormat = !!(imp.banner || imp.video || imp.native || imp.audio);
  if (!hasFormat) findings.push(F('imp.format_required', LEVELS.ERROR, p, { num }));

  if (imp.banner) {
    // Same tolerance as the imp-level coercion above, one level down. A
    // sender writing `banner: "300x250"` (or `banner: 1`, or `banner: true`)
    // has declared "this slot is a banner" in a shape no field check can
    // read. Coercing to an empty object makes the size rule below say the
    // true thing about that payload — there is no readable size — instead of
    // throwing on `'pos' in "300x250"`, which is what the `in` operator does
    // to a primitive and which took the entire verdict down with it.
    const b = isObj(imp.banner) ? imp.banner : {};
    // oRTB §3.2.10: a Format object carries a size — either the fixed pair
    // w+h or the relative pair wratio+hratio. The previous check counted
    // format[] entries and never looked inside them:
    //
    //     Array.isArray(b.format) && b.format.length > 0
    //
    // so `format: [{}]`, `format: [null]` and `format: [{w:"300",h:"250"}]`
    // (strings — what a payload reassembled from a query string looks like)
    // all read as "a size is present" and silenced this rule for the whole
    // impression. Nothing downstream re-checks format[] either — there is no
    // other rule in this engine that reads format[].w — so the verdict on a
    // slot with no usable size anywhere in it was a clean bill of health.
    //
    // The fixed-size leg gained the same scrutiny via isPosNum: `isNum(0)`
    // and `isNum(-300)` are both true, so `banner:{w:0,h:0}` used to pass as
    // a size through the very same gap.
    const hasFixedSize = isPosNum(b.w) && isPosNum(b.h);
    const hasUsableFormat = Array.isArray(b.format) && b.format.some(isUsableFormat);
    if (!hasFixedSize && !hasUsableFormat) {
      findings.push(F('imp.banner.size_required', LEVELS.ERROR, `${p}.banner`, { num }));
    }
    if ('pos' in b) {
      if (!Number.isInteger(b.pos) || b.pos < 0 || b.pos > 7) {
        findings.push(
          F('imp.banner.pos_nonstandard', LEVELS.WARNING, `${p}.banner.pos`, { num, pos: b.pos }),
        );
      }
    }
    if ('mimes' in b) {
      if (!Array.isArray(b.mimes) || !b.mimes.length) {
        findings.push(F('imp.banner.mimes_invalid', LEVELS.ERROR, `${p}.banner.mimes`, { num }));
      } else {
        b.mimes.forEach((mime, m) => {
          if (!isStr(mime) || !mime.trim()) {
            findings.push(
              F('imp.banner.mimes_invalid', LEVELS.ERROR, `${p}.banner.mimes[${m}]`, { num }),
            );
          }
        });
      }
    }
  }

  if (imp.video) {
    if (!Array.isArray(imp.video.mimes) || !imp.video.mimes.length) {
      findings.push(F('imp.video.mimes_required', LEVELS.ERROR, `${p}.video.mimes`, { num }));
    }
    if (!Array.isArray(imp.video.protocols) || !imp.video.protocols.length) {
      findings.push(
        F('imp.video.protocols_missing', LEVELS.WARNING, `${p}.video.protocols`, { num }),
      );
    } else {
      // Per IAB OpenRTB 2.6 List 5.8: 1=VAST 1.0, 2=VAST 2.0, 3=VAST 3.0,
      // 4=VAST 1.0 Wrapper, 5=VAST 2.0 Wrapper, 6=VAST 3.0 Wrapper,
      // 7=VAST 4.0, 8=VAST 4.0 Wrapper, 9=DAAST 1.0, 10=DAAST 1.0 Wrapper,
      // 11=VAST 4.1, 12=VAST 4.1 Wrapper, 13=VAST 4.2, 14=VAST 4.2 Wrapper.
      // 500+ = exchange-specific. Anything else is malformed.
      const KNOWN = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      const unknown = imp.video.protocols.filter(
        (v) => Number.isFinite(v) && !KNOWN.has(v) && v < 500,
      );
      if (unknown.length) {
        findings.push(
          F('imp.video.protocols_unknown', LEVELS.WARNING, `${p}.video.protocols`, {
            num,
            values: JSON.stringify(unknown),
          }),
        );
      }
    }
  }

  if (imp.native) {
    try {
      const native =
        typeof imp.native.request === 'string'
          ? JSON.parse(imp.native.request)
          : imp.native.request;
      if (!isObj(native)) {
        findings.push(
          F('imp.native.assets_required', LEVELS.ERROR, `${p}.native.request`, { num }),
        );
      } else {
        const inner = isObj(native.native) ? native.native : native;
        const assets = inner.assets;
        if (!Array.isArray(assets) || assets.length === 0) {
          findings.push(
            F('imp.native.assets_required', LEVELS.ERROR, `${p}.native.request`, { num }),
          );
        } else {
          assets.forEach((asset, m) => {
            const assetPath = `${p}.native.request.assets[${m}]`;
            if (!isObj(asset)) {
              findings.push(
                F('imp.native.asset_type_required', LEVELS.ERROR, assetPath, { num, asset: m }),
              );
              return;
            }
            const present = NATIVE_ASSET_SUBTYPES.filter((t) => asset[t] != null);
            if (present.length !== 1 || !isObj(asset[present[0]])) {
              findings.push(
                F('imp.native.asset_type_required', LEVELS.ERROR, assetPath, { num, asset: m }),
              );
            }
          });
        }
      }
      if (!imp.native.ver) {
        findings.push(F('imp.native.ver_missing', LEVELS.WARNING, `${p}.native.ver`, { num }));
      }
    } catch (e) {
      findings.push(
        F('imp.native.invalid_json', LEVELS.ERROR, `${p}.native.request`, {
          num,
          error: e.message,
        }),
      );
    }
  }

  return findings;
}

module.exports = { validateRequest };
