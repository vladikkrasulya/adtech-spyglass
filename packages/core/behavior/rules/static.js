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
  { id: 'function_constructor', re: /\b(?:new\s+)?Function\s*\(\s*['"`]return[\s'"`]/ },
  // Dean Edwards packer signature. Universally fingerprintable.
  {
    id: 'packer',
    re: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[rd]\s*\)/,
  },
  // jjencode — characteristic '$=~[]' bootstrap string.
  { id: 'jjencode', re: /\$\s*=\s*~\s*\[\s*\]/ },
  // aaencode — Japanese kana glyphs as variable names.
  { id: 'aaencode', re: /ﾟωﾟ|\(ﾟДﾟ\)|\(ﾟΘﾟ\)/ },
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

const BASE64_BLOB_RE = /[A-Za-z0-9+/=]{500,}/g;
const BASE64_HIGH_ENTROPY_THRESHOLD = 4.5;
const ADM_SCAN_LIMIT = 100 * 1024; // 100 KB — bounded scan for huge banners

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

/**
 * Find runs of base64 alphabet >= 500 chars whose entropy crosses the
 * BASE64_HIGH_ENTROPY_THRESHOLD. Returns [{ length, entropy, preview }].
 * preview is the first 40 chars — enough to seed an investigation
 * without dumping the whole blob into the findings UI.
 */
function findHighEntropyBlobs(s) {
  const out = [];
  if (!s) return out;
  // Reset lastIndex defensively — this regex carries /g state across calls.
  BASE64_BLOB_RE.lastIndex = 0;
  let m;
  while ((m = BASE64_BLOB_RE.exec(s))) {
    const blob = m[0];
    const e = shannonEntropy(blob);
    if (e >= BASE64_HIGH_ENTROPY_THRESHOLD) {
      out.push({
        length: blob.length,
        entropy: Number(e.toFixed(2)),
        preview: blob.slice(0, 40),
      });
    }
  }
  return out;
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
 * The input is truncated at ADM_SCAN_LIMIT (100 KB) to bound regex work
 * on huge VAST/banner blobs. Anything beyond the limit gets pattern-
 * scanned only against the prefix; this is intentional — the malicious
 * payloads we're hunting always fire in the head of the creative
 * (loader / decoder), and the long tail is usually padding/asset bytes.
 */
function scanCreative(adm) {
  if (!adm || typeof adm !== 'string') return [];
  const src = adm.length > ADM_SCAN_LIMIT ? adm.slice(0, ADM_SCAN_LIMIT) : adm;
  const events = [];
  const ts = Date.now();

  for (const { id, re } of OBFUSCATION_PATTERNS) {
    if (re.test(src)) {
      events.push({
        type: 'spyglass-static',
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
        type: 'spyglass-static',
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
        type: 'spyglass-static',
        v: 1,
        ts: ts,
        kind: 'static_xss_marker',
        method: id,
        url: '',
        trigger: 'static-scan',
      });
    }
  }

  for (const blob of findHighEntropyBlobs(src)) {
    events.push({
      type: 'spyglass-static',
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
