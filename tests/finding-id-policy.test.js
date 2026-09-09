'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../packages/core');
const en = require('../packages/core/messages/en.json');
const uk = require('../packages/core/messages/uk.json');
const ru = require('../packages/core/messages/ru.json');
const references = require('../packages/core/spec-refs.json');

// Frozen compatibility exceptions from 2bd93d6, not inferred from the current catalog.
const LEGACY_IDS = [
  'inpage-push.title_required',
  'inpage-push.title_too_long',
  'inpage-push.image_required',
  'inpage-push.image_invalid_url',
  'inpage-push.click_required',
  'inpage-push.click_invalid_url',
  'inpage-push.icon_invalid_url',
  'inpage-push.desc_too_long',
  'inpage-push.cta_too_long',
  'err-schain-version',
  'err-schain-complete',
  'err-schain-nodes-empty',
  'err-schain-node-asi',
  'err-schain-node-sid',
  'err-schain-node-hp',
  'warn-schain-node-rid-missing',
  'warn-schain-node-domain-missing',
  'err-eids-not-array',
  'err-eids-source-missing',
  'err-eids-uids-empty',
  'err-eids-uid-id-missing',
  'err-podseq-invalid',
  'err-pod-len-mismatch',
  'err-pod-len-invalid',
  'err-schain-node-domain-invalid',
  'err-schain-node-rid-invalid',
  'err-eids-source-invalid',
  'err-bid-currency-invalid',
  'err-bid-currency-mismatch',
  'err-bid-price-negative',
  'err-bid-price-below-floor',
  'err-tmax-invalid',
  'warn-tmax-too-small',
  'warn-tmax-too-large',
  'err-podid-invalid',
  'err-rqddurs-invalid',
  'err-rqddurs-conflict',
  'err-schain-invalid',
  'err-schain-node-invalid',
  'err-eids-entry-invalid',
  'err-eids-uid-invalid',
  'err-eids-source-invalid-type',
  'err-eids-uid-id-invalid-type',
  'err-eids-uid-atype-invalid',
  'warn-currency-conversion-needed',
].sort();

const ids = (catalog) =>
  Object.keys(catalog)
    .filter((id) => !id.startsWith('_'))
    .sort();

test('finding IDs retain every legacy exception while new names use dotted lowercase namespaces', () => {
  assert.deepEqual(
    ids(en).filter((id) => id.includes('-')),
    LEGACY_IDS,
  );
  for (const id of ids(en)) {
    if (!LEGACY_IDS.includes(id)) assert.match(id, /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/, id);
  }
});

test('finding ID policy preserves locale and specification-reference compatibility', () => {
  assert.deepEqual(ids(uk), ids(en));
  assert.deepEqual(ids(ru), ids(en));
  for (const id of LEGACY_IDS) assert.ok(Object.hasOwn(references, id), id);
});

test('public suppression accepts exact legacy IDs and either naming family as a prefix', () => {
  const payload = {
    id: 'id-policy',
    seatbid: [
      {
        bid: [
          {
            id: 'b',
            impid: 'i',
            price: 'not-a-price',
            adm: '<div>synthetic</div>',
            adomain: ['example.test'],
          },
        ],
      },
    ],
  };
  const baseline = core.validate(payload, { locale: 'en' }).findings;
  assert.ok(baseline.some((finding) => finding.id === 'err-bid-price-negative'));
  assert.ok(baseline.some((finding) => finding.id === 'response.bid.price_required'));
  for (const disabledRules of [
    ['err-bid-price-negative'],
    ['err-bid-*'],
    ['response.bid.price_*'],
  ]) {
    const expected = baseline.filter(
      (finding) =>
        !disabledRules.some((id) =>
          id.endsWith('*') ? finding.id.startsWith(id.slice(0, -1)) : finding.id === id,
        ),
    );
    assert.deepEqual(core.validate(payload, { locale: 'en', disabledRules }).findings, expected);
  }
});
