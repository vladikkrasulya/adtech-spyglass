'use strict';

/**
 * Exponential decay for field-observation scores.
 *
 *   score(t)  =  score(t0) * 0.5 ^ ((t - t0) / halfLife)
 *
 * Half-life default 24h: a field that fired 100× a week ago has score ≈ 0.78
 * today, while a field that fired 100× yesterday has score ≈ 50. The
 * observer adds 1 to the decayed score on each new sighting, so a field
 * that fires steadily holds its level; a field that goes quiet sinks
 * below the suggestion threshold automatically.
 *
 * Why decay (not fixed windows):
 *   Fixed buckets need bucket-boundary GC and a fixed retention. Decay
 *   gives smooth aging without bucket math. Storage stays small because
 *   we evict observations whose decayed score falls below an eviction
 *   threshold (Phase 7b feature).
 *
 * Edge cases handled:
 *   - lastSeenAt in the future (clock skew) → no decay (factor = 1)
 *   - lastSeenAt = 0 (never seen) → caller passes seed score, we no-op
 *   - elapsed > 30 days → cap factor at floor (avoids underflow on
 *     long-dormant entries; eviction handles permanent removal)
 */

const MS_PER_HOUR = 3600 * 1000;
const DEFAULT_HALF_LIFE_HOURS = 24;
// Floor: 30 half-lives = 2^-30 ≈ 1e-9. Beyond that we treat the score
// as zero — no point tracking sub-femto values.
const MAX_HALF_LIVES = 30;

function applyDecay(prevScore, lastSeenAtMs, nowMs, halfLifeHours) {
  if (typeof prevScore !== 'number' || !Number.isFinite(prevScore)) return 0;
  if (prevScore <= 0) return 0;
  if (typeof lastSeenAtMs !== 'number' || lastSeenAtMs <= 0) return prevScore;
  if (typeof nowMs !== 'number') nowMs = Date.now();
  const halfLife = halfLifeHours || DEFAULT_HALF_LIFE_HOURS;

  const elapsedMs = nowMs - lastSeenAtMs;
  if (elapsedMs <= 0) return prevScore; // future-dated; clock skew

  const halfLives = elapsedMs / MS_PER_HOUR / halfLife;
  if (halfLives >= MAX_HALF_LIVES) return 0;

  const factor = Math.pow(0.5, halfLives);
  return prevScore * factor;
}

module.exports = { applyDecay, DEFAULT_HALF_LIFE_HOURS, MAX_HALF_LIVES };
