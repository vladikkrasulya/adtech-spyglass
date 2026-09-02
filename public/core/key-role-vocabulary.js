/* ============================================================
   public/core/key-role-vocabulary.js — browser mirror of Core's
   normative label vocabulary (016 R-10, FR-024; ADR-015).

   GENERATED CONTENT — the no-bundler picker cannot reach Core's CommonJS export,
   so the enum ships twice with ONE source of truth:
   packages/core/dialects/key-role-vocabulary.js is authoritative,
   and tests/key-role-browser-mirror.test.js asserts set equality
   byte for byte. Edit the Core module, then update this mirror to
   match; drift is a build failure, not a runtime surprise.
   ============================================================ */
(function () {
  'use strict';

  const LEGACY_LABELS = [
    'pop',
    'native',
    'banner',
    'video',
    'audio',
    'in-page-push',
    'push',
    'interstitial-banner',
    'ignore',
    'informational',
    'custom',
  ];

  const ROLE_LABELS = [
    'identifier',
    'credential',
    'metadata',
    'media-property',
    'pricing',
    'targeting',
    'privacy-consent',
    'delivery-control',
    'measurement',
  ];

  const FORMAT_LABELS = [
    'pop',
    'native',
    'banner',
    'video',
    'audio',
    'in-page-push',
    'push',
    'interstitial-banner',
  ];

  window.KeyRoleVocabulary = {
    LEGACY_LABELS: LEGACY_LABELS,
    ROLE_LABELS: ROLE_LABELS,
    STORABLE_LABELS: LEGACY_LABELS.concat(ROLE_LABELS),
    FORMAT_LABELS: FORMAT_LABELS,
  };
})();
