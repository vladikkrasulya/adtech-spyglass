'use strict';

/**
 * Audit regressions — Discovery walker, cluster detection, temp dialects.
 *
 * Three defects found in the 2026-08-18 audit, all of the same family:
 * the Discovery pipeline writes a vocabulary of logical field paths on one
 * end and reads it back on the other, and in three places the two ends
 * disagreed. None of them threw; each one silently produced a wrong
 * answer, which is why they survived the existing suite in
 * tests/intel.test.js — those tests exercise each module against
 * hand-written inputs shaped the way the module expects, never against
 * what its actual neighbour hands it.
 *
 * The tests below are written from the caller's side on purpose: they feed
 * walker output into the resolver, and unfiltered storage rows into the
 * cluster detector, the way public/modules/intel/{observer,builder}.js
 * really do it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractFields,
  detectClusters,
  applyTempDialect,
  resolvePath,
} = require('@ortbtools/core/intel');

// ── walker: the response-side namespace exists ────────────────────────
// findExtEntryPoints used to register payload.ext twice — as `req.ext` and
// again as `res.ext` — and rely on walkSubtree's cycle guard to pick one.
// The guard picked the first, so `res.ext.*` was an empty namespace and a
// bid response's top-level ext was filed under the request prefix.

test('extractFields — a BidResponse files its top-level ext under res.ext, not req.ext', () => {
  const payload = {
    id: 'resp-1',
    seatbid: [{ seat: 's1', bid: [{ id: 'b1', ext: { vendor_macro: 'x' } }], ext: { sb: 1 } }],
    ext: { resp_level: 'z' },
  };
  const paths = extractFields(payload).map((f) => f.path);
  assert.ok(paths.includes('res.ext.resp_level'), 'top-level response ext → res.ext.*');
  assert.ok(
    !paths.some((p) => p.startsWith('req.')),
    'a response has no request-side fields, got: ' + JSON.stringify(paths),
  );
  // The rest of the response vocabulary must be unaffected.
  assert.ok(paths.includes('res.seatbid.ext.sb'));
  assert.ok(paths.includes('res.bid.ext.vendor_macro'));
});

test('extractFields — a no-bid response (nbr, no seatbid) is still response-side', () => {
  // NBR responses carry no seatbid at all, so seatbid[] alone is not enough
  // to recognise the side. `nbr` is response-only and decides it.
  const paths = extractFields({ id: 'r', nbr: 2, ext: { reason_detail: 'blocked' } }).map(
    (f) => f.path,
  );
  assert.deepEqual(paths, ['res.ext.reason_detail']);
});

test('extractFields — a BidRequest keeps its top-level ext under req.ext', () => {
  const paths = extractFields({
    id: 'req-1',
    imp: [{ id: '1', ext: { placement: 'a' } }],
    ext: { req_level: 'y' },
  }).map((f) => f.path);
  assert.ok(paths.includes('req.ext.req_level'));
  assert.ok(paths.includes('req.imp.ext.placement'));
  assert.ok(!paths.some((p) => p.startsWith('res.')));
});

test('extractFields — an unlabelled ext fragment stays on the req default', () => {
  // Neither imp[] nor seatbid[]: a partial paste. Guessing `res` here would
  // scatter one vendor's fields across two namespaces depending on how much
  // of the payload the user happened to copy, so the historical default
  // wins. This pins the choice so it is not "fixed" by accident later.
  const paths = extractFields({ ext: { fragment_field: 1 } }).map((f) => f.path);
  assert.deepEqual(paths, ['req.ext.fragment_field']);
});

test('extractFields — the cycle guard is path-scoped, not a global visited-set', () => {
  // Two distinct ext entry points holding the same object is what the
  // double-tryAdd bug looked like from the inside. A guard shared across
  // entry points swallows the second one entirely; a path-scoped guard
  // records both and still terminates on a real cycle.
  const shared = { shared_field: 'v' };
  const payload = { imp: [{ id: '1', ext: shared }], site: { ext: shared } };
  const paths = extractFields(payload)
    .map((f) => f.path)
    .sort();
  assert.deepEqual(paths, ['req.imp.ext.shared_field', 'req.site.ext.shared_field']);
});

test('extractFields — a genuine self-reference still terminates', () => {
  const root = { ext: { a: 1 } };
  root.ext.self = root.ext;
  // Not wrapped in doesNotThrow: a non-terminating walk would hang rather
  // than throw, and the assertion below only runs if the call returned.
  const fields = extractFields(root);
  assert.ok(fields.some((f) => f.path === 'req.ext.a'));
});

// ── cluster: cross-bucket rows accumulate, they don't overwrite ───────
// The Dialect Builder calls detectClusters(observations, coOccurrences)
// with no opts — the whole unfiltered index. Rows are keyed by
// (bucket, path), so one path arrives once per bucket, and `set` let the
// last row win regardless of score.

function row(bucket, path, score, now) {
  return { key: bucket + '::' + path, bucket, path, decayedScore: score, lastSeenAt: now };
}
function pair(bucket, pathA, pathB, weight, now) {
  return {
    key: bucket + '::' + pathA + '::' + pathB,
    bucket,
    pathA,
    pathB,
    decayedScore: weight,
    count: weight,
    lastSeenAt: now,
  };
}

test('detectClusters — a weak row in another bucket cannot erase a strong cluster', () => {
  const now = Date.now();
  const observations = [
    row('display', 'req.imp.ext.a', 400, now),
    row('display', 'req.imp.ext.b', 400, now),
    row('display', 'req.imp.ext.c', 400, now),
    // Same field, one sighting in a different bucket, stored last.
    row('push', 'req.imp.ext.a', 1, now),
  ];
  const coOccurrences = [
    pair('display', 'req.imp.ext.a', 'req.imp.ext.b', 300, now),
    pair('display', 'req.imp.ext.a', 'req.imp.ext.c', 300, now),
  ];
  const unfiltered = detectClusters(observations, coOccurrences, { now });
  assert.equal(unfiltered.length, 1, 'the 400× cluster must survive the 1× row');
  assert.deepEqual(unfiltered[0].fields, ['req.imp.ext.a', 'req.imp.ext.b', 'req.imp.ext.c']);
  // Unfiltered totals aggregate across buckets: 400+400+400 + the stray 1.
  assert.equal(unfiltered[0].totalCount, 1201);

  // And the bucket-filtered read is unchanged by any of this.
  const display = detectClusters(observations, coOccurrences, { now, bucket: 'display' });
  assert.equal(display.length, 1);
  assert.equal(display[0].totalCount, 1200);
});

test('detectClusters — the same pair seen in two buckets yields one partner, not two', () => {
  // A list-of-rows adjacency duplicated the partner, which both
  // double-counted its weight and let a two-field pair pass the "need ≥3
  // fields" gate by presenting the same partner twice.
  const now = Date.now();
  const observations = [
    row('display', 'req.imp.ext.a', 30, now),
    row('push', 'req.imp.ext.b', 30, now),
  ];
  const coOccurrences = [
    pair('display', 'req.imp.ext.a', 'req.imp.ext.b', 30, now),
    pair('push', 'req.imp.ext.a', 'req.imp.ext.b', 30, now),
  ];
  const clusters = detectClusters(observations, coOccurrences, { now });
  assert.deepEqual(clusters, [], 'two fields are not a cluster, however many buckets say so');
});

test('detectClusters — co-occurrence weight is summed across buckets before thresholding', () => {
  // MIN_COOCCURRENCE asks how often two fields were seen together, not how
  // often inside one bucket. Two buckets at 2 each clear a floor of 3.
  const now = Date.now();
  const observations = [
    row('display', 'req.imp.ext.a', 30, now),
    row('display', 'req.imp.ext.b', 30, now),
    row('display', 'req.imp.ext.c', 30, now),
  ];
  const coOccurrences = [
    pair('display', 'req.imp.ext.a', 'req.imp.ext.b', 2, now),
    pair('push', 'req.imp.ext.a', 'req.imp.ext.b', 2, now),
    pair('display', 'req.imp.ext.a', 'req.imp.ext.c', 2, now),
    pair('push', 'req.imp.ext.a', 'req.imp.ext.c', 2, now),
  ];
  const clusters = detectClusters(observations, coOccurrences, { now });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].coOccurrenceCount, 8);

  // Restricted to one bucket the same evidence is 2 per pair — below the
  // floor — so nothing surfaces. The floor itself has not moved.
  assert.deepEqual(detectClusters(observations, coOccurrences, { now, bucket: 'display' }), []);
});

// ── temp dialect: the resolver speaks the walker's path vocabulary ────
// spec.fields is seeded from walker output, and the walker collapses
// seatbid[].bid[] to a single `bid` segment. The resolver looked for the
// key `bid` on the response root, found nothing, and reported every
// present res.bid.* field as missing.

const RESPONSE = {
  id: 'r',
  seatbid: [{ seat: 's', bid: [{ id: 'b', ext: { vendor_macro: 'PRESENT', n: 'notnum' } }] }],
};

test('resolvePath — resolves the walker-shaped res.bid.* path', () => {
  assert.equal(resolvePath({ req: null, res: RESPONSE }, 'res.bid.ext.vendor_macro'), 'PRESENT');
});

test('resolvePath — the physical res.seatbid.bid.* spelling keeps working', () => {
  // Dialects saved before the expansion existed carry the long form.
  assert.equal(
    resolvePath({ req: null, res: RESPONSE }, 'res.seatbid.bid.ext.vendor_macro'),
    'PRESENT',
  );
});

test('resolvePath — res.bid.* that is genuinely absent still resolves to undefined', () => {
  // The expansion must not turn "missing" into a false present.
  assert.equal(resolvePath({ req: null, res: RESPONSE }, 'res.bid.ext.nope'), undefined);
  assert.equal(resolvePath({ req: null, res: { id: 'r' } }, 'res.bid.ext.vendor_macro'), undefined);
});

test('resolvePath — a missing payload pair returns undefined instead of throwing', () => {
  assert.equal(resolvePath(null, 'res.bid.ext.vendor_macro'), undefined);
});

test('applyTempDialect — a present required res.bid.* field raises no ERROR', () => {
  // The damaging half: an ERROR moves rollupStatus, so this defect painted
  // a clean bid response as broken on a field that was right there.
  const spec = {
    name: 'V',
    fields: [{ path: 'res.bid.ext.vendor_macro', required: true, expectedType: 'string' }],
  };
  assert.deepEqual(applyTempDialect(spec, { req: null, res: RESPONSE }), []);
});

test('applyTempDialect — the type check now actually runs on res.bid.* fields', () => {
  // The quiet half: a value that never resolves is never type-tested, so
  // expectedType was dead for the entire response-side namespace.
  const spec = { name: 'V', fields: [{ path: 'res.bid.ext.n', expectedType: 'number' }] };
  const findings = applyTempDialect(spec, { req: null, res: RESPONSE });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'temp.field_wrong_type');
  assert.equal(findings[0].level, 'warning');
  assert.equal(findings[0].path, 'res.bid.ext.n');
});

test('applyTempDialect — a truly missing required res.bid.* field still ERRORs', () => {
  const spec = { name: 'V', fields: [{ path: 'res.bid.ext.absent', required: true }] };
  const findings = applyTempDialect(spec, { req: null, res: RESPONSE });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'temp.field_required');
  assert.equal(findings[0].level, 'error');
});

// ── the two ends, joined ──────────────────────────────────────────────

test('walker → dialect round-trip: every discovered response path resolves', () => {
  // The end-to-end shape of all three defects: whatever the walker names,
  // the resolver must be able to find again in the very same payload.
  // Before the fix this failed on both counts — `req.ext.*` for a response
  // field, and an unresolvable `res.bid.*`.
  const payload = {
    id: 'resp-1',
    ext: { resp_level: 'z' },
    seatbid: [{ seat: 's', bid: [{ id: 'b', ext: { vendor_macro: 'x' } }], ext: { sb: 1 } }],
  };
  const paths = extractFields(payload).map((f) => f.path);
  assert.ok(paths.length >= 3);
  const spec = { name: 'Round trip', fields: paths.map((path) => ({ path, required: true })) };
  assert.deepEqual(
    applyTempDialect(spec, { req: null, res: payload }),
    [],
    'a dialect built from a payload must validate that same payload cleanly',
  );
});
