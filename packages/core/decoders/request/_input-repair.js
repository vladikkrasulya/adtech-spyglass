'use strict';

const INVISIBLE_CHARACTERS = /[\u200B\u00AD\uFEFF\u2028\u2029]/g;
const NON_BREAKING_SPACES = /\u00A0/g;
const GUARDED_HTML_AMP = /&amp;(?=[A-Za-z0-9_\-[\]%.]+=)/g;
const DOUBLE_ESCAPED_HTML_AMP = /&amp;(?=amp;)/;
const ALWAYS_TRAILING_PUNCTUATION = new Set(['?', '!', '.', ',', ':', '*', '_', '~']);

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasBalancedParentheses(value) {
  let depth = 0;
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character !== ')') continue;
    if (depth === 0) return false;
    depth -= 1;
  }
  return depth === 0;
}

/**
 * Extract the destination from the deliberately small markdown-link shape
 * accepted by the input contract. Rejecting unbalanced destinations keeps a
 * pasted sequence of several links from being mistaken for one link.
 *
 * @param {string} value
 * @returns {string|null}
 */
function markdownDestination(value) {
  const match = /^\[[^\]]*\]\(([\s\S]*)\)$/.exec(value);
  if (!match || !hasBalancedParentheses(match[1])) return null;
  return match[1];
}

/**
 * Apply the trailing-punctuation rule to a value. Whitespace exposed by an
 * actual punctuation removal is transport residue too; consuming it here is
 * what keeps the ordered pipeline stable on a second run.
 *
 * @param {string} value
 * @returns {string}
 */
function withoutTrailingPunctuation(value) {
  let result = value;

  while (result.length > 0) {
    const finalCharacter = result.at(-1);

    if (ALWAYS_TRAILING_PUNCTUATION.has(finalCharacter)) {
      result = result.slice(0, -1).trimEnd();
      continue;
    }

    if (finalCharacter === ')') {
      const openingCount = (result.match(/\(/g) || []).length;
      const closingCount = (result.match(/\)/g) || []).length;
      if (closingCount > openingCount) {
        result = result.slice(0, -1).trimEnd();
        continue;
      }
    }

    if (finalCharacter === ';') {
      const entityTail = /&[A-Za-z0-9]+;$/.exec(result);
      if (entityTail) {
        result = result.slice(0, -entityTail[0].length).trimEnd();
        continue;
      }
    }

    break;
  }

  return result;
}

/**
 * Remove full-string wrappers iteratively. A removable punctuation tail is
 * held aside while looking for a wrapper, then restored for the next ordered
 * step. That preserves the six-step order while ensuring punctuation cannot
 * expose a wrapper only on the second call.
 *
 * @param {string} value
 * @returns {string}
 */
function withoutWrappers(value) {
  let core = value;
  let trailing = '';
  let changed = false;

  while (true) {
    const withoutTrailing = withoutTrailingPunctuation(core);
    if (withoutTrailing !== core) {
      trailing = core.slice(withoutTrailing.length) + trailing;
      core = withoutTrailing;
    }

    const destination = markdownDestination(core);
    if (destination !== null) {
      core = destination.trim();
      changed = true;
      continue;
    }

    if (core.length < 2) break;
    const first = core[0];
    const last = core.at(-1);
    const isSimplePair =
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`') ||
      (first === '<' && last === '>');
    const isParenthesisPair = first === '(' && last === ')';

    if (!isSimplePair && !isParenthesisPair) break;
    core = core.slice(1, -1).trim();
    changed = true;
  }

  return changed ? core + trailing : value;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeHost(value) {
  const schemeRelative = value.startsWith('//');
  if (/\s+(?:(?:https?:)?\/\/)/i.test(value)) return false;

  let parsed;
  try {
    parsed = new URL(schemeRelative ? `https:${value}` : `https://${value}`);
  } catch {
    return false;
  }

  const hostname = parsed.hostname;
  if (
    !hostname ||
    parsed.username ||
    parsed.password ||
    hostname.includes('_') ||
    hostname.includes('..')
  ) {
    return false;
  }
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;

  const labels = hostname.endsWith('.') ? hostname.slice(0, -1).split('.') : hostname.split('.');
  if (!schemeRelative && labels.length < 2) return false;
  return labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

/**
 * Validate the host part of the explicit host:port heuristic. Single-label
 * Docker names may contain `_`; dotted DNS names keep the stricter host rule.
 *
 * @param {string} value
 * @returns {boolean}
 */
function looksLikePortHost(value) {
  if (!value || /\s|@/.test(value) || value.includes('..')) return false;
  if (value === 'localhost') return true;
  if (!value.includes('.')) {
    return /^[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?$/.test(value);
  }

  let hostname;
  try {
    hostname = new URL(`https://${value}`).hostname;
  } catch {
    return false;
  }
  if (!hostname || hostname.includes('_') || hostname.includes('..')) return false;
  return hostname
    .split('.')
    .every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

/**
 * Add the default scheme only for the two shapes the contract can identify:
 * a numeric host:port prefix, or a conservative host-like string with no
 * leading scheme. Other protocols stay untouched for the decoder layer.
 *
 * @param {string} value
 * @returns {string}
 */
function withDefaultScheme(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value;
  } catch {
    // The two repairable shapes below are expected not to parse without a base.
  }

  if (value.startsWith('//')) return looksLikeHost(value) ? `https:${value}` : value;

  const firstColon = value.indexOf(':');
  const firstBoundary = value.search(/[/?#]/);
  const hasLeadingColon = firstColon >= 0 && (firstBoundary === -1 || firstColon < firstBoundary);

  if (hasLeadingColon) {
    const hostText = value.slice(0, firstColon);
    const rest = value.slice(firstColon + 1);
    const portBoundary = rest.search(/[/?#]/);
    const portText = portBoundary === -1 ? rest : rest.slice(0, portBoundary);
    if (looksLikePortHost(hostText) && /^\d+$/.test(portText)) {
      const port = Number(portText);
      if (port >= 1 && port <= 65535) {
        const candidate = `https://${value}`;
        try {
          new URL(candidate);
          return candidate;
        } catch {
          return value;
        }
      }
    }
    return value;
  }

  return looksLikeHost(value) ? `https://${value}` : value;
}

/**
 * Repair transport artifacts in a human-pasted URL before it reaches
 * `new URL()`. Payload spelling, case, parameter values, and macros are never
 * canonicalized here.
 *
 * @param {string} input
 * @returns {{
 *   text: string,
 *   repairs: Array<{ step: string, before: string, after: string }>,
 *   warnings: Array<{ step: string, code: string, detail: string }>
 * }}
 */
function repairInput(input) {
  /** @type {Array<{ step: string, before: string, after: string }>} */
  const repairs = [];
  /** @type {Array<{ step: string, code: string, detail: string }>} */
  const warnings = [];
  let text = input;

  /**
   * @param {string} step
   * @param {string} before
   * @param {string} after
   */
  function record(step, before, after) {
    if (before !== after) repairs.push({ step, before, after });
  }

  let before = text;
  text = text.trim();
  record('trim', before, text);

  before = text;
  text = text
    .replace(INVISIBLE_CHARACTERS, '')
    .replaceAll('\0', '')
    .replace(NON_BREAKING_SPACES, ' ')
    .trim();
  record('invisible_chars', before, text);

  before = text;
  text = withoutWrappers(text);
  record('wrappers', before, text);

  before = text;
  text = withoutTrailingPunctuation(text);
  record('trailing_punctuation', before, text);

  if (DOUBLE_ESCAPED_HTML_AMP.test(text)) {
    warnings.push({
      step: 'html_amp',
      code: 'double_escaped_amp',
      detail: 'Ambiguous double-escaped &amp; sequence left unchanged.',
    });
  }
  before = text;
  text = text.replace(GUARDED_HTML_AMP, '&');
  record('html_amp', before, text);

  before = text;
  text = withDefaultScheme(text);
  record('scheme', before, text);

  return { text, repairs, warnings };
}

module.exports = { repairInput };
