'use strict';

/**
 * tests/corpus/lib/oracle.js — compare what the product produced with what the
 * specification says it should produce.
 *
 * The oracle is deliberately strict in two directions:
 *   - `must`    a finding the spec justifies has to be present (id, and when
 *               given, exact path and level);
 *   - `mustNot` a finding that would be a FALSE POSITIVE (or a contradictory
 *               positive verdict, e.g. "above floor" for a non-numeric price)
 *               has to be absent.
 * A validation error alone is not a passing result if the crosscheck still
 * reports success for the same field — that is what `consistency` rules are
 * for. Each rule is named so a case can opt in explicitly and a reviewer can
 * read what the rule enforces.
 */

const { isDeepStrictEqual } = require('node:util');

/** @typedef {{id: string, level?: string, path?: string, params?: any, ok?: boolean, side?: string, location?: any}} Finding */
/** @typedef {{id: string, path?: string, level?: string, params?: any, ok?: boolean, side?: string, count?: number}} FindingRef */

/** Expected params are a recursive subset; array values require exact equality.
 * @param {any} actual @param {any} expected
 */
function containsParams(actual, expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected))
    return isDeepStrictEqual(actual, expected);
  return (
    actual != null &&
    typeof actual === 'object' &&
    Object.entries(expected).every(
      ([k, v]) => Object.hasOwn(actual, k) && containsParams(actual[k], v),
    )
  );
}

/**
 * @param {Finding[]} findings
 * @param {string|FindingRef} ref
 * @returns {Finding[]}
 */
function matches(findings, ref) {
  const r = typeof ref === 'string' ? { id: ref } : ref;
  return findings.filter(
    (f) =>
      f.id === r.id &&
      (r.path === undefined || f.path === r.path) &&
      (r.level === undefined || f.level === r.level) &&
      (r.ok === undefined || f.ok === r.ok) &&
      (r.side === undefined || (f.side ?? f.location?.primary?.side) === r.side) &&
      (r.params === undefined || containsParams(f.params, r.params)),
  );
}

/**
 * @param {string|FindingRef} ref
 */
function describe(ref) {
  if (typeof ref === 'string') return ref;
  return `${ref.id}${ref.path !== undefined ? ' @ ' + ref.path : ''}${ref.level ? ' [' + ref.level + ']' : ''}${ref.side ? ' side=' + ref.side : ''}${ref.ok !== undefined ? ' ok=' + ref.ok : ''}${ref.params !== undefined ? ' params=' + JSON.stringify(ref.params) : ''}`;
}

/**
 * @param {Finding[]} findings
 * @returns {string}
 */
function summarize(findings) {
  if (!findings.length) return '(none)';
  return findings
    .map((f) => `${f.id}${f.level ? '[' + f.level + ']' : ''}@${f.path ?? ''}`)
    .join(', ');
}

const LEVEL_RANK = { error: 3, warning: 2, info: 1, question: 0 };

/**
 * @param {string} label
 * @param {{type?: string, version?: {version?: string}|string, status?: string, findings?: Finding[], parseError?: string}|undefined} actual
 * @param {any} expect
 * @param {string[]} failures
 */
function checkSide(label, actual, expect, failures) {
  if (!expect) return;
  if (expect.parse === 'invalid-json') {
    if (!actual || !actual.parseError)
      failures.push(`${label}: expected unparseable JSON, but it parsed`);
    return;
  }
  if (!actual) {
    failures.push(`${label}: no result produced`);
    return;
  }
  if (actual.parseError) {
    failures.push(`${label}: could not parse (${actual.parseError})`);
    return;
  }
  const findings = actual.findings || [];
  if (expect.type !== undefined && actual.type !== expect.type) {
    failures.push(`${label}.type: expected "${expect.type}", got "${actual.type}"`);
  }
  if (expect.version !== undefined) {
    const v =
      typeof actual.version === 'object' && actual.version
        ? actual.version.version
        : actual.version;
    if (v !== expect.version)
      failures.push(`${label}.version: expected ${expect.version}, got ${v}`);
  }
  if (expect.status !== undefined && actual.status !== expect.status) {
    failures.push(
      `${label}.status: expected ${expect.status}, got ${actual.status} — findings: ${summarize(findings)}`,
    );
  }
  if (expect.maxLevel !== undefined) {
    const cap = LEVEL_RANK[expect.maxLevel];
    const over = findings.filter((f) => (LEVEL_RANK[f.level] ?? -1) > cap);
    if (over.length)
      failures.push(`${label}: findings above ${expect.maxLevel}: ${summarize(over)}`);
  }
  for (const ref of expect.must || []) {
    const hits = matches(findings, ref);
    if (!hits.length) {
      failures.push(
        `${label}: missing required finding ${describe(ref)} — got ${summarize(findings)}`,
      );
    } else if (typeof ref === 'object' && ref.count !== undefined && hits.length !== ref.count) {
      failures.push(
        `${label}: finding ${describe(ref)} expected count ${ref.count}, got ${hits.length}`,
      );
    }
  }
  for (const ref of expect.mustNot || []) {
    const hit = matches(findings, ref);
    if (hit.length)
      failures.push(`${label}: forbidden finding present ${describe(ref)} → ${summarize(hit)}`);
  }
  for (const prefix of expect.mustNotPrefix || []) {
    const hit = findings.filter((f) => f.id.startsWith(prefix));
    if (hit.length)
      failures.push(`${label}: forbidden prefix ${prefix}* present → ${summarize(hit)}`);
  }
  for (const path of expect.mustIssueAt || []) {
    if (
      !findings.some(
        (f) => f.path === path && ['error', 'warning'].includes(f.level) && f.ok !== true,
      )
    )
      failures.push(`${label}: missing issue at ${path}`);
  }
}

/**
 * @param {string[]|undefined} actual
 * @param {string[]|undefined} expected
 * @param {string} label
 * @param {string[]} failures
 */
function checkSet(actual, expected, label, failures) {
  if (expected === undefined) return;
  const a = [...new Set(actual || [])].sort();
  const e = [...new Set(expected)].sort();
  if (a.join(',') !== e.join(','))
    failures.push(`${label}: expected [${e.join(', ')}], got [${a.join(', ')}]`);
}

/**
 * Named cross-output consistency rules. Each receives the full actual result
 * and appends failures. Keep the list small and spec-justified.
 * @type {Record<string, {doc: string, run: (actual: any, failures: string[]) => void}>}
 */
const CONSISTENCY_RULES = {
  'price-invalid-blocks-floor-verdict': {
    doc: 'OpenRTB 2.6 §4.3.3 Bid.price is a required float. When response validation rejects the price as missing or non-numeric at a path, crosscheck must not report an above/below-floor verdict for that path and must report crosscheck.bid.price_invalid there.',
    run(actual, failures) {
      const res = (actual.response && actual.response.findings) || [];
      const cross = actual.crosscheck || [];
      const badPaths = new Set(
        res
          .filter(
            (f) =>
              [
                'response.bid.price_required',
                'err-bid-price-negative',
                'response.bid.price_invalid',
              ].includes(f.id) && f.level === 'error',
          )
          .map((f) => f.path),
      );
      for (const p of badPaths) {
        const verdicts = cross.filter(
          (f) =>
            f.path === p &&
            ['crosscheck.bid.above_floor', 'crosscheck.bid.below_floor'].includes(f.id),
        );
        if (verdicts.length)
          failures.push(
            `consistency: price rejected at ${p} but crosscheck still judged the floor: ${summarize(verdicts)}`,
          );
        if (!cross.some((f) => f.path === p && f.id === 'crosscheck.bid.price_invalid')) {
          failures.push(
            `consistency: price rejected at ${p} but crosscheck.bid.price_invalid is absent`,
          );
        }
      }
    },
  },
  'deal-floor-governs': {
    doc: 'OpenRTB 2.6 §3.2.12 Deal.bidfloor overrides Imp.bidfloor for a bid carrying that dealid. When response validation (with the paired request) reports the bid below the deal floor, crosscheck must not report it above the impression floor.',
    run(actual, failures) {
      const res = (actual.response && actual.response.findings) || [];
      const cross = actual.crosscheck || [];
      for (const f of res.filter((x) => x.id === 'err-bid-price-below-floor')) {
        const above = cross.filter(
          (c) => c.path === f.path && c.id === 'crosscheck.bid.above_floor',
        );
        if (above.length)
          failures.push(
            `consistency: validation says below deal floor ${f.params && f.params.floor} at ${f.path}, crosscheck says ${summarize(above)}`,
          );
        if (!cross.some((c) => c.path === f.path && c.id === 'crosscheck.bid.below_floor')) {
          failures.push(
            `consistency: crosscheck.bid.below_floor missing at ${f.path} although validation found the bid below the governing floor`,
          );
        }
      }
    },
  },
  'unresolved-impid-not-filled': {
    doc: 'A bid whose impid resolves to no impression cannot fill one (OpenRTB 2.6 §4.3.3 impid references Imp.id). Crosscheck must not emit positive per-bid verdicts (size/floor/VAST/category ok) for that bid.',
    run(actual, failures) {
      const cross = actual.crosscheck || [];
      for (const f of cross.filter((x) => x.id === 'crosscheck.bid.impid_unresolved')) {
        const bidPrefix = String(f.path).replace(/\.(impid|item)$/, '');
        const positives = cross.filter(
          (c) =>
            c.ok === true &&
            c.id !== f.id &&
            String(c.path).startsWith(bidPrefix + '.') &&
            c.id !== 'crosscheck.auction.summary',
        );
        if (positives.length)
          failures.push(
            `consistency: unresolved bid ${bidPrefix} still received positive verdicts: ${summarize(positives)}`,
          );
      }
    },
  },
  'no-ok-when-invalid-side': {
    doc: 'When either side fails to validate as a payload (status invalid), the crosscheck cannot compare auction semantics and must not report per-bid ok verdicts.',
    run(actual, failures) {
      const invalid = ['request', 'response'].filter(
        (s) => actual[s] && actual[s].status === 'invalid',
      );
      if (!invalid.length) return;
      const oks = (actual.crosscheck || []).filter(
        (c) => c.ok === true && c.id.startsWith('crosscheck.bid.'),
      );
      if (oks.length)
        failures.push(
          `consistency: ${invalid.join('/')} invalid but crosscheck reports ${summarize(oks)}`,
        );
    },
  },
};

/**
 * @param {any} actual normalized result: {request?, response?, crosscheck?, format?, http?}
 * @param {any} expect the case's `expect` object
 * @param {{layers?: string[]}} [opts] which layers to check: core (request/response/crosscheck/format/consistency), http
 * @returns {{failures: string[]}}
 */
function evaluate(actual, expect, opts = {}) {
  /** @type {string[]} */
  const failures = [];
  const layers = opts.layers || ['core'];
  if (layers.includes('core')) {
    checkSide('request', actual.request, expect.request, failures);
    checkSide('response', actual.response, expect.response, failures);
    if (expect.crosscheck) {
      const cross = actual.crosscheck || [];
      for (const ref of expect.crosscheck.must || []) {
        const hits = matches(cross, ref);
        if (!hits.length)
          failures.push(`crosscheck: missing ${describe(ref)} — got ${summarize(cross)}`);
        else if (typeof ref === 'object' && ref.count !== undefined && hits.length !== ref.count)
          failures.push(
            `crosscheck: finding ${describe(ref)} expected count ${ref.count}, got ${hits.length}`,
          );
      }
      for (const ref of expect.crosscheck.mustNot || []) {
        const hit = matches(cross, ref);
        if (hit.length) failures.push(`crosscheck: forbidden ${describe(ref)} → ${summarize(hit)}`);
      }
      for (const prefix of expect.crosscheck.mustNotPrefix || []) {
        const hit = cross.filter((f) => f.id.startsWith(prefix));
        if (hit.length)
          failures.push(`crosscheck: forbidden prefix ${prefix}* → ${summarize(hit)}`);
      }
      if (expect.crosscheck.empty === true && cross.length) {
        failures.push(`crosscheck: expected no crosscheck findings, got ${summarize(cross)}`);
      }
      for (const path of expect.crosscheck.mustIssueAt || []) {
        if (
          !cross.some((f) => f.path === path && ['crit', 'warn'].includes(f.level) && f.ok !== true)
        )
          failures.push(`crosscheck: missing issue at ${path}`);
      }
    }
    if (expect.format) {
      const fmt = actual.format || {};
      checkSet(fmt.formats, expect.format.formats, 'format.formats', failures);
      checkSet(fmt.contexts, expect.format.contexts, 'format.contexts', failures);
      checkSet(fmt.protocols, expect.format.protocols, 'format.protocols', failures);
    }
    for (const rule of expect.consistency || []) {
      const impl = CONSISTENCY_RULES[rule];
      if (!impl) {
        failures.push(
          `consistency: unknown rule "${rule}" (known: ${Object.keys(CONSISTENCY_RULES).join(', ')})`,
        );
        continue;
      }
      impl.run(actual, failures);
    }
  }
  if (layers.includes('http') && expect.http) {
    const h = actual.http || {};
    if (expect.http.status !== undefined && h.status !== expect.http.status) {
      failures.push(
        `http.status: expected ${expect.http.status}, got ${h.status}${h.transportError ? ` (transport: ${h.transportError})` : ''}`,
      );
    }
    if (expect.http.code !== undefined && (!h.body || h.body.code !== expect.http.code)) {
      failures.push(`http.code: expected ${expect.http.code}, got ${h.body && h.body.code}`);
    }
  }
  return { failures };
}

/**
 * Compare a measured preview state (from the browser) with the contract
 * expectation. Measured fields mirror expect.preview; missing measured fields
 * are reported rather than silently passing.
 *
 * @param {any} measured
 * @param {any} expectPreview
 * @returns {{failures: string[]}}
 */
function evaluatePreview(measured, expectPreview) {
  /** @type {string[]} */
  const failures = [];
  if (!expectPreview || expectPreview.kind === 'n/a') return { failures };
  if (!measured) return { failures: ['preview: nothing measured'] };
  for (const key of ['kind', 'rendered', 'mediaPlays']) {
    if (expectPreview[key] !== undefined && measured[key] !== expectPreview[key]) {
      failures.push(`preview.${key}: expected ${expectPreview[key]}, got ${measured[key]}`);
    }
  }
  if (expectPreview.assets) {
    for (const [k, v] of Object.entries(expectPreview.assets)) {
      const got = measured.assets ? measured.assets[k] : undefined;
      if (JSON.stringify(got) !== JSON.stringify(v))
        failures.push(
          `preview.assets.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got)}`,
        );
    }
  }
  if (expectPreview.price !== undefined) {
    // The chip carries the money the analyst reads off this creative: the
    // amount AND the currency the response named. Compared as displayed,
    // because a symbol swap is exactly the defect this exists to catch.
    const shown = measured.outer ? measured.outer.priceChip : undefined;
    if (shown !== expectPreview.price)
      failures.push(`preview.price: expected ${expectPreview.price}, got ${shown}`);
  }
  if (expectPreview.limitation) {
    if (!measured.limitationShown)
      failures.push(
        `preview: limitation "${expectPreview.limitation}" expected to be explained on screen, but no explanation was visible`,
      );
  }
  return { failures };
}

module.exports = { evaluate, evaluatePreview, CONSISTENCY_RULES, matches, summarize };
