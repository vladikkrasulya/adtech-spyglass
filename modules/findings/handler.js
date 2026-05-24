'use strict';

/**
 * modules/findings/handler.js — GET /api/v1/finding-catalog
 *
 * Returns the full finding-ID catalog built from:
 *   packages/core/messages/{lang}.json  — message template per ID
 *   packages/core/spec-refs.json        — IAB spec URL per ID
 *
 * Severity is inferred from the finding ID suffix using these rules
 * (in priority order):
 *   _required  → error
 *   _invalid   → error
 *   _mismatch  → error
 *   _recommended → warning
 *   _missing   → warning
 *   _detected  → info
 *   _unknown   → info
 *   everything else → info
 *
 * Query params:
 *   ?lang=en|uk|ru  — defaults to 'en'
 *
 * Response: { ok: true, count: N, lang, items: [{id, severity, message, specRef}] }
 * Cache-Control: public, max-age=300
 */

const fs = require('fs');
const path = require('path');
const { sendJson, sendError } = require('../../lib/http');

const CORE_DIR = path.join(__dirname, '..', '..', 'packages', 'core');
const MESSAGES_DIR = path.join(CORE_DIR, 'messages');
const SPEC_REFS_PATH = path.join(CORE_DIR, 'spec-refs.json');

const VALID_LANGS = new Set(['en', 'uk', 'ru']);

// Severity inference from ID suffix (longest-match first)
function inferSeverity(id) {
  // Prefix-based: err-* / warn-* / info-* (Etap B+ naming convention)
  if (/^err-/.test(id)) return 'error';
  if (/^warn-/.test(id)) return 'warning';
  if (/^info-/.test(id)) return 'info';
  if (/_required$/.test(id)) return 'error';
  if (/_invalid$/.test(id)) return 'error';
  if (/_mismatch$/.test(id)) return 'error';
  if (/_recommended$/.test(id)) return 'warning';
  if (/_missing$/.test(id)) return 'warning';
  if (/_detected$/.test(id)) return 'info';
  if (/_unknown$/.test(id)) return 'info';
  if (/_empty$/.test(id)) return 'warning';
  return 'info';
}

// Load and cache parsed JSON files (process-lifetime cache — restart clears it)
const _cache = {};
function loadJson(filePath) {
  if (!_cache[filePath]) {
    try {
      _cache[filePath] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
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

      items.push({
        id,
        severity: inferSeverity(id),
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
