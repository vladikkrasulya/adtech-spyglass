'use strict';
/** Shared numeric facts; callers own their legacy diagnostic trigger sets. */
function classifyPrice(value) {
  const finite = typeof value === 'number' && Number.isFinite(value);
  return { finite, nonNegative: finite && value >= 0, negative: finite && value < 0 };
}
module.exports = { classifyPrice };
