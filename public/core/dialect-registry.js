/** Built-in dialect IDs: the authority consumed by Core and the browser. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrtbtoolsDialectRegistry = factory();
})(globalThis, function () {
  'use strict';
  return Object.freeze({ ids: Object.freeze(['iab', 'ext-rtb', 'inpage-push']), defaultId: 'iab' });
});
