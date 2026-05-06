'use strict';

/**
 * Bot-pattern rules — Phase 2 of the Behavior epic.
 *
 * Detects automation/scripted-input signals on click events captured by
 * the in-iframe probe (creative-probe.js). The probe maintains entropy
 * counters (`mousemove` / `touchstart` capture-phase listeners) and a
 * sliding ring of recent click timestamps; on each click it emits one
 * kind-specific event per pattern matched. Rules here are 1-to-1
 * promotions to findings so the UI can list + label each.
 *
 * Phase 2 ships three patterns:
 *   - center_synth_click  → behavior.bot.center_synth         (ERROR)
 *   - click_burst         → behavior.bot.click_burst          (ERROR)
 *   - phantom_click       → behavior.bot.phantom_click        (WARNING)
 *
 * What's intentionally NOT here yet (Phase 2+ R&D doc):
 *   - center_pixel_perfect (isTrusted=true, dist<1px) — needs a labelled
 *     corpus of human clicks to calibrate FP rate before shipping.
 *   - double_too_fast (2 clicks <100ms) — overlaps with click_burst's
 *     3-in-200ms; revisit when we have real traffic to differentiate.
 *   - path_too_clean (mousemove trajectory entropy) — needs trajectory
 *     sampling, deferred to Phase 3.
 */

const { LEVELS, makeFinding } = require('../../findings');

/**
 * behavior.bot.center_synth
 *
 * Click event whose clientX/Y land within 0.5px of the target's geometric
 * center AND event.isTrusted === false. Canonical pixelbot signature:
 * scripts compute target center via getBoundingClientRect and dispatch
 * a click event there. Synthesized events cannot get isTrusted=true
 * outside WebDriver / CDP — and a creative running in our sandbox iframe
 * has no access to either.
 *
 * Severity: ERROR.
 */
function centerSynthClick(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'center_synth_click') continue;

    const dist = typeof ev.centerDistancePx === 'number' ? ev.centerDistancePx : 0;

    out.push(
      makeFinding('behavior.bot.center_synth', LEVELS.ERROR, '', {
        tagName: String(ev.tagName || 'unknown').toLowerCase(),
        distancePx: dist.toFixed(2),
        eventIndex: i,
      }),
    );
  }
  return out;
}

/**
 * behavior.bot.click_burst
 *
 * 3+ click events fired within a 200ms sliding window. Humans rarely
 * tap that fast on a single target; even rapid double-clicks usually
 * land in the 100-200ms range, three in 200ms is over the human cap.
 * Probe emits ONCE per burst sequence (transition from <3 to ≥3 in
 * window), so each finding represents a distinct burst, not a flood.
 *
 * Severity: ERROR.
 */
function clickBurst(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'click_burst') continue;

    out.push(
      makeFinding('behavior.bot.click_burst', LEVELS.ERROR, '', {
        clickCount: typeof ev.clickCount === 'number' ? ev.clickCount : 3,
        windowMs: typeof ev.windowMs === 'number' ? ev.windowMs : 200,
        eventIndex: i,
      }),
    );
  }
  return out;
}

/**
 * behavior.bot.phantom_click
 *
 * Click event fired with NO preceding `mousemove` AND NO preceding
 * `touchstart` since probe initialization. Synthetic input typical of
 * headless browsers and pixelbot scripts that dispatch click without
 * any input gesture.
 *
 * Severity: WARNING. There IS a rare legitimate case (cursor was already
 * inside the iframe rect at load time → click without intervening
 * mousemove inside the iframe), but probabilistically uncommon enough
 * to flag for a human reviewer.
 */
function phantomClick(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'phantom_click') continue;

    out.push(
      makeFinding('behavior.bot.phantom_click', LEVELS.WARNING, '', {
        tagName: String(ev.tagName || 'unknown').toLowerCase(),
        isTrusted: ev.isTrusted === true,
        eventIndex: i,
      }),
    );
  }
  return out;
}

module.exports = [centerSynthClick, clickBurst, phantomClick];
