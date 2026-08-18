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

/**
 * Walk every `<tag …>` OPEN TAG in `adm`, calling `fn(openTagText, endIndex)`.
 *
 * ── Why indexOf and not a regex ──────────────────────────────────────────
 * The obvious pattern for this is `<tag\b[^>]*>`, and it is quadratic on
 * hostile input. `adm` is attacker-controlled — it arrives in a bid
 * response someone pastes, or POSTs to the public /api/analyze. Feed it
 * `'<MediaFile '.repeat(20000)` — twenty thousand open-tag starts and not
 * one `>` — and at every start `[^>]*` runs to the end of the string, fails
 * to find what follows, and backtracks the whole way. Measured on this
 * repo before the change: 27KB → 104ms, 54KB → 381ms, 107KB → 1507ms,
 * 215KB → 6070ms. Doubling the input quadrupled the time, so the 2MB body
 * cap upstream was not a bound on anything — it permitted minutes of
 * blocked event loop from one unauthenticated request.
 *
 * Scanning with indexOf is linear and has no backtracking to exploit: find
 * the next `<tag`, find the next `>`, hand over the slice, continue past
 * it. An unterminated final tag ends the walk, because no later `>` can
 * close it either.
 *
 * Case-insensitive to match the `/i` the regexes carried; XML tag names in
 * VAST are conventionally cased but real payloads are not conventional.
 *
 * @param {string} adm
 * @param {string} tag  bare tag name, e.g. 'MediaFile'
 * @param {(openTag: string, endIndex: number) => void} fn
 */
function forEachOpenTag(adm, tag, fn) {
  const hay = adm.toLowerCase();
  const needle = '<' + tag.toLowerCase();
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    const after = hay.charCodeAt(i + needle.length);
    // `\b` in the original: the tag name must not run on into a longer one,
    // so `<MediaFiles>` is not a `<MediaFile>`. NaN (end of string) passes.
    const isWordChar =
      (after >= 97 && after <= 122) || (after >= 48 && after <= 57) || after === 95;
    if (isWordChar) {
      i += needle.length;
      continue;
    }
    const close = adm.indexOf('>', i + needle.length);
    if (close === -1) return; // unterminated — nothing after it can close either
    fn(adm.slice(i, close + 1), close);
    i = close + 1;
  }
}

// Pull all attribute=value pairs of `attr` from any `<tag>` occurrence.
// Used to find apiFramework="VPAID" etc.
function getAttrValues(adm, tag, attr) {
  // Runs against ONE open tag at a time, so the bounded backtracking here
  // is over an attribute list, not over the whole document.
  const attrRe = new RegExp(`\\s${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const out = [];
  forEachOpenTag(adm, tag, (openTag) => {
    const m = attrRe.exec(openTag);
    if (m) out.push(m[1]);
  });
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

  // R5b. A Wrapper carrying more than one <Ad> while leaving
  //      `allowMultipleAds` unset. The attribute decides whether the player
  //      renders every ad or only the first, and the omitted value is not the
  //      same everywhere: VAST prose defaults it to false, VMAP prose defaults
  //      it to true, and no schema declares either — measured across
  //      vast4.xsd, vast_4.1.xsd, vast_4.2.xsd and vast_4.4.xsd, where all
  //      three wrapper controls are bare `xs:boolean` with no `default=`.
  //      So the same document plays one ad or several depending on the layer
  //      it is embedded in, and the author's intent cannot be recovered from
  //      the tag.
  if (hasWrapper && countTag(adm, 'Ad') > 1 && !/\ballowMultipleAds\s*=/i.test(adm)) {
    findings.push(
      F('vast.wrapper_multiple_ads_ambiguous', LEVELS.WARNING, path, {
        ads: countTag(adm, 'Ad'),
      }),
    );
  }

  // R6. Insecure http:// URLs in security-critical tags. SSPs running
  //     on https sites will silently reject these for mixed-content.
  //     We scan a focused set: MediaFile, VASTAdTagURI, Impression,
  //     ClickThrough, ClickTracking. CDATA is the typical wrapper but
  //     we match anything between the tags.
  const SECURE_TAGS = ['MediaFile', 'VASTAdTagURI', 'ClickThrough', 'ClickTracking', 'Impression'];
  let insecureCount = 0;
  let firstUrl = null;
  // Walked open-tag-first for the same linearity reason as getAttrValues —
  // the old `<tag\b[^>]*>([\s\S]*?)</tag>` was the second quadratic pattern.
  //
  // Handling `/>` explicitly also fixes a miss the old regex had: a
  // self-closing `<MediaFile/>` has no `</MediaFile>`, so the lazy
  // `[\s\S]*?` ran past it to the NEXT closing tag and swallowed whatever
  // lay between — including an insecure URL that should have been flagged.
  // An empty element has no content, so there is nothing to scan and we
  // move on rather than reaching forward into a different element.
  const lowerAdm = adm.toLowerCase();
  for (const tag of SECURE_TAGS) {
    const closeTag = '</' + tag.toLowerCase() + '>';
    forEachOpenTag(adm, tag, (openTag, endIndex) => {
      if (/\/>$/.test(openTag)) return;
      const closeAt = lowerAdm.indexOf(closeTag, endIndex + 1);
      if (closeAt === -1) return;
      const url = adm
        .slice(endIndex + 1, closeAt)
        .replace(/^<!\[CDATA\[/i, '')
        .replace(/\]\]>$/, '')
        .trim();
      if (/^http:\/\//i.test(url)) {
        insecureCount++;
        if (!firstUrl) firstUrl = url.slice(0, 120);
      }
    });
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
    // Walked with forEachOpenTag for the same reason R6 is — and, as there,
    // because of what the lazy pair-matching regex did to a SELF-CLOSING tag.
    //
    // The old pattern was `<Duration\b[^>]*>([\s\S]*?)</Duration>`. Against
    // `<Duration/>` the `[^>]*` happily consumed the `/`, so an empty element
    // matched as an OPENING tag, and `[\s\S]*?` then ran forward to the next
    // creative's `</Duration>`. What landed in the list was a slab of markup —
    //
    //   "<MediaFiles><MediaFile …>https://a</MediaFile></MediaFiles></Linear>
    //    </Creative><Creative><Linear><Duration>00:00:30"
    //
    // — reported to the user as an invalid "timecode" 150 characters long. Two
    // failures in one: garbage in `val`, and the genuine `00:00:30` from the
    // second creative was swallowed into that slab and never checked at all.
    // R8 stayed silent throughout, because `hasTag('Duration')` is satisfied by
    // the empty tag. An ad pod with one broken creative therefore produced one
    // nonsense warning and zero real validation.
    //
    // An empty `<Duration/>` is now read as what it is — a Duration whose
    // content is the empty string — and fails the timecode test on its own
    // merits. That is deliberately NOT R6's "self-closing has no content, skip
    // it" rule: for a URL scan emptiness means nothing to look at, but here
    // emptiness IS the defect. It also makes `<Duration/>` and
    // `<Duration></Duration>` behave identically, which they must — XML says
    // they are the same element, yet the old code gave one a bogus finding and
    // the other a correct one.
    const durations = [];
    const CLOSE_DURATION = '</duration>';
    forEachOpenTag(adm, 'Duration', (openTag, endIndex) => {
      if (/\/>$/.test(openTag)) {
        durations.push('');
        return;
      }
      const closeAt = lowerAdm.indexOf(CLOSE_DURATION, endIndex + 1);
      if (closeAt === -1) return; // unterminated — the parser reports that, not us
      const raw = adm.slice(endIndex + 1, closeAt).trim();
      const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
      durations.push(cdata ? cdata[1].trim() : raw);
    });
    const firstBadDur = durations.find((v) => !/^\d{2}:[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(v));
    if (firstBadDur !== undefined)
      findings.push(F('vast.duration_invalid', LEVELS.WARNING, path, { val: firstBadDur }));
  }

  // R15: <MediaFile type> must be a recognised VAST-compatible MIME type.
  //   Only fires when the `type` attribute IS present — absence is covered by
  //   R11 (no dimensions). Case-insensitive; reports the first bad type found.
  {
    const VALID_MF_TYPES = new Set([
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/3gpp',
      'video/x-flv',
      'video/x-ms-wmv',
      'video/x-msvideo',
      'application/x-mpegurl',
      'video/mp2t',
      'application/dash+xml',
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

  // R17: InLine <VideoClicks> should contain a <ClickThrough> landing URL.
  //   <ClickTracking> without <ClickThrough> records a pixel but sends the
  //   user nowhere — clicks are unattributable and the bid CPC/CPA value is
  //   lost. Wrapper is exempt; it delegates click handling to the chain.
  if (hasInLine && hasTag(adm, 'VideoClicks') && !hasTag(adm, 'ClickThrough'))
    findings.push(F('vast.videoclicks_no_clickthrough', LEVELS.INFO, path));

  // R18: <NonLinear> overlays should declare width and height (VAST §3.10).
  //   The player uses these to position and scale the overlay over the video
  //   frame; without dimensions placement is guesswork and the overlay may
  //   not render at all. Analogue of R11 for NonLinear.
  {
    const nlTags = adm.match(/<NonLinear\b[^>]*>/gi) || [];
    let nlNoDims = 0;
    for (const tag of nlTags) {
      if (!/\bwidth\s*=\s*["']\d+["']/i.test(tag) || !/\bheight\s*=\s*["']\d+["']/i.test(tag))
        nlNoDims++;
    }
    if (nlNoDims > 0)
      findings.push(F('vast.nonlinear_no_dimensions', LEVELS.WARNING, path, { count: nlNoDims }));
  }

  return findings;
}

module.exports = { validateVast, isVastShape };
