/* ============================================================
   Spyglass creative-probe — self-contained instrumentation script
   that runs INSIDE the sandboxed iframe, BEFORE the creative HTML.

   Purpose: detect click-skim and auto-navigate behaviour without
   relying on the iframe sandbox to merely block it. The sandbox
   already prevents top-level navigation; the probe makes the
   *attempt* visible so it can be surfaced as a finding.

   Hooks installed:
     - window.open
     - Location.prototype.assign / replace / href setter
     - EventTarget.prototype.addEventListener (wraps every listener
       to track which DOM event is currently firing)
     - HTMLElement.prototype on{click|mouseover|mouseenter|mousemove|
       pointerover|pointerenter} setters (inline `onmouseover="…"`
       creatives bypass addEventListener)
     - HTMLElement.prototype.click (programmatic click)
     - document click (capture phase) — geometry + opacity inspection
       for invisible-overlay click traps (Phase 1 Behavior heuristic)
     - document mousemove + touchstart (capture phase) — input-entropy
       counters used by the Phase 2 click analyser for phantom-click
       detection
     - document click (second capture-phase listener) — bot-pattern
       analysis: center-synth, click-burst, phantom-click (Phase 2
       Behavior heuristics; kept separate from the Phase 1 listener
       so the overlay logic stays untouched)
     - document mousedown / touchstart / pointerdown / keydown (capture
       phase) — gesture timestamp tracker for navContext() (Phase 3)
     - document click (third capture-phase listener) — anchor target=_top
       / _parent frame-bust intent detection (Phase 3)
     - HTMLFormElement.prototype.submit + document submit-event capture
       — form-based frame-bust via target=_top / _parent (Phase 3)
     - PerformanceObserver(longtask) — accumulates main-thread blocking
       time; emits heavy_ad_cpu when Chrome Heavy Ad Intervention
       thresholds breached (Phase 4)
     - PerformanceObserver(resource) — sums transferSize / decodedBodySize
       across sub-resources; emits heavy_ad_network at IAB 4MB cap
       (Phase 4)
     - setInterval heartbeat — 1Hz liveness signal so the parent
       watchdog can detect a frozen iframe thread that can no longer
       send postMessages itself (Phase 4)
     - Notification.requestPermission (Phase 5)
     - navigator.geolocation.getCurrentPosition + watchPosition (Phase 5)
     - navigator.mediaDevices.getUserMedia (camera/mic) (Phase 5)
     - navigator.permissions.query (fingerprinting / permission probing) (Phase 5)
     - Element.prototype.requestFullscreen + legacy webkit/moz/ms variants
       (Phase 5)
     - navigator.serviceWorker.register (persistent push vehicle) (Phase 5)

   Detection lineage:
     activeEventStack tracks the chain of DOM events currently
     dispatching. When a navigation API fires, classifyTrigger()
     reads the topmost event:
       - 'click' / 'pointerdown' / 'mousedown' / 'touchstart' → user gesture, NOT skim
       - mouseover / mouseenter / mousemove (and pointer- variants) → SKIM
       - empty stack (auto-redirect, setTimeout) → AUTO-NAVIGATE

   Events go to parent via postMessage with type='spyglass-probe'.
   The parent (spyglass.app.js) collates and renders them in the
   "Behavior" tab.

   Notes:
     - Probe is loaded as <script src="/creative-probe.js"> from the
       parent origin; sandbox iframes (allow-scripts, no
       allow-same-origin) can fetch same-origin resources because
       they have an opaque origin and no SOP-restricted loads.
     - `window.open` and friends are blocked anyway by the sandbox
       (no allow-popups / allow-top-navigation). Probe runs FIRST so
       we observe the attempt before the browser denies it.
     - All hooks are guarded with try/catch so a failed install on
       any one API doesn't disable the rest.
   ============================================================ */
(function () {
  'use strict';

  if (window.__spyglassProbe) return;
  window.__spyglassProbe = true;

  const PROBE_VERSION = 1;

  const NAV_TRIGGER_HOVER = new Set([
    'mouseover',
    'mouseenter',
    'mousemove',
    'mouseout',
    'mouseleave',
    'pointerover',
    'pointerenter',
    'pointermove',
    'pointerout',
    'pointerleave',
  ]);

  const USER_GESTURE = new Set([
    'click',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
    'keydown',
    'keyup',
    'submit',
  ]);

  // Stack of currently-dispatching event types. `addEventListener` and
  // on-property hooks push/pop around the listener invocation.
  const activeEventStack = [];

  // Phase 2 (bot detection) — input-entropy counters + click-burst ring.
  // Populated by capture-phase listeners on mousemove/touchstart so the
  // click handler can decide phantom / center-synth / burst classification.
  // Counters are cumulative across the probe's lifetime (== one creative);
  // a fresh probe instance on each setAdPreview means clean state.
  let _mousemoveCount = 0;
  let _touchStartCount = 0;
  const _clickTimestamps = [];
  let _burstActive = false;
  const CLICK_BURST_WINDOW_MS = 200;
  const CLICK_BURST_THRESHOLD = 3;
  const CENTER_TOLERANCE_PX = 0.5;

  // Invisible-overlay aggregate detection (v0.37.1 — Pro-audit P1-002 fix).
  // Per-element rule (>50% viewport AND invisible) has been here since
  // Phase 1. We discovered an evasion where a creative ships N transparent
  // divs each <50% of the viewport — none trip the per-element threshold,
  // but their sum is a full-screen click trap.
  //
  // Pre-fix: a click-driven Map (_invisibleEls) accumulated invisible click
  // targets across clicks. That logic NEVER fired in real life — a click
  // trap redirects on the FIRST click, so the Map only ever contained one
  // entry before the user left the page.
  //
  // Post-fix: scan-on-click. On every click (capture phase, runs BEFORE
  // the trap's redirect handler), we sweep all elements that intersect
  // the viewport, identify invisibles, sum their visible coverage. If
  // total > threshold across ≥2 contributors, emit the aggregate event
  // RIGHT NOW — before the trap can navigate away.
  const AGGREGATE_COVERAGE_THRESHOLD = 0.5;
  const AGGREGATE_MIN_CONTRIBUTORS = 2;
  // Bound the scan so a pathological creative with 100k elements can't
  // turn a click into a several-second freeze. Real creatives have
  // <100 elements; even adversarial cases top out around 1000.
  const AGGREGATE_SCAN_CAP = 5000;

  // Phase 3 (malicious-ads) — gesture timing for auto-redirect classification.
  // Capture-phase listeners on the user-input events below update _lastGestureAt;
  // the navigation hooks (window.open / Location.* / anchor click / form.submit)
  // read it via navContext() to decide whether the navigation has any
  // user-gesture lineage, even when navigator.userActivation API is missing
  // (older browsers / certain WebViews).
  let _lastGestureAt = 0; // 0 = no gesture observed yet
  const GESTURE_GRACE_MS = 500;
  const USER_GESTURE_TYPES = ['mousedown', 'touchstart', 'pointerdown', 'keydown'];

  // Phase 4 (heavy ads + freeze watchdog).
  // CPU thresholds mirror Chrome Heavy Ad Intervention (60s cumulative OR
  // 4s within any 30s window of `longtask` PerformanceObserver entries).
  // Network threshold mirrors IAB display ad weight cap (4MB across all
  // sub-resources). Heartbeat lets the parent watchdog detect a frozen
  // thread — see modules/behavior + spyglass.app.js receiver for the
  // parent half of this protocol.
  const HEAVY_CPU_TOTAL_MS = 60000;
  const HEAVY_CPU_WINDOW_MS = 30000;
  const HEAVY_CPU_WINDOW_THRESHOLD_MS = 4000;
  const HEAVY_NETWORK_BYTES = 4 * 1024 * 1024;
  const HEARTBEAT_INTERVAL_MS = 1000;

  let _longTaskTotalMs = 0;
  const _longTaskRing = []; // [{ts, dur}, …] trimmed to HEAVY_CPU_WINDOW_MS
  let _heavyCpuAlerted = false;

  let _networkBytesTotal = 0;
  let _networkResourceCount = 0;
  let _heavyNetworkAlerted = false;

  function send(payload) {
    try {
      const msg = Object.assign(
        { type: 'spyglass-probe', v: PROBE_VERSION, ts: Date.now() },
        payload || {},
      );
      parent.postMessage(msg, '*');
    } catch (_e) {
      /* parent gone */
    }
  }

  function classifyTrigger() {
    const top = activeEventStack[activeEventStack.length - 1];
    if (!top) return { trigger: 'no-event', kind: 'auto_navigate' };
    if (USER_GESTURE.has(top)) return { trigger: top, kind: null };
    if (NAV_TRIGGER_HOVER.has(top)) return { trigger: top, kind: 'click_skim_suspect' };
    return { trigger: top, kind: null };
  }

  // Phase 3 — snapshot input-trust signals at the moment of a navigation
  // attempt. Returned by reference into every nav-event payload so the
  // engine has full classification metadata: it can split `auto_navigate`
  // events into `auto_redirect` (no recent gesture, ERROR) vs `late_redirect`
  // (gesture happened <GESTURE_GRACE_MS ago, WARNING — classic setTimeout
  // cloaking) without re-deriving timing on its own.
  function navContext() {
    let isActive = false;
    let hasBeenActive = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.userActivation) {
        isActive = !!navigator.userActivation.isActive;
        hasBeenActive = !!navigator.userActivation.hasBeenActive;
      }
    } catch (_e) {
      /* feature missing — falls through to gesture-time heuristic */
    }
    const msSinceGesture = _lastGestureAt ? Date.now() - _lastGestureAt : -1;
    return {
      userActivationActive: isActive,
      userActivationEverActive: hasBeenActive,
      msSinceGesture: msSinceGesture, // -1 = never any gesture
      withinGestureGrace: msSinceGesture >= 0 && msSinceGesture <= GESTURE_GRACE_MS,
    };
  }

  function reportNavigation(method, url, extra) {
    const c = classifyTrigger();
    const payload = Object.assign(
      {
        kind: c.kind || 'navigation',
        method: method,
        url: String(url == null ? '' : url),
        trigger: c.trigger,
      },
      navContext(),
    );
    if (extra) {
      for (const k in extra) payload[k] = extra[k];
    }
    send(payload);
  }

  // 1) window.open
  try {
    const origOpen = window.open ? window.open.bind(window) : null;
    window.open = function (url, target, features) {
      reportNavigation('window.open', url, { target: String(target || '') });
      try {
        return origOpen ? origOpen(url, target, features) : null;
      } catch (_e) {
        return null;
      }
    };
  } catch (_e) {
    /* */
  }

  // 2) Location.prototype.assign / replace
  ['assign', 'replace'].forEach(function (method) {
    try {
      const orig = Location.prototype[method];
      Location.prototype[method] = function (url) {
        reportNavigation('location.' + method, url);
        try {
          return orig.call(this, url);
        } catch (_e) {
          /* sandbox denied */
        }
      };
    } catch (_e) {
      /* can't redefine */
    }
  });

  // 3) Location.prototype.href setter
  try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (desc && desc.set) {
      const origSet = desc.set;
      Object.defineProperty(Location.prototype, 'href', {
        configurable: true,
        get: desc.get,
        set: function (v) {
          reportNavigation('location.href=', v);
          try {
            origSet.call(this, v);
          } catch (_e) {
            /* sandbox denied */
          }
        },
      });
    }
  } catch (_e) {
    /* */
  }

  // 4) addEventListener — wrap every listener to track active event type
  try {
    const origAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, opts) {
      if (
        typeof listener !== 'function' &&
        !(listener && typeof listener.handleEvent === 'function')
      ) {
        return origAEL.apply(this, arguments);
      }
      const wrapped = function () {
        activeEventStack.push(type);
        try {
          if (typeof listener === 'function') return listener.apply(this, arguments);
          return listener.handleEvent.apply(listener, arguments);
        } finally {
          activeEventStack.pop();
        }
      };
      return origAEL.call(this, type, wrapped, opts);
    };
  } catch (_e) {
    /* */
  }

  // 5) on{event} property setters — inline `<div onmouseover="…">`
  // bypasses addEventListener; we re-route through addEventListener so
  // the wrapper above tracks them too.
  [
    'onclick',
    'onmouseover',
    'onmouseenter',
    'onmousemove',
    'onpointerover',
    'onpointerenter',
  ].forEach(function (prop) {
    try {
      const eventType = prop.slice(2);
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get: function () {
          return this['__' + prop] || null;
        },
        set: function (handler) {
          const prev = this['__' + prop + '_listener'];
          if (prev) this.removeEventListener(eventType, prev);
          this['__' + prop] = handler;
          if (typeof handler === 'function') {
            const wrapped = function () {
              activeEventStack.push(eventType);
              try {
                return handler.apply(this, arguments);
              } finally {
                activeEventStack.pop();
              }
            };
            this['__' + prop + '_listener'] = wrapped;
            this.addEventListener(eventType, wrapped);
          }
        },
      });
    } catch (_e) {
      /* */
    }
  });

  // 6) HTMLElement.click — programmatic click (e.g. el.click() called
  // from a hover handler is the canonical click-skim primitive).
  try {
    const origClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      const c = classifyTrigger();
      const isAnchor = this.tagName === 'A';
      const href = isAnchor ? String(this.href || '') : '';
      const tgt = isAnchor ? String(this.target || '') : '';
      send({
        kind: c.kind || 'programmatic_click',
        method: 'el.click()',
        url: href,
        target: tgt,
        tagName: this.tagName,
        trigger: c.trigger,
      });
      return origClick.apply(this, arguments);
    };
  } catch (_e) {
    /* */
  }

  // 7) Invisible overlay click detection — Phase 1 Behavior heuristic.
  //    Goal: catch the click-skim primitive where a creative ships a
  //    full-screen transparent element above the visible content to
  //    intercept any click on the page.
  //
  //    On every captured click we measure the target's bounding rect
  //    against the iframe viewport AND inspect computed opacity +
  //    background alpha. A click on an element that
  //      - covers > 50% of viewport AND
  //      - has opacity < 0.05 OR transparent background-color (no image)
  //    has no legitimate creative use case and is reported as
  //    `invisible_overlay_click`. The packages/core/behavior engine
  //    promotes each such event to a behavior.trap.invisible_overlay
  //    finding (severity: error).
  //
  //    Capture phase: we run BEFORE author-attached handlers so even if
  //    the creative stops propagation we still observe the target.
  //    Probe-internal try/catch keeps a measurement throw from breaking
  //    other probe channels.
  try {
    document.addEventListener(
      'click',
      function (e) {
        try {
          const t = e && e.target;
          if (!t || typeof t.getBoundingClientRect !== 'function') return;

          const _rect = t.getBoundingClientRect();
          const vw =
            window.innerWidth ||
            (document.documentElement && document.documentElement.clientWidth) ||
            0;
          const vh =
            window.innerHeight ||
            (document.documentElement && document.documentElement.clientHeight) ||
            0;
          if (!vw || !vh) return;

          const viewport = vw * vh;

          // Helper: classify an element as visible / invisible + return its
          // in-viewport coverage ratio. Returns null if too small to matter.
          function classifyInvisible(el) {
            try {
              // Skip structural roots — HTML and BODY default to transparent
              // background and span the whole viewport, so without this guard
              // every page trips the aggregate detector. They aren't click
              // traps either: clicks "on body" fall through to whatever is
              // underneath, not to the body element itself.
              // IFRAME skipped too — nested iframes have their own probe and
              // we shouldn't double-count their viewport area as our own.
              // (Caught by Playwright smoke 2026-05-11 — pre-fix scan
              // returned contributorCount=11 + agg=236% on a 4-overlay test;
              // post-fix expects ~4-8 contributors.)
              const tag = el.tagName;
              if (tag === 'HTML' || tag === 'BODY' || tag === 'IFRAME') return null;
              const r = el.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) return null;
              // Clip to viewport so off-screen elements don't inflate ratio.
              const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
              const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
              const visArea = visW * visH;
              if (visArea <= 0) return null;
              const ratio = visArea / viewport;
              if (ratio < 0.05) return null;
              const style = window.getComputedStyle(el);
              const opacityRaw = parseFloat(style.opacity);
              const opacity = isNaN(opacityRaw) ? 1 : opacityRaw;
              const bg = String(style.backgroundColor || '');
              let bgAlpha = 1;
              if (bg === 'transparent' || bg === '') {
                bgAlpha = 0;
              } else {
                const m = bg.match(/^rgba?\(([^)]+)\)$/);
                if (m) {
                  const parts = m[1].split(',');
                  if (parts.length === 4) {
                    const a = parseFloat(parts[3]);
                    bgAlpha = isNaN(a) ? 1 : a;
                  }
                }
              }
              const noBgImage = !style.backgroundImage || style.backgroundImage === 'none';
              const isInvisible = opacity < 0.05 || (bgAlpha < 0.05 && noBgImage);
              if (!isInvisible) return null;
              return { ratio, opacity, bgAlpha };
            } catch {
              return null;
            }
          }

          // Per-element rule (Phase 1): the click TARGET itself, if
          // invisible AND >50% viewport, is a textbook click-skim trap.
          const targetClass = classifyInvisible(t);
          if (targetClass && targetClass.ratio >= 0.5) {
            send({
              kind: 'invisible_overlay_click',
              method: 'click',
              url: '',
              trigger: 'click',
              tagName: t.tagName || '',
              coverageRatio: Number(targetClass.ratio.toFixed(3)),
              opacity: Number(targetClass.opacity.toFixed(3)),
              bgAlpha: Number(targetClass.bgAlpha.toFixed(3)),
            });
            return;
          }

          // Aggregate rule (v0.37.1 — Pro-audit P1-002 fix): scan the
          // viewport NOW for ALL invisible elements covering meaningful
          // area. Sum their coverage. If above threshold across ≥2
          // contributors, this is a split-overlay click trap — fire the
          // aggregate finding RIGHT NOW, before the trap can navigate
          // away (we're in capture phase, runs before author handlers).
          //
          // Pre-fix: only-the-click-target tracking via a Map populated
          // over multiple clicks. Click traps redirect on first click,
          // so the Map never accumulated past one entry. End-to-end
          // detection never fired on real attacks.
          let aggregateRatio = 0;
          let contributorCount = 0;
          // Track max-ratio contributor for tagName/opacity finding params.
          let topRatio = 0;
          let topOpacity = 1;
          let topBgAlpha = 1;
          let topTagName = (t.tagName || '').toString();
          const all = document.querySelectorAll('*');
          const scanLimit = Math.min(all.length, AGGREGATE_SCAN_CAP);
          for (let i = 0; i < scanLimit; i++) {
            const el = all[i];
            const c = classifyInvisible(el);
            if (!c) continue;
            aggregateRatio += c.ratio;
            contributorCount++;
            if (c.ratio > topRatio) {
              topRatio = c.ratio;
              topOpacity = c.opacity;
              topBgAlpha = c.bgAlpha;
              topTagName = el.tagName || topTagName;
            }
          }
          if (
            aggregateRatio > AGGREGATE_COVERAGE_THRESHOLD &&
            contributorCount >= AGGREGATE_MIN_CONTRIBUTORS
          ) {
            send({
              kind: 'invisible_overlay_aggregate_click',
              method: 'click',
              url: '',
              trigger: 'click',
              tagName: topTagName,
              aggregateCoverage: Number(aggregateRatio.toFixed(3)),
              contributorCount,
              opacity: Number(topOpacity.toFixed(3)),
              bgAlpha: Number(topBgAlpha.toFixed(3)),
            });
          }
        } catch (_err) {
          /* per-click measurement failure — ignore so we keep observing */
        }
      },
      true,
    );
  } catch (_e) {
    /* listener install failed — non-fatal */
  }

  // 8) Input-entropy counters (Phase 2). Capture-phase listeners
  //    increment closure-scope counters that the bot-pattern click
  //    analyser (hook 9 below) reads. We don't measure trajectory here
  //    — just "did the user move OR tap at all?". Trajectory entropy
  //    (path-too-clean detection) is a Phase 3 candidate.
  try {
    document.addEventListener(
      'mousemove',
      function () {
        _mousemoveCount++;
      },
      true,
    );
  } catch (_e) {
    /* */
  }

  try {
    document.addEventListener(
      'touchstart',
      function () {
        _touchStartCount++;
      },
      true,
    );
  } catch (_e) {
    /* */
  }

  // 9) Bot-pattern click analysis (Phase 2 Behavior heuristic).
  //    Separate capture-phase listener from hook 7 so the existing
  //    invisible-overlay logic stays untouched. Each detection has its
  //    own try/catch — a measurement throw in one channel does not
  //    block the others.
  //
  //    9.A center_synth_click — clientX/Y within CENTER_TOLERANCE_PX
  //         of target's geometric center AND event.isTrusted === false.
  //         Canonical pixelbot signature: scripts read center via
  //         getBoundingClientRect and dispatch a click there. Synthesized
  //         clicks cannot get isTrusted=true outside WebDriver / CDP,
  //         and a sandboxed creative has access to neither.
  //    9.B click_burst        — 3+ clicks within CLICK_BURST_WINDOW_MS
  //         (200ms). Emitted ONCE per burst sequence (transition from
  //         <3 to ≥3 in window) so we don't flood the timeline with one
  //         event per click in the burst.
  //    9.C phantom_click      — click fired while BOTH entropy counters
  //         are still 0 (no mousemove AND no touchstart since probe init).
  //         Synthetic input typical of headless / pixelbots that dispatch
  //         clicks without an input gesture.
  try {
    document.addEventListener(
      'click',
      function (e) {
        const now = Date.now();

        // 9.A center-synth detection
        try {
          const t = e && e.target;
          if (t && typeof t.getBoundingClientRect === 'function') {
            const _rect = t.getBoundingClientRect();
            // Skip degenerate targets (1×1 hit-areas trivially "centered").
            if (rect.width > 4 && rect.height > 4) {
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const dx = (e.clientX || 0) - cx;
              const dy = (e.clientY || 0) - cy;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < CENTER_TOLERANCE_PX && e.isTrusted === false) {
                send({
                  kind: 'center_synth_click',
                  method: 'click',
                  url: '',
                  trigger: 'click',
                  tagName: t.tagName || '',
                  centerDistancePx: Number(dist.toFixed(3)),
                  isTrusted: false,
                });
              }
            }
          }
        } catch (_err) {
          /* center detection failed — continue with other checks */
        }

        // 9.B click-burst (sliding window)
        try {
          _clickTimestamps.push(now);
          while (_clickTimestamps.length > 0 && now - _clickTimestamps[0] > CLICK_BURST_WINDOW_MS) {
            _clickTimestamps.shift();
          }
          if (_clickTimestamps.length >= CLICK_BURST_THRESHOLD) {
            if (!_burstActive) {
              _burstActive = true;
              send({
                kind: 'click_burst',
                method: 'click',
                url: '',
                trigger: 'click',
                clickCount: _clickTimestamps.length,
                windowMs: CLICK_BURST_WINDOW_MS,
              });
            }
          } else {
            _burstActive = false;
          }
        } catch (_err) {
          /* burst detection failed */
        }

        // 9.C phantom-click (zero entropy)
        try {
          if (_mousemoveCount === 0 && _touchStartCount === 0) {
            send({
              kind: 'phantom_click',
              method: 'click',
              url: '',
              trigger: 'click',
              tagName: (e && e.target && e.target.tagName) || '',
              isTrusted: !!(e && e.isTrusted),
            });
          }
        } catch (_err) {
          /* phantom detection failed */
        }
      },
      true,
    );
  } catch (_e) {
    /* listener install failed — non-fatal */
  }

  // 10) User-gesture timestamp tracker (Phase 3). Capture-phase listeners
  //     update _lastGestureAt on every input that browsers count as a
  //     trust-anchor for navigation. navContext() reads this so the
  //     auto-redirect rule has a robust signal even when
  //     navigator.userActivation isn't available (older browsers, some
  //     WebViews). Capture phase so we win over author-attached handlers
  //     that might stopPropagation.
  USER_GESTURE_TYPES.forEach(function (gtype) {
    try {
      document.addEventListener(
        gtype,
        function () {
          _lastGestureAt = Date.now();
        },
        true,
      );
    } catch (_e) {
      /* */
    }
  });

  // 11) Anchor frame-bust intent detection (Phase 3). HTML-only frame
  //     escape via <a target="_top|_parent" href="..."> bypasses the
  //     window.open / Location.* hooks entirely — the browser invokes
  //     the top-frame nav code path directly. We catch the *intent* by
  //     inspecting click events on anchor descendants in capture phase.
  //     The sandbox iframe (no allow-top-navigation) blocks the actual
  //     navigation, but the attempt is what we report.
  //
  //     Severity is delegated to the engine: an anchor click fired
  //     within GESTURE_GRACE_MS of a real gesture is suspicious-but-
  //     possibly-legitimate (some banners do link out via _top); one
  //     fired without any gesture lineage is unambiguous frame-bust.
  try {
    document.addEventListener(
      'click',
      function (e) {
        try {
          const t = e && e.target;
          if (!t || typeof t.closest !== 'function') return;
          // Two routes to a frame-bust anchor:
          //   (1) explicit per-anchor `<a target="_top">`
          //   (2) page-wide `<base target="_top">` + a plain `<a href>`
          // The second one bypassed pre-v0.20.0 detection entirely. Now we
          // resolve target by combining the anchor's own attribute and the
          // first <base> element's target — same precedence the browser
          // itself uses (anchor wins, base falls back).
          const a = t.closest('a[href]');
          if (!a) return;
          let target = String(a.getAttribute('target') || '').toLowerCase();
          if (!target) {
            try {
              const baseEl = document.querySelector('base[target]');
              if (baseEl) target = String(baseEl.getAttribute('target') || '').toLowerCase();
            } catch (_e) {
              /* defensive — querySelector should never throw, but locked-down sandboxes are weird */
            }
          }
          if (target !== '_top' && target !== '_parent') return;
          send(
            Object.assign(
              {
                kind: 'frame_bust_anchor',
                method: 'a[target=' + target + '].click',
                url: String(a.getAttribute('href') || a.href || ''),
                trigger: 'click',
                tagName: 'A',
                target: target,
                isTrusted: !!(e && e.isTrusted),
              },
              navContext(),
            ),
          );
        } catch (_err) {
          /* */
        }
      },
      true,
    );
  } catch (_e) {
    /* */
  }

  // 12) Form-based frame-bust (Phase 3). Two paths to cover:
  //     12.A HTMLFormElement.prototype.submit — programmatic call.
  //          Override the prototype to inspect the form's `target`
  //          before delegating.
  //     12.B 'submit' event in capture phase — declarative form
  //          submission via Enter / type=submit button.
  //     Both paths emit `frame_bust_form` only when target ∈ {_top,
  //     _parent}. The engine treats every such event as ERROR — forms
  //     with target=_top inside a banner creative have no legitimate
  //     use case (unlike anchors, which sometimes do link out).
  try {
    const origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      try {
        const target = String(this.target || this.getAttribute('target') || '').toLowerCase();
        if (target === '_top' || target === '_parent') {
          send(
            Object.assign(
              {
                kind: 'frame_bust_form',
                method: 'form.submit',
                url: String(this.action || this.getAttribute('action') || ''),
                trigger: 'no-event',
                tagName: 'FORM',
                target: target,
              },
              navContext(),
            ),
          );
        }
      } catch (_e) {
        /* measurement failed — still delegate to native */
      }
      return origSubmit.apply(this, arguments);
    };
  } catch (_e) {
    /* */
  }

  try {
    document.addEventListener(
      'submit',
      function (e) {
        try {
          const f = e && e.target;
          if (!f || f.tagName !== 'FORM') return;
          const target = String(f.target || f.getAttribute('target') || '').toLowerCase();
          if (target !== '_top' && target !== '_parent') return;
          send(
            Object.assign(
              {
                kind: 'frame_bust_form',
                method: 'submit-event',
                url: String(f.action || f.getAttribute('action') || ''),
                trigger: 'submit',
                tagName: 'FORM',
                target: target,
                isTrusted: !!(e && e.isTrusted),
              },
              navContext(),
            ),
          );
        } catch (_err) {
          /* */
        }
      },
      true,
    );
  } catch (_e) {
    /* */
  }

  // 13) Heavy-ad CPU detection (Phase 4). PerformanceObserver listens for
  //     `longtask` entries (any task >50ms blocking the main thread) and
  //     accumulates duration both cumulatively and within a 30s sliding
  //     window. Emits `heavy_ad_cpu` ONCE per creative when EITHER
  //     threshold first breaches:
  //       - cumulative ≥ HEAVY_CPU_TOTAL_MS (60s) — Chrome HAI hard cap
  //       - window ≥ HEAVY_CPU_WINDOW_THRESHOLD_MS (4s in 30s) — HAI soft cap
  //     `_heavyCpuAlerted` flag dedupes; never re-fires for the same
  //     creative even if usage keeps climbing.
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      const cpuObserver = new PerformanceObserver(function (list) {
        try {
          const entries = list.getEntries();
          const now = Date.now();
          for (let i = 0; i < entries.length; i++) {
            const dur = entries[i].duration || 0;
            _longTaskTotalMs += dur;
            _longTaskRing.push({ ts: now, dur: dur });
          }
          while (_longTaskRing.length && now - _longTaskRing[0].ts > HEAVY_CPU_WINDOW_MS) {
            _longTaskRing.shift();
          }
          if (_heavyCpuAlerted) return;
          let windowMs = 0;
          for (let i = 0; i < _longTaskRing.length; i++) windowMs += _longTaskRing[i].dur;
          let breached = null;
          if (_longTaskTotalMs >= HEAVY_CPU_TOTAL_MS) breached = 'total';
          else if (windowMs >= HEAVY_CPU_WINDOW_THRESHOLD_MS) breached = 'window';
          if (breached) {
            _heavyCpuAlerted = true;
            send({
              kind: 'heavy_ad_cpu',
              method: 'longtask',
              url: '',
              trigger: 'no-event',
              cumulativeMs: Math.round(_longTaskTotalMs),
              windowMs: Math.round(windowMs),
              breachedThreshold: breached,
            });
          }
        } catch (_err) {
          /* */
        }
      });
      cpuObserver.observe({ entryTypes: ['longtask'] });
    }
  } catch (_e) {
    /* longtask unsupported (older Safari, some WebViews) — no-op */
  }

  // 14) Heavy-ad network detection (Phase 4). PerformanceObserver(resource)
  //     accumulates wire-byte usage across every sub-resource the creative
  //     loads (img, script, fetch, XHR, etc.). When transferSize is 0 due
  //     to CORS gating without Timing-Allow-Origin, fall back to
  //     decodedBodySize so we still get a signal — slight overcount, but
  //     the threshold is generous (4MB) and false positives at that scale
  //     are unlikely. Emits `heavy_ad_network` once per creative.
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      const netObserver = new PerformanceObserver(function (list) {
        try {
          const entries = list.getEntries();
          for (let i = 0; i < entries.length; i++) {
            const ent = entries[i];
            const sz = ent.transferSize || ent.decodedBodySize || 0;
            _networkBytesTotal += sz;
            _networkResourceCount++;
          }
          if (!_heavyNetworkAlerted && _networkBytesTotal >= HEAVY_NETWORK_BYTES) {
            _heavyNetworkAlerted = true;
            send({
              kind: 'heavy_ad_network',
              method: 'resource-timing',
              url: '',
              trigger: 'no-event',
              cumulativeBytes: _networkBytesTotal,
              resourceCount: _networkResourceCount,
            });
          }
        } catch (_err) {
          /* */
        }
      });
      netObserver.observe({ entryTypes: ['resource'] });
    }
  } catch (_e) {
    /* resource entry type unsupported — no-op */
  }

  // 15) Heartbeat (Phase 4). 1Hz liveness ping the parent watchdog uses
  //     to detect a frozen thread. The probe itself can't observe its
  //     own freeze (an infinite loop blocks both setInterval AND
  //     postMessage), so this signal exists *for the parent* — a missed
  //     heartbeat is the only available evidence that the iframe's JS
  //     thread is no longer servicing tasks. Parent half lives in
  //     spyglass.app.js's message receiver: it updates _lastHeartbeatAt
  //     on every probe message (heartbeat or otherwise), and a setInterval
  //     watchdog injects a synthetic kind:'frozen_thread' event into
  //     __spyglassBehavior.events when lag exceeds FROZEN_THRESHOLD_MS.
  try {
    setInterval(function () {
      try {
        send({ kind: 'heartbeat', method: 'heartbeat', url: '', trigger: 'no-event' });
      } catch (_err) {
        /* */
      }
    }, HEARTBEAT_INTERVAL_MS);
  } catch (_e) {
    /* */
  }

  // ── Phase 5 — Permission Abuse hooks ─────────────────────────────
  // System-permission-gated APIs are categorically inappropriate for
  // banner / native creatives: a creative has no legitimate reason to
  // ask for push, geolocation, camera, or fullscreen. The sandbox
  // (allow-scripts only) generally denies these requests at the browser
  // level — but, like with navigation, the *attempt* is the signal.
  //
  // Each wrapper snapshots navContext() at call time so the engine can
  // split severity by gesture lineage (no gesture = ERROR / malware,
  // with gesture = WARNING / dark pattern). Same try/catch-per-hook
  // discipline as Phase 0-4 so a missing API on one platform doesn't
  // kill the rest.
  function permissionHookSend(apiKind, method, extra) {
    const payload = {
      kind: 'permission_abuse',
      apiKind: apiKind,
      method: method,
      url: '',
      trigger: classifyTrigger().trigger,
    };
    if (extra) {
      for (const k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    send(Object.assign(payload, navContext()));
  }

  // 16) Notification.requestPermission — push prompt, the canonical
  //     adware-spam vector. Even sandboxed iframes can call it (the API
  //     resolves to 'denied' in the sandbox), and the call itself is
  //     what we surface.
  try {
    if (window.Notification && typeof window.Notification.requestPermission === 'function') {
      const origNotifReq = window.Notification.requestPermission.bind(window.Notification);
      window.Notification.requestPermission = function (callback) {
        permissionHookSend('notification', 'Notification.requestPermission');
        try {
          return origNotifReq(callback);
        } catch (_e) {
          return Promise.resolve('denied');
        }
      };
    }
  } catch (_e) {
    /* */
  }

  // 17) navigator.geolocation — getCurrentPosition + watchPosition.
  //     watchPosition is an oft-overlooked second entry point that
  //     malware uses for continuous-location tracking; we wrap both.
  try {
    if (navigator.geolocation) {
      ['getCurrentPosition', 'watchPosition'].forEach(function (m) {
        try {
          const orig = navigator.geolocation[m];
          if (typeof orig !== 'function') return;
          navigator.geolocation[m] = function () {
            permissionHookSend('geolocation', 'navigator.geolocation.' + m);
            try {
              return orig.apply(navigator.geolocation, arguments);
            } catch (_e) {
              /* sandbox / permission denied */
            }
          };
        } catch (_e) {
          /* */
        }
      });
    }
  } catch (_e) {
    /* */
  }

  // 18) navigator.mediaDevices.getUserMedia — camera / microphone.
  //     Inspect constraints to record sub-kind (camera / mic / both)
  //     so the engine + UI can distinguish camera-grab from mic-grab.
  try {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = function (constraints) {
        let mediaSubKind = '';
        try {
          const wantsVideo = !!(constraints && constraints.video);
          const wantsAudio = !!(constraints && constraints.audio);
          mediaSubKind =
            wantsVideo && wantsAudio
              ? 'camera+mic'
              : wantsVideo
                ? 'camera'
                : wantsAudio
                  ? 'mic'
                  : '';
        } catch (_e) {
          /* */
        }
        permissionHookSend('getUserMedia', 'navigator.mediaDevices.getUserMedia', {
          mediaSubKind: mediaSubKind,
        });
        try {
          return origGUM(constraints);
        } catch (e) {
          return Promise.reject(e);
        }
      };
    }
  } catch (_e) {
    /* */
  }

  // 19) navigator.permissions.query — does NOT prompt, but it's the
  //     fingerprinting + nag-dismissal probe ("is push already granted?
  //     if so, prompt; if denied, give up; if prompt, harass the user").
  //     A creative invoking this is doing reconnaissance, not work.
  try {
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      const origPermQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (descriptor) {
        let permName = '';
        try {
          permName = descriptor && descriptor.name ? String(descriptor.name) : '';
        } catch (_e) {
          /* */
        }
        permissionHookSend('permissions.query', 'navigator.permissions.query', {
          mediaSubKind: permName,
        });
        try {
          return origPermQuery(descriptor);
        } catch (e) {
          return Promise.reject(e);
        }
      };
    }
  } catch (_e) {
    /* */
  }

  // 20) Element.requestFullscreen + legacy vendor variants. Fullscreen
  //     escape is a classic clickjacking primer — the creative goes
  //     fullscreen on a "hover" or after a synthetic gesture, then
  //     overlays its own UI. Browsers gate this on userActivation so
  //     gestureless calls are auto-denied, but the attempt is the tell.
  [
    'requestFullscreen',
    'webkitRequestFullscreen',
    'mozRequestFullScreen',
    'msRequestFullscreen',
  ].forEach(function (m) {
    try {
      const orig = Element.prototype[m];
      if (typeof orig !== 'function') return;
      Element.prototype[m] = function () {
        permissionHookSend('fullscreen', 'Element.' + m);
        try {
          return orig.apply(this, arguments);
        } catch (_e) {
          /* sandbox / activation denied */
        }
      };
    } catch (_e) {
      /* */
    }
  });

  // 21) navigator.serviceWorker.register — persistent-push vehicle.
  //     A registered SW outlives the iframe and can fire push
  //     notifications indefinitely. Sandbox without allow-same-origin
  //     denies registration outright, but the *attempt* is exactly the
  //     pattern we want flagged: no banner has any business installing
  //     a worker on the visiting domain.
  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      const origSWReg = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function (scriptURL, options) {
        permissionHookSend('serviceWorker', 'navigator.serviceWorker.register', {
          url: String(scriptURL || ''),
        });
        try {
          return origSWReg(scriptURL, options);
        } catch (e) {
          return Promise.reject(e);
        }
      };
    }
  } catch (_e) {
    /* */
  }

  send({ kind: 'probe_ready', method: 'init', url: '', trigger: 'no-event' });
})();
