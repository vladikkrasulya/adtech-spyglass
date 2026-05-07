'use strict';

/**
 * Malicious-ad rules — Phase 3 + Phase 4 of the Behavior epic.
 *
 * Phase 3 (navigation attacks): detects iframe-escape and gestureless
 * redirects. The probe captures the runtime signal (anchor target=_top
 * click, form.submit with target=_top, navigation API call with no
 * recent gesture); rules here promote each event to a finding with
 * severity decided by the navContext metadata.
 *
 * Phase 4 (resource attacks + thread freeze): the probe's
 * PerformanceObserver hooks emit `heavy_ad_cpu` (Chrome HAI thresholds:
 * 60s cumulative OR 4s in 30s window) and `heavy_ad_network` (IAB 4MB
 * cap). The parent's watchdog injects synthetic `frozen_thread` events
 * when the iframe stops sending heartbeats — the only way to detect a
 * freeze, since a frozen probe can't send postMessages itself.
 *
 * Findings emitted:
 *   - frame_bust_anchor → behavior.malicious.frame_bust_anchor
 *       severity ERROR if no gesture lineage, WARNING if within grace
 *       (some banners legitimately link out via target=_top — bad
 *       practice but not unambiguous fraud)
 *   - frame_bust_form  → behavior.malicious.frame_bust_form (always ERROR)
 *   - auto_navigate (no gesture)  → behavior.malicious.auto_redirect (ERROR)
 *   - auto_navigate (within grace) → behavior.malicious.late_redirect (WARNING)
 *   - heavy_ad_cpu     → behavior.malicious.heavy_ad_cpu (ERROR)
 *   - heavy_ad_network → behavior.malicious.heavy_ad_network (ERROR)
 *   - frozen_thread    → behavior.malicious.frozen_thread (ERROR)
 *   - permission_abuse → behavior.malicious.permission_abuse
 *       severity ERROR if no gesture lineage (malware/spam),
 *       WARNING if within gesture grace (UX dark pattern; banner
 *       creatives have no legitimate cause to request system perms,
 *       but a real click reduces the certainty)
 *
 * The auto_redirect / late_redirect split is the key Phase 3 signal:
 * cloaking creatives chain `click → setTimeout(() => location.href = X, 800)`
 * to dodge naive "no event in stack" classifiers — withinGestureGrace
 * catches that.
 *
 * What's NOT in this rule family:
 *   - performance.memory tracking — non-standard (Chrome only) and
 *     prone to false positives, deliberately skipped per Phase 4 scope.
 *   - Crypto miner heuristics (Worker / WebAssembly fingerprinting) —
 *     would belong here when shipped; not in scope yet.
 *   - window.top read-trap — write attempts already covered by Phase 0
 *     Location.* hooks; reads in our sandbox throw SecurityError
 *     natively, no probe interception needed.
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

/**
 * behavior.malicious.heavy_ad_cpu
 *
 * Probe's PerformanceObserver(longtask) accumulated enough main-thread
 * blocking time to breach Chrome's Heavy Ad Intervention thresholds:
 *   - cumulative ≥ 60s   (HAI hard cap, `breachedThreshold='total'`)
 *   - 30s window ≥ 4s    (HAI soft cap, `breachedThreshold='window'`)
 *
 * Probe emits this event ONCE per creative (dedup via _heavyCpuAlerted
 * flag), so a single event = a single finding. Severity ERROR — there
 * is no legitimate banner that needs that much CPU; this is either a
 * miner, a runaway loop, or aggressive animation/tracking.
 */
function heavyAdCpu(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'heavy_ad_cpu') continue;

    const cumulativeMs = typeof ev.cumulativeMs === 'number' ? ev.cumulativeMs : 0;
    const windowMs = typeof ev.windowMs === 'number' ? ev.windowMs : 0;

    out.push(
      makeFinding('behavior.malicious.heavy_ad_cpu', LEVELS.ERROR, '', {
        breachedThreshold: String(ev.breachedThreshold || 'unknown'),
        cumulativeMs: cumulativeMs,
        cumulativeSec: (cumulativeMs / 1000).toFixed(1),
        windowMs: windowMs,
        windowSec: (windowMs / 1000).toFixed(1),
        eventIndex: i,
      }),
    );
  }
  return out;
}

/**
 * behavior.malicious.heavy_ad_network
 *
 * Cumulative bytes loaded across the creative's sub-resources crossed
 * IAB's 4MB display-ad cap (also Chrome's HAI network threshold).
 * `transferSize` is preferred but falls back to `decodedBodySize` when
 * the resource is CORS-blocked without Timing-Allow-Origin (slight
 * overcount, acceptable at this scale).
 *
 * Severity ERROR — banner creatives over 4MB are fundamentally broken
 * regardless of intent: they wreck mobile data plans and slow LCP.
 */
function heavyAdNetwork(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'heavy_ad_network') continue;

    const bytes = typeof ev.cumulativeBytes === 'number' ? ev.cumulativeBytes : 0;

    out.push(
      makeFinding('behavior.malicious.heavy_ad_network', LEVELS.ERROR, '', {
        cumulativeBytes: bytes,
        cumulativeMb: (bytes / (1024 * 1024)).toFixed(2),
        resourceCount: typeof ev.resourceCount === 'number' ? ev.resourceCount : 0,
        eventIndex: i,
      }),
    );
  }
  return out;
}

/**
 * behavior.malicious.frozen_thread
 *
 * Synthesized BY THE PARENT (not the probe — a frozen probe can't
 * send postMessages). The parent watchdog in spyglass.app.js injects a
 * `kind:'frozen_thread'` event into __spyglassBehavior.events when the
 * heartbeat lag exceeds FROZEN_THRESHOLD_MS (default 3.5s). This rule
 * promotes the synthetic event to a finding the same way it would for
 * any probe-emitted event — engine doesn't need to know who the source
 * was, the kind tag is enough.
 *
 * Severity ERROR. A creative that hangs the JS thread for >3 seconds
 * is broken (or hostile) regardless of intent.
 */
function frozenThread(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'frozen_thread') continue;

    out.push(
      makeFinding('behavior.malicious.frozen_thread', LEVELS.ERROR, '', {
        msSinceLastHeartbeat:
          typeof ev.msSinceLastHeartbeat === 'number' ? ev.msSinceLastHeartbeat : 0,
        secSinceLastHeartbeat: (
          (typeof ev.msSinceLastHeartbeat === 'number' ? ev.msSinceLastHeartbeat : 0) / 1000
        ).toFixed(1),
        method: String(ev.method || 'parent-watchdog'),
        eventIndex: i,
      }),
    );
  }
  return out;
}

/**
 * behavior.malicious.permission_abuse
 *
 * Phase 5. The probe wraps every system-permission-gated API
 * (Notification.requestPermission, geolocation, getUserMedia,
 * permissions.query, requestFullscreen, serviceWorker.register) and
 * emits a permission_abuse event for each call, with navContext metadata.
 *
 * Severity splits on gesture lineage:
 *   - withinGestureGrace !== true → ERROR (no recent gesture; categorical
 *     malware/spam — the creative is asking for system permissions while
 *     the user hasn't interacted at all, or pre-Phase-5 probe lacks
 *     metadata, in which case defensive default = ERROR)
 *   - withinGestureGrace === true → WARNING (request piggy-backed on a
 *     recent click; technically the legitimate path for the API, but
 *     no banner creative has cause to ask, so it surfaces for review
 *     instead of silently passing)
 *
 * One finding per emitted event. Multiple permission requests across
 * different APIs each produce their own finding so analysts see the
 * full surface (push + geo + camera from a single creative is a strong
 * pattern signal).
 */
function permissionAbuse(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'permission_abuse') continue;

    const inGrace = ev.withinGestureGrace === true;
    out.push(
      makeFinding(
        'behavior.malicious.permission_abuse',
        inGrace ? LEVELS.WARNING : LEVELS.ERROR,
        '',
        {
          apiKind: String(ev.apiKind || 'unknown'),
          method: String(ev.method || ''),
          mediaSubKind: ev.mediaSubKind ? String(ev.mediaSubKind) : '',
          withinGestureGrace: inGrace,
          msSinceGesture: typeof ev.msSinceGesture === 'number' ? ev.msSinceGesture : -1,
          eventIndex: i,
        },
      ),
    );
  }
  return out;
}

module.exports = [
  frameBustAnchor,
  frameBustForm,
  autoRedirect,
  lateRedirect,
  heavyAdCpu,
  heavyAdNetwork,
  frozenThread,
  permissionAbuse,
];
