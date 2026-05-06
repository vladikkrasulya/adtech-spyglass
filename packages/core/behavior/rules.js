'use strict';

/**
 * Rule registry for behavior analysis. Each rule is a pure function:
 *
 *   rule(events, ctx) → Finding[] | null
 *
 * Append to module.exports to register. Order is meaningful only insofar
 * as findings appear in the same order in the output — composition is
 * concatenative, no rule reads another rule's output.
 *
 * Phase 1 ships a single rule (invisible_overlay_click). The architecture
 * scales to misclick / bot-pattern / malicious-ad rule families per the
 * Behavior R&D doc; they slot in here without changes to analyze.js.
 */

const { LEVELS, makeFinding } = require('../findings');

/**
 * behavior.trap.invisible_overlay
 *
 * Fires when the probe reports an `invisible_overlay_click` — a click
 * landed on a DOM element that
 *   - covers > 50% of the iframe viewport (rect.area / viewport.area)
 *   - has computed opacity < 0.05 OR transparent background (alpha < 0.05
 *     with no background-image)
 *
 * The probe does the geometry + style inspection inside the creative's
 * realm before postMessage'ing the event; this rule just promotes each
 * such event into a finding so the UI can list + highlight them.
 *
 * Severity: ERROR. There is no legitimate creative that ships an invisible
 * full-screen click target; this is a textbook click-skim trap.
 */
function invisibleOverlayClick(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'invisible_overlay_click') continue;

    const ratio = typeof ev.coverageRatio === 'number' ? ev.coverageRatio : 0;
    const opacity = typeof ev.opacity === 'number' ? ev.opacity : 1;
    const bgAlpha = typeof ev.bgAlpha === 'number' ? ev.bgAlpha : 1;

    out.push(
      makeFinding('behavior.trap.invisible_overlay', LEVELS.ERROR, '', {
        tagName: String(ev.tagName || 'unknown').toLowerCase(),
        coverage: Math.round(ratio * 100) + '%',
        opacity: opacity.toFixed(2),
        bgAlpha: bgAlpha.toFixed(2),
        eventIndex: i,
      }),
    );
  }
  return out;
}

module.exports = [invisibleOverlayClick];
