/* ============================================================
   public/modules/intel/index.js — ortbtools Intelligence entry.

   Phase 7a: loads storage + observer + banner, wires init.
   ortbtools.app.js calls window.OrtbtoolsIntel.observe(payload, validation)
   after every analyze; the observer gates and persists.

   Why a thin entry: the three submodules are loaded as classic
   <script>s in the shell (so they run before this file). This file
   exposes the consolidated public API + kicks off init().
   ============================================================ */
(function () {
  'use strict';

  if (window.OrtbtoolsIntel) return;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    if (window.OrtbtoolsIntelObserver && typeof window.OrtbtoolsIntelObserver.init === 'function') {
      window.OrtbtoolsIntelObserver.init();
    }
  });

  // ── Phase 7b: temp-dialect runtime (inlined from
  //    packages/core/intel/temp-dialect.js — KEEP IN SYNC) ──────────

  function resolvePath(payloadPair, logicalPath) {
    if (!logicalPath || typeof logicalPath !== 'string') return undefined;
    const segments = logicalPath.split('.');
    if (segments.length < 2) return undefined;
    const root =
      segments[0] === 'req' ? payloadPair.req : segments[0] === 'res' ? payloadPair.res : undefined;
    if (root == null) return undefined;
    return walkSeg(root, segments.slice(1));
  }
  function walkSeg(node, segments) {
    if (!segments.length) return node;
    if (node == null) return undefined;
    const [head, ...rest] = segments;
    if (Array.isArray(node)) {
      for (const elem of node) {
        const child = elem && elem[head];
        if (child !== undefined) {
          const r = walkSeg(child, rest);
          if (r !== undefined) return r;
        }
      }
      return undefined;
    }
    if (typeof node === 'object') {
      const child = node[head];
      if (child === undefined) return undefined;
      return walkSeg(child, rest);
    }
    return undefined;
  }
  function checkType(value, expected) {
    if (value === undefined || value === null) return true;
    if (expected === 'number') return typeof value === 'number';
    if (expected === 'string') return typeof value === 'string';
    if (expected === 'boolean') return typeof value === 'boolean';
    if (expected === 'array') return Array.isArray(value);
    if (expected === 'object')
      return typeof value === 'object' && !Array.isArray(value) && value !== null;
    return true;
  }

  function applyTempDialect(spec, payloadPair) {
    if (!spec || !Array.isArray(spec.fields)) return [];
    const findings = [];
    const dialectName = String(spec.name || 'Custom');
    const now = Date.now();
    if (spec.validUntil && now > spec.validUntil) {
      findings.push({
        id: 'temp.dialect_expired',
        level: 'info',
        path: '',
        params: { dialectName, validUntil: new Date(spec.validUntil).toISOString() },
        msg:
          'Temporary dialect "' +
          dialectName +
          '" has expired — still applied, but consider re-creating.',
        specRef: null,
      });
    }
    for (const f of spec.fields) {
      if (!f || typeof f.path !== 'string') continue;
      const value = resolvePath(payloadPair, f.path);
      if (f.required && value === undefined) {
        findings.push({
          id: 'temp.field_required',
          level: 'error',
          path: f.path,
          params: { dialectName, fieldPath: f.path },
          msg: 'Required by "' + dialectName + '": missing `' + f.path + '`',
          specRef: null,
        });
        continue;
      }
      if (value !== undefined && f.expectedType && !checkType(value, f.expectedType)) {
        findings.push({
          id: 'temp.field_wrong_type',
          level: 'warning',
          path: f.path,
          params: {
            dialectName,
            fieldPath: f.path,
            expected: f.expectedType,
            actual: Array.isArray(value) ? 'array' : typeof value,
          },
          msg:
            'Custom rule "' +
            dialectName +
            '": `' +
            f.path +
            '` expected ' +
            f.expectedType +
            ', got ' +
            (Array.isArray(value) ? 'array' : typeof value),
          specRef: null,
        });
      }
    }
    return findings;
  }

  // ── Active temp-dialect cache + getters ─────────────────────────

  // Cached spec for the currently-active temp dialect. Refreshed by
  // activate() and by getActiveSpec() when the cache is stale.
  let _activeSpec = null;
  let _activeId = null;

  async function getActiveSpec() {
    if (!window.OrtbtoolsIntelStorage) return null;
    // Caller (ortbtools.app.js) gives us the dialect ID via activate(),
    // but on first paint we may not have it yet — derive from URL/storage
    // via the same activeDialect() the inspector uses.
    if (!_activeId) {
      try {
        const qp = new URLSearchParams(location.search);
        const fromUrl = qp.get('dialect');
        if (fromUrl && fromUrl.startsWith('temp:')) _activeId = fromUrl;
        else {
          const fromLs = localStorage.getItem('ortbtools_dialect_v1');
          if (fromLs && fromLs.startsWith('temp:')) _activeId = fromLs;
        }
      } catch (_e) {
        /* */
      }
    }
    if (!_activeId) return null;
    if (_activeSpec && _activeSpec.id === _activeId) return _activeSpec;
    try {
      _activeSpec = await window.OrtbtoolsIntelStorage.getTempDialect(_activeId);
      return _activeSpec || null;
    } catch (_e) {
      return null;
    }
  }

  function activate(id) {
    _activeId = id || null;
    _activeSpec = null; // force re-fetch
    // Bubble out so the inspector can re-paint its selector and re-run
    // analysis on the new dialect. Carries no payload — listeners pull
    // state via OrtbtoolsIntel.list / activeDialectId.
    try {
      window.dispatchEvent(new CustomEvent('ortbtools:intel-dialect-changed', { detail: { id } }));
    } catch (_e) {
      /* CustomEvent may be unavailable in unusual runtimes */
    }
  }

  async function listTempDialects() {
    if (!window.OrtbtoolsIntelStorage) return [];
    try {
      const list = await window.OrtbtoolsIntelStorage.listTempDialects();
      return list || [];
    } catch (_e) {
      return [];
    }
  }

  async function applyToFindings(payloadPair, validation) {
    const spec = await getActiveSpec();
    if (!spec) return validation;
    try {
      const extra = applyTempDialect(spec, payloadPair);
      if (extra.length && validation && Array.isArray(validation.findings)) {
        validation.findings.push(...extra);
        // Recompute status: if any new ERROR, bump status to 'errors'.
        const hasError = extra.some((f) => f.level === 'error');
        if (hasError && validation.status !== 'errors' && validation.status !== 'invalid') {
          validation.status = 'errors';
        } else if (!hasError && extra.some((f) => f.level === 'warning')) {
          if (validation.status === 'clean') validation.status = 'warnings';
        }
      }
    } catch (e) {
      console.warn('[ortbtools-intel] applyTempDialect failed', e);
    }
    return validation;
  }

  // ── Intel suggestion client ──────────────────────────────────────

  // A 503 or network failure flips this latch for the current page session so
  // the UI does not repeatedly call an unavailable server. The legacy `llm`
  // identifier and event names remain as compatibility APIs for older modules;
  // all current responses come from the deterministic rules engine.
  let _llmUnavailable = false;
  function isLlmAvailable() {
    return !_llmUnavailable;
  }

  // The visible namespace makes pre-v1.6 LLM cache rows (`k_*`) unreachable.
  // Prefixing the final key, rather than only the hash input, also rules out a
  // 32-bit collision with the legacy namespace.
  const INTEL_CACHE_NAMESPACE = 'rules-v1';

  // Stable cache key. Hash with djb2 → unsigned 32-bit hex so keys do not grow
  // with path length and IDB lookups stay fast.
  function cacheKey(parts) {
    const s = parts.join('||');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return INTEL_CACHE_NAMESPACE + ':k_' + (h >>> 0).toString(16);
  }

  async function fetchJson(url, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 35000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const j = await r.json().catch(() => null);
      if (r.status === 503) {
        _llmUnavailable = true;
        try {
          window.dispatchEvent(new CustomEvent('ortbtools:intel-llm-unavailable'));
        } catch (_e) {
          /* */
        }
        return { ok: false, status: 503, body: j };
      }
      if (!r.ok) return { ok: false, status: r.status, body: j };
      return { ok: true, status: r.status, body: j };
    } catch (_e) {
      _llmUnavailable = true;
      return { ok: false, status: 0, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Suggest a snake_case name for a cluster of fields. Cached locally
   * for 30 days (fields are stable; renaming the same cluster should not
   * repeat a rules request). Returns null on any failure path so
   * the UI can hide the suggestion silently.
   */
  async function suggestName(bucket, fields, format) {
    if (_llmUnavailable) return null;
    const sortedFields = (fields || []).slice().sort();
    // `format` is part of the cache key because the same field set can map to a
    // different deterministic suggestion when format-specific KB context exists.
    const cleanFormat = typeof format === 'string' ? format : '';
    const key = cacheKey(['suggest-name', bucket || '', cleanFormat, ...sortedFields]);
    if (window.OrtbtoolsIntelStorage) {
      try {
        const cached = await window.OrtbtoolsIntelStorage.getLlmCache(key);
        if (cached && cached.kind === 'name' && cached.engine === 'rules') return cached;
      } catch (_e) {
        /* cache miss is fine */
      }
    }
    const r = await fetchJson('/api/intel/suggest-name', {
      bucket: bucket || 'display',
      fields: sortedFields,
      format: cleanFormat,
    });
    if (
      !r.ok ||
      !r.body ||
      !r.body.success ||
      !r.body.suggestion ||
      r.body.suggestion.engine !== 'rules'
    )
      return null;
    const out = {
      kind: 'name',
      name: r.body.suggestion.name,
      description: r.body.suggestion.description,
      engine: 'rules',
      cachedAt: Date.now(),
    };
    if (window.OrtbtoolsIntelStorage) {
      try {
        await window.OrtbtoolsIntelStorage.putLlmCache(key, out);
      } catch (_e) {
        /* */
      }
    }
    return out;
  }

  /**
   * Suggest a single-purpose label for one field. Hover-fired in the
   * builder; a 30-day cache avoids repeating a rules request for a path.
   */
  async function fieldPurpose(path, charClass, bucket) {
    if (_llmUnavailable) return null;
    const key = cacheKey(['field-purpose', path || '', charClass || '', bucket || '']);
    if (window.OrtbtoolsIntelStorage) {
      try {
        const cached = await window.OrtbtoolsIntelStorage.getLlmCache(key);
        if (cached && cached.kind === 'purpose' && cached.engine === 'rules') return cached;
      } catch (_e) {
        /* */
      }
    }
    const r = await fetchJson('/api/intel/field-purpose', {
      path,
      charClass: charClass || 'unknown',
      bucket: bucket || 'display',
    });
    if (!r.ok || !r.body || !r.body.success || !r.body.purpose || r.body.purpose.engine !== 'rules')
      return null;
    const out = {
      kind: 'purpose',
      purpose: r.body.purpose.purpose,
      confidence: r.body.purpose.confidence,
      engine: 'rules',
      cachedAt: Date.now(),
    };
    if (window.OrtbtoolsIntelStorage) {
      try {
        await window.OrtbtoolsIntelStorage.putLlmCache(key, out);
      } catch (_e) {
        /* */
      }
    }
    return out;
  }

  window.OrtbtoolsIntel = {
    /**
     * Observe a (payload, validation) pair. No-ops when discovery is
     * disabled or the gate rejects. Errors are swallowed.
     */
    observe: function (payload, validation) {
      if (!window.OrtbtoolsIntelObserver) return;
      window.OrtbtoolsIntelObserver.observe(payload, validation);
    },
    /**
     * Pull the current banner summary on demand (settings UI, debug).
     */
    summary: function () {
      if (!window.OrtbtoolsIntelObserver) return Promise.resolve({ total: 0, byBucket: {} });
      return window.OrtbtoolsIntelObserver.summariseForBanner();
    },
    /**
     * Wipe the field-observation index. Settings UI / privacy reset.
     */
    clear: async function () {
      if (window.OrtbtoolsIntelStorage) await window.OrtbtoolsIntelStorage.clearAll();
      if (window.OrtbtoolsIntelBanner) {
        window.OrtbtoolsIntelBanner.refresh({ total: 0, byBucket: {} });
      }
    },
    // Phase 7b
    activate: activate,
    listTempDialects: listTempDialects,
    getActiveSpec: getActiveSpec,
    applyToFindings: applyToFindings,
    // Suggestion client (legacy availability alias retained below).
    suggestName: suggestName,
    fieldPurpose: fieldPurpose,
    isIntelAvailable: isLlmAvailable,
    isLlmAvailable: isLlmAvailable,
  };
})();
