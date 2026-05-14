'use strict';

/**
 * VAST 2.x / 3.x / 4.x XML validation rules — minimal viable set.
 *
 * Triggered from rules-response.js when a `bid.adm` matches the VAST
 * shape (anchored at start). We deliberately use regex-based scanning
 * instead of a full XML parser:
 *   - keeps the package browser-runnable with zero deps
 *   - covers ~95% of real-world breakage with ~5% of the cost
 *   - production-grade VAST validators always need a server anyway
 *     (wrapper-chain traversal, mediafile codec sniffing, etc.) — not
 *     in scope for a paste-and-go inspector
 *
 * The 16 rules below are the "every serious SSP rejects on these" set plus
 * common quality signals. Deeper coverage (OMID viewability, ad-pod
 * sequencing) is documented in docs/validator-roadmap-2026-05-09.md §③.
 *
 * Spec reference: IAB VAST 4.2 (2019/2022 errata).
 *   https://iabtechlab.com/standards/vast/
 */

const { LEVELS, makeFinding } = require('./findings');
const { isVastShape, detectVastVersion } = require('./format-detect');

const F = makeFinding;

function hasTag(adm, tag) {
  return new RegExp(`<${tag}\\b`, 'i').test(adm);
}

function countTag(adm, tag) {
  const re = new RegExp(`<${tag}\\b`, 'gi');
  return (adm.match(re) || []).length;
}

// Pull all attribute=value pairs of `attr` from any `<tag>` occurrence.
// Used to find apiFramework="VPAID" etc.
function getAttrValues(adm, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(adm)) !== null) out.push(m[1]);
  return out;
}

/**
 * @param {string} adm — bid.adm string already verified as VAST shape
 * @param {string} path — JSON path of the adm field (e.g. "seatbid[0].bid[0].adm")
 * @returns {Array<{id:string, level:string, path:string, params:object}>}
 */
function validateVast(adm, path) {
  const findings = [];

  // R1. Version present + supported. We accept any major.minor that
  //     starts with 2/3/4. VAST 1.x is dead; VAST 5+ doesn't exist yet.
  const ver = detectVastVersion(adm);
  if (!ver) {
    findings.push(F('vast.version_missing', LEVELS.ERROR, path));
  } else if (!/^[234](\.\d+)?$/.test(ver)) {
    findings.push(F('vast.version_unknown', LEVELS.WARNING, path, { ver }));
  }

  // R2. Each <Ad> must declare exactly one of <InLine> or <Wrapper>.
  //     We surface "neither present" globally; per-Ad strictness is out
  //     of scope without a real parser.
  const hasInLine = hasTag(adm, 'InLine');
  const hasWrapper = hasTag(adm, 'Wrapper');
  if (!hasInLine && !hasWrapper) {
    findings.push(F('vast.inline_or_wrapper_required', LEVELS.ERROR, path));
  }

  // R3. InLine MUST contain <AdSystem> + <AdTitle> per VAST §3.2.
  if (hasInLine) {
    if (!hasTag(adm, 'AdSystem')) {
      findings.push(F('vast.adsystem_missing', LEVELS.ERROR, path));
    }
    if (!hasTag(adm, 'AdTitle')) {
      findings.push(F('vast.adtitle_missing', LEVELS.ERROR, path));
    }
    // R4. InLine MUST have at least one <MediaFile>. Without media there
    //     is nothing to play.
    if (!hasTag(adm, 'MediaFile')) {
      findings.push(F('vast.mediafile_missing', LEVELS.ERROR, path));
    }
  }

  // R5. Wrapper MUST contain <VASTAdTagURI> — that's the whole point of
  //     a wrapper.
  if (hasWrapper && !hasTag(adm, 'VASTAdTagURI')) {
    findings.push(F('vast.wrapper_no_tag_uri', LEVELS.ERROR, path));
  }

  // R6. Insecure http:// URLs in security-critical tags. SSPs running
  //     on https sites will silently reject these for mixed-content.
  //     We scan a focused set: MediaFile, VASTAdTagURI, Impression,
  //     ClickThrough, ClickTracking. CDATA is the typical wrapper but
  //     we match anything between the tags.
  const SECURE_TAGS = ['MediaFile', 'VASTAdTagURI', 'ClickThrough', 'ClickTracking', 'Impression'];
  let insecureCount = 0;
  let firstUrl = null;
  for (const tag of SECURE_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    let m;
    while ((m = re.exec(adm)) !== null) {
      const url = (m[1] || '')
        .replace(/^<!\[CDATA\[/i, '')
        .replace(/\]\]>$/, '')
        .trim();
      if (/^http:\/\//i.test(url)) {
        insecureCount++;
        if (!firstUrl) firstUrl = url.slice(0, 120);
      }
    }
  }
  if (insecureCount > 0) {
    findings.push(
      F('vast.insecure_url', LEVELS.WARNING, path, {
        count: insecureCount,
        sampleUrl: firstUrl,
      }),
    );
  }

  // R7. Multiple <Ad> in one VAST = ad-pod (sequential video ads, e.g. a
  //     pre-roll cluster). Surface as INFO so users notice — not every
  //     player handles ad-pods, and downstream processing differs.
  const adCount = countTag(adm, 'Ad');
  if (adCount >= 2) {
    findings.push(F('vast.ad_pod', LEVELS.INFO, path, { count: adCount }));
  }

  // R8. <Linear> requires <Duration>. VAST §3.7 — duration is mandatory
  //     for linear video; without it players don't know when the ad ends
  //     and tracker fires get unreliable.
  if (hasTag(adm, 'Linear') && !hasTag(adm, 'Duration')) {
    findings.push(F('vast.linear_duration_missing', LEVELS.ERROR, path));
  }

  // R9. VPAID was deprecated in VAST 4.1 and REMOVED in 4.2. Production
  //     SSPs flag VPAID creatives as legacy / risk. Detect via
  //     `apiFramework="VPAID"` on <MediaFile>.
  const apiFrameworks = getAttrValues(adm, 'MediaFile', 'apiFramework');
  if (apiFrameworks.some((v) => /^vpaid$/i.test(v))) {
    findings.push(F('vast.vpaid_deprecated', LEVELS.WARNING, path));
  }

  // R10. InLine should fire <Impression> tracking. WARN (not ERROR) — the
  //      spec recommends but doesn't strictly forbid creatives without
  //      Impression beacons; some publishers fire impressions server-side.
  //      Still: an InLine without ANY <Impression> tag is suspicious.
  if (hasInLine && !hasTag(adm, 'Impression')) {
    findings.push(F('vast.impression_tracking_missing', LEVELS.WARNING, path));
  }

  // R11. <MediaFile> should declare both width and height (VAST §3.8).
  const mfTags = adm.match(/<MediaFile\b[^>]*>/gi) || [];
  let mfNoDims = 0;
  for (const tag of mfTags) {
    if (!/\bwidth\s*=\s*["']\d+["']/i.test(tag) || !/\bheight\s*=\s*["']\d+["']/i.test(tag))
      mfNoDims++;
  }
  if (mfNoDims > 0)
    findings.push(F('vast.mediafile_no_dimensions', LEVELS.WARNING, path, { count: mfNoDims }));

  // R12. <Linear> skipoffset, if present, must be HH:MM:SS(.mmm) or 0–100%.
  //   Minutes and seconds are range-checked (0–59), not just format-checked.
  //   Decimals allowed in percentage (e.g. 33.33%); must not exceed 100.
  const skipOffsets = getAttrValues(adm, 'Linear', 'skipoffset');
  const isValidSkipOffset = (v) => {
    if (/^\d{2}:[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(v)) return true;
    const pct = /^(\d+(?:\.\d+)?)%$/.exec(v);
    if (pct) return Number(pct[1]) >= 0 && Number(pct[1]) <= 100;
    return false;
  };
  const firstBadSkip = skipOffsets.find((v) => !isValidSkipOffset(v));
  if (firstBadSkip !== undefined)
    findings.push(F('vast.skip_offset_invalid', LEVELS.WARNING, path, { val: firstBadSkip }));

  // R13. InLine <Linear> without <TrackingEvents>.
  //   Wrapper delegates tracking to the next VAST in chain; don't fire for it.
  if (hasInLine && hasTag(adm, 'Linear') && !hasTag(adm, 'TrackingEvents'))
    findings.push(F('vast.tracking_events_missing', LEVELS.INFO, path));

  // R14. <Duration> value must be a valid VAST timecode when the tag is present.
  //   R8 already fires if the tag is absent; here we validate the content.
  //   VAST §3.7: HH:MM:SS or HH:MM:SS.mmm; minutes/seconds are range-checked 00–59.
  //   Content may be CDATA-wrapped — strip markers before validating.
  if (hasTag(adm, 'Linear') && hasTag(adm, 'Duration')) {
    const durRe = /<Duration\b[^>]*>([\s\S]*?)<\/Duration>/gi;
    const durations = [];
    let dm;
    while ((dm = durRe.exec(adm)) !== null) {
      const raw = (dm[1] || '').trim();
      const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
      durations.push(cdata ? cdata[1].trim() : raw);
    }
    const firstBadDur = durations.find((v) => !/^\d{2}:[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(v));
    if (firstBadDur !== undefined)
      findings.push(F('vast.duration_invalid', LEVELS.WARNING, path, { val: firstBadDur }));
  }

  // R15: <MediaFile type> must be a recognised VAST-compatible MIME type.
  //   Only fires when the `type` attribute IS present — absence is covered by
  //   R11 (no dimensions). Case-insensitive; reports the first bad type found.
  {
    const VALID_MF_TYPES = new Set([
      'video/mp4', 'video/webm', 'video/ogg', 'video/3gpp',
      'video/x-flv', 'video/x-ms-wmv', 'video/x-msvideo',
      'application/x-mpegurl', 'video/mp2t', 'application/dash+xml',
    ]);
    const mfTags = adm.match(/<MediaFile\b[^>]*>/gi) || [];
    let badType = null;
    for (const tag of mfTags) {
      const m = /\btype\s*=\s*(["'])([^"']+)\1/i.exec(tag);
      if (!m) continue;
      if (!VALID_MF_TYPES.has(m[2].trim().toLowerCase())) {
        badType = m[2];
        break;
      }
    }
    if (badType !== null)
      findings.push(F('vast.mediafile_type_invalid', LEVELS.WARNING, path, { type: badType }));
  }

  // R16: VAST 4.x InLine should include <UniversalAdId> (required since 4.0).
  //   Wrapper is exempt — it delegates ad identity to the resolved VAST chain.
  //   VAST 2.x/3.x didn't define UniversalAdId; guard on detected version.
  if (ver && /^4/.test(ver) && hasInLine && !hasTag(adm, 'UniversalAdId'))
    findings.push(F('vast.universaladid_missing', LEVELS.INFO, path));

  return findings;
}

module.exports = { validateVast, isVastShape };
