/**
 * rules.js — the OpenRTB 2.5 → 2.6 migration rule table.
 *
 * Isomorphic on purpose: this one canonical source runs unchanged in Node
 * (`module.exports`) and in the browser (`window.OrtbtoolsMigrateRules`), and
 * scripts/gen-browser-core.js mirrors it verbatim into public/core/ behind a CI
 * parity guard. The Migration tab must propose exactly what
 * tests/migration-rules.test.js pins, so there is no second copy to drift.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrtbtoolsMigrateRules = factory();
})(globalThis, function () {
  'use strict';

  const SPEC_BASE = 'https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md';

  /**
   * @typedef {object} MigrationRule
   * @property {string} id
   * @property {string} spec
   * @property {'certain'|'likely'|'review'} confidence
   * @property {string} rationale
   */

  const RULE_DEFINITIONS = /** @type {MigrationRule[]} */ ([
    {
      id: 'ortb26.category.cattax',
      spec: `${SPEC_BASE}#appendix-b-specification-change-log`,
      confidence: 'review',
      rationale:
        'Category codes do not all look like Content Taxonomy 1.0; confirm the suggested cattax value manually before applying it.',
    },
    {
      id: 'ortb26.content.prodq',
      spec: `${SPEC_BASE}#3216---object-content`,
      confidence: 'certain',
      rationale: 'Move the removed videoquality value to its 2.6 production-quality field prodq.',
    },
    {
      id: 'ortb26.imp.rwdd',
      spec: `${SPEC_BASE}#324---object-imp`,
      confidence: 'likely',
      rationale: 'Promote the legacy rewarded-video extension to the standardized 2.6 rwdd field.',
    },
    {
      id: 'ortb26.regs.gdpr',
      spec: `${SPEC_BASE}#323---object-regs`,
      confidence: 'certain',
      rationale: 'Promote the standardized GDPR flag from its pre-2.6 extension location.',
    },
    {
      id: 'ortb26.regs.us_privacy',
      spec: `${SPEC_BASE}#323---object-regs`,
      confidence: 'certain',
      rationale:
        'Promote the US Privacy (CCPA) string from its pre-2.6 extension location, where a 2.6 reader does not look for it.',
    },
    {
      id: 'ortb26.source.schain',
      spec: `${SPEC_BASE}#322---object-source`,
      confidence: 'likely',
      rationale: 'Promote the legacy SupplyChain extension to the standardized 2.6 source field.',
    },
    {
      id: 'ortb26.user.consent',
      spec: `${SPEC_BASE}#3220---object-user`,
      confidence: 'certain',
      rationale: 'Promote the TCF consent string from its pre-2.6 extension location.',
    },
    {
      id: 'ortb26.user.eids',
      spec: `${SPEC_BASE}#3220---object-user`,
      confidence: 'likely',
      rationale:
        'Promote the legacy extended-identifiers extension to the standardized 2.6 user field.',
    },
    {
      id: 'ortb26.video.protocols',
      spec: `${SPEC_BASE}#327---object-video`,
      confidence: 'certain',
      rationale: 'Replace the removed singular video protocol field with the 2.6 protocols array.',
    },
  ]);

  /** @type {ReadonlyArray<Readonly<MigrationRule>>} */
  const MIGRATION_RULES = Object.freeze(RULE_DEFINITIONS.map((rule) => Object.freeze(rule)));

  return { MIGRATION_RULES };
});
