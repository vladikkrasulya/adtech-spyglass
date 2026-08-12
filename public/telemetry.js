/* ============================================================
   public/telemetry.js — privacy-safe product telemetry client.

   Emits a handful of counter events so the operator can tell real
   external users apart from their own browsing, dev agents, CI and
   crawlers, and can compute activation / repeat usage / D1-D7-D30
   retention. Nothing else.

   WHAT IS NEVER SENT
     - No BidRequest / BidResponse content, and no field that could
       carry any. The body is a fixed shape of enums and opaque ids.
     - No URL path or query string. From an inbound referrer only the
       HOST travels; from the current page only the utm_* parameters.
     - No email, user id, or account data. The server attaches the
       signed-in user id itself from the session cookie.

   IDENTITY
     `ortbtools_vid_v1` is 128 random bits from crypto.getRandomValues,
     kept in localStorage. It is NOT a cookie: it never rides along on
     ordinary page or API requests, only inside an explicit beacon body,
     so it cannot be used for cross-site tracking.

   OPT-OUT (three independent switches)
     1. Explicit  — `?__ot_optout=1` (sticky) or setting
        localStorage `ortbtools_telemetry_optout_v1` = '1'.
        Result: nothing is sent, ever, and the stored id is deleted.
     2. GPC / DNT — `navigator.globalPrivacyControl` or DNT '1'.
        Result: events still count the visit, but no persistent id is
        minted or sent and the server records dnt=1, so the visit can
        never join a retention cohort.
     3. Internal  — `?__ot_internal=1` (sticky) marks this browser as
        owner/dev traffic. Events are still sent but flagged, and the
        server files them outside `external`. Clear with
        `?__ot_internal=0`.

   Loaded as a classic script on every page type, next to version.js.
   Exposes window.ortbtoolsTrack(event) and window.OrtbtoolsTelemetry.
   ============================================================ */
(function () {
  'use strict';

  const ENDPOINT = '/api/v1/telemetry/event';
  const VID_KEY = 'ortbtools_vid_v1';
  const SID_KEY = 'ortbtools_sid_v1';
  const OPTOUT_KEY = 'ortbtools_telemetry_optout_v1';
  const INTERNAL_KEY = 'ortbtools_traffic_internal_v1';

  // Mirrors PRODUCT_EVENTS in lib/product-telemetry.js. The server re-checks
  // this; the copy here just avoids pointless network calls on a typo.
  const EVENTS = [
    'landing',
    'session_start',
    'analyze_success',
    'macro_use',
    'share_use',
    'gist_create',
    'gist_open',
    'diff_use',
    'register',
    'verify_email',
  ];

  // ── Storage helpers (private mode / blocked storage must not throw) ──────
  function lsGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_e) {
      return null;
    }
  }
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_e) {
      return false;
    }
  }
  function lsDel(key) {
    try {
      localStorage.removeItem(key);
    } catch (_e) {
      /* nothing to do */
    }
  }
  function ssGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (_e) {
      return null;
    }
  }
  function ssSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (_e) {
      /* nothing to do */
    }
  }

  /** 128 random bits as 32 lowercase hex chars. */
  function randomId() {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        out += (bytes[i] + 0x100).toString(16).slice(1);
      }
      return out;
    } catch (_e) {
      return '';
    }
  }

  function isValidId(v) {
    return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
  }

  // ── Consent state ────────────────────────────────────────────────────────

  /** Honour Global Privacy Control and legacy Do Not Track alike. */
  function privacySignal() {
    try {
      if (navigator.globalPrivacyControl === true) return true;
      const dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      return dnt === '1' || dnt === 'yes' || dnt === 1;
    } catch (_e) {
      return false;
    }
  }

  function isOptedOut() {
    return lsGet(OPTOUT_KEY) === '1';
  }

  function isInternal() {
    return lsGet(INTERNAL_KEY) === '1';
  }

  /**
   * Apply the sticky `?__ot_optout=` / `?__ot_internal=` switches. Read once at
   * load so the operator can mark a browser by visiting a URL, with no UI.
   */
  function applyUrlSwitches() {
    let params;
    try {
      params = new URLSearchParams(location.search);
    } catch (_e) {
      return;
    }
    const optout = params.get('__ot_optout');
    if (optout === '1') {
      lsSet(OPTOUT_KEY, '1');
      lsDel(VID_KEY);
    } else if (optout === '0') {
      lsDel(OPTOUT_KEY);
    }
    const internal = params.get('__ot_internal');
    if (internal === '1') lsSet(INTERNAL_KEY, '1');
    else if (internal === '0') lsDel(INTERNAL_KEY);
  }

  /**
   * The stable anonymous id, minted on first need. Returns '' when the user
   * opted out, signalled GPC/DNT, or storage is unavailable — in the last case
   * the visit still counts, it simply cannot be linked to another day.
   */
  function visitorId() {
    if (isOptedOut()) return '';
    if (privacySignal()) {
      lsDel(VID_KEY); // do not keep an id we are no longer allowed to use
      return '';
    }
    const existing = lsGet(VID_KEY);
    if (isValidId(existing)) return existing;
    const fresh = randomId();
    if (!fresh) return '';
    return lsSet(VID_KEY, fresh) ? fresh : '';
  }

  /** Per-tab id, so "sessions" means what an analyst expects it to mean. */
  function sessionId() {
    if (isOptedOut()) return '';
    const existing = ssGet(SID_KEY);
    if (isValidId(existing)) return existing;
    const fresh = randomId();
    if (!fresh) return '';
    ssSet(SID_KEY, fresh);
    return fresh;
  }

  /** True when this document load started a new tab session. */
  function isNewSession() {
    return !isValidId(ssGet(SID_KEY));
  }

  // ── Acquisition context ──────────────────────────────────────────────────

  function currentLocale() {
    try {
      const lang = (document.documentElement.getAttribute('lang') || '').slice(0, 2).toLowerCase();
      return lang === 'uk' || lang === 'ru' ? lang : 'en';
    } catch (_e) {
      return 'en';
    }
  }

  /** utm_* only. The server re-sanitises and drops anything unexpected. */
  function utmParams() {
    const out = { utm_source: '', utm_medium: '', utm_campaign: '' };
    try {
      const params = new URLSearchParams(location.search);
      out.utm_source = params.get('utm_source') || '';
      out.utm_medium = params.get('utm_medium') || '';
      out.utm_campaign = params.get('utm_campaign') || '';
    } catch (_e) {
      /* keep the empty defaults */
    }
    return out;
  }

  /**
   * The referrer HOST only — never its path or query. The server drops it again
   * when it points back at this same site.
   */
  function referrerHost() {
    try {
      if (!document.referrer) return '';
      return new URL(document.referrer).hostname || '';
    } catch (_e) {
      return '';
    }
  }

  // ── Transport ────────────────────────────────────────────────────────────

  /**
   * `text/plain` keeps this a CORS "simple request", so sendBeacon works during
   * page unload without a preflight. The server ignores Content-Type and
   * rejects genuinely cross-site posts via Sec-Fetch-Site.
   */
  function send(payload) {
    const body = JSON.stringify(payload);
    try {
      // A plain string (not a Blob) — sendBeacon then sets
      // `text/plain;charset=UTF-8` itself, which is what we want, and the body
      // stays a readable string for proxies, devtools and the browser test.
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return true;
    } catch (_e) {
      /* fall through to fetch */
    }
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        body: body,
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      }).catch(function () {});
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Record one product event. Silently does nothing when opted out, when the
   * event name is unknown, or inside an iframe (an embedded inspector is not a
   * visit). Never throws.
   *
   * @param {string} event one of EVENTS
   * @returns {boolean} whether a beacon was dispatched
   */
  function track(event) {
    try {
      if (EVENTS.indexOf(event) === -1) return false;
      if (isOptedOut()) return false;
      // Embeds are someone else's page view, not ours.
      if (window.top !== window.self) return false;

      const utm = utmParams();
      return send({
        event: event,
        visitor_id: visitorId(),
        session_id: sessionId(),
        locale: currentLocale(),
        referrer: referrerHost(),
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        dnt: privacySignal() ? 1 : 0,
        internal: isInternal(),
      });
    } catch (_e) {
      return false;
    }
  }

  /**
   * Fire `event` at most once per tab session. Used for `macro_use` and
   * `share_use`, where the question is "did this person use the feature",
   * not "how many times did they click".
   */
  const _oncePerSession = {};
  function trackOnce(event) {
    try {
      const key = 'ortbtools_once_' + event;
      if (_oncePerSession[key] || ssGet(key) === '1') {
        _oncePerSession[key] = true;
        return false;
      }
      // Mark it spent only if a beacon really went out. Otherwise an opted-out
      // (or iframed) page would burn the one slot this session has, and the
      // event would stay silent even after the user opts back in.
      if (!track(event)) return false;
      _oncePerSession[key] = true;
      ssSet(key, '1');
      return true;
    } catch (_e) {
      return false;
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  applyUrlSwitches();

  const api = {
    track: track,
    trackOnce: trackOnce,
    visitorId: visitorId,
    sessionId: sessionId,
    isOptedOut: isOptedOut,
    isInternal: isInternal,
    privacySignal: privacySignal,
    optOut: function () {
      lsSet(OPTOUT_KEY, '1');
      lsDel(VID_KEY);
    },
    optIn: function () {
      lsDel(OPTOUT_KEY);
    },
    EVENTS: EVENTS,
  };

  window.OrtbtoolsTelemetry = api;
  window.ortbtoolsTrack = track;
  window.ortbtoolsTrackOnce = trackOnce;

  // One `landing` per document load; `session_start` additionally on the first
  // document of a tab session. Order matters — isNewSession() must be read
  // before sessionId() mints the id.
  try {
    const fresh = isNewSession();
    track('landing');
    if (fresh) track('session_start');
  } catch (_e) {
    /* telemetry must never break page boot */
  }
})();
