'use strict';

/**
 * Plugin registry for validator rules.
 *
 * Legacy `rules-request.js` / `rules-response.js` are still authoritative
 * for the IAB-spec baseline. THIS file is the modular surface for new
 * checks — each plugin lives in its own folder under `rules/<name>/` and
 * gets called by `runRulePlugins()` in addition to the legacy validators.
 *
 * Add a plugin: drop it in PLUGINS below. The plugin must match the
 * contract in `rules/README.md`.
 *
 * Findings from plugins join legacy findings BEFORE dedup+sort in
 * `index.js` — same shape, same lifecycle.
 */

const { TYPES } = require('../detect');

const PLUGINS = [
  // 1. Client hints — flags missing UA-CH / Structured-UA data that
  //    modern (Chrome/Edge 100+) browsers would carry. Warning severity
  //    because the bid still works, just with coarser targeting.
  require('./client-hints'),

  // 2. imp.secure — checks each impression's `secure` flag. Warns when
  //    missing/0 (HTTPS publishers risk mixed-content blocks); errors
  //    when the value isn't 0 or 1 (oRTB §3.2.4 violation).
  require('./imp-secure'),

  // 3. pop-request — request-side checks that fire ONLY when a pop /
  //    popunder / clickunder hint is present on the request (fcap
  //    missing → warn, banner.btype:[4] missing → info, secure:1
  //    + pop → info).
  require('./pop-request'),

  // 4. pop-response — response-side check that a bid in a pop-tagged
  //    response actually ships a redirect / window.open in adm
  //    instead of banner HTML (mis-shaped pop bids don't render).
  require('./pop-response'),

  // 5. dialects-questions (v8) — walks imp.ext.* / req.ext.* for unknown
  //    vendor extension keys. Emits `level:'question'` findings carrying
  //    shape-based format suggestions + a stable fingerprint. Non-
  //    blocking; rollupStatus ignores `question` level. If ctx.userDialect
  //    has a saved mapping for a signal, that question is suppressed.
  require('./dialects-questions'),
];

/**
 * Run all registered plugins against a payload.
 *
 * @param {object} payload    The validated payload (oRTB BidRequest /
 *                            BidResponse / etc.). Plugin's `appliesTo`
 *                            field decides whether it runs for a given
 *                            payload kind.
 * @param {string} type       One of TYPES.* (see detect.js).
 * @param {object} ctx        Same context the legacy rules get:
 *                            `{ dialect, version }`.
 * @returns {Array}           Findings array (never null).
 */
function runRulePlugins(payload, type, ctx) {
  const findings = [];
  for (const plugin of PLUGINS) {
    if (Array.isArray(plugin.appliesTo) && !plugin.appliesTo.includes(type)) {
      continue;
    }
    if (typeof plugin.applies === 'function' && !plugin.applies(payload, ctx)) {
      continue;
    }
    try {
      const out = /** @type {(p: any, c: any) => any[]} */ (plugin.validate)(payload, ctx);
      if (Array.isArray(out) && out.length) {
        findings.push(...out);
      }
    } catch (e) {
      // A bug in one plugin must NOT break validation. Log + skip.
      console.error('[validator-plugin]', plugin.id, e && e.stack ? e.stack : e);
    }
  }
  return findings;
}

/**
 * Returns metadata for all registered plugins. Used by future
 * frontend UI to render "active rule groups" toggles.
 */
function listPlugins() {
  return PLUGINS.map((p) => ({
    id: p.id,
    description: p.description || '',
    appliesTo: p.appliesTo || [],
  }));
}

module.exports = { runRulePlugins, listPlugins, TYPES };
