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

  function send(payload) {
    try {
      const msg = Object.assign(
        { type: 'spyglass-probe', v: PROBE_VERSION, ts: Date.now() },
        payload || {},
      );
      parent.postMessage(msg, '*');
    } catch (e) {
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

  function reportNavigation(method, url, extra) {
    const c = classifyTrigger();
    const payload = {
      kind: c.kind || 'navigation',
      method: method,
      url: String(url == null ? '' : url),
      trigger: c.trigger,
    };
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
      } catch (e) {
        return null;
      }
    };
  } catch (e) {
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
        } catch (e) {
          /* sandbox denied */
        }
      };
    } catch (e) {
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
          } catch (e) {
            /* sandbox denied */
          }
        },
      });
    }
  } catch (e) {
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
  } catch (e) {
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
    } catch (e) {
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
  } catch (e) {
    /* */
  }

  send({ kind: 'probe_ready', method: 'init', url: '', trigger: 'no-event' });
})();
