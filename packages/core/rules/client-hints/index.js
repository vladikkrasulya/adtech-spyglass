'use strict';

/**
 * Client-Hints / Structured User-Agent presence checks.
 *
 * Background. Chrome 100+, Edge 100+, Opera 80+ FREEZE the legacy
 * User-Agent string — the UA reports a generic "Mozilla/5.0 (...)
 * Chrome/100.0.0.0" regardless of actual minor version, OS version, or
 * device model. The real fingerprint moved to client-hints
 * (`sec-ch-ua*` HTTP headers), which oRTB 2.6 surfaces as
 * `device.sua` (Structured User Agent).
 *
 * If an SSP doesn't capture client-hints and only forwards the frozen
 * UA, the DSP can't target by OS/browser version/device model
 * accurately — bids still happen, but with coarser segmentation and
 * lower CPM. The validator should surface this as a WARNING, not
 * error: the request is technically valid, just under-informed.
 *
 * Three rules:
 *   - device.client_hints.sua_missing       (warning) — UA suggests
 *     modern Chrome/Edge but `device.sua` is absent.
 *   - device.client_hints.os_unknown        (warning) — neither
 *     `device.os/.osv` nor `device.sua.platform` carries OS data.
 *   - device.client_hints.browser_unknown   (warning) — browser
 *     identity unreachable from any of: device.ua + device.sua.browsers.
 *
 * Why three rules instead of one bundled "client-hints incomplete":
 *   - Different DSP targeting features depend on different fields. A
 *     creative that targets "Android only" cares about os, not browser.
 *   - Granular IDs let integrators silence individual checks via
 *     `disabledRules: ['device.client_hints.os_unknown']` if their
 *     vertical doesn't care.
 *
 * Vendor-neutral. The doc that motivated this lives at Kadam, but the
 * pattern (SSP doesn't capture client-hints → DSP works with degraded
 * data) applies to many networks. No Kadam-specific code here.
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

// Major-version threshold below which client-hints weren't a concern.
// Chrome 100 / Edge 100 / Opera 80 — released 2022; before that, UA
// string still carried full detail and missing sua is unsurprising.
const UA_CH_ERA_THRESHOLD = {
  Chrome: 100,
  Chromium: 100,
  Edg: 100, // matches "Edg/" prefix in modern Edge UA
  OPR: 80,
};

function looksLikeUACHEraBrowser(ua) {
  if (!ua || typeof ua !== 'string') return false;
  // Match the major version after a known brand token.
  for (const [brand, threshold] of Object.entries(UA_CH_ERA_THRESHOLD)) {
    const re = new RegExp(`\\b${brand}\\/(\\d+)`, 'i');
    const m = ua.match(re);
    if (m) {
      const major = parseInt(m[1], 10);
      if (Number.isFinite(major) && major >= threshold) return true;
    }
  }
  return false;
}

function hasSuaPlatform(sua) {
  return !!(
    sua &&
    typeof sua === 'object' &&
    sua.platform &&
    (sua.platform.brand || (Array.isArray(sua.platform.version) && sua.platform.version.length))
  );
}

function hasSuaBrowsers(sua) {
  return !!(sua && Array.isArray(sua.browsers) && sua.browsers.length);
}

function validate(req /*, ctx */) {
  const findings = [];
  const device = req && typeof req === 'object' ? req.device : null;
  if (!device || typeof device !== 'object') return findings;

  const ua = device.ua;
  const sua = device.sua;
  const os = device.os;
  const osv = device.osv;
  // `device.browser` isn't IAB-standard; some dialects put it under
  // device.ext.browser. We accept either, since the rule is "do we
  // have ANY browser identity?".
  const browser = device.browser || (device.ext && device.ext.browser);

  // Rule 1: SUA missing on UA-CH-era browser.
  if (looksLikeUACHEraBrowser(ua) && !sua) {
    findings.push(F('device.client_hints.sua_missing', LEVELS.WARNING, 'device.sua'));
  }

  // Rule 2: OS completely unknown.
  if (!os && !osv && !hasSuaPlatform(sua)) {
    findings.push(F('device.client_hints.os_unknown', LEVELS.WARNING, 'device.os'));
  }

  // Rule 3: Browser identity unknown — neither legacy fields nor SUA
  // carry it, AND UA string is empty / unclassifiable. We don't try
  // to parse the UA string ourselves here (that's a known
  // anti-pattern); we just check whether SOMETHING usable exists.
  if (!browser && !hasSuaBrowsers(sua) && !ua) {
    findings.push(F('device.client_hints.browser_unknown', LEVELS.WARNING, 'device.browser'));
  }

  return findings;
}

module.exports = {
  id: 'client-hints',
  description:
    'Flags missing User-Agent Client Hints / Structured-UA data — bid is valid but targeting degrades.',
  appliesTo: ['ORTB_REQUEST'],
  validate,

  // Exported for tests
  _looksLikeUACHEraBrowser: looksLikeUACHEraBrowser,
  _hasSuaPlatform: hasSuaPlatform,
  _hasSuaBrowsers: hasSuaBrowsers,
};
