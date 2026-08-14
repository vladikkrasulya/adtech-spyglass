'use strict';

/**
 * Findings for defects that only exist in the bytes.
 *
 * Every other rule in this package reads a parsed object, which is the right
 * input for almost everything and the wrong one for three defects that the
 * parse itself erases:
 *
 *   - a duplicate key: `JSON.parse` keeps one value and the other is gone, with
 *     no record that a choice was made. RFC 8259 §4 leaves which one undefined,
 *     so two receivers can legitimately read different values from the same
 *     bytes — and one of those values can be a bid floor.
 *   - an integer past 2^53-1: the token is read into a JS number and comes back
 *     spelled differently. Measured: 9007199254740993 becomes …992 in Node,
 *     while Python returns it intact, so the same bytes give different ids
 *     depending on who receives them.
 *   - a raw control character inside a string: forbidden unescaped by
 *     RFC 8259 §7, tolerated by some receivers, rejected by others.
 *
 * `scanRawJson` finds all three by reading the text. This module is only the
 * translation from its output into findings — no scanning logic lives here.
 *
 * Severity follows consequence, not spec pedantry. A duplicate key on a field
 * that decides money or identity is an error, because two participants reading
 * the same bytes will disagree about the amount. Anywhere else it is a warning:
 * still a defect, still worth removing, but nobody's invoice depends on it.
 */

const { scanRawJson } = require('./raw-json');
const { makeFinding, LEVELS } = require('./findings');

/**
 * Leaf names where two receivers disagreeing is a billing or identity event
 * rather than a cosmetic one. Matched on the final path segment, so
 * `imp[0].bidfloor` and `bidfloor` both count.
 */
const CONSEQUENTIAL_KEYS = new Set([
  'bidfloor',
  'bidfloorcur',
  'price',
  'cur',
  'id',
  'impid',
  'seat',
  'tmax',
  'at',
  'dealid',
  'crid',
  'adomain',
]);

/**
 * @param {string} path Finding path such as `imp[0].bidfloor`.
 * @returns {boolean}
 */
function isConsequential(path) {
  const leaf = String(path || '')
    .split('.')
    .pop()
    .replace(/\[\d+\]$/, '');
  return CONSEQUENTIAL_KEYS.has(leaf);
}

/**
 * Validate the raw bytes of a payload the caller still holds as text.
 *
 * Returns an empty finding list for anything it cannot scan, including a text
 * that is not valid JSON: reporting a parse error here would duplicate what the
 * caller already knows, and the scan's partial results are still emitted so a
 * truncated paste does not hide what was in it.
 *
 * @param {string} text Raw payload exactly as received, before any parse.
 * @returns {{ findings: Array<Object> }}
 */
function validateRawJson(text) {
  const findings = [];
  if (typeof text !== 'string' || text.length === 0) return { findings };

  const scan = scanRawJson(text);

  for (const d of scan.duplicateKeys) {
    const values = d.occurrences.map((o) => o.value);
    findings.push(
      makeFinding(
        'payload.duplicate_key',
        isConsequential(d.path) ? LEVELS.ERROR : LEVELS.WARNING,
        d.path,
        {
          key: d.key,
          count: d.count,
          values: values.join(' | '),
          line: d.occurrences[0].line,
        },
      ),
    );
  }

  for (const n of scan.unsafeNumbers) {
    // `unsafe-magnitude` means the value survived the round trip but arithmetic
    // on it is already unreliable. That is a warning; the lossy reasons, where
    // the number came back spelled differently, are errors.
    findings.push(
      makeFinding('payload.unsafe_number', n.lossy ? LEVELS.ERROR : LEVELS.WARNING, n.path, {
        raw: n.raw,
        parsed: n.rendered,
        reason: n.reason,
        line: n.line,
      }),
    );
  }

  for (const c of scan.controlCharacters) {
    findings.push(
      makeFinding('payload.control_character', LEVELS.WARNING, c.path, {
        codepoint: c.label,
        where: c.where,
        line: c.line,
      }),
    );
  }

  // The scan caps each list so one misread payload cannot produce a report tens
  // of thousands of lines long. Say when that happened rather than presenting a
  // truncated list as a complete one.
  const capped = Object.keys(scan.truncated).filter((k) => scan.truncated[k]);
  if (capped.length) {
    findings.push(
      makeFinding('payload.raw_scan_truncated', LEVELS.INFO, '', {
        lists: capped.join(', '),
      }),
    );
  }

  return { findings };
}

module.exports = { validateRawJson, CONSEQUENTIAL_KEYS };
