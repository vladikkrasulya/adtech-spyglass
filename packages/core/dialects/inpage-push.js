'use strict';

/**
 * In-Page Push dialect overlay.
 *
 * In-Page Push is a vendor-specific creative format. It
 * does NOT use the standard `bid.adm` (banner HTML / VAST XML) or
 * `bid.native` (oRTB Native 1.x JSON) carrier. Instead the creative
 * fragments — title, description, hero image, icon, click URL, CTA —
 * travel inside `bid.ext` as plain string fields. SSPs that route this
 * traffic assemble the visible card on their side at impression time.
 *
 * Why this needs a dialect (not just an overlay):
 *   The IAB base rule in rules-response.js raises
 *     `response.bid.payload_missing`
 *   for any bid lacking adm AND nurl. In-Page Push bids legitimately
 *   omit both — surfacing that as a WARNING on every In-Page Push bid
 *   would drown the real findings. The dialect therefore exposes a
 *   `claimsBid(bid)` predicate; when it returns true, rules-response.js
 *   skips the IAB payload check for that bid and lets this overlay
 *   validate the In-Page Push fields instead.
 *
 * Field name aliases:
 *   Different vendor-routed networks normalise the field names slightly
 *   differently. We accept the most common variants under each role:
 *     - title:       title / text
 *     - description: description / body / desc
 *     - image:       image / image_url / picture
 *     - icon:        icon / favicon
 *     - clickUrl:    url / click / click_url / href / link
 *     - cta:         cta / button / button_text
 *
 *   `claimsBid` and `validateResponse` look at all aliases. The finding
 *   `path` quotes the canonical name (`bid.ext.title` etc.) regardless
 *   of which alias was actually present, so the path is stable across
 *   payload variants.
 *
 * What this dialect does NOT do:
 *   - Render the In-Page Push creative. That belongs to the frontend
 *     preview pipeline (analogous to renderNativeToHtml in
 *     spyglass.app.js) and is intentionally out of scope here — the
 *     engine's job is validation, not preview.
 *   - Validate request-side ext fields. Extended-RTB request-side rules
 *     (bsection / btags / push detection) live in dialects/ext-rtb.js;
 *     this overlay focuses entirely on the response-side bid shape.
 */

const { LEVELS, makeFinding } = require('../findings');

const F = makeFinding;

const TITLE_ALIASES = ['title', 'text'];
const DESC_ALIASES = ['description', 'body', 'desc'];
const IMAGE_ALIASES = ['image', 'image_url', 'picture'];
const ICON_ALIASES = ['icon', 'favicon'];
const CLICK_ALIASES = ['url', 'click', 'click_url', 'href', 'link'];
const CTA_ALIASES = ['cta', 'button', 'button_text'];

const TITLE_MAX = 90;
const DESC_MAX = 200;
const CTA_MAX = 25;

function pickAlias(obj, names) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of names) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

function isHttpUrl(s) {
  if (typeof s !== 'string' || !s) return false;
  return /^https?:\/\//i.test(s);
}

/**
 * Returns true if `bid` looks like an In-Page Push creative — i.e. carries
 * its content in bid.ext.* fields rather than adm/nurl/native. Used by
 * rules-response.js to skip the IAB `payload_missing` rule for these bids.
 *
 * Heuristic: the presence of EITHER a title-shaped field OR an image-shaped
 * field inside bid.ext is enough to claim. We don't require a click URL at
 * the claim stage because validateResponse will report it as a missing-
 * required finding if absent — better to claim and validate than to leak
 * the IAB payload_missing on top of our specific finding.
 */
function claimsBid(bid) {
  if (!bid || typeof bid !== 'object') return false;
  const ext = bid.ext;
  if (!ext || typeof ext !== 'object') return false;
  return !!(pickAlias(ext, TITLE_ALIASES) || pickAlias(ext, IMAGE_ALIASES));
}

function validateResponse(res) {
  const findings = [];
  (res.seatbid || []).forEach((sb, sbi) => {
    (sb.bid || []).forEach((bid, bi) => {
      if (!claimsBid(bid)) return;
      const sNum = sbi + 1;
      const bNum = bi + 1;
      const bp = `seatbid[${sbi}].bid[${bi}]`;
      const ext = bid.ext || {};

      const title = pickAlias(ext, TITLE_ALIASES);
      const image = pickAlias(ext, IMAGE_ALIASES);
      const click = pickAlias(ext, CLICK_ALIASES);
      const icon = pickAlias(ext, ICON_ALIASES);
      const desc = pickAlias(ext, DESC_ALIASES);
      const cta = pickAlias(ext, CTA_ALIASES);

      // Required fields — In-Page Push without these renders as a
      // broken/empty card on the publisher side.
      if (!title) {
        findings.push(
          F('inpage-push.title_required', LEVELS.ERROR, `${bp}.ext.title`, { sNum, bNum }),
        );
      } else if (title.length > TITLE_MAX) {
        findings.push(
          F('inpage-push.title_too_long', LEVELS.WARNING, `${bp}.ext.title`, {
            sNum,
            bNum,
            len: title.length,
            max: TITLE_MAX,
          }),
        );
      }
      if (!image) {
        findings.push(
          F('inpage-push.image_required', LEVELS.ERROR, `${bp}.ext.image`, { sNum, bNum }),
        );
      } else if (!isHttpUrl(image)) {
        findings.push(
          F('inpage-push.image_invalid_url', LEVELS.ERROR, `${bp}.ext.image`, {
            sNum,
            bNum,
            url: String(image).slice(0, 80),
          }),
        );
      }
      if (!click) {
        findings.push(
          F('inpage-push.click_required', LEVELS.ERROR, `${bp}.ext.url`, { sNum, bNum }),
        );
      } else if (!isHttpUrl(click)) {
        findings.push(
          F('inpage-push.click_invalid_url', LEVELS.ERROR, `${bp}.ext.url`, {
            sNum,
            bNum,
            url: String(click).slice(0, 80),
          }),
        );
      }

      // Optional-but-checked fields. These don't block rendering but
      // common quality gates (max length / valid URL).
      if (icon && !isHttpUrl(icon)) {
        findings.push(
          F('inpage-push.icon_invalid_url', LEVELS.WARNING, `${bp}.ext.icon`, {
            sNum,
            bNum,
            url: String(icon).slice(0, 80),
          }),
        );
      }
      if (desc && desc.length > DESC_MAX) {
        findings.push(
          F('inpage-push.desc_too_long', LEVELS.WARNING, `${bp}.ext.description`, {
            sNum,
            bNum,
            len: desc.length,
            max: DESC_MAX,
          }),
        );
      }
      if (cta && cta.length > CTA_MAX) {
        findings.push(
          F('inpage-push.cta_too_long', LEVELS.WARNING, `${bp}.ext.cta`, {
            sNum,
            bNum,
            len: cta.length,
            max: CTA_MAX,
          }),
        );
      }
    });
  });
  return findings;
}

module.exports = {
  name: 'inpage-push',
  // No request-side overlay — keep all RTB-level extras (bsection/btags/
  // push macro support) in dialects/ext-rtb.js so they don't double-fire
  // when a user picks In-Page Push.
  validateRequest: () => [],
  validateResponse,
  claimsBid,
};
