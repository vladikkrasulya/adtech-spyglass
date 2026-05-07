'use strict';

/**
 * Behavior analysis pipeline.
 *
 * The probe (public/creative-probe.js) does runtime instrumentation INSIDE
 * the sandboxed creative iframe — it hooks navigation APIs, tracks the
 * active event stack, and (Phase 1) measures click-target geometry. Each
 * suspicious event is postMessage'd to the parent.
 *
 * This module looks at the resulting timeline and decides which patterns
 * warrant a finding. Rules are pure functions: each takes the events array
 * + a small context object and returns Finding[]. We compose by running
 * every rule and concatenating their output — rules don't talk to each
 * other; cross-event correlation lives inside the rule.
 *
 * Output is decorated identically to validate(): localized `msg` from
 * messages/<locale>.json + `specRef` from spec-refs.json. So a Behavior
 * finding renders the same way in the UI as a validation finding.
 */

const { rollupStatus } = require('../findings');
const { resolve, FALLBACK_LOCALE } = require('../messages');
const specRefs = require('../spec-refs.json');
const RULES = require('./rules');

/**
 * @param {Array<object>} events  raw probe events
 * @param {{ locale?: string }} [opts]
 * @returns {{ findings: Array, status: string, eventCount: number }}
 */
function analyze(events, opts) {
  const o = opts || {};
  const evs = Array.isArray(events) ? events : [];
  const locale = o.locale || FALLBACK_LOCALE;

  let raw = [];
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    try {
      const out = rule(evs);
      if (out && out.length) raw = raw.concat(out);
    } catch (e) {
      // A buggy rule shouldn't take down the whole analysis. Log and
      // continue so the rest of the pipeline still runs.
      if (typeof console !== 'undefined' && console.error) {
        console.error('[behavior] rule threw:', rule.name, e);
      }
    }
  }

  const findings = raw.map((f) =>
    Object.assign({}, f, {
      msg: resolve(f.id, f.params, locale),
      specRef: specRefs[f.id] || null,
    }),
  );

  // probe_ready is an internal handshake (probe → parent: "I'm installed");
  // not a user-visible event. The badge / counts use this trimmed total.
  const userVisible = evs.filter((e) => e && e.kind !== 'probe_ready');

  return {
    findings,
    status: rollupStatus(findings),
    eventCount: userVisible.length,
  };
}

module.exports = { analyze };
