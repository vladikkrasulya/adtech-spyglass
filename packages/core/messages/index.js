'use strict';

/**
 * Locale resolver for finding messages.
 *
 * Architecture (per ARCHITECTURE §4.3):
 *   - Validator emits findings with stable {id, params, level, path}
 *   - Presentation layer resolves id → localized string at the last possible
 *     moment, optionally on the client (for the public demo)
 *   - Server resolves message text on the way out via this module so the API
 *     payload is human-readable for callers that don't have the locale dict.
 *
 * Phase 3 will swap the trivial {var} interpolator below for ICU MessageFormat
 * (intl-messageformat) once we need plurals. The resolve() signature is the
 * stable boundary — callers won't change.
 */

const uk = require('./uk.json');
const en = require('./en.json');

const LOCALES = { uk, en };
const FALLBACK_LOCALE = 'uk';

/**
 * Resolve a finding id (or any registry key) to a localized string with
 * parameter interpolation.
 *
 *   resolve('imp.banner.size_required', { num: 1 }, 'uk')
 *
 * Resolution order: requested locale → UK fallback → "[id]" placeholder.
 *
 * @param {string} id
 * @param {Record<string, unknown>} [params]
 * @param {string} [locale]
 * @returns {string}
 */
function resolve(id, params, locale) {
  const dict = LOCALES[locale] || LOCALES[FALLBACK_LOCALE];
  const fallback = LOCALES[FALLBACK_LOCALE];
  const tpl = dict[id] || fallback[id];
  if (!tpl) return '[' + id + ']';
  return interpolate(tpl, params || {});
}

// Tiny `{var}` interpolator. Missing vars stay literal (helps debugging).
// `{{var}}` is treated as escaped `{var}` for literal output (used in JSON
// previews — e.g. macros like `${{macro}}` should render as `${MACRO}`).
function interpolate(tpl, params) {
  return tpl.replace(/\{(\{?)(\w+)\}?\}/g, (whole, escape, key) => {
    if (escape === '{') return '{' + key + '}'; // literal
    return params[key] != null ? String(params[key]) : whole;
  });
}

// Don't advertise a locale that's still a stub (en.json holds only `_note`
// until Phase 3). Otherwise the API would accept `?locale=en` and silently
// fall back to UK strings — meta would lie about what was returned.
function isPopulated(dict) {
  const keys = Object.keys(dict).filter((k) => !k.startsWith('_'));
  return keys.length > 0;
}

function listLocales() {
  return Object.keys(LOCALES).filter((k) => isPopulated(LOCALES[k]));
}

module.exports = { resolve, listLocales, FALLBACK_LOCALE };
