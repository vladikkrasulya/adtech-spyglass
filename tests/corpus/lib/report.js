'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Resolve a case's explicitly authorized deviation for one execution layer.
 * @param {any} c
 * @param {string} layer
 * @returns {{id:string,note:string,matches:string[]}|null}
 */
function gapFor(c, layer) {
  const g = c.meta.knownGap;
  if (!g || !Array.isArray(g.layers) || !g.layers.includes(layer)) return null;
  const matches = Array.isArray(g.matches) ? g.matches : g.matches && g.matches[layer];
  if (!Array.isArray(matches) || !matches.length)
    throw new Error(`${c.id}: ${layer} gap ${g.id} needs nonempty failure signatures`);
  for (const pattern of matches) {
    if (typeof pattern !== 'string' || !pattern.startsWith('^') || !pattern.endsWith('$'))
      throw new Error(`${c.id}: ${layer} gap ${g.id} signature must be anchored`);
    new RegExp(pattern);
  }
  return { id: g.id, note: g.note || '', matches };
}

/** Every failure is authorized AND every authorized deviation still exists.
 * @param {string[]} failures
 * @param {{id:string,matches:string[]}} gap
 */
function deviationVerdict(failures, gap) {
  if (!gap || !Array.isArray(gap.matches) || !gap.matches.length)
    return {
      stillPresent: false,
      unexpected: failures,
      missingPatterns: [],
      reason: 'no signatures pinned',
    };
  const patterns = gap.matches.map((m) => new RegExp(m));
  const unexpected = failures.filter((f) => !patterns.some((re) => re.test(f)));
  const missingPatterns = gap.matches.filter((_m, i) => !failures.some((f) => patterns[i].test(f)));
  const stillPresent = failures.length > 0 && !unexpected.length && !missingPatterns.length;
  return {
    stillPresent,
    unexpected,
    missingPatterns,
    reason: !failures.length
      ? 'expectation now passes; retire the gap'
      : unexpected.length
        ? 'unrelated failures present'
        : missingPatterns.length
          ? `recorded deviations disappeared: ${missingPatterns.join(', ')}`
          : 'all recorded deviations present',
  };
}

/**
 * @param {string} layer
 * @param {any} c
 * @param {{pass?:boolean,failures?:string[],gap?:string|null,measured?:any,outcome?:string,reason?:string}} result
 */
function recordResult(layer, c, result) {
  const dir = process.env.CORPUS_REPORT_DIR;
  if (!dir) return;
  const failures = result.failures || [];
  const gap = gapFor(c, layer);
  const verdict = gap ? deviationVerdict(failures, gap) : null;
  let outcome = gap
    ? verdict.stillPresent
      ? 'known-gap'
      : 'fail'
    : result.pass === true && !failures.length
      ? 'pass'
      : 'fail';
  if (['skip', 'not-applicable'].includes(result.outcome)) {
    if (result.outcome === 'not-applicable' && gap)
      throw new Error(`${c.id}: not-applicable cannot suppress an active ${gap.id} deviation`);
    if (!result.reason) throw new Error(`${c.id}: ${result.outcome} needs a reason`);
    outcome = result.outcome;
  } else if (result.outcome && result.outcome !== outcome) {
    throw new Error(`${c.id}: declared ${result.outcome} disagrees with measured ${outcome}`);
  }
  const row = {
    layer,
    id: c.id,
    kind: c.kind,
    format: c.meta.format,
    protocol: c.meta.protocol,
    context: c.meta.context,
    dialect: c.meta.dialect,
    scenario: c.meta.scenario,
    category: c.meta.category || null,
    base: c.baseId || null,
    outcome,
    pass: outcome === 'pass',
    gap: gap ? gap.id : null,
    reason: result.reason || (verdict ? verdict.reason : null),
    failures,
    measured: result.measured === undefined ? null : result.measured,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${layer}.jsonl`), JSON.stringify(row) + '\n');
}

module.exports = { recordResult, gapFor, deviationVerdict };
