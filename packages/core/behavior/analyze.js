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
const { scanCreative } = require('./rules/static');

/**
 * @param {Array<object>} events  raw probe events
 * @param {{ locale?: string, adm?: string }} [opts]
 * @returns {{ findings: Array, status: string, eventCount: number }}
 */
function analyze(events, opts) {
  const o = opts || {};
  const evs = Array.isArray(events) ? events : [];
  const locale = o.locale || FALLBACK_LOCALE;

  // Phase 6 — synthesize static-analysis events from the raw creative
  // (HTML/JS adm, or stringified native JSON). Concat into a separate
  // `enrichedEvs` so eventCount below stays based on the original probe
  // events: static events are *scan signals*, not runtime activity, and
  // shouldn't inflate the Behavior-tab badge. Backwards-compatible —
  // callers that don't pass opts.adm get the pre-Phase-6 pipeline
  // unchanged.
  let enrichedEvs = evs;
  if (typeof o.adm === 'string' && o.adm.length > 0) {
    const staticEvents = scanCreative(o.adm);
    if (staticEvents.length) enrichedEvs = evs.concat(staticEvents);
  }

  let raw = [];
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    try {
      const out = rule(enrichedEvs);
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
