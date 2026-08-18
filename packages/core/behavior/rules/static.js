'use strict';

/**
 * Static / payload-analysis rules — Phase 6 of the Behavior epic.
 *
 * Where Phase 1-5 instrumented the *runtime* (probe inside the iframe
 * captures DOM events, navigation API calls, performance counters),
 * Phase 6 examines the *raw creative source* before any execution.
 * Some attack patterns are visible only as code (eval(atob(…)), packer
 * signatures, miner libraries, document.write(decodeURIComponent(…))),
 * and they're often hidden behind enough indirection that the runtime
 * probe never observes the smoking gun in the dispatched event stream.
 *
 * Pipeline:
 *   scanCreative(adm) → SyntheticEvent[]
 *     emits events with kind ∈ {static_obfuscation, static_miner,
 *     static_xss_marker, static_high_entropy} that look identical in
 *     shape to probe events. analyze() concats them onto the events
 *     array and the rule functions in this file promote each kind to
 *     the matching finding.
 *
 *     Before any pattern runs, the source is normalized (transport
 *     escaping undone), base64 runs are elided (and measured), and a
 *     head+tail window is cut. See the comment blocks on
 *     normalizeTransportEscapes / elideBase64Runs / windowScanSource —
 *     each of those three steps closes a way the scanner used to be
 *     silently talked out of looking at the code.
 *
 * Findings emitted:
 *   - static_obfuscation   → behavior.static.obfuscation (ERROR)
 *   - static_miner         → behavior.static.miner_signature (ERROR)
 *   - static_xss_marker    → behavior.static.xss_marker (ERROR)
 *   - static_high_entropy  → behavior.static.high_entropy_blob (WARNING)
 *
 * Severity rationale:
 *   - obfuscation / miner / xss_marker are categorical: no legitimate
 *     banner ships eval(atob), a CoinHive reference, or
 *     document.write(decodeURIComponent(…)) by accident.
 *   - high_entropy is WARNING because base64 blobs sometimes carry
 *     legitimate compressed assets (sprites, embedded fonts, custom
 *     glyphs). Entropy alone can't distinguish a packed payload from a
 *     valid binary; surface it for review rather than block.
 */

const { LEVELS, makeFinding } = require('../../findings');

// ── Pattern banks ───────────────────────────────────────────────────
//
// Each entry: { id, re }. The `id` propagates into the finding's
// `pattern` / `signature` param so analysts know which heuristic fired
// (and so we can deprecate individual heuristics that prove noisy
// without rewriting the rule body).
//
// All patterns are deliberately conservative — false negatives are
// acceptable, false positives on a live SSP destroy trust in the tool.

const OBFUSCATION_PATTERNS = [
  // Canonical "decode + run" chain — base64 payload pulled out at runtime.
  { id: 'eval_atob', re: /\beval\s*\(\s*atob\s*\(/ },
  // URL-encoded variant. Older malware preferred unescape() for terseness.
  { id: 'eval_decode_uri', re: /\beval\s*\(\s*(?:decodeURIComponent|unescape)\s*\(/ },
  // Function constructor with a literal "return …" body — eval-equivalent
  // that bypasses naive eval-string scanners.
  //
  // The negative lookahead is load-bearing (audit 2026-08-18). The single
  // most common `Function("return …")` in the wild is not malware at all:
  // `new Function("return this")()` is THE canonical way to reach the
  // global object from inside a bundle, emitted verbatim by the webpack
  // runtime (`__webpack_require__.g`), core-js, regenerator-runtime,
  // lodash (`root`), and virtually every UMD-wrapped ad tag (IMA SDK,
  // Prebid, GPT wrappers). Flagging it fired behavior.static.obfuscation
  // at ERROR on ordinary bundled creatives — and packages/core/intel/gate.js
  // then dropped every such bid out of training as `static-error:`. So we
  // exempt exactly the global-object idiom: the body must be nothing but
  // `this` / `globalThis` / `window` / `self` / `global` (optional `;`)
  // before the closing quote. The exemption ends the moment the body does
  // anything more — `Function("return window.location=…")` and
  // `Function("return " + payload)` still match.
  {
    id: 'function_constructor',
    re: /\b(?:new\s+)?Function\s*\(\s*(['"`])\s*return(?=[\s;]|\1)(?!\s*(?:this|globalThis|window|self|global)\s*;?\s*\1)/,
  },
  // Dean Edwards packer signature. Universally fingerprintable.
  {
    id: 'packer',
    re: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[rd]\s*\)/,
  },
  // jjencode — characteristic '$=~[]' bootstrap string.
  { id: 'jjencode', re: /\$\s*=\s*~\s*\[\s*\]/ },
  // aaencode — Japanese kana glyphs as variable names.
  //
  // Conjunction, not a single glyph (audit 2026-08-18). Taken alone,
  // (ﾟДﾟ) and ﾟωﾟ are not signatures of anything — they are everyday
  // Japanese kaomoji ("shock" / "face"), and any JP-market creative whose
  // ad copy read えっ(ﾟДﾟ) 今なら70%OFF used to raise an ERROR-level
  // obfuscation finding and lose the bid from intel training. The
  // aaencode *encoder*, by contrast, always emits its whole bootstrap on
  // the first line — `ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻` followed by the (ﾟΘﾟ) and
  // (ﾟｰﾟ) accumulator variables — so we require three independent glyph
  // groups to co-occur. Ad copy never carries all three; encoder output
  // always does.
  //
  // The code points are written out below because these glyphs are
  // unreviewable by eye (halfwidth kana plus Greek/Cyrillic lookalikes):
  // one byte mangled by a copy-paste through a non-UTF-8 pipe would
  // silently disable the heuristic with nothing to see in the diff. The
  // audit test asserts the pattern against a fixture built from these
  // escapes, so a mangled literal here fails the suite instead of the
  // scan.
  //   ﾟ=U+FF9F  ω=U+03C9  ﾉ=U+FF89  Θ=U+0398  ｰ=U+FF70
  //
  // Anchored at ^ so the three whole-string lookaheads run once. Without
  // the anchor the engine would retry all three at every start position —
  // quadratic on a 100 KB creative.
  {
    id: 'aaencode',
    re: /^(?=[\s\S]*ﾟωﾟﾉ)(?=[\s\S]*\(ﾟΘﾟ\))(?=[\s\S]*\(ﾟｰﾟ\))/,
  },
];

const MINER_PATTERNS = [
  // Library + service name matches. \b ensures we don't match
  // 'cryptocurrencyhive' or other innocuous substrings.
  { id: 'coinhive', re: /\bcoin[-_]?hive\b/i },
  { id: 'cryptoloot', re: /\bcrypto[-_]?loot\b/i },
  { id: 'cryptonight', re: /\bcrypto[-_]?night\b/i },
  { id: 'jsecoin', re: /\bjsecoin\b/i },
  { id: 'webminerpool', re: /\bweb[-_]?miner[-_]?pool\b/i },
  { id: 'monero_ocean', re: /\bmonero[-_]?ocean\b/i },
  { id: 'deepminer', re: /\bdeep[-_]?miner\b/i },
];

const XSS_PATTERNS = [
  // document.write(decode(…)) — feed encoded HTML into the parser.
  // Classic DOM-XSS sink; also the textbook cloaked-redirect primitive.
  {
    id: 'docwrite_decode',
    re: /document\s*\.\s*write\s*\(\s*(?:decodeURIComponent|unescape|atob)\s*\(/,
  },
  // .innerHTML = decode(…) — same shape, alternate sink.
  {
    id: 'innerhtml_decode',
    re: /\.\s*innerHTML\s*=\s*(?:decodeURIComponent|unescape|atob)\s*\(/,
  },
  // setAttribute('on…', …) — dynamic event-handler injection that
  // bypasses CSP `script-src` rules in some configurations.
  {
    id: 'set_event_attr',
    re: /\.\s*setAttribute\s*\(\s*['"`]on\w+['"`]\s*,/,
  },
];

// ── High-entropy blob detection ────────────────────────────────────
//
// Long runs of base64 chars carry either legitimate assets (compressed
// images, fonts) or hidden code/data. Entropy alone can't tell them
// apart, but it can distinguish "structured" from "uniform random":
//   - Plain English in base64: ~5.0 bits/char
//   - Compressed text:         ~5.5 bits/char
//   - Random binary:           ~5.95 bits/char (max for base64 alphabet)
//   - URL with timestamp:      ~4.0 bits/char
//
// Threshold 4.5 catches anything denser than typical filenames+URLs
// while leaving short cache-buster query strings alone.

const BASE64_MIN_RUN = 500;
const BASE64_HIGH_ENTROPY_THRESHOLD = 4.5;

// One creative can carry hundreds of sprites. Each blob costs a WARNING
// finding, and a findings list with 400 identical warnings is the same as
// no findings list at all. Report the first few and stop — the point of
// the heuristic is "this creative hides binary payloads", which the first
// hit already makes.
const MAX_ENTROPY_BLOBS = 32;

// What replaces an elided base64 run, and what joins the head/tail
// windows. Deliberately a character that is neither base64 nor
// whitespace: eliding a blob must never *fabricate* a hit by gluing two
// innocent halves together (`eval …(atob(` must not read as `eval(atob(`).
const BLOB_PLACEHOLDER = '…';

// Bounds on how much of one creative we touch at all. Two levels:
//   RAW    — the slice we normalize + sweep for blobs (linear, cheap).
//   HEAD/TAIL — the window the 16 pattern regexes actually run over.
//
// The head/tail split replaced a head-only cap (audit 2026-08-18). The
// old comment justified head-only with "malicious payloads always fire in
// the head of the creative, the long tail is padding" — which is exactly
// backwards as a security argument: an attacker who knows the scanner
// stops at 100 KB simply puts his padding FIRST. One inline retina sprite
// (a perfectly ordinary 64+ KB data: URI) pushed every byte of the actual
// script out of the window, and the only finding left was a useless
// high_entropy warning about the picture. Now base64 runs are elided
// before the window is cut, so padding of the one shape that makes
// creatives huge costs the attacker nothing and buys him nothing; and
// whatever bulk remains is scanned from both ends.
const ADM_RAW_LIMIT = 1024 * 1024; // 1 MB of source we will look at
const ADM_HEAD_SCAN_LIMIT = 100 * 1024; // pattern window, from the front
const ADM_TAIL_SCAN_LIMIT = 50 * 1024; //  … and from the back

// ── Transport-escaping normalization ───────────────────────────────
//
// The same bytes reach this scanner at three different escaping levels,
// and until 2026-08-18 detection silently degraded with each one:
//
//   banner adm : <script>new Function("return this")()…      → 3 findings
//   native adm : JSON string, so every quote is \"           → 1 finding
//   VAST HTML  : XML-escaped, so every quote is &quot;       → 0 findings
//
// Half the pattern bank anchors on a quote right after `(` (set_event_attr,
// function_constructor); those simply stop matching once the quote is
// escaped, while the quote-free patterns (eval_atob, docwrite_decode)
// survive. The result was a scanner that got quieter the deeper the
// creative was wrapped — worst possible failure mode, since native and
// VAST are exactly where an attacker has an extra wrapping layer to hide
// behind. Rather than teach 16 regexes about three escaping dialects, we
// undo the transport escaping once, up front.
//
// Order matters: \uXXXX first (a serializer may emit " instead of
// \"), then backslash escapes, then XML entities with &amp; LAST — so
// `&amp;quot;`, which *displays* as the text &quot;, decodes one level
// only and not into a quote.
function normalizeTransportEscapes(s) {
  return s
    .replace(/\\u00([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\([\\"'`/nrt])/g, (_m, c) =>
      c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c,
    )
    .replace(/&(?:quot|#0*34|#[xX]0*22);/g, '"')
    .replace(/&(?:apos|#0*39|#[xX]0*27);/g, "'")
    .replace(/&(?:lt|#0*60|#[xX]0*3[cC]);/g, '<')
    .replace(/&(?:gt|#0*62|#[xX]0*3[eE]);/g, '>')
    .replace(/&(?:amp|#0*38|#[xX]0*26);/g, '&');
}

/**
 * Shannon entropy in bits per character.
 *
 * H = -Σ(p_i * log2(p_i))  over distinct characters.
 *
 * For a uniformly random string over an alphabet of size N, H → log2(N).
 * For natural-language text, H is much lower (English ~4.5 over the full
 * Latin alphabet, ~2.5 if you account for digrams).
 */
function shannonEntropy(s) {
  if (!s || !s.length) return 0;
  const freq = Object.create(null);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    freq[c] = (freq[c] || 0) + 1;
  }
  const len = s.length;
  let h = 0;
  for (const c in freq) {
    const p = freq[c] / len;
    h -= p * Math.log2(p);
  }
  return h;
}

function isBase64Code(c) {
  return (
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) || // a-z
    (c >= 48 && c <= 57) || // 0-9
    c === 43 || // +
    c === 47 || // /
    c === 61 // =
  );
}

/**
 * Single linear sweep that does both jobs at once:
 *   - measures every maximal base64-alphabet run of >= BASE64_MIN_RUN
 *     chars and keeps the high-entropy ones (the WARNING findings), and
 *   - returns the source with those runs replaced by BLOB_PLACEHOLDER,
 *     so the pattern banks scan code instead of asset bytes.
 *
 * Returns { blobs: [{ length, entropy, preview }], elided }. `preview` is
 * the first 40 chars — enough to seed an investigation without dumping
 * the whole blob into the findings UI.
 *
 * Hand-rolled rather than /[A-Za-z0-9+/=]{500,}/g on purpose. The regex
 * form is quadratic on the input shape it exists to handle: on a run of
 * 499 base64 chars it scans all 499, fails the {500,} quantifier, then
 * restarts one character later and scans 498… Measured before this
 * rewrite: 211 ms for a 150 KB creative built from 499-char runs, i.e. a
 * cheap CPU-burn vector against every /analyze call. The sweep below is
 * O(n) — the same 150 KB costs well under a millisecond.
 *
 * Eliding cannot create a false positive, and that is a property of
 * maximal munch rather than luck: every pattern in the banks needs at
 * least one non-base64 character (a paren, a dot, a quote), so no match
 * can live *inside* a run; and any code token adjacent to a run (`eval`,
 * `atob`) is itself base64-alphabet, so it gets absorbed into the run and
 * elided with it rather than left behind to glue onto the far side.
 */
function elideBase64Runs(s) {
  const blobs = [];
  const parts = [];
  const n = s.length;
  let copiedTo = 0; // everything before this index is accounted for
  let runStart = -1;
  let elidedAny = false;

  for (let i = 0; i <= n; i++) {
    if (i < n && isBase64Code(s.charCodeAt(i))) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0) {
      const len = i - runStart;
      if (len >= BASE64_MIN_RUN) {
        const blob = s.slice(runStart, i);
        const e = shannonEntropy(blob);
        if (e >= BASE64_HIGH_ENTROPY_THRESHOLD && blobs.length < MAX_ENTROPY_BLOBS) {
          blobs.push({
            length: len,
            entropy: Number(e.toFixed(2)),
            preview: blob.slice(0, 40),
          });
        }
        parts.push(s.slice(copiedTo, runStart), BLOB_PLACEHOLDER);
        copiedTo = i;
        elidedAny = true;
      }
      runStart = -1;
    }
  }

  if (!elidedAny) return { blobs, elided: s };
  parts.push(s.slice(copiedTo));
  return { blobs, elided: parts.join('') };
}

/**
 * Cut the pattern-scan window out of an already-elided source: the first
 * ADM_HEAD_SCAN_LIMIT bytes plus the last ADM_TAIL_SCAN_LIMIT, joined by
 * the placeholder so the seam can't fabricate a match. Bulk that survived
 * blob elision is genuine text, and a creative with >150 KB of it is
 * already pathological; both ends are still covered, which is what the
 * old head-only cut was missing.
 */
function windowScanSource(s) {
  if (s.length <= ADM_HEAD_SCAN_LIMIT + ADM_TAIL_SCAN_LIMIT) return s;
  return (
    s.slice(0, ADM_HEAD_SCAN_LIMIT) + BLOB_PLACEHOLDER + s.slice(s.length - ADM_TAIL_SCAN_LIMIT)
  );
}

/**
 * scanCreative — Phase 6 entry point. Takes a raw creative string
 * (typically `bid.adm` for banners, or stringified `bid.native` JSON
 * for native) and emits synthetic events that the rule functions in
 * this file then promote to findings.
 *
 * Returns [] for empty / non-string input — defensive so analyze() can
 * call this unconditionally without null checks.
 *
 * Source preparation, in order (each step has its own rationale above):
 *   1. bound the input at ADM_RAW_LIMIT so one creative can't cost
 *      unbounded CPU;
 *   2. undo transport escaping (\" from native JSON, &quot; from VAST) so
 *      the same creative scans identically at every wrapping level;
 *   3. elide base64 runs — this is where the blob WARNINGs come from, and
 *      it stops asset bytes from consuming the pattern window;
 *   4. cut the head+tail window the pattern banks run over.
 *
 * Entropy blobs are collected in step 3, i.e. across the whole bounded
 * input, not just the window — a sprite at 400 KB is still reported even
 * though no pattern regex ever sees that offset.
 */
function scanCreative(adm) {
  if (!adm || typeof adm !== 'string') return [];
  const raw = adm.length > ADM_RAW_LIMIT ? adm.slice(0, ADM_RAW_LIMIT) : adm;
  const { blobs, elided } = elideBase64Runs(normalizeTransportEscapes(raw));
  const src = windowScanSource(elided);
  const events = [];
  const ts = Date.now();

  for (const { id, re } of OBFUSCATION_PATTERNS) {
    if (re.test(src)) {
      events.push({
        type: 'ortbtools-static',
        v: 1,
        ts: ts,
        kind: 'static_obfuscation',
        method: id,
        url: '',
        trigger: 'static-scan',
      });
    }
  }

  for (const { id, re } of MINER_PATTERNS) {
    if (re.test(src)) {
      events.push({
        type: 'ortbtools-static',
        v: 1,
        ts: ts,
        kind: 'static_miner',
        method: id,
        url: '',
        trigger: 'static-scan',
      });
    }
  }

  for (const { id, re } of XSS_PATTERNS) {
    if (re.test(src)) {
      events.push({
        type: 'ortbtools-static',
        v: 1,
        ts: ts,
        kind: 'static_xss_marker',
        method: id,
        url: '',
        trigger: 'static-scan',
      });
    }
  }

  for (const blob of blobs) {
    events.push({
      type: 'ortbtools-static',
      v: 1,
      ts: ts,
      kind: 'static_high_entropy',
      method: 'base64-blob',
      url: '',
      trigger: 'static-scan',
      blobLength: blob.length,
      blobEntropy: blob.entropy,
      blobPreview: blob.preview,
    });
  }

  return events;
}

// ── Rule functions ─────────────────────────────────────────────────

function staticObfuscation(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'static_obfuscation') continue;
    out.push(
      makeFinding('behavior.static.obfuscation', LEVELS.ERROR, '', {
        pattern: String(ev.method || 'unknown'),
        eventIndex: i,
      }),
    );
  }
  return out;
}

function staticMiner(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'static_miner') continue;
    out.push(
      makeFinding('behavior.static.miner_signature', LEVELS.ERROR, '', {
        signature: String(ev.method || 'unknown'),
        eventIndex: i,
      }),
    );
  }
  return out;
}

function staticXssMarker(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'static_xss_marker') continue;
    out.push(
      makeFinding('behavior.static.xss_marker', LEVELS.ERROR, '', {
        pattern: String(ev.method || 'unknown'),
        eventIndex: i,
      }),
    );
  }
  return out;
}

function staticHighEntropy(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.kind !== 'static_high_entropy') continue;
    out.push(
      makeFinding('behavior.static.high_entropy_blob', LEVELS.WARNING, '', {
        blobLength: typeof ev.blobLength === 'number' ? ev.blobLength : 0,
        blobEntropy: String(ev.blobEntropy || '0'),
        blobPreview: String(ev.blobPreview || ''),
        eventIndex: i,
      }),
    );
  }
  return out;
}

module.exports = [staticObfuscation, staticMiner, staticXssMarker, staticHighEntropy];
module.exports.scanCreative = scanCreative;
module.exports.shannonEntropy = shannonEntropy;
// Exported for the audit suite: the escaping-dialect fix is only testable
// as a unit if the normalizer can be called directly — asserting it
// through scanCreative alone can't tell "the pattern matched" from "the
// normalizer happened to leave the string alone".
module.exports.normalizeTransportEscapes = normalizeTransportEscapes;
