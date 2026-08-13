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

module.exports = { MIGRATION_RULES };
