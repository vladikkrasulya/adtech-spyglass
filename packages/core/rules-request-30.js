'use strict';

/**
 * IAB OpenRTB 3.0 BidRequest validation — envelope + item + context + placement deep validation.
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/3.0.md
 */

const { isObj, isStr, isNum, ISO_3166_ALPHA3, ISO_639_ALPHA2 } = require('./helpers');
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
  const hasContext = isObj(req.context);
  if (!hasContext) {
    findings.push(F('request.30.context_recommended', LEVELS.WARNING, 'openrtb.request.context'));
  } else {
    validateContext30(req.context, findings);
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
    } else {
      validatePlacement30(it.spec, ip, num, findings);
    }
  });

  // R8. Always emit the limitation INFO note.
  findings.push(F('request.30.deep_validation_limited', LEVELS.INFO, ''));

  return findings;
}

/**
 * Validates the oRTB 3.0 context targeting object.
 */
function validateContext30(context, findings) {
  const bp = 'openrtb.request.context';

  // 1. distribution channel — exactly one of site / app / dooh. AdCOM 1.0
  //    has three DistributionChannel subclasses; a DOOH request (billboard /
  //    kiosk) carries neither site nor app, so it must NOT trip "no channel".
  const channels = ['site', 'app', 'dooh'].filter((k) => context[k]);
  if (channels.length > 1) {
    findings.push(
      F('request.30.context.site_and_app_both', LEVELS.WARNING, bp, {
        channels: channels.join(', '),
      }),
    );
  } else if (channels.length === 0) {
    findings.push(F('request.30.context.no_site_or_app', LEVELS.ERROR, bp));
  }

  // 2. site
  if (context.site) {
    if (!isObj(context.site)) {
      findings.push(F('request.30.context.site_invalid', LEVELS.ERROR, `${bp}.site`));
    } else if (!isStr(context.site.domain)) {
      findings.push(
        F('request.30.context.site.domain_missing', LEVELS.WARNING, `${bp}.site.domain`),
      );
    }
  }

  // 3. app
  if (context.app) {
    if (!isObj(context.app)) {
      findings.push(F('request.30.context.app_invalid', LEVELS.ERROR, `${bp}.app`));
    } else if (!isStr(context.app.bundle)) {
      findings.push(F('request.30.context.app.bundle_missing', LEVELS.WARNING, `${bp}.app.bundle`));
    }
  }

  // 4. device
  if (!context.device) {
    findings.push(F('request.30.context.device_required', LEVELS.ERROR, `${bp}.device`));
  } else if (!isObj(context.device)) {
    findings.push(F('request.30.context.device_invalid', LEVELS.ERROR, `${bp}.device`));
  } else {
    const dev = context.device;
    if (!dev.ip && !dev.ipv6) {
      findings.push(F('request.30.context.device.ip_required', LEVELS.ERROR, `${bp}.device.ip`));
    }
    if (!isStr(dev.ua)) {
      findings.push(F('request.30.context.device.ua_required', LEVELS.ERROR, `${bp}.device.ua`));
    }
    if (dev.geo) {
      if (!isObj(dev.geo)) {
        findings.push(F('request.30.context.device.geo_invalid', LEVELS.ERROR, `${bp}.device.geo`));
      } else if (dev.geo.country && !ISO_3166_ALPHA3.test(dev.geo.country)) {
        findings.push(
          F(
            'request.30.context.device.geo.country_invalid',
            LEVELS.WARNING,
            `${bp}.device.geo.country`,
            {
              country: dev.geo.country,
            },
          ),
        );
      }
    }
    const langVal = dev.lang || dev.language;
    if (langVal) {
      if (!ISO_639_ALPHA2.test(langVal)) {
        findings.push(
          F('request.30.context.device.language_invalid', LEVELS.WARNING, `${bp}.device.lang`, {
            language: langVal,
          }),
        );
      }
    } else {
      findings.push(
        F('request.30.context.device.language_missing', LEVELS.INFO, `${bp}.device.lang`),
      );
    }
  }

  // 5. regs
  if (context.regs) {
    if (!isObj(context.regs)) {
      findings.push(F('request.30.regs_invalid', LEVELS.ERROR, `${bp}.regs`));
    } else {
      const regs = context.regs;
      // GDPR Consent
      const gdprTopLevel = regs.gdpr === 1;
      const gdprLegacy = regs.ext && regs.ext.gdpr === 1;
      if (gdprTopLevel || gdprLegacy) {
        const consent =
          (context.user && context.user.consent) ||
          (context.user && context.user.ext && context.user.ext.consent);
        if (!isStr(consent) || !consent.trim()) {
          findings.push(
            F(
              'request.30.regs.gdpr_consent_missing',
              LEVELS.WARNING,
              gdprTopLevel ? `${bp}.regs.gdpr` : `${bp}.regs.ext.gdpr`,
            ),
          );
        }
      }

      // COPPA PII checks
      if (regs.coppa === 1) {
        const userObj = context.user || {};
        const hasUid = isStr(userObj.id) || isStr(userObj.buyeruid);
        const devGeo = (context.device && context.device.geo) || {};
        const hasGeo = devGeo.lat != null || devGeo.lon != null;
        if (hasUid || hasGeo) {
          findings.push(
            F('request.30.regs.coppa_pii_present', LEVELS.WARNING, `${bp}.regs.coppa`, {
              hasUid: String(hasUid),
              hasGeo: String(hasGeo),
            }),
          );
        }
      }

      // CCPA us_privacy
      const usp = regs.ext && regs.ext.us_privacy;
      if (usp != null) {
        if (!isStr(usp) || !/^[1-9][-YN][-YN][-YN]$/i.test(usp)) {
          findings.push(
            F('request.30.regs.us_privacy_invalid', LEVELS.WARNING, `${bp}.regs.ext.us_privacy`, {
              usp: String(usp),
            }),
          );
        }
      }

      // GPP
      const hasGppSid = Array.isArray(regs.gpp_sid) && regs.gpp_sid.length;
      const hasGppStr = isStr(regs.gpp) && regs.gpp.trim();
      if (hasGppSid && !hasGppStr) {
        findings.push(
          F('request.30.regs.gpp_sid_without_string', LEVELS.WARNING, `${bp}.regs.gpp`),
        );
      } else if (hasGppStr && !hasGppSid) {
        findings.push(
          F('request.30.regs.gpp_string_without_sid', LEVELS.WARNING, `${bp}.regs.gpp_sid`),
        );
      }
    }
  }

  // 6. user
  if (context.user) {
    if (!isObj(context.user)) {
      findings.push(F('request.30.context.user_invalid', LEVELS.ERROR, `${bp}.user`));
    } else {
      const user = context.user;
      if (user.gender && !['M', 'F', 'O'].includes(user.gender)) {
        findings.push(
          F('request.30.context.user.gender_invalid', LEVELS.WARNING, `${bp}.user.gender`, {
            gender: user.gender,
          }),
        );
      }
    }
  }
}

/**
 * Validates AdCOM placement specification under item[].spec.placement.
 */
function validatePlacement30(spec, ip, num, findings) {
  if (!isObj(spec.placement)) {
    findings.push(
      F('request.30.item.placement_required', LEVELS.ERROR, `${ip}.spec.placement`, { num }),
    );
    return;
  }
  const placement = spec.placement;

  const hasDisplay = placement.display != null;
  const hasVideo = placement.video != null;
  const hasAudio = placement.audio != null;
  const hasNative = placement.native != null;

  if (!hasDisplay && !hasVideo && !hasAudio && !hasNative) {
    findings.push(
      F('request.30.item.placement_format_required', LEVELS.ERROR, `${ip}.spec.placement`, { num }),
    );
  }

  // display
  if (hasDisplay) {
    if (!isObj(placement.display)) {
      findings.push(
        F('request.30.item.display_invalid', LEVELS.ERROR, `${ip}.spec.placement.display`, { num }),
      );
    } else {
      const d = placement.display;
      if (d.w != null && (!isNum(d.w) || d.w <= 0)) {
        findings.push(
          F(
            'request.30.item.display.size_invalid',
            LEVELS.WARNING,
            `${ip}.spec.placement.display.w`,
            { num },
          ),
        );
      }
      if (d.h != null && (!isNum(d.h) || d.h <= 0)) {
        findings.push(
          F(
            'request.30.item.display.size_invalid',
            LEVELS.WARNING,
            `${ip}.spec.placement.display.h`,
            { num },
          ),
        );
      }
    }
  }

  // video
  if (hasVideo) {
    if (!isObj(placement.video)) {
      findings.push(
        F('request.30.item.video_invalid', LEVELS.ERROR, `${ip}.spec.placement.video`, { num }),
      );
    } else {
      const v = placement.video;
      if (!Array.isArray(v.mime) || !v.mime.length) {
        findings.push(
          F(
            'request.30.item.video.mime_required',
            LEVELS.ERROR,
            `${ip}.spec.placement.video.mime`,
            { num },
          ),
        );
      }
      // AdCOM VideoPlacement carries accepted creative subtypes (the VAST
      // version equivalent) in `ctype` (List: Creative Subtypes — Audio/Video),
      // NOT in 2.x-style `protocols`. Recommended, not strictly required → WARN.
      if (!Array.isArray(v.ctype) || !v.ctype.length) {
        findings.push(
          F(
            'request.30.item.video.ctype_recommended',
            LEVELS.WARNING,
            `${ip}.spec.placement.video.ctype`,
            { num },
          ),
        );
      }
      if (v.mindur != null || v.maxdur != null) {
        const min = v.mindur;
        const max = v.maxdur;
        if (
          (min != null && min <= 0) ||
          (max != null && max <= 0) ||
          (min != null && max != null && min > max)
        ) {
          findings.push(
            F(
              'request.30.item.video.dur_invalid',
              LEVELS.WARNING,
              `${ip}.spec.placement.video.maxdur`,
              {
                num,
                mindur: min,
                maxdur: max,
              },
            ),
          );
        }
      }
    }
  }

  // audio
  if (hasAudio) {
    if (!isObj(placement.audio)) {
      findings.push(
        F('request.30.item.audio_invalid', LEVELS.ERROR, `${ip}.spec.placement.audio`, { num }),
      );
    } else {
      const a = placement.audio;
      if (!Array.isArray(a.mime) || !a.mime.length) {
        findings.push(
          F(
            'request.30.item.audio.mime_required',
            LEVELS.ERROR,
            `${ip}.spec.placement.audio.mime`,
            { num },
          ),
        );
      }
    }
  }

  // native
  if (hasNative) {
    if (!isObj(placement.native)) {
      findings.push(
        F('request.30.item.native_invalid', LEVELS.ERROR, `${ip}.spec.placement.native`, { num }),
      );
    }
  }
}

module.exports = { validateRequest30 };
