/**
 * registry.js — the explicit OpenRTB semantic-diff registries.
 *
 * Isomorphic on purpose: this one canonical source runs unchanged in Node
 * (`module.exports`) and in the browser (`window.OrtbtoolsDiffRegistry`), and
 * scripts/gen-browser-core.js mirrors it verbatim into public/core/ with a CI
 * parity guard. The diff UI has to apply exactly the same rules the server-side
 * tests pin, so there must be no second copy to drift.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrtbtoolsDiffRegistry = factory();
})(globalThis, function () {
  'use strict';

  /**
   * Arrays whose elements have stable OpenRTB identities. Matching is enabled
   * only at these exact schema paths. `*` represents one array element.
   */
  const OPENRTB_ARRAY_IDENTITIES = Object.freeze([
    Object.freeze({ path: '/imp', key: 'id' }),
    Object.freeze({ path: '/seatbid', key: 'seat' }),
    Object.freeze({ path: '/seatbid/*/bid', key: 'id' }),
  ]);

  /**
   * OpenRTB arrays whose order has no domain meaning for comparison. Every path
   * is explicit: arrays absent from this registry remain positional, including
   * source.ext.schain.nodes.
   */
  const OPENRTB_SET_PATHS = Object.freeze([
    '/badv',
    '/bapp',
    '/bcat',
    '/bseat',
    '/cur',
    '/wlang',
    '/app/cat',
    '/app/pagecat',
    '/app/sectioncat',
    '/content/cat',
    '/site/cat',
    '/site/pagecat',
    '/site/sectioncat',
    '/imp/*/audio/api',
    '/imp/*/audio/battr',
    '/imp/*/audio/companiontype',
    '/imp/*/audio/delivery',
    '/imp/*/audio/mimes',
    '/imp/*/audio/protocols',
    '/imp/*/banner/api',
    '/imp/*/banner/battr',
    '/imp/*/banner/mimes',
    '/imp/*/native/api',
    '/imp/*/native/battr',
    '/imp/*/video/api',
    '/imp/*/video/battr',
    '/imp/*/video/companiontype',
    '/imp/*/video/delivery',
    '/imp/*/video/mimes',
    '/imp/*/video/playbackmethod',
    '/imp/*/video/protocols',
    '/seatbid/*/bid/*/adomain',
    '/seatbid/*/bid/*/attr',
    '/seatbid/*/bid/*/cat',
  ]);

  return {
    OPENRTB_ARRAY_IDENTITIES,
    OPENRTB_SET_PATHS,
  };
});
