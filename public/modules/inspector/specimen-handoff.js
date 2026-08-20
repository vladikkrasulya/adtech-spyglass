/* ============================================================
   public/modules/inspector/specimen-handoff.js — permalink payload
   handoff into the correct Inspector editor.
   ============================================================ */
'use strict';

import { classifyAuctionPayload } from '/core/auction-shape.js';

/**
 * Load a complete cached specimen into its auction-side editor.
 * Unknown payloads retain the historical request-editor fallback.
 *
 * @param {unknown} specimen
 * @param {Document} doc
 * @returns {'bidReq' | 'bidRes' | null}
 */
export function loadSpecimenIntoEditor(specimen, doc = document) {
  const shape = classifyAuctionPayload(specimen);
  const targetId = shape.kind === 'res' ? 'bidRes' : 'bidReq';
  const target = doc.getElementById(targetId);
  if (!target) return null;

  target.value = JSON.stringify(specimen, null, 2);
  const EventCtor = target.ownerDocument.defaultView.Event;
  target.dispatchEvent(new EventCtor('input', { bubbles: true }));
  return targetId;
}
