'use strict';

/**
 * modules/findings/handler.js — GET /api/v1/finding-catalog
 *
 * Returns the full finding-ID catalog built from:
 *   packages/core/messages/{lang}.json  — message template per ID
 *   packages/core/spec-refs.json        — IAB spec URL per ID
 *   packages/core/severity-registry.js  — the level the engine emits per ID
 *
 * ── SEVERITY ────────────────────────────────────────────────────────────────
 *
 * Severity used to be inferred here from the shape of the ID string — a table
 * of suffix rules (`_required` → error, `_missing` → warning, `_invalid` →
 * error, everything unmatched → info). It disagreed with the validator for 25
 * of the 64 IDs reachable from `samples/`: `vast.mediafile_missing` was
 * published as `warning` while rules-vast.js emits `error`,
 * `request.30.item.qty_invalid` as `error` while rules-request-30.js emits
 * `warning`, `imp.secure_recommended` as `warning` against an emitted `info`.
 * `question` — a real findings.js level since v8 — had no representation at
 * all, so `dialects.question.unknown_ext_signal` could not be published
 * correctly under any suffix rule.
 *
 * The catalog now reports what packages/core actually puts in `finding.level`,
 * read from the `makeFinding` / `makeCross` call sites by severity-registry.js.
 * The three consumers of this endpoint — /docs/findings, the dialect severity
 * tallies and the site search index — get the engine's own answer.
 *
 * `severity` is therefore on the scale of the family that emits it, and
 * `family` says which scale to read it on:
 *
 *   validator    error | warning | info | question   (findings.js LEVELS)
 *   crosscheck   crit | warn | ok                    (findings.js CROSS_LEVELS)
 *                crit≈error and warn≈warning; `ok` is the check *passing*, and
 *                has no counterpart on the validator scale. Reported verbatim
 *                rather than folded, because folding would publish a value
 *                `finding.level` never holds — the defect this replaced.
 *   mirror-note  'none' — mirror.js notes are `{id, params}` with no level at
 *                all. The old scheme called all 23 of them `info`.
 *   unknown      'unknown' — an ID with message text but no emitter anywhere
 *                in packages/core. Published as unknown rather than defaulted
 *                to `info`, so the catalog does not sound authoritative about
 *                a rule that does not run.
 *
 * `severities` lists every level an ID can carry. It is a single-entry array
 * except for the handful of rules that pick at runtime (`payload.duplicate_key`
 * is error on a consequential path, warning elsewhere); for those `severity`
 * holds the most severe of them.
 *
 * Query params:
 *   ?lang=en|uk|ru  — defaults to 'en'
 *
 * Response: { ok: true, count: N, lang,
 *             items: [{id, severity, severities, family, message, specRef}] }
 * Cache-Control: public, max-age=300
 */

const fs = require('fs');
const path = require('path');
const { sendJson, sendError } = require('../../lib/http');
const severityRegistry = require('../../packages/core/severity-registry');

const CORE_DIR = path.join(__dirname, '..', '..', 'packages', 'core');
const MESSAGES_DIR = path.join(CORE_DIR, 'messages');
const SPEC_REFS_PATH = path.join(CORE_DIR, 'spec-refs.json');

const VALID_LANGS = new Set(['en', 'uk', 'ru']);

// Load and cache parsed JSON files (process-lifetime cache — restart clears it)
const _cache = {};
function loadJson(filePath) {
  if (!_cache[filePath]) {
    try {
      _cache[filePath] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_e) {
      _cache[filePath] = {};
    }
  }
  return _cache[filePath];
}

function handleFindingCatalog(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    let lang = (url.searchParams.get('lang') || 'en').toLowerCase().trim();
    if (!VALID_LANGS.has(lang)) lang = 'en';

    const messages = loadJson(path.join(MESSAGES_DIR, lang + '.json'));
    const specRefs = loadJson(SPEC_REFS_PATH);

    const items = [];
    for (const [id, message] of Object.entries(messages)) {
      // Skip internal comment keys
      if (id.startsWith('_')) continue;
      if (typeof message !== 'string') continue;

      const sev = severityRegistry.describe(id);
      items.push({
        id,
        severity: sev.severity,
        severities: sev.levels.length ? sev.levels : [sev.severity],
        family: sev.family,
        message,
        specRef: specRefs[id] || '',
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    sendJson(res, 200, { ok: true, count: items.length, lang, items });
  } catch (e) {
    sendError(res, 500, 'catalog_failed', e.message);
  }
}

module.exports = {
  id: 'findings',
  routes: [{ method: 'GET', path: '/api/v1/finding-catalog', handler: handleFindingCatalog }],
};
