'use strict';

/**
 * Misclick / UX-abuse rules.
 *
 * Family scope: detections for click traps and dark-pattern UI in the
 * creative — not bot heuristics (those live in bot-patterns.js). The
 * probe captures the runtime signal; rules here promote it to findings.
 */

const { LEVELS, makeFinding } = require('../../findings');

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

/**
 * behavior.trap.invisible_overlay_aggregate
 *
 * Fires when the probe reports an `invisible_overlay_aggregate_click` —
 * the sum of viewport coverage across ≥2 invisible elements exceeded
 * 50% at click time, even though no single element crossed the
 * per-element 50% threshold. This catches the split-overlay evasion
 * where a creative ships 10× 12%-viewport transparent divs to escape
 * the original rule.
 *
 * Severity: ERROR. Same intent as `invisible_overlay` (no legitimate
 * creative needs invisible clickable surface covering most of the
 * viewport), just delivered piecewise instead of monolithically.
 */
function invisibleOverlayAggregateClick(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'invisible_overlay_aggregate_click') continue;

    const aggregateRatio = typeof ev.aggregateCoverage === 'number' ? ev.aggregateCoverage : 0;
    const contributors = typeof ev.contributorCount === 'number' ? ev.contributorCount : 0;
    const opacity = typeof ev.opacity === 'number' ? ev.opacity : 1;
    const bgAlpha = typeof ev.bgAlpha === 'number' ? ev.bgAlpha : 1;

    out.push(
      makeFinding('behavior.trap.invisible_overlay_aggregate', LEVELS.ERROR, '', {
        tagName: String(ev.tagName || 'unknown').toLowerCase(),
        coverage: Math.round(aggregateRatio * 100) + '%',
        contributors,
        opacity: opacity.toFixed(2),
        bgAlpha: bgAlpha.toFixed(2),
        eventIndex: i,
      }),
    );
  }
  return out;
}

module.exports = [invisibleOverlayClick, invisibleOverlayAggregateClick];
