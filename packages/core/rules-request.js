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

function validateRequest(req, ctx) {
  const findings = [];
  const dialect = (ctx && ctx.dialect) || null;

  // ── Root structure ───────────────────────────────────────────────────────
  if (!isStr(req.id)) findings.push(F('request.id_required', LEVELS.ERROR, 'id'));
  if (!Array.isArray(req.imp) || !req.imp.length) {
    findings.push(F('request.imp_required', LEVELS.ERROR, 'imp'));
  }
  if (!req.site && !req.app) findings.push(F('request.no_site_or_app', LEVELS.ERROR, 'site/app'));
  // oRTB §3.2.1: "site OR app, never both". Some SSPs reject; others
  // silently pick one and discard the other's targeting context.
  // Surface as WARNING — the request still has *some* targeting surface,
  // but the inventory side is ambiguous.
  else if (req.site && req.app)
    findings.push(F('request.site_and_app_both', LEVELS.WARNING, 'site/app'));

  // at is required per oRTB §3.2.1. Missing or non-numeric → error.
  // Present-but-wrong-value (3, 4, "first", …) → at_invalid warning below.
  if (req.at == null || typeof req.at !== 'number') {
    findings.push(F('request.at_required', LEVELS.ERROR, 'at'));
  } else if (req.at !== 1 && req.at !== 2) {
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
  if (!dev.ip && !dev.ipv6)
    findings.push(F('request.device.ip_required', LEVELS.ERROR, 'device.ip'));
  if (!isStr(dev.ua)) findings.push(F('request.device.ua_required', LEVELS.ERROR, 'device.ua'));
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
  (req.imp || []).forEach((imp, i) => {
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
  (req.imp || []).forEach((imp, i) => {
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
    const b = imp.banner;
    const hasFormatArr = Array.isArray(b.format) && b.format.length > 0;
    if ((!isNum(b.w) || !isNum(b.h)) && !hasFormatArr) {
      findings.push(F('imp.banner.size_required', LEVELS.ERROR, `${p}.banner`, { num }));
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
      if (!isObj(native) || !isObj(native.native) || !Array.isArray(native.native.assets)) {
        findings.push(
          F('imp.native.assets_required', LEVELS.ERROR, `${p}.native.request`, { num }),
        );
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
