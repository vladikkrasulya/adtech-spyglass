/**
 * finding-location.js — the additive "location contract" for findings.
 *
 * Produces a STATIC location candidate per finding so the client can jump to
 * the exact source position. The server never decides `resolvable`/`stale`;
 * it only emits the candidate (precision + primary/related pointers + dialect)
 * and the client resolves it against the CURRENT pane text (see source-map.js).
 *
 * Contract (additive — legacy `finding.path` and every existing field stay):
 *   finding.location = {
 *     precision: 'exact'|'container'|'none',          // == primary's precision
 *     primary:   { side, pointer, display, target, precision } | null,
 *     related:   [ { side, pointer, display, target, precision, role } ],
 *     dialect:   'ortb-json' | 'url' | 'vast' | 'envelope'
 *   }
 *
 * `target` picks WHICH token of the resolved node to highlight: 'value' (the
 * default), 'node' for a whole object/array, or 'key' for the field NAME — the
 * one the client falls back out of on its own when the resolved entry has no
 * key of its own. 'key' exists for the defects that ARE the name rather than
 * what it holds: a key written twice, a key misspelled (see KEY_TARGET below).
 *
 * HARD RULE: `side` comes ONLY from the validate() call context (request vs
 * response) passed in by the caller — never from an id/path regex or a
 * default. Crosscheck findings declare primary/related explicitly via the
 * per-id descriptor table below.
 *
 * Pure + isomorphic (Node `module.exports` + browser `window.OrtbtoolsFindingLocation`),
 * dependency-free. Privacy: derives only from `id`/`path`/`params` + the
 * request/response STRUCTURE — never copies payload values into the contract.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrtbtoolsFindingLocation = factory();
})(globalThis, function () {
  'use strict';

  function escapeToken(key) {
    return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  /**
   * Parse a validator display-path (`imp[0].banner`, `seatbid[0].bid[0].price`,
   * `openrtb.request.item[0].id`, `device.geo.country`) into RFC 6901 segments.
   * Grammar: ident ( '.' ident | '[' digits ']' )*  ; ident = [A-Za-z_][\w-]* .
   * @param {string} display
   * @returns {Array<string|number>|null}  segments, or null if it doesn't parse
   */
  function parsePathSegments(display) {
    if (typeof display !== 'string' || display === '') return null;
    const segs = [];
    const ident = /[A-Za-z_][A-Za-z0-9_-]*/y;
    const idx = /\[(\d+)\]/y;
    let i = 0;
    ident.lastIndex = 0;
    let m = ident.exec(display);
    if (!m || m.index !== 0) return null;
    segs.push(m[0]);
    i = ident.lastIndex;
    while (i < display.length) {
      const c = display[i];
      if (c === '.') {
        ident.lastIndex = i + 1;
        m = ident.exec(display);
        if (!m || m.index !== i + 1) return null;
        segs.push(m[0]);
        i = ident.lastIndex;
      } else if (c === '[') {
        idx.lastIndex = i;
        m = idx.exec(display);
        if (!m || m.index !== i) return null;
        segs.push(Number(m[1]));
        i = idx.lastIndex;
      } else {
        return null;
      }
    }
    return segs;
  }

  /**
   * Validator display-path → RFC 6901 pointer ('' stays ''). null if unparseable.
   * @param {string} display
   * @returns {string|null}
   */
  function pathToPointer(display) {
    if (display === '') return '';
    const segs = parsePathSegments(display);
    if (!segs) return null;
    let p = '';
    for (const s of segs) p += '/' + (typeof s === 'number' ? s : escapeToken(s));
    return p;
  }

  /** RFC 6901 pointer → dotted/bracket display-path. */
  function pointerToDisplay(pointer) {
    if (!pointer) return '';
    const toks = pointer.split('/').slice(1);
    let out = '';
    for (const t of toks) {
      const tok = t.replace(/~1/g, '/').replace(/~0/g, '~');
      if (/^\d+$/.test(tok)) out += '[' + tok + ']';
      else out += (out ? '.' : '') + tok;
    }
    return out;
  }

  // ── location object helpers ───────────────────────────────────────────────
  /** @returns {{side:string,pointer:string,display:string,target:string,precision:string}} */
  function P(side, pointer, display, target, precision) {
    return { side: side, pointer: pointer, display: display, target: target, precision: precision };
  }
  function R(side, pointer, display, target, precision, role) {
    return {
      side: side,
      pointer: pointer,
      display: display,
      target: target,
      precision: precision,
      role: role,
    };
  }
  function loc(primary, related, dialect) {
    return {
      precision: primary ? primary.precision : 'none',
      primary: primary || null,
      related: related || [],
      dialect: dialect,
    };
  }
  const NONE = function (dialect) {
    return loc(null, [], dialect || 'ortb-json');
  };

  /**
   * Findings whose subject is the KEY, not the value sitting behind it.
   *
   * A key written twice, a key spelled `bidfloorcurr`, a key that belongs on a
   * different object: in every one of these the value is innocent and the NAME
   * is the defect. Pointing at the value would underline `0.5` and tell the
   * reader to fix the number when what is wrong is the word beside it — and for
   * a duplicate key it would underline whichever of the two values the map kept,
   * which is the one thing about the finding that is not in dispute.
   *
   * Asking for the key is always safe: the client's rangeFromEntry falls back to
   * the value range on its own whenever the resolved entry has no key of its own
   * (a root object, an array element), so a wrong guess here degrades to today's
   * behaviour rather than to a broken jump.
   */
  const KEY_TARGET = {
    'payload.duplicate_key': true,
    'payload.field_misspelled': true,
    'payload.field_wrong_object': true,
    'payload.field_wrong_version': true,
    'payload.field_unrecognized': true,
  };
  // Own-property lookup, not `KEY_TARGET[id]`. Finding ids are namespaced and
  // none of them is `constructor` or `toString` today, but a plain-object table
  // indexed by a string that arrives from a finding answers truthy for every
  // name on Object.prototype, and a table that says yes to ids it has never
  // heard of is a table that will be wrong the first time one is added.
  function targetFor(id) {
    return Object.prototype.hasOwnProperty.call(KEY_TARGET, id) ? 'key' : 'value';
  }

  // Dialect is a RENDERING/precision hint only — NEVER side. Side is always the
  // call-context value. This explicit family list selects how to resolve the
  // pointer (JSON vs VAST-container vs envelope-no-jump); it does not infer side.
  function dialectOf(finding, ctx) {
    const id = (finding && finding.id) || '';
    if (ctx && ctx.kind === 'url') return 'url';
    if (id.indexOf('vast.') === 0) return 'vast';
    if (id.indexOf('version.') === 0 || id.indexOf('jsonfeed.') === 0) return 'envelope';
    // `payload.` is ONE prefix over TWO different kinds of finding, and the
    // blanket 'envelope' this used to return threw away a position that had
    // already been computed and was exact.
    //
    // Half the family really is about the payload as a whole and carries no
    // path at all — invalid_root, unknown_type, ambiguous_both_sides,
    // raw_scan_truncated. The other half names a real oRTB place that the
    // source map resolves to the byte: duplicate_key and unsafe_number arrive
    // with `imp[0].bidfloor` straight out of the raw scan, field_misspelled with
    // `imp[0].bidfloorcurr` out of the unknown-field walk.
    //
    // Losing the second half cost more than a dead jump. paintGutterSeverity
    // skips any finding without a `location.primary`, so an ERROR-level
    // duplicate bid floor left its line UNPAINTED in the gutter — and an
    // unpainted line is not a missing feature, it is the gutter asserting that
    // nothing is wrong there, on the one line where money is ambiguous.
    //
    // The discriminator is the path itself rather than a list of ids: a payload
    // finding that can name a JSON position IS an ortb-json finding whatever it
    // is called, and any new one inherits the behaviour without an edit here.
    // The pointer round-trip is part of the test on purpose — raw-json.js and
    // unknown-fields.js both build their paths from KEYS AS WRITTEN, so a key
    // literally named `a.b` comes back bracket-quoted into something the display
    // grammar cannot parse. That one stays envelope instead of becoming an
    // ortb-json finding with no pointer, which is what the corpus invariant
    // ("every ortb-json path parses") is there to catch.
    if (id.indexOf('payload.') === 0) {
      const p = (finding && finding.path) || '';
      return p && pathToPointer(p) !== null ? 'ortb-json' : 'envelope';
    }
    return 'ortb-json';
  }

  /**
   * Build the location candidate for a NORMAL (non-crosscheck) finding.
   * @param {{id?:string,path?:string}} finding
   * @param {{side?:string, kind?:string, canonical?:any}} ctx
   */
  function buildNormalLocation(finding, ctx) {
    const dialect = dialectOf(finding, ctx);
    if (dialect === 'envelope') return NONE('envelope');
    if (dialect === 'url') return buildUrlLocation(finding, ctx);
    const path = (finding && finding.path) || '';
    if (!path) return NONE(dialect);
    const pointer = pathToPointer(path);
    if (pointer === null) return NONE(dialect);
    const precision = dialect === 'vast' ? 'container' : 'exact';
    // A duplicate key resolves to ONE entry, because a source map is keyed by
    // pointer and a pointer cannot name two places. The entry it keeps is the
    // last occurrence — which is also the value `JSON.parse` kept and therefore
    // the value every other rule in the same run was reading. Landing there is
    // the honest answer to "where is this": it is the occurrence that won.
    const target = targetFor((finding && finding.id) || '');
    // VAST → the adm JSON value (container; no claim of an exact XML node).
    return loc(P(ctx.side, pointer, path, target, precision), [], dialect);
  }

  /**
   * URL findings: enable ONLY when provenance is known — i.e. the finding's
   * path is an actual raw query-parameter present in the decoded canonical's
   * `_raw`. Otherwise (canonical-derived field with unknown raw param) the
   * location is disabled — never an approximate jump. The `pointer` carries
   * the raw param key; dialect 'url' tells the client to use locateUrlParam().
   */
  function buildUrlLocation(finding, ctx) {
    const key = (finding && finding.path) || '';
    const raw = ctx && ctx.canonical && ctx.canonical._raw;
    if (key && raw && Object.prototype.hasOwnProperty.call(raw, key)) {
      return loc(P('request', key, key, 'value', 'exact'), [], 'url');
    }
    return NONE('url');
  }

  // ── crosscheck: explicit per-id primary/related declarations ──────────────
  // Keyed by EXACT finding id (no regex). Builders receive (finding, req, res)
  // and derive related pointers deterministically from the real OpenRTB
  // structure. Both `req` and `res` are read-only structure inputs.

  function bidCoords(finding) {
    const segs = parsePathSegments((finding && finding.path) || '');
    if (!segs || segs[0] !== 'seatbid' || typeof segs[1] !== 'number' || segs[2] !== 'bid')
      return null;
    return { sbi: /** @type {number} */ (segs[1]), bi: /** @type {number} */ (segs[3]) };
  }
  function bidPtr(c, leaf) {
    return '/seatbid/' + c.sbi + '/bid/' + c.bi + (leaf ? '/' + leaf : '');
  }
  function bidDisp(c, leaf) {
    return 'seatbid[' + c.sbi + '].bid[' + c.bi + ']' + (leaf ? '.' + leaf : '');
  }
  function impIndexForBid(req, res, c) {
    try {
      const impid = res.seatbid[c.sbi].bid[c.bi].impid;
      if (impid == null) return -1;
      return req.imp.findIndex(function (im) {
        return im && im.id === impid;
      });
    } catch (_e) {
      return -1;
    }
  }
  function impIndexFromPath(finding) {
    const segs = parsePathSegments((finding && finding.path) || '');
    if (segs && segs[0] === 'imp' && typeof segs[1] === 'number') return segs[1];
    return -1;
  }

  function bidPrimary(finding, leaf, precision) {
    const c = bidCoords(finding);
    if (!c) return null;
    return P(
      'response',
      bidPtr(c, leaf),
      bidDisp(c, leaf),
      leaf === '' ? 'node' : 'value',
      precision,
    );
  }

  /** @type {Record<string, (f:any,req:any,res:any)=>{precision:string,primary:any,related:any[],dialect?:string}>} */
  const CROSS = {
    'crosscheck.id_mismatch': function () {
      return finalize(P('response', '/id', 'id', 'value', 'exact'), [
        R('request', '/id', 'id', 'value', 'exact', 'request-id'),
      ]);
    },
    'crosscheck.id_match': function () {
      return finalize(P('response', '/id', 'id', 'value', 'exact'), [
        R('request', '/id', 'id', 'value', 'exact', 'request-id'),
      ]);
    },
    // Real OpenRTB: bid currency is RESPONSE-side (res.cur); the allow-list is
    // request-side (req.cur). Primary = the offending response /cur.
    'crosscheck.cur_not_in_request': function () {
      return finalize(P('response', '/cur', 'cur', 'value', 'exact'), [
        R('request', '/cur', 'cur', 'node', 'container', 'allowed-list'),
      ]);
    },
    'crosscheck.cur_allowed': function () {
      return finalize(P('response', '/cur', 'cur', 'value', 'exact'), [
        R('request', '/cur', 'cur', 'node', 'container', 'allowed-list'),
      ]);
    },
    // Response is silent about cur; the actionable spot is the request /cur list.
    'crosscheck.cur_default_usd_mismatch': function () {
      return finalize(P('request', '/cur', 'cur', 'node', 'container'), []);
    },
    'crosscheck.bid.impid_unresolved': function (f) {
      return finalize(bidPrimary(f, 'impid', 'exact'), [
        R('request', '/imp', 'imp', 'node', 'container', 'candidate-imps'),
      ]);
    },
    'crosscheck.bid.impid_resolved': function (f, req, res) {
      const c = bidCoords(f);
      const k = c ? impIndexForBid(req, res, c) : -1;
      return finalize(
        bidPrimary(f, 'impid', 'exact'),
        k >= 0
          ? [R('request', '/imp/' + k, 'imp[' + k + ']', 'node', 'container', 'target-imp')]
          : [],
      );
    },
    'crosscheck.bid.no_floor_set': function (f) {
      const k = impIndexFromPath(f);
      const primary =
        k >= 0 ? P('request', '/imp/' + k, 'imp[' + k + ']', 'node', 'container') : null;
      return finalize(primary, []);
    },
    'crosscheck.bid.below_floor': priceVsFloor,
    'crosscheck.bid.above_floor': priceVsFloor,
    'crosscheck.bid.floor_currency_mismatch': priceVsFloor,
    'crosscheck.bid.price_invalid': function (f) {
      return finalize(bidPrimary(f, 'price', 'exact'), []);
    },
    'crosscheck.bid.cat_blocked': function (f) {
      return finalize(bidPrimary(f, 'cat', 'exact'), [
        R('request', '/bcat', 'bcat', 'node', 'container', 'blocklist'),
      ]);
    },
    'crosscheck.bid.cat_clean': function (f) {
      return finalize(bidPrimary(f, 'cat', 'exact'), [
        R('request', '/bcat', 'bcat', 'node', 'container', 'blocklist'),
      ]);
    },
    'crosscheck.bid.adomain_blocked': function (f) {
      return finalize(bidPrimary(f, 'adomain', 'exact'), [
        R('request', '/badv', 'badv', 'node', 'container', 'blocklist'),
      ]);
    },
    'crosscheck.bid.pop.adomain_landing_mismatch': function (f) {
      return finalize(bidPrimary(f, 'adm', 'container'), [
        R('response', adm(f), admD(f), 'node', 'container', 'declared-adomain'),
      ]);
    },
    'crosscheck.bid.pop.adomain_landing_match': function (f) {
      return finalize(bidPrimary(f, 'adm', 'container'), []);
    },
    // Real OpenRTB: there is NO bid.size — the values live in bid.w / bid.h.
    'crosscheck.bid.size_mismatch': sizeFamily,
    'crosscheck.bid.size_match': sizeFamily,
    'crosscheck.bid.native_missing_assets': nativeFamily,
    'crosscheck.bid.native_complete': nativeFamily,
    'crosscheck.bid.native_extra_assets': nativeFamily,
    'crosscheck.bid.native_invalid_adm': nativeFamily,
    'crosscheck.bid.video_vast': videoFamily,
    'crosscheck.bid.video_not_vast': videoFamily,
    'crosscheck.no_request': function () {
      return loc(null, [], 'ortb-json');
    },
    'crosscheck.no_response': function () {
      return loc(null, [], 'ortb-json');
    },
  };

  function adm(f) {
    const c = bidCoords(f);
    return c ? bidPtr(c, 'adomain') : '';
  }
  function admD(f) {
    const c = bidCoords(f);
    return c ? bidDisp(c, 'adomain') : '';
  }

  function priceVsFloor(f, req, res) {
    const c = bidCoords(f);
    const primary = bidPrimary(f, 'price', 'exact');
    const k = c ? impIndexForBid(req, res, c) : -1;
    const related =
      k >= 0
        ? [
            R(
              'request',
              '/imp/' + k + '/bidfloor',
              'imp[' + k + '].bidfloor',
              'value',
              'exact',
              'floor',
            ),
          ]
        : [];
    return finalize(primary, related);
  }
  function sizeFamily(f, req, res) {
    const c = bidCoords(f);
    if (!c) return loc(null, [], 'ortb-json');
    const k = impIndexForBid(req, res, c);
    const related = [R('response', bidPtr(c, 'h'), bidDisp(c, 'h'), 'value', 'exact', 'height')];
    if (k >= 0)
      related.push(
        R(
          'request',
          '/imp/' + k + '/banner/format',
          'imp[' + k + '].banner.format',
          'node',
          'container',
          'allowed-sizes',
        ),
      );
    return finalize(P('response', bidPtr(c, 'w'), bidDisp(c, 'w'), 'value', 'exact'), related);
  }
  function nativeFamily(f, req, res) {
    const c = bidCoords(f);
    const k = c ? impIndexForBid(req, res, c) : -1;
    const related =
      k >= 0
        ? [
            R(
              'request',
              '/imp/' + k + '/native',
              'imp[' + k + '].native',
              'node',
              'container',
              'asset-spec',
            ),
          ]
        : [];
    return finalize(bidPrimary(f, 'adm', 'container'), related, 'ortb-json');
  }
  function videoFamily(f, req, res) {
    const c = bidCoords(f);
    const k = c ? impIndexForBid(req, res, c) : -1;
    const related =
      k >= 0
        ? [
            R(
              'request',
              '/imp/' + k + '/video',
              'imp[' + k + '].video',
              'node',
              'container',
              'video-spec',
            ),
          ]
        : [];
    return finalize(bidPrimary(f, 'adm', 'container'), related, 'vast');
  }

  function finalize(primary, related, dialect) {
    return loc(primary, related || [], dialect || 'ortb-json');
  }

  /**
   * Build the location candidate for a CROSSCHECK finding from its explicit
   * descriptor. req/res are read-only structure used to derive related
   * pointers. Unknown ids → no location (honest).
   */
  function buildCrosscheckLocation(finding, req, res) {
    const fn = CROSS[(finding && finding.id) || ''];
    if (!fn) return NONE('ortb-json');
    try {
      const out = fn(finding, req, res);
      return out && out.precision ? out : NONE('ortb-json');
    } catch (_e) {
      return NONE('ortb-json');
    }
  }

  /**
   * Attach `.location` to every finding in-place (additive). Side comes from
   * ctx.side (call context) for normal findings; crosscheck uses req/res.
   * @param {Array<any>} findings
   * @param {{side?:string, kind?:string, canonical?:any, crosscheck?:boolean, req?:any, res?:any}} ctx
   */
  function attachLocations(findings, ctx) {
    if (!Array.isArray(findings)) return findings;
    for (const f of findings) {
      if (!f || typeof f !== 'object') continue;
      f.location =
        ctx && ctx.crosscheck
          ? buildCrosscheckLocation(f, ctx.req, ctx.res)
          : buildNormalLocation(f, ctx || { side: 'request' });
    }
    return findings;
  }

  return {
    pathToPointer: pathToPointer,
    pointerToDisplay: pointerToDisplay,
    parsePathSegments: parsePathSegments,
    buildNormalLocation: buildNormalLocation,
    buildCrosscheckLocation: buildCrosscheckLocation,
    attachLocations: attachLocations,
    CROSS_IDS: Object.keys(CROSS),
  };
});
