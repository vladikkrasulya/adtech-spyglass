'use strict';

/**
 * IAB OpenRTB 2.x BidRequest validation rules. Pure spec — no Kadam (or any
 * other SSP) dialect concerns; those layer on top via ctx.dialect.
 *
 * Phase 2 will gate version-specific fields (rwdd, sua, regs.gpp, etc.) on
 * the version detected by detect.js — for now we accept the 2.5 baseline that
 * still dominates production traffic.
 */

const { isObj, isStr, isNum, ISO_3166_ALPHA3, ISO_639_ALPHA2 } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');

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

  if (req.at != null && req.at !== 1 && req.at !== 2) {
    findings.push(F('request.at_invalid', LEVELS.WARNING, 'at', { at: req.at }));
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

  // ── Dialect overlay ──────────────────────────────────────────────────────
  if (dialect && typeof dialect.validateRequest === 'function') {
    findings.push(...dialect.validateRequest(req));
  }

  return findings;
}

// Recognised non-IAB format strings (lowercase, normalised). Underscores and
// hyphens are stripped before comparison so `pop_under`/`pop-under` match.
const NON_STANDARD_FORMATS = new Set([
  'pop',
  'popup',
  'popunder',
  'clickunder',
  'pushunder',
  'push',
  'nativepush',
  'banner_pop'.replace(/[-_]/g, ''),
]);

// Boolean flags networks use to mark these formats. Same name conventions as
// strings above but addressed as truthy markers instead of `adtype: "pop"`.
const NON_STANDARD_FLAG_KEYS = [
  'pop',
  'popup',
  'popunder',
  'clickunder',
  'pushunder',
  'push',
  'pushup',
];

function normaliseFormatName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

function detectNonStandardFormats(req) {
  const findings = [];
  const seen = new Map(); // format → first-seen path

  function record(format, path) {
    const key = normaliseFormatName(format);
    if (!NON_STANDARD_FORMATS.has(key)) return;
    if (!seen.has(key)) seen.set(key, { format: key, path });
  }

  function scanExt(ext, basePath) {
    if (!isObj(ext)) return;
    // String hints: ext.adtype = "pop" / ext.format = "popunder" / ext.type = ...
    for (const k of ['adtype', 'format', 'type', 'ad_format']) {
      const v = ext[k];
      if (typeof v === 'string') record(v, `${basePath}.${k}`);
    }
    // Boolean / truthy flags: ext.pop = true, ext.popunder = 1, etc.
    for (const k of NON_STANDARD_FLAG_KEYS) {
      if (ext[k]) record(k, `${basePath}.${k}`);
    }
  }

  scanExt(req.ext, 'ext');
  (req.imp || []).forEach((imp, i) => {
    scanExt(imp && imp.ext, `imp[${i}].ext`);
    if (imp && imp.banner) scanExt(imp.banner.ext, `imp[${i}].banner.ext`);
    if (imp && imp.video) scanExt(imp.video.ext, `imp[${i}].video.ext`);
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
