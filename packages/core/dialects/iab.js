'use strict';

/**
 * IAB OpenRTB base dialect. The rule files (rules-request, rules-response)
 * already implement the IAB-canonical baseline, so this overlay is empty.
 *
 * Phase 2 will move version-specific extras (rwdd, sua, regs.gpp, plcmt …)
 * into per-version sub-overlays here. For Phase 1 the validator core IS the
 * IAB baseline — no extras to add.
 */

module.exports = {
  name: 'iab',
  validateRequest: () => [],
  validateResponse: () => [],
};
