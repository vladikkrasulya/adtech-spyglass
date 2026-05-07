/* ============================================================
   public/modules/intel/index.js — Spyglass Intelligence entry.

   Phase 7a: loads storage + observer + banner, wires init.
   spyglass.app.js calls window.SpyglassIntel.observe(payload, validation)
   after every analyze; the observer gates and persists.

   Why a thin entry: the three submodules are loaded as classic
   <script>s in the shell (so they run before this file). This file
   exposes the consolidated public API + kicks off init().
   ============================================================ */
(function () {
  'use strict';

  if (window.SpyglassIntel) return;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    if (window.SpyglassIntelObserver && typeof window.SpyglassIntelObserver.init === 'function') {
      window.SpyglassIntelObserver.init();
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
    if (!window.SpyglassIntelStorage) return null;
    // Caller (spyglass.app.js) gives us the dialect ID via activate(),
    // but on first paint we may not have it yet — derive from URL/storage
    // via the same activeDialect() the inspector uses.
    if (!_activeId) {
      try {
        const qp = new URLSearchParams(location.search);
        const fromUrl = qp.get('dialect');
        if (fromUrl && fromUrl.startsWith('temp:')) _activeId = fromUrl;
        else {
          const fromLs = localStorage.getItem('spyglass_dialect_v1');
          if (fromLs && fromLs.startsWith('temp:')) _activeId = fromLs;
        }
      } catch (e) {
        /* */
      }
    }
    if (!_activeId) return null;
    if (_activeSpec && _activeSpec.id === _activeId) return _activeSpec;
    try {
      _activeSpec = await window.SpyglassIntelStorage.getTempDialect(_activeId);
      return _activeSpec || null;
    } catch (e) {
      return null;
    }
  }

  function activate(id) {
    _activeId = id || null;
    _activeSpec = null; // force re-fetch
    // Bubble out so the inspector can re-paint its selector and re-run
    // analysis on the new dialect. Carries no payload — listeners pull
    // state via SpyglassIntel.list / activeDialectId.
    try {
      window.dispatchEvent(new CustomEvent('spyglass:intel-dialect-changed', { detail: { id } }));
    } catch (e) {
      /* CustomEvent may be unavailable in unusual runtimes */
    }
  }

  async function listTempDialects() {
    if (!window.SpyglassIntelStorage) return [];
    try {
      const list = await window.SpyglassIntelStorage.listTempDialects();
      return list || [];
    } catch (e) {
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
      console.warn('[spyglass-intel] applyTempDialect failed', e);
    }
    return validation;
  }

  window.SpyglassIntel = {
    /**
     * Observe a (payload, validation) pair. No-ops when discovery is
     * disabled or the gate rejects. Errors are swallowed.
     */
    observe: function (payload, validation) {
      if (!window.SpyglassIntelObserver) return;
      window.SpyglassIntelObserver.observe(payload, validation);
    },
    /**
     * Pull the current banner summary on demand (settings UI, debug).
     */
    summary: function () {
      if (!window.SpyglassIntelObserver) return Promise.resolve({ total: 0, byBucket: {} });
      return window.SpyglassIntelObserver.summariseForBanner();
    },
    /**
     * Wipe the field-observation index. Settings UI / privacy reset.
     */
    clear: async function () {
      if (window.SpyglassIntelStorage) await window.SpyglassIntelStorage.clearAll();
      if (window.SpyglassIntelBanner) {
        window.SpyglassIntelBanner.refresh({ total: 0, byBucket: {} });
      }
    },
    // Phase 7b
    activate: activate,
    listTempDialects: listTempDialects,
    getActiveSpec: getActiveSpec,
    applyToFindings: applyToFindings,
  };
})();
