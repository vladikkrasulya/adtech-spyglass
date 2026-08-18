'use strict';

/**
 * Co-occurrence cluster detection — Phase 7b foundation. Pure function.
 *
 * Given the field-observation index and the co-occurrence index, surface
 * groups of fields that consistently appear together. These clusters are
 * what the Dialect Builder UI presents as pre-cooked candidate dialects
 * ("here are 4 fields that always travel together — turn them into a
 * temporary dialect?").
 *
 * `opts.bucket` narrows the read to one domain bucket; without it the
 * function reads across all of them and aggregates. This header used to
 * say "for a single bucket", which is not how its only production caller
 * uses it — the builder passes the unfiltered index — and the code
 * underneath had been written to the header rather than to the caller.
 * See the accumulation comments in detectClusters for what that cost.
 *
 * Algorithm v1 (intentionally simple for 7b):
 *   1. Apply decay to all observation + co-occurrence scores at read time.
 *   2. Build an adjacency map: for each field A, list its top partners B
 *      where coOccur(A,B) >= MIN_COOCCURRENCE.
 *   3. For each field A whose decayed score >= MIN_FIELD_SCORE, form a
 *      cluster from A + its top partners (capped at MAX_CLUSTER_SIZE).
 *   4. De-dupe clusters that are subsets of larger ones.
 *   5. Sort by total observation count, descending.
 *
 * What this is NOT:
 *   - Connected-components on the full graph: would surface massive
 *     "everything-with-everything" components that aren't useful as
 *     dialect candidates. Anchored exploration is more interpretable.
 *   - Clustering with optimal cuts (spectral / Louvain / etc.): overkill
 *     for the 5-50 field scale we're dealing with.
 *   - A learning algorithm: it's a frequency aggregation. Real semantics
 *     come from the user via the Dialect Builder.
 *
 * Output:
 *   Array<{
 *     anchorPath: string,          // the highest-score field
 *     fields: string[],            // includes anchor; up to MAX_CLUSTER_SIZE
 *     totalCount: number,          // sum of decayed scores in cluster
 *     coOccurrenceCount: number    // sum of co-occurrence weights
 *   }>
 */

const { applyDecay } = require('./decay');

const MIN_FIELD_SCORE = 5;
const MIN_COOCCURRENCE = 3;
const MAX_CLUSTER_SIZE = 8;

/**
 * @param {Array<{key: string, bucket: string, path: string, decayedScore: number, lastSeenAt: number}>} observations
 * @param {Array<{key: string, bucket: string, pathA: string, pathB: string, decayedScore?: number, count: number, lastSeenAt: number}>} coOccurrences
 * @param {{ bucket?: string, now?: number, minFieldScore?: number, minCoOccurrence?: number }} [opts]
 */
function detectClusters(observations, coOccurrences, opts) {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const minFieldScore = o.minFieldScore != null ? o.minFieldScore : MIN_FIELD_SCORE;
  const minCo = o.minCoOccurrence != null ? o.minCoOccurrence : MIN_COOCCURRENCE;

  // Filter by bucket if requested.
  const obs = (observations || []).filter((r) => !o.bucket || r.bucket === o.bucket);
  const co = (coOccurrences || []).filter((r) => !o.bucket || r.bucket === o.bucket);

  // Decay-at-read-time so dormant fields fall below threshold without writes.
  //
  // Accumulate, never overwrite. An observation row is keyed by
  // (bucket, path), so the same path arrives once per bucket it was ever
  // seen in — and when the caller passes no `opts.bucket`, which is
  // exactly what the Dialect Builder does (it feeds the whole
  // storage.listObservations() in unfiltered), every one of those rows
  // lands on the same map key. A `set` made the last row win, and row
  // order is storage order, not score order. A field seen 400× in
  // `display` and once in `push` therefore came out with a score of 1,
  // fell under MIN_FIELD_SCORE, and took its entire cluster down with it:
  // the builder showed "no candidates" sitting on top of hundreds of
  // observations. Summing is also the honest aggregate for an unfiltered
  // read — the question being asked is "how much evidence exists for this
  // field, anywhere", and bucket separation is what `opts.bucket` is for.
  const fieldScores = new Map();
  for (const r of obs) {
    const decayed = applyDecay(r.decayedScore || 0, r.lastSeenAt || 0, now);
    if (decayed > 0) fieldScores.set(r.path, (fieldScores.get(r.path) || 0) + decayed);
  }

  // Adjacency: pathA → Map(partner → summed decayed co-occurrence weight).
  //
  // A Map of partners rather than a list of rows, for the same
  // cross-bucket reason plus one of its own: an unfiltered read hands us
  // the same (pathA, pathB) pair once per bucket, and a plain list turned
  // that into a duplicated partner — the same field name appearing twice
  // inside one cluster's `fields`, its weight double-counted in
  // coOccurrenceCount, and a two-field pair sneaking past the "need ≥3
  // fields" check by presenting the same partner twice.
  //
  // The minCo floor is applied AFTER the sum, not per row, because that is
  // what MIN_COOCCURRENCE means: how often the two fields were seen
  // together — not how often they were seen together inside a single
  // bucket. For a bucket-filtered read there is one row per pair, so the
  // two readings coincide and nothing changes.
  const adjacency = new Map();
  for (const c of co) {
    const decayed = applyDecay(
      c.decayedScore != null ? c.decayedScore : c.count || 0,
      c.lastSeenAt || 0,
      now,
    );
    if (decayed <= 0) continue;
    bump(adjacency, c.pathA, c.pathB, decayed);
    bump(adjacency, c.pathB, c.pathA, decayed);
  }
  for (const [path, partners] of adjacency) {
    for (const [partner, weight] of partners) {
      if (weight < minCo) partners.delete(partner);
    }
    if (partners.size === 0) adjacency.delete(path);
  }

  // Anchor each strong field; harvest its top partners (also strong fields).
  const anchors = Array.from(fieldScores.entries())
    .filter(([, score]) => score >= minFieldScore)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);

  const clusters = [];
  const seenSignatures = new Set();

  for (const anchor of anchors) {
    const partners = Array.from(adjacency.get(anchor) || [])
      .filter(([partner]) => fieldScores.has(partner) && fieldScores.get(partner) >= minFieldScore)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CLUSTER_SIZE - 1)
      .map(([partner]) => partner);

    if (partners.length < 2) continue; // Need ≥3 fields total to qualify

    const fields = [anchor, ...partners].sort();
    const signature = fields.join('|');
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);

    let totalCount = 0;
    for (const f of fields) totalCount += fieldScores.get(f) || 0;
    let coOccurrenceCount = 0;
    for (const [partner, weight] of adjacency.get(anchor) || []) {
      if (fields.includes(partner)) coOccurrenceCount += weight;
    }

    clusters.push({
      anchorPath: anchor,
      fields,
      totalCount: Number(totalCount.toFixed(2)),
      coOccurrenceCount: Number(coOccurrenceCount.toFixed(2)),
    });
  }

  // Sort: strongest clusters first.
  clusters.sort((a, b) => b.totalCount - a.totalCount);
  return clusters;
}

function bump(adjacency, path, partner, weight) {
  let partners = adjacency.get(path);
  if (!partners) {
    partners = new Map();
    adjacency.set(path, partners);
  }
  partners.set(partner, (partners.get(partner) || 0) + weight);
}

module.exports = {
  detectClusters,
  MIN_FIELD_SCORE,
  MIN_COOCCURRENCE,
  MAX_CLUSTER_SIZE,
};
