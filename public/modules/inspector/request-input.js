/* ============================================================
   Inspector request-input boundary.

   The request pane accepts either an OpenRTB JSON value or a legacy
   HTTP(S) feed URL. Keep parsing and editor serialisation symmetrical:

     raw URL -> string -> raw URL
     JSON    -> value  -> pretty JSON

   In particular, do not JSON.stringify() a URL before putting it in
   History. That turns it into a quoted JSON scalar and makes a later
   History load look different from the request the user pasted.
   ============================================================ */
'use strict';

/**
 * Edge noise the routing test has to see past. `String.prototype.trim()` is
 * not enough: U+200B and friends are not whitespace in ECMAScript, so a
 * zero-width space smuggled in by a chat client survived the trim and pushed
 * the paste off the front-anchored scheme test. Format and control characters
 * are a deliberate superset of the list `repairInput()`'s `invisible_chars`
 * step removes: this only has to LOOK past them to route, so being generous
 * at the two edges costs nothing and cannot alter what the server repairs.
 */
const EDGE_NOISE = /^[\s\p{Cf}\p{Cc}]+|[\s\p{Cf}\p{Cc}]+$/gu;

/**
 * Full-string wrappers a human paste picks up in transit — the same pairs
 * `repairInput()`'s `wrappers` step peels, MINUS `"…"`. See the long note on
 * `isUrlLikeInput` for why the double quote is deliberately left alone.
 */
const WRAPPER_CLOSERS = new Map([
  ['<', '>'],
  ["'", "'"],
  ['`', '`'],
  ['(', ')'],
]);

/** The deliberately small markdown-link shape, mirroring `markdownDestination()`. */
const MARKDOWN_LINK = /^\[[^\]]*\]\((\S*)\)$/;

/**
 * Any `scheme://` opener, not just http(s): the decoder registry answers
 * `unsupported_scheme` for those, and `detect.js` says so explicitly —
 * "the operator typed `javascript:`/`mailto:`/`ftp:` themselves; answering
 * about the scheme beats answering about JSON".
 */
const ANY_SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * authority [ :port ] [ delimiter ] — the cheap sketch of a schemeless URL.
 * Besides a bracketed IPv6 literal, the authority class admits no whitespace,
 * `@`, `"` or `{`, so prose, userinfo and a JSON fragment cannot reach the URL
 * branch through it.
 */
const SCHEMELESS_SHAPE =
  /^(\/\/)?(\[[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*\]|[A-Za-z0-9._~%+-]+)(:\d{1,5})?([/?#]|$)/;

/**
 * Strip edge noise and peel full-string wrappers so the shape tests below see
 * the URL a human meant to paste. Bounded rather than run to a fixed point
 * like `repairInput()`: the routing answer only needs to see past the wrappers
 * a real paste stacks, and the badge re-runs this on every keystroke.
 *
 * This is NOT a repair. The peeled core decides "URL or JSON" and is then
 * thrown away — `parseRequestInput()` forwards the operator's own bytes, so
 * the server's `repairs[0].before` stays their paste and not ours.
 *
 * @param {string} text
 * @returns {string}
 */
function urlRoutingCore(text) {
  let core = text.replace(EDGE_NOISE, '');

  for (let depth = 0; depth < 4 && core.length > 1; depth += 1) {
    const link = MARKDOWN_LINK.exec(core);
    if (link) {
      core = link[1].replace(EDGE_NOISE, '');
      continue;
    }

    const closer = WRAPPER_CLOSERS.get(core[0]);
    if (!closer || core.at(-1) !== closer) break;
    core = core.slice(1, -1).replace(EDGE_NOISE, '');
  }

  return core;
}

/**
 * A schemeless authority is claimed only when it carries a marker prose does
 * not: a `//` prefix, an explicit `:port`, or a `/` `?` `#` delimiter.
 * `_input-repair.js` would happily prepend `https://` to a bare dotted token,
 * but `request.json`, `2.5.1` and `req.imp.0.banner` are that shape too, and a
 * JSON syntax error is the more honest answer for them than a URL verdict.
 *
 * @param {string} core
 * @returns {boolean}
 */
function looksLikeSchemelessUrl(core) {
  const match = SCHEMELESS_SHAPE.exec(core);
  if (!match) return false;

  const [, schemeRelative, authority, port, delimiter] = match;
  const named = authority.includes('.') || authority === 'localhost' || authority.startsWith('[');

  // `//host/…` is the scheme-relative form `withDefaultScheme()` completes.
  // Requiring a named authority keeps a pasted `//legacy/path` line of code
  // out of the URL branch.
  if (schemeRelative) return named;
  if (named) return Boolean(port) || Boolean(delimiter);
  // A single-label host (a Docker service name, say) is claimed only with BOTH
  // a port and a path, so a stray `12:30` cannot become a URL verdict.
  return Boolean(port) && Boolean(delimiter);
}

/**
 * Permissive: the text LOOKS like a URL, however mangled. This is the routing
 * test — its only job is "send this to the server as a URL-style request" — so
 * it stays cheap and deliberately non-authoritative about what a valid URL is.
 * People paste URLs with spaces from wrapped log lines and truncated hosts
 * from chat; those must still travel to the server as URL-style requests so
 * validate() can produce a verdict about THEM, alongside the response-side
 * findings. A strict `new URL()` gate here once made a mangled URL throw as
 * "not valid JSON", which aborted the whole analysis and blamed the wrong
 * format.
 *
 * It used to be a bare `^https?://` prefix match on the trimmed string, which
 * was strictly narrower than the server's repair contract
 * (packages/core/decoders/request/_input-repair.js). `repairInput()` runs six
 * steps and three of them exist precisely for text that does NOT start with
 * http(s)://, so those steps were unreachable from the UI. Measured before the
 * fix — every one of these was rejected here and repaired correctly there, and
 * the operator instead got `Unexpected token '<', "<https://f"... is not valid
 * JSON`:
 *
 *   feed.vendor.example/search?a=1                  -> scheme
 *   //feed.vendor.example/search?a=1                -> scheme
 *   <https://feed.vendor.example/search?a=1>        -> wrappers
 *   [feed](https://feed.vendor.example/search?a=1)  -> wrappers
 *   U+200B + https://feed.vendor.example/search?a=1 -> invisible_chars
 *
 * Hence the two-stage shape: look past the same edge noise and wrappers the
 * repair contract knows about, then apply a prefix/authority test to what is
 * left. Recognising the SHAPE is not reimplementing the repair — the server
 * still owns the repaired bytes and the `repairs[]` record shown to the user.
 *
 * Where the line is drawn against JSON:
 *  - JSON wins ties. `parseRequestInput()` tries JSON.parse first, so only
 *    text JSON has already rejected reaches this test; anything that still
 *    looks like a JSON attempt (`{…}`, `[…]`, `"…"`, a bare number) fails the
 *    authority class and keeps its JSON syntax error, which is what a user
 *    debugging a trailing comma needs to see.
 *  - `"…"` is NOT peeled as a wrapper even though `repairInput()` peels it: it
 *    is JSON's own shape. A quoted URL already parses as a JSON string scalar
 *    and never reaches here, while peeling it would let
 *    `serializeRequestInput()` store such a scalar bare and reload it as a
 *    different value — the History round-trip bug the header warns about.
 *  - Everything this test accepts is text `JSON.parse` rejects, which is what
 *    keeps `serializeRequestInput()` symmetrical by construction.
 */
export function isUrlLikeInput(text) {
  if (typeof text !== 'string') return false;
  const core = urlRoutingCore(text);
  if (!core) return false;
  if (ANY_SCHEME_PREFIX.test(core)) return true;
  return looksLikeSchemelessUrl(core);
}

export function parseRequestInput(text) {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (jsonError) {
    const trimmed = text.trim();
    // `trim()`, not the routing core: the server must receive the operator's
    // bytes — including the zero-width space that routed this here — so its
    // `repairs[]` can tell them what was removed and why.
    if (isUrlLikeInput(trimmed)) return trimmed;
    throw jsonError;
  }
}

export function serializeRequestInput(value) {
  // Bare only for what the URL branch produced — the same permissive test
  // parseRequestInput routes on, so the two stay symmetrical by construction.
  // An unconditional bare-string branch stored a JSON string scalar ("hello")
  // unquoted, and the History reload then threw on its own stored entry.
  return typeof value === 'string' && isUrlLikeInput(value)
    ? value
    : JSON.stringify(value, null, 2);
}

/**
 * What the badge says, and why it asks the routing test rather than a stricter one.
 *
 * The badge names the format the input is about to be analysed AS. It is not a
 * second opinion on whether the URL is any good — the server owns that verdict,
 * and answers it with a message and a `repairs[]` record no four-state chip can
 * compete with.
 *
 * It used to call a display-grade `isHttpUrlInput()`: `isUrlLikeInput()` first,
 * then a strict `new URL()` on the text AS TYPED. That second judgement had
 * exactly one caller — this function — and it disagreed with the one judgement
 * the app acts on. Measured across the shapes the server repair contract
 * accepts, six inputs read "invalid" here while the analyser produced a clean
 * URL request from them:
 *
 *   feed.vendor.example/search?a=1                  invalid  ->  URL request
 *   //feed.vendor.example/search?a=1                invalid  ->  URL request
 *   <https://feed.vendor.example/search?a=1>        invalid  ->  URL request
 *   [feed](https://feed.vendor.example/search?a=1)  invalid  ->  URL request
 *   U+200B + https://feed.vendor.example/search…    invalid  ->  URL request
 *   ftp://h.example/link                            invalid  ->  URL request
 *
 * So the operator was told their paste was broken and then watched it analyse.
 *
 * Mirroring `repairInput()` into the browser and re-running the strict test on
 * the REPAIRED text was the obvious repair, and it was measured too: it fixes
 * the first five and leaves `ftp://` disagreeing, because that one is routed to
 * the server precisely so the server can answer about the scheme. Two
 * judgements kept in agreement by care, at the cost of a mirrored module and a
 * browser global — still disagreeing.
 *
 * There is only one judgement now. The badge calls `isUrlLikeInput()` — the
 * same function `parseRequestInput()` routes on, in the same order, JSON first
 * — so it cannot disagree with what happens next. Nothing keeps them in sync
 * because there are not two things to sync. The permissiveness is bounded by
 * that function's own guards, which `tests/inspector-request-input.test.js`
 * pins: `request.json`, `2.5.1`, `12:30` and a trailing comma all keep their
 * JSON error here exactly as they keep it there.
 */
export function inputBadgeState(text, opts = {}) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return { kind: 'empty', key: 'badge.empty' };

  // JSON first, mirroring parseRequestInput's own order rather than relying on
  // the invariant that the two tests are mutually exclusive. They are, and a
  // test pins it — but a badge that shadows the router's control flow stays
  // truthful even on the day that invariant is what broke.
  try {
    JSON.parse(trimmed);
    return { kind: 'valid', key: 'badge.valid' };
  } catch {
    /* not JSON — fall through to the same URL question the router asks */
  }

  if (opts.allowUrl && isUrlLikeInput(trimmed)) {
    return { kind: 'url', key: 'badge.url_request' };
  }
  return { kind: 'invalid', key: 'badge.invalid' };
}

export function renderInputBadge(text, badge, translate, opts = {}) {
  const state = inputBadgeState(text, opts);
  badge.textContent = translate(state.key);
  badge.className = `json-badge ${state.kind}`;
  return state;
}
