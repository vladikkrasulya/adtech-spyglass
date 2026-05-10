'use strict';

/**
 * IAB OpenRTB 3.0 BidRequest validation — minimal envelope + item shape.
 *
 * 3.0 is a structural rewrite of 2.x:
 *   - request lives under `payload.openrtb.request` (envelope wrapper)
 *   - `imp` becomes `item`; impressions become "items" (more generic — can
 *     describe ad placements, content placements, anything the publisher
 *     wants to monetize)
 *   - flat 2.x fields (`site`, `app`, `device`, `regs`, `user`) move under
 *     `request.context` and largely defer to AdCOM 1.0 (a separate spec)
 *   - placement specifics (banner / video / native shapes) live in
 *     `item[].spec.placement` and follow AdCOM, not the legacy IAB types
 *
 * Real-world 3.0 traffic is essentially nil per IAB — every working DSP
 * still speaks 2.x. We ship STRUCTURAL validation only: did the caller
 * even shape the envelope correctly? Deeper AdCOM validation (placement
 * type discrimination, etc.) is a separate sprint, deferred until someone
 * shows up with real 3.0 traffic to test against.
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/3.0.md
 */

const { isObj, isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

/**
 * @param {object} payload — full request as received (with `openrtb` envelope)
 * @param {object} _ctx — unused for 3.0 today; reserved for future dialect
 * @returns {Array<{id:string, level:string, path:string, params:object}>}
 */
function validateRequest30(payload, _ctx) {
  const findings = [];

  // R1. Envelope. Anything else means we got a 2.x payload mistakenly
  //     routed here (detectVersion bug) or a 3.0 caller without the
  //     envelope wrapper (writing the request as if it were 2.x).
  if (!isObj(payload.openrtb)) {
    findings.push(F('request.30.envelope_required', LEVELS.ERROR, 'openrtb'));
    findings.push(F('request.30.deep_validation_limited', LEVELS.INFO, ''));
    return findings;
  }
  const env = payload.openrtb;

  // R2. ver field — required, must be 3.x
  if (!isStr(env.ver)) {
    findings.push(F('request.30.ver_required', LEVELS.ERROR, 'openrtb.ver'));
  } else if (!/^3\.\d+$/.test(env.ver)) {
    findings.push(F('request.30.ver_invalid', LEVELS.ERROR, 'openrtb.ver', { ver: env.ver }));
  }

  // R3. request object
  if (!isObj(env.request)) {
    findings.push(F('request.30.request_required', LEVELS.ERROR, 'openrtb.request'));
    findings.push(F('request.30.deep_validation_limited', LEVELS.INFO, ''));
    return findings;
  }
  const req = env.request;

  // R4. request.id — required (parallels 2.x BidRequest.id)
  if (!isStr(req.id)) {
    findings.push(F('request.30.id_required', LEVELS.ERROR, 'openrtb.request.id'));
  }

  // R5. request.item[] — required, non-empty (parallels 2.x imp[])
  if (!Array.isArray(req.item) || !req.item.length) {
    findings.push(F('request.30.item_required', LEVELS.ERROR, 'openrtb.request.item'));
  }

  // R6. request.context — recommended (carries site/app/device/regs/user;
  //     spec doesn't make it strictly mandatory but bidders need it)
  if (!isObj(req.context)) {
    findings.push(F('request.30.context_recommended', LEVELS.WARNING, 'openrtb.request.context'));
  }

  // R7. Per-item validation. Each item is { id, qty?, spec }.
  (req.item || []).forEach((it, i) => {
    const ip = `openrtb.request.item[${i}]`;
    const num = i + 1;
    if (!isObj(it)) {
      findings.push(F('request.30.item.invalid', LEVELS.ERROR, ip, { num }));
      return;
    }
    if (!isStr(it.id)) {
      findings.push(F('request.30.item.id_required', LEVELS.ERROR, `${ip}.id`, { num }));
    }
    // qty is INFO/WARN — defaults to 1 per spec; surface only when it's
    // present-but-bogus, not on absent.
    if (it.qty != null && (!isNum(it.qty) || it.qty <= 0)) {
      findings.push(
        F('request.30.item.qty_invalid', LEVELS.WARNING, `${ip}.qty`, { num, qty: it.qty }),
      );
    }
    if (!isObj(it.spec)) {
      findings.push(F('request.30.item.spec_required', LEVELS.ERROR, `${ip}.spec`, { num }));
    }
  });

  // R8. Always emit the limitation INFO note. Users pasting 3.0 traffic
  //     will see a thin findings list and might assume Spyglass is broken;
  //     this finding tells them the truth — we only cover envelope shape,
  //     deeper AdCOM validation isn't here yet.
  findings.push(F('request.30.deep_validation_limited', LEVELS.INFO, ''));

  return findings;
}

module.exports = { validateRequest30 };
