'use strict';

/**
 * Confusion-matrix runner over the labelled behavior corpus.
 *
 * For each finding-id emitted by behavior.analyze across all of a user's
 * corpus entries, we count:
 *   TP — fired AND entry labelled 'fraud'
 *   FP — fired AND entry labelled 'legitimate'
 *   FN — didn't fire AND entry labelled 'fraud'
 *   TN — didn't fire AND entry labelled 'legitimate'
 *
 * Ambiguous entries are excluded from the math (they're inspection-only).
 * Each pattern is treated as a fraud-detector regardless of severity tier;
 * info-level patterns may show low precision and that's exactly what the
 * matrix is meant to surface.
 *
 * On-demand computed (no caching) — corpora are small (cap N×1MB) and
 * `analyze()` is fast (~ms per entry). If users grow corpora into the
 * thousands, layer a Map cache keyed by max(corpus.created_at).
 */

/**
 * @param {object} deps
 * @param {object} deps.BehaviorCorpus  model with listForUser/getById
 * @param {(events: Array) => { findings: Array }} deps.analyzeBehavior
 * @param {number} userId
 * @returns {{
 *   totals: { fraud: number, legitimate: number, ambiguous: number, patterns: number },
 *   patterns: Array<{
 *     id: string, tp: number, fp: number, fn: number, tn: number,
 *     precision: number|null, recall: number|null, f1: number|null
 *   }>
 * }}
 */
function computeCorpusMatrix({ BehaviorCorpus, analyzeBehavior }, userId) {
  const all = BehaviorCorpus.listForUser(userId, { limit: 500 });
  const fraudIds = new Set();
  const legitIds = new Set();
  const allFindingIds = new Set();
  const fired = new Map();

  let totalFraud = 0;
  let totalLegit = 0;
  let totalAmbig = 0;

  for (const meta of all) {
    if (meta.label === 'ambiguous') {
      totalAmbig++;
      continue;
    }
    const row = BehaviorCorpus.getById(meta.id, userId);
    if (!row) continue;
    let events;
    try {
      events = JSON.parse(row.eventsJson);
    } catch {
      continue;
    }
    if (!Array.isArray(events)) continue;

    if (meta.label === 'fraud') {
      fraudIds.add(meta.id);
      totalFraud++;
    } else if (meta.label === 'legitimate') {
      legitIds.add(meta.id);
      totalLegit++;
    }

    const result = analyzeBehavior(events);
    const seenIdsThisEntry = new Set();
    for (const f of result.findings || []) {
      if (!f || !f.id) continue;
      if (seenIdsThisEntry.has(f.id)) continue;
      seenIdsThisEntry.add(f.id);
      allFindingIds.add(f.id);
      let s = fired.get(f.id);
      if (!s) {
        s = new Set();
        fired.set(f.id, s);
      }
      s.add(meta.id);
    }
  }

  const patterns = [];
  for (const id of allFindingIds) {
    const firedSet = fired.get(id) || new Set();
    let tp = 0;
    let fp = 0;
    for (const eid of firedSet) {
      if (fraudIds.has(eid)) tp++;
      else if (legitIds.has(eid)) fp++;
    }
    const fn = totalFraud - tp;
    const tn = totalLegit - fp;
    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const recall = totalFraud > 0 ? tp / totalFraud : null;
    const f1 =
      precision != null && recall != null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    patterns.push({ id, tp, fp, fn, tn, precision, recall, f1 });
  }

  patterns.sort((a, b) => {
    const af = a.f1;
    const bf = b.f1;
    if (af == null && bf == null) {
      if (a.tp !== b.tp) return b.tp - a.tp;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    if (af == null) return 1;
    if (bf == null) return -1;
    if (af !== bf) return bf - af;
    if (a.tp !== b.tp) return b.tp - a.tp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    totals: {
      fraud: totalFraud,
      legitimate: totalLegit,
      ambiguous: totalAmbig,
      patterns: patterns.length,
    },
    patterns,
  };
}

module.exports = { computeCorpusMatrix };
