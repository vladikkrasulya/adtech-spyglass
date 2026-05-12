'use strict';

/**
 * Knowledge Base loader — Phase 10.
 *
 * Reads `knowledge_base/manifest.json` + the referenced sample files
 * from disk on first call, caches them in-memory, and exposes a tiny
 * query surface for two consumers:
 *
 *   1. `format-detect` self-tests — enumerate known samples and prove
 *      the heuristic tags every one correctly. (Phase 10 test rig.)
 *
 *   2. `intel-llm` few-shot context (Phase 10b) — when the LLM is asked
 *      to name a discovered cluster, we fetch 1–3 anonymised field
 *      paths from samples matching the same `format`. The actual
 *      VALUES never leave this module; only top-level field names
 *      go into the prompt. The privacy posture matches the rest of
 *      the Discovery layer (`packages/core/intel/walker.js`).
 *
 * Node-only: uses `fs.readFileSync` at first access. Browser code
 * does not import this module — `format-detect.js` is the
 * isomorphic surface that runs in both.
 *
 * Failure posture: if manifest or any sample fails to load, the
 * loader returns an empty list rather than throwing. The KB is
 * supplementary — Spyglass must work when it's missing.
 */

const fs = require('fs');
const path = require('path');

const KB_ROOT = path.join(__dirname, 'knowledge_base');
const MANIFEST_PATH = path.join(KB_ROOT, 'manifest.json');

let _cache = null;

function loadManifest() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const samples = Array.isArray(parsed && parsed.samples) ? parsed.samples : [];
    _cache = { version: parsed._version || 1, samples };
  } catch (e) {
    _cache = { version: 0, samples: [], error: String(e && e.message) };
  }
  return _cache;
}

function readSampleFile(relativeFile) {
  try {
    const abs = path.join(KB_ROOT, relativeFile);
    // Defense in depth: ensure resolved path stays inside KB_ROOT
    // (manifest is hand-curated, but a future ingestion script could
    // fat-finger a `../something` and we'd silently leak unrelated
    // files into prompts).
    if (!abs.startsWith(KB_ROOT + path.sep) && abs !== KB_ROOT) return null;
    const raw = fs.readFileSync(abs, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

/**
 * List manifest entries, optionally filtered by format / spec / side.
 *
 * @param {{format?:string, spec?:string, side?:string}} [filter]
 * @returns {Array<{id:string, spec:string, side:string, format:string, tags:string[], file:string, source:string, license:string, description:string}>}
 */
function listSamples(filter) {
  const m = loadManifest();
  const f = filter || {};
  return m.samples.filter((s) => {
    if (f.format && s.format !== f.format) return false;
    if (f.spec && s.spec !== f.spec) return false;
    if (f.side && s.side !== f.side) return false;
    return true;
  });
}

/**
 * Load the JSON payload for a given manifest entry id.
 * Returns null if the id is unknown or the file fails to read.
 */
function loadSample(id) {
  const entry = listSamples().find((s) => s.id === id);
  if (!entry) return null;
  return readSampleFile(entry.file);
}

/**
 * Extract the top-level FIELD NAMES (not values) from a sample. Used
 * by Phase 10b few-shot wiring to pass anonymized hints to the LLM.
 *
 * For an array payload (Kadam-style feed), uses the first item.
 * For an oRTB request, walks one level under the most format-relevant
 * subtree (`imp[0].banner` for banner, `imp[0].video` for video, etc.)
 * so the field list reflects the format, not boilerplate.
 *
 * Returns a sorted, de-duplicated array of strings. Caps at 30 entries.
 *
 * @param {string} id
 * @param {string} format
 * @returns {string[]}
 */
function fieldsForSample(id, format) {
  const payload = loadSample(id);
  if (payload == null) return [];

  /** @type {any} */
  let scope = payload;
  if (Array.isArray(scope)) scope = scope[0];
  if (!scope || typeof scope !== 'object') return [];

  // Dive into the format-specific subtree if present so we surface
  // genuinely format-discriminating fields rather than top-level
  // boilerplate (id, at, imp, site, device).
  const imp0 = Array.isArray(scope.imp) && scope.imp[0];
  if (imp0 && format === 'banner' && imp0.banner) scope = imp0.banner;
  else if (imp0 && format === 'video' && imp0.video) scope = imp0.video;
  else if (imp0 && format === 'audio' && imp0.audio) scope = imp0.audio;
  else if (imp0 && format === 'native' && imp0.native) scope = imp0.native;

  const out = new Set();
  for (const k of Object.keys(scope)) {
    out.add(k);
    if (out.size >= 30) break;
  }
  return Array.from(out).sort();
}

/**
 * Build a few-shot context object for the LLM prompt: up to `limit`
 * (default 2) sample summaries that match `format`, each carrying
 * an id, tags, and an anonymized field-name list.
 *
 * Caller composes the prompt; this module only provides the data.
 *
 * @param {string} format
 * @param {{limit?:number, side?:string, spec?:string}} [opts]
 */
function fewShotForFormat(format, opts) {
  const o = opts || {};
  const limit = typeof o.limit === 'number' ? o.limit : 2;
  const matches = listSamples({ format, side: o.side, spec: o.spec });
  return matches.slice(0, limit).map((entry) => ({
    id: entry.id,
    spec: entry.spec,
    side: entry.side,
    format: entry.format,
    tags: entry.tags || [],
    fields: fieldsForSample(entry.id, format),
  }));
}

/** Bypass the in-memory cache (test rig only). */
function _clearCache() {
  _cache = null;
}

module.exports = {
  loadManifest,
  listSamples,
  loadSample,
  fieldsForSample,
  fewShotForFormat,
  _clearCache,
  KB_ROOT,
};
