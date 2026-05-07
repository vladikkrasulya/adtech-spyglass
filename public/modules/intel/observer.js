/* ============================================================
   public/modules/intel/observer.js — Discovery observer.

   Phase 7a foundation. Hooks into spyglass.app.js's analyze flow as a
   side-channel observer: walks the parsed payload, records ext-field
   shapes into IndexedDB, applies decay, and asks the banner module to
   refresh its summary.

   Discovery NEVER mutates analyze() output. A bug here cannot weaken
   validation — observer is read-only relative to the engine pipeline.

   Gate (Phase 7a):
     - validation.status must be 'clean' or 'warnings' (not errors/invalid)
     - Phase 7b will tighten with behavior.malicious.* + behavior.static.*
       error checks once the post-analyze re-evaluation loop ships.

   Pure-helper imports come from packages/core/intel/, exposed in the
   browser via the script-tag bundle (see index.js entrypoint). For
   Phase 7a we inline the small shims so we don't have to wire a
   bundler — the helpers are tiny and clearly-bounded.
   ============================================================ */
(function () {
  'use strict';

  if (window.SpyglassIntelObserver) return;

  // ── Bucketize / walker / fingerprint / decay / gate ──────────────
  // Inlined from packages/core/intel/* so the browser doesn't need a
  // bundler. Keeping logic identical to the Node-tested originals is a
  // maintenance hazard; Phase 7b will publish core/intel as an ES
  // module imported via <script type="module">. For 7a, the surface
  // is small enough that drift is manageable + tests guard the truth.
  // KEEP IN SYNC: packages/core/intel/{walker,fingerprint,decay,gate}.js

  const MAX_DEPTH = 4;
  const MAX_VALUE_CHARS = 200;
  const PII_TOKENS = new Set([
    'ip',
    'ipv6',
    'ifa',
    'dpidsha1',
    'dpidmd5',
    'macsha1',
    'macmd5',
    'didsha1',
    'didmd5',
    'buyeruid',
    'consent',
    'gpp',
    'gpp_sid',
    'usp',
    'us_privacy',
    'token',
    'session_id',
    'sessionid',
    'auth',
    'cookie',
  ]);
  const PII_PATTERNS = [/^.*consent.*$/i, /^.*token.*$/i, /^.*uid$/i, /^.*_id$/i];
  function isPiiPath(c) {
    if (PII_TOKENS.has(c)) return true;
    for (const re of PII_PATTERNS) if (re.test(c)) return true;
    return false;
  }
  function classifyString(s) {
    if (s.length === 0) return 'empty';
    if (/^https?:\/\//i.test(s)) return 'url';
    if (/^\d+$/.test(s)) return 'digits';
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return 'hex';
    if (/^[A-Za-z0-9+/=]+$/.test(s) && /[+/=]/.test(s) && s.length >= 8) return 'base64';
    if (/^[A-Z0-9]+$/.test(s)) return 'alnum-upper';
    if (/^[a-z0-9]+$/.test(s)) return 'alnum-lower';
    if (/^[a-zA-Z0-9]+$/.test(s)) return 'alnum-mixed';
    return 'mixed';
  }
  function fingerprintValue(v) {
    if (v == null) return null;
    const t = typeof v;
    if (t === 'string') return { len: v.length, charClass: classifyString(v) };
    if (t === 'number') {
      if (!Number.isFinite(v)) return { integer: false, sign: 0, magnitude: 0 };
      const abs = Math.abs(v);
      return {
        integer: Number.isInteger(v),
        sign: v === 0 ? 0 : v > 0 ? 1 : -1,
        magnitude: abs === 0 ? 0 : Math.floor(Math.log10(abs)),
      };
    }
    if (t === 'boolean') return {};
    if (Array.isArray(v)) {
      const elemTypes = new Set();
      for (const e of v) {
        if (e === null) elemTypes.add('null');
        else if (Array.isArray(e)) elemTypes.add('array');
        else elemTypes.add(typeof e);
      }
      return { length: v.length, elemTypes: Array.from(elemTypes).sort() };
    }
    if (t === 'object') {
      const keys = Object.keys(v).sort();
      return { keyCount: keys.length, keys: keys.slice(0, 10) };
    }
    return {};
  }

  function findExtEntryPoints(p) {
    const e = [];
    if (!p || typeof p !== 'object') return e;
    const tryAdd = (lp, val) => {
      if (val && typeof val === 'object') e.push({ logicalPath: lp, value: val });
    };
    tryAdd('req.ext', p.ext);
    tryAdd('req.site.ext', p.site && p.site.ext);
    tryAdd('req.app.ext', p.app && p.app.ext);
    tryAdd('req.user.ext', p.user && p.user.ext);
    tryAdd('req.device.ext', p.device && p.device.ext);
    tryAdd('req.regs.ext', p.regs && p.regs.ext);
    tryAdd('req.source.ext', p.source && p.source.ext);
    if (Array.isArray(p.imp)) {
      for (const imp of p.imp) {
        tryAdd('req.imp.ext', imp && imp.ext);
        tryAdd('req.imp.banner.ext', imp && imp.banner && imp.banner.ext);
        tryAdd('req.imp.video.ext', imp && imp.video && imp.video.ext);
        tryAdd('req.imp.native.ext', imp && imp.native && imp.native.ext);
        tryAdd('req.imp.audio.ext', imp && imp.audio && imp.audio.ext);
      }
    }
    tryAdd('res.ext', p.ext);
    if (Array.isArray(p.seatbid)) {
      for (const sb of p.seatbid) {
        tryAdd('res.seatbid.ext', sb && sb.ext);
        if (Array.isArray(sb && sb.bid)) {
          for (const b of sb.bid) tryAdd('res.bid.ext', b && b.ext);
        }
      }
    }
    return e;
  }
  function walkSubtree(value, basePath, depth, out, seen) {
    if (depth > MAX_DEPTH) return;
    if (value == null) return;
    if (typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
    }
    if (Array.isArray(value)) {
      out.push({ path: basePath, type: 'array', valueShape: fingerprintValue(value) });
      return;
    }
    if (typeof value === 'object') {
      for (const k of Object.keys(value)) {
        if (isPiiPath(k)) continue;
        const child = value[k];
        const childPath = basePath + '.' + k;
        if (typeof child === 'string' && child.length > MAX_VALUE_CHARS) {
          out.push({
            path: childPath,
            type: 'string',
            valueShape: { len: child.length, oversize: true },
          });
          continue;
        }
        if (typeof child !== 'object' || child === null) {
          out.push({ path: childPath, type: typeof child, valueShape: fingerprintValue(child) });
          continue;
        }
        out.push({
          path: childPath,
          type: Array.isArray(child) ? 'array' : 'object',
          valueShape: fingerprintValue(child),
        });
        walkSubtree(child, childPath, depth + 1, out, seen);
      }
    }
  }
  function extractFields(payload) {
    const entries = findExtEntryPoints(payload);
    const out = [];
    const seen = new WeakSet();
    for (const { logicalPath, value } of entries) {
      walkSubtree(value, logicalPath, 1, out, seen);
    }
    return out;
  }
  function bucketize(p) {
    if (!p || typeof p !== 'object') return 'unknown';
    if (Array.isArray(p.imp)) {
      for (const imp of p.imp) {
        const e = (imp && imp.ext) || {};
        if (e.subage != null || e.subage0 != null || e.subage_dt || e.subage_ts) return 'push';
      }
    }
    const sitePush = p.site && p.site.ext && p.site.ext.idzone && String(p.site.ext.idzone);
    if (sitePush && /push|sub/i.test(sitePush)) return 'push';
    if (p.app && typeof p.app.bundle === 'string' && p.app.bundle.length > 0) return 'inapp';
    return 'display';
  }

  const MS_PER_HOUR = 3600 * 1000;
  const HALF_LIFE_HOURS = 24;
  function applyDecay(prev, lastSeenAt, now) {
    if (typeof prev !== 'number' || !Number.isFinite(prev) || prev <= 0) return 0;
    if (typeof lastSeenAt !== 'number' || lastSeenAt <= 0) return prev;
    const elapsed = now - lastSeenAt;
    if (elapsed <= 0) return prev;
    const halfLives = elapsed / MS_PER_HOUR / HALF_LIFE_HOURS;
    if (halfLives >= 30) return 0;
    return prev * Math.pow(0.5, halfLives);
  }

  function isLearnable(validation) {
    if (!validation || typeof validation !== 'object')
      return { allow: false, reason: 'no-validation' };
    if (validation.status === 'errors' || validation.status === 'invalid') {
      return { allow: false, reason: 'validation-' + validation.status };
    }
    return { allow: true, reason: null };
  }

  // ── Observer orchestration ───────────────────────────────────────

  const SUGGESTION_NEW_WITHIN_MS = 24 * 3600 * 1000; // count fields seen in last 24h as "new"
  const SUGGESTION_SCORE_MIN = 5; // decayed-score threshold for "noteworthy"

  // Debounce banner refresh — observe() can fire several times in rapid
  // succession (req+res walked separately). Coalescing avoids redundant
  // listObservations() round-trips against IDB.
  let _refreshTimer = null;
  function scheduleBannerRefresh() {
    if (_refreshTimer) return;
    _refreshTimer = setTimeout(async () => {
      _refreshTimer = null;
      if (window.SpyglassIntelBanner && typeof window.SpyglassIntelBanner.refresh === 'function') {
        try {
          const summary = await summariseForBanner();
          window.SpyglassIntelBanner.refresh(summary);
        } catch (e) {
          console.warn('[spyglass-intel] banner refresh failed', e);
        }
      }
    }, 200);
  }

  /**
   * Read all observations, apply decay at READ time, and bucket the
   * "new pattern" count per traffic class. Returns
   *   { total, byBucket: {push: N, display: N, inapp: N, unknown: N} }
   * "new" = (firstSeenAt within last 24h) AND (decayedScore ≥ threshold).
   */
  async function summariseForBanner() {
    if (!window.SpyglassIntelStorage) return { total: 0, byBucket: {} };
    const all = await window.SpyglassIntelStorage.listObservations();
    const now = Date.now();
    const byBucket = {};
    let total = 0;
    for (const r of all || []) {
      const decayed = applyDecay(r.decayedScore || 0, r.lastSeenAt || 0, now);
      const isNew = r.firstSeenAt && now - r.firstSeenAt <= SUGGESTION_NEW_WITHIN_MS;
      if (isNew && decayed >= SUGGESTION_SCORE_MIN) {
        total += 1;
        byBucket[r.bucket] = (byBucket[r.bucket] || 0) + 1;
      }
    }
    return { total, byBucket };
  }

  /**
   * Persist a single field-observation. Reads existing record (if any),
   * applies decay, increments score, writes back.
   */
  async function recordOne(bucket, path, type, valueShape) {
    const storage = window.SpyglassIntelStorage;
    if (!storage) return;
    const key = bucket + '::' + path;
    const now = Date.now();
    let prev;
    try {
      prev = await storage.getObservation(key);
    } catch (e) {
      // First call may race the upgradeneeded transaction; treat as no-prev.
      prev = null;
    }
    const decayedScore = prev
      ? applyDecay(prev.decayedScore || 0, prev.lastSeenAt || 0, now) + 1
      : 1;
    const next = {
      key,
      bucket,
      path,
      type,
      valueShape,
      count: prev && prev.count ? prev.count + 1 : 1,
      firstSeenAt: (prev && prev.firstSeenAt) || now,
      lastSeenAt: now,
      decayedScore,
    };
    try {
      await storage.putObservation(next);
    } catch (e) {
      console.warn('[spyglass-intel] putObservation failed', e);
    }
  }

  /**
   * Public entrypoint. Called by spyglass.app.js after /api/analyze
   * returns. `payload` is the parsed BidRequest OR BidResponse (we run
   * once for each); `validation` is the analyze() result envelope.
   *
   * Defensive: any thrown exception is swallowed + logged. Discovery
   * MUST NOT break the analyze flow.
   */
  async function observe(payload, validation) {
    try {
      // Phase 7a default: discovery is ON. Respect a meta opt-out flag
      // so future Settings UI can toggle without code changes.
      if (window.SpyglassIntelStorage) {
        const flag = await window.SpyglassIntelStorage.getMeta('discovery_enabled');
        if (flag === false) return;
      }
      const gate = isLearnable(validation);
      if (!gate.allow) return;
      const bucket = bucketize(payload);
      if (bucket === 'unknown') return; // Don't pollute index with unbucketed observations
      const fields = extractFields(payload);
      if (!fields.length) return;
      // Run writes in parallel — IDB transactions are independent.
      // Cap at 256 fields per observe to bound worst-case payloads.
      const slice = fields.slice(0, 256);
      await Promise.all(slice.map((f) => recordOne(bucket, f.path, f.type, f.valueShape)));
      scheduleBannerRefresh();
    } catch (e) {
      console.warn('[spyglass-intel] observe failed', e);
    }
  }

  /**
   * Init: seed default config keys on first run. Called by index.js
   * entrypoint after the storage module loads.
   */
  async function init() {
    try {
      if (!window.SpyglassIntelStorage) return;
      const enabled = await window.SpyglassIntelStorage.getMeta('discovery_enabled');
      if (enabled === undefined) {
        // First-run default per Phase 7a: ON. User can toggle later.
        await window.SpyglassIntelStorage.setMeta('discovery_enabled', true);
      }
      // Initial banner paint based on any historical observations.
      scheduleBannerRefresh();
    } catch (e) {
      console.warn('[spyglass-intel] init failed', e);
    }
  }

  window.SpyglassIntelObserver = {
    observe,
    init,
    summariseForBanner,
    // Exposed for inspection / future settings UI:
    HALF_LIFE_HOURS,
    SUGGESTION_NEW_WITHIN_MS,
    SUGGESTION_SCORE_MIN,
  };
})();
