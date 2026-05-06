'use strict';

/**
 * Malicious-ad rules — Phase 3 of the Behavior epic.
 *
 * Detects aggressive in-creative behaviour that escapes the iframe or
 * navigates the user without a real gesture lineage. The probe captures
 * the runtime signal (anchor target=_top click, form.submit with
 * target=_top, navigation API call with no recent gesture); rules here
 * promote each event to a finding with severity decided by the
 * navContext metadata that the probe attached at observation time.
 *
 * Phase 3 ships four patterns:
 *   - frame_bust_anchor → behavior.malicious.frame_bust_anchor
 *       severity ERROR if no gesture lineage, WARNING if within grace
 *       (some banners legitimately link out via target=_top — bad
 *       practice but not unambiguous fraud)
 *   - frame_bust_form  → behavior.malicious.frame_bust_form (always ERROR)
 *   - auto_navigate (no gesture)  → behavior.malicious.auto_redirect (ERROR)
 *   - auto_navigate (within grace) → behavior.malicious.late_redirect (WARNING)
 *
 * The auto_redirect / late_redirect split is the key Phase 3 signal:
 * cloaking creatives chain `click → setTimeout(() => location.href = X, 800)`
 * to dodge naive "no event in stack" classifiers — withinGestureGrace
 * catches that.
 *
 * What's NOT in this rule family (Phase 4 candidates):
 *   - Heavy ads (CPU/network/memory) — separate subsystem,
 *     PerformanceObserver + watchdog ping/pong required.
 *   - Crypto miners — subset of heavy-ads.
 *   - window.top read-trap — write attempts already covered by
 *     Phase 0 Location.* hooks; reads in our sandbox throw
 *     SecurityError natively, no probe interception needed.
 */

const { LEVELS, makeFinding } = require('../../findings');

// Navigation kinds emitted by the probe's reportNavigation chain that
// might warrant auto/late-redirect classification. We only fire the
// auto/late rules on `auto_navigate` (empty event-stack at nav time)
// — kinds like window_open / location_set with a real click in stack
// are already a user-driven flow.
const NAV_KIND_AUTO = 'auto_navigate';

/**
 * behavior.malicious.frame_bust_anchor
 *
 * <a target="_top|_parent"> click captured in capture phase. Severity
 * splits on the gesture lineage:
 *   - withinGestureGrace === true → WARNING (could be a legitimate
 *     "click-out" banner with poor practice)
 *   - else → ERROR (no gesture lineage = unambiguous frame-bust intent)
 */
function frameBustAnchor(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'frame_bust_anchor') continue;

    const inGrace = ev.withinGestureGrace === true;
    out.push(
      makeFinding(
        'behavior.malicious.frame_bust_anchor',
        inGrace ? LEVELS.WARNING : LEVELS.ERROR,
        '',
        {
          target: String(ev.target || '_top'),
          url: String(ev.url || ''),
          withinGestureGrace: inGrace,
          msSinceGesture: typeof ev.msSinceGesture === 'number' ? ev.msSinceGesture : -1,
          eventIndex: i,
        },
      ),
    );
  }
  return out;
}

/**
 * behavior.malicious.frame_bust_form
 *
 * `<form target="_top|_parent">` submitted programmatically or
 * declaratively. Always ERROR — banner creatives have no legitimate
 * reason to ship a form that escapes the iframe (forms are a clear
 * sign of either credential phishing or top-frame redirection
 * dressed up as something else).
 */
function frameBustForm(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'frame_bust_form') continue;

    out.push(
      makeFinding('behavior.malicious.frame_bust_form', LEVELS.ERROR, '', {
        target: String(ev.target || '_top'),
        url: String(ev.url || ''),
        method: String(ev.method || 'form.submit'),
        eventIndex: i,
      }),
    );
  }
  return out;
}

/**
 * behavior.malicious.auto_redirect
 *
 * Auto-navigation event (kind=auto_navigate, empty event-stack) where
 * navContext shows NO recent gesture (withinGestureGrace !== true).
 * Either the probe predates Phase 3 and lacks the metadata (defensive:
 * treat missing as no-grace) or the user truly never interacted before
 * this navigation fired. Either way: ERROR.
 *
 * Co-exists with the existing `kind:auto_navigate` event in the
 * timeline UI — this rule promotes it to a structured finding.
 */
function autoRedirect(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== NAV_KIND_AUTO) continue;
    if (ev.withinGestureGrace === true) continue; // → late_redirect rule below

    out.push(
      makeFinding('behavior.malicious.auto_redirect', LEVELS.ERROR, '', {
        method: String(ev.method || 'unknown'),
        url: String(ev.url || ''),
        msSinceGesture: typeof ev.msSinceGesture === 'number' ? ev.msSinceGesture : -1,
        userActivationEverActive: ev.userActivationEverActive === true,
        eventIndex: i,
      }),
    );
  }
  return out;
}

/**
 * behavior.malicious.late_redirect
 *
 * Auto-navigation event where a real gesture happened within
 * GESTURE_GRACE_MS (probe-side default 500ms) but the navigation itself
 * fired with an empty event-stack. Classic cloaking pattern: the user
 * clicks something visible, then `setTimeout(() => location.href = X, 800)`
 * fires the actual navigation outside the gesture lineage so naive
 * classifiers see a "user-driven" click.
 *
 * Severity WARNING — also catches occasional legitimate "click → animate
 * out → navigate" UX patterns. False-positive cost manageable; finding
 * still surfaces it for human review.
 */
function lateRedirect(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== NAV_KIND_AUTO) continue;
    if (ev.withinGestureGrace !== true) continue;

    out.push(
      makeFinding('behavior.malicious.late_redirect', LEVELS.WARNING, '', {
        method: String(ev.method || 'unknown'),
        url: String(ev.url || ''),
        msSinceGesture: typeof ev.msSinceGesture === 'number' ? ev.msSinceGesture : 0,
        eventIndex: i,
      }),
    );
  }
  return out;
}

module.exports = [frameBustAnchor, frameBustForm, autoRedirect, lateRedirect];
