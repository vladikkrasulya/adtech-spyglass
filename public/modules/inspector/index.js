/* ============================================================
   public/modules/inspector/index.js — Inspector module (ES module).

   Phase C-1 of the modular-architecture migration. Wraps the
   existing `mountInspector` function (currently still living in
   /public/spyglass.app.js — Phase C-2 will move the implementation
   into this directory alongside template.html / inspector.css).

   For now the contract is:
     - mount(root, ctx)  → delegates to mountInspector
     - unmount(root)      → no-op; ctx.addCleanup queue + signal
                              + DOM sweep handle teardown, identical
                              pattern to the stream module.

   The current spyglass.app.js binds to elements via document IDs
   inside body (assumes existing markup is already there). The
   shell wraps body content in <div id="app-root"> so registry
   sweeps don't blow away unrelated nodes.
   ============================================================ */
'use strict';

import { mountInspector } from '/spyglass.app.js';

export default {
  id: 'inspector',
  // Single route entry won't catch /uk/, /ru/, /en/ because they're
  // separate files served via locale-aware routing in server.js.
  // Each shell explicitly calls activate('inspector', ...) in its
  // boot script, so the route field is informational only here.
  route: '/',
  manifest: {
    title: { en: 'Inspector', uk: 'Інспектор', ru: 'Инспектор' },
    description: {
      en: 'OpenRTB BidRequest / BidResponse inspector + validator',
      uk: 'OpenRTB-інспектор з валідацією BidRequest / BidResponse',
      ru: 'OpenRTB-инспектор с валидацией BidRequest / BidResponse',
    },
  },
  async mount(root, ctx) {
    await mountInspector(root, ctx);
  },
  async unmount(_root) {
    // No-op. Cleanup runs through:
    //   1. ctx.signal — listeners with {signal} detach automatically
    //   2. ctx.addCleanup queue — sweeps window globals, EventSources,
    //      dynamic <link> nodes, anything else mountInspector registered
    //   3. registry clears root.innerHTML
  },
};
