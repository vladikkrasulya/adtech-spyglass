/* ============================================================
   public/core/auction-shape.js — one browser-side auction classifier.

   OpenRTB 2.x keeps `imp` / `seatbid` at the top level. OpenRTB 3.0
   wraps the actual request or response in `openrtb`. Keeping that rule
   here prevents the stream and Inspector handoff from drifting apart.
   ============================================================ */
'use strict';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Browser copy of the hardened OpenRTB 3.0 envelope mechanism in
 * packages/core/detect.js. An empty `openrtb` key does not outweigh explicit
 * 2.x root markers; a genuine wrapper or version marker does.
 */
function looksLike30Envelope(payload) {
  const has2x = Array.isArray(payload.imp) || Array.isArray(payload.seatbid);
  const envelope = payload.openrtb;
  if (isRecord(envelope)) {
    if (isRecord(envelope.request) || isRecord(envelope.response) || envelope.ver != null) {
      return true;
    }
    return !has2x;
  }

  // A peeled 3.0 request keeps item[]. Primitive items are too generic to
  // claim, while an empty array is a valid structural signal.
  return (
    Array.isArray(payload.item) &&
    !payload.item.some((item) => item != null && !isRecord(item)) &&
    !has2x
  );
}

/**
 * A peeled 3.0 response still has seatbid[], but its bids use `item` and
 * `media` instead of 2.x `impid` / `adm`. Any impid vetoes the 3.0 claim.
 */
function looksLike30ResponseBody(payload) {
  if (!Array.isArray(payload.seatbid)) return false;
  let found30Signal = false;
  for (const seat of payload.seatbid) {
    if (!isRecord(seat) || !Array.isArray(seat.bid)) continue;
    for (const bid of seat.bid) {
      if (!isRecord(bid)) continue;
      if (bid.impid != null) return false;
      if (typeof bid.item === 'string' || typeof bid.item === 'number') found30Signal = true;
      if (isRecord(bid.media)) found30Signal = true;
    }
  }
  return found30Signal;
}

/**
 * @param {unknown} payload
 * @returns {{ kind: 'req' | 'res' | 'unknown', body: object, version: '3.0' | null }}
 */
export function classifyAuctionPayload(payload) {
  if (!isRecord(payload)) return { kind: 'unknown', body: {}, version: null };

  if (looksLike30Envelope(payload)) {
    const envelope = isRecord(payload.openrtb) ? payload.openrtb : null;
    if (!envelope) return { kind: 'req', body: payload, version: '3.0' };

    const hasRequest = isRecord(envelope.request);
    const hasResponse = isRecord(envelope.response);

    if (hasRequest !== hasResponse) {
      return {
        kind: hasRequest ? 'req' : 'res',
        body: hasRequest ? envelope.request : envelope.response,
        version: '3.0',
      };
    }

    // An empty or contradictory 3.0 envelope is still recognisably 3.0,
    // but choosing an auction side would be a guess.
    return { kind: 'unknown', body: envelope, version: '3.0' };
  }

  const hasRequest = Array.isArray(payload.imp);
  const hasResponse = Array.isArray(payload.seatbid);
  const has30ResponseBody = looksLike30ResponseBody(payload);

  // A root that declares both auction sides is contradictory. Preserve the
  // 3.0 version signal when its bids carry one, but do not let that choose a
  // side — the same no-guess policy used for a wrapper with both children.
  if (hasRequest && hasResponse) {
    return {
      kind: 'unknown',
      body: payload,
      version: has30ResponseBody ? '3.0' : null,
    };
  }

  if (has30ResponseBody) {
    return { kind: 'res', body: payload, version: '3.0' };
  }

  if (hasRequest !== hasResponse) {
    return {
      kind: hasRequest ? 'req' : 'res',
      body: payload,
      version: null,
    };
  }

  return { kind: 'unknown', body: payload, version: null };
}
