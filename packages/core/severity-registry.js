'use strict';

/**
 * Finding severity registry — the single source of truth for "what level does
 * this finding id come out at".
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Before this file, `modules/findings/handler.js` (GET /api/v1/finding-catalog)
 * derived a finding's severity from the *shape of its id string*: `_required`
 * → error, `_missing` → warning, `_invalid` → error, and `info` for everything
 * that matched nothing. The public /docs/findings table, the dialect severity
 * tallies and the site search index all read that guess.
 *
 * The guess was wrong for 25 of the 64 ids reachable from `samples/`. A few of
 * the wrong ones, to show the failure is not cosmetic:
 *
 *   vast.mediafile_missing        catalog said warning — rules-vast.js emits error
 *   vast.version_missing          catalog said warning — rules-vast.js emits error
 *   request.30.item.qty_invalid   catalog said error   — rules-request-30.js emits warning
 *   imp.secure_recommended        catalog said warning — rules/imp-secure emits info
 *   consent.tcstring_roundtrip_mismatch
 *                                 catalog said error   — rules-consent.js emits warning
 *
 * The suffix conventions were never a contract. `_missing` means "required in
 * VAST, optional in oRTB" depending on which document you are reading, and
 * `_mismatch` on a TCF round trip is a confidence caveat about the *reader*,
 * not a defect in the payload. Any rule whose id does not happen to end in one
 * of eight blessed suffixes silently became `info`.
 *
 * ── APPROACH ────────────────────────────────────────────────────────────────
 *
 * Levels are read out of the `makeFinding(id, LEVEL, …)` / `makeCross(id, ok,
 * LEVEL, …)` call sites in this package. That is where the level is decided, so
 * that is where the catalog reads it from — nothing to keep in sync, and adding
 * a rule updates the catalog by construction.
 *
 * The scan happens at first use and is cached for the process lifetime. It is
 * not a naive regex over the raw text: comment bodies, string bodies and regex
 * literals are blanked out first (`maskSource`) so a call shape mentioned in
 * prose cannot be mistaken for a call, and argument splitting counts brackets
 * on the masked text so a comma inside a template literal does not shift the
 * level into the wrong argument slot.
 *
 * A level expression that is not statically decidable is recorded as
 * unresolved and the id stays UNKNOWN. It is never rounded to a plausible
 * value. `packages/core/behavior/rules/malicious.js` emits its frame-bust
 * finding as
 *
 *     makeFinding( <id>, inGrace ? LEVELS.WARNING : LEVELS.ERROR, … )
 *
 * and a regex that grabs "the token after the id" reads the level of that
 * finding as `inGrace`. Conditionals are resolved as the union of both
 * branches instead, so the id honestly carries two possible levels.
 *
 * (The id is elided above on purpose: spec-refs.test.js greps this package for
 * a quoted id after the factory name, and a docblock that spells one out would
 * register as a real emission site.)
 *
 * ── WHAT A SEVERITY MEANS PER FAMILY ────────────────────────────────────────
 *
 * VALIDATOR   ids go through `makeFinding` and carry findings.js LEVELS:
 *             error / warning / info / question. All four are representable
 *             here; `question` had no representation at all in the old scheme,
 *             so `dialects.question.unknown_ext_signal` could not be right.
 *
 * CROSSCHECK  ids go through `makeCross` and carry CROSS_LEVELS: ok / warn /
 *             crit. These are reported verbatim rather than folded into
 *             error/warning, because folding would put a value in the catalog
 *             that `finding.level` never holds — which is the exact defect
 *             this file removes. The scales line up as crit≈error,
 *             warn≈warning, and `ok` is a *pass* state with no counterpart on
 *             the validator scale (`crosscheck.id_match` is the check
 *             succeeding, not a low-severity problem). A consumer that wants
 *             one scale should fold on `family`, which is why it is exported.
 *
 * MIRROR_NOTE ids like `mirror.note.banner_size_copied` live in messages/*.json
 *             but are not findings: mirror.js pushes `{id, params}` notes with
 *             no level anywhere in the object. Their severity is NONE, not
 *             `info`. The old scheme called all 23 of them `info`, inventing a
 *             severity for records that never had one.
 *
 * UNKNOWN     an id present in messages/*.json that no call site emits. Today:
 *             `response.seatbid_required` and `request.30.item.placement_invalid`
 *             — message text and a spec-refs.json entry, no emitter. They are
 *             reported as UNKNOWN so the catalog says "I do not know" instead
 *             of defaulting them to `info` and looking authoritative.
 *
 * ── CONTRACT ────────────────────────────────────────────────────────────────
 *
 * Read-only and side-effect free apart from the lazy cache. Never throws: an
 * unreadable source tree yields an empty registry and every id answers UNKNOWN,
 * which degrades the catalog to "no severity known" rather than to a wrong one.
 *
 * tests/spec-refs.test.js gates this file: it asserts every emitted id resolves,
 * that no level expression is unresolved, that the computed-id declarations
 * below still match the call sites they cite, and — the anti-rot check — that
 * the level `validate()` actually puts on a finding is one of the levels
 * recorded here.
 */

const fs = require('fs');
const path = require('path');

const CORE_DIR = __dirname;

/** Which construction path an id came from — decides how to read `severity`. */
const FAMILIES = {
  VALIDATOR: 'validator',
  CROSSCHECK: 'crosscheck',
  MIRROR_NOTE: 'mirror-note',
  UNKNOWN: 'unknown',
};

/** Severity placeholders for the two families that have no level. */
const NONE = 'none'; // mirror notes: the engine attaches no level, by design
const UNKNOWN = 'unknown'; // no emitting call site found

// Mirrors findings.js LEVELS / CROSS_LEVELS. Duplicated rather than imported
// because this module resolves *source text* (`LEVELS.ERROR` as written in a
// rule file) and must not silently accept a member name that findings.js does
// not define — an import would hand back `undefined` and we would store it.
const VALIDATOR_LEVELS = { ERROR: 'error', WARNING: 'warning', INFO: 'info', QUESTION: 'question' };
const CROSSCHECK_LEVELS = { OK: 'ok', WARN: 'warn', CRIT: 'crit' };

/** Worst-first. Used to pick the canonical severity of a conditional id. */
const SEVERITY_ORDER = ['crit', 'error', 'warn', 'warning', 'question', 'info', 'ok'];

/**
 * Call sites that assemble the finding id at runtime, so the scanner sees the
 * level but cannot see which ids it applies to. Each entry names the exact call
 * site and repeats the level expression standing there, so a reviewer can check
 * the claim in one hop. This is not inference — the level at these sites is a
 * plain `CROSS_LEVELS.*` and the id set is a closed literal set in the same
 * file. The test asserts the number of computed-id sites found by the scanner
 * still equals the number declared here, so a new one fails loudly rather than
 * quietly falling through to UNKNOWN.
 */
const COMPUTED_ID_SITES = [
  {
    site: 'crosscheck.js  C(cm.errorKey, false, CROSS_LEVELS.WARN, …)',
    // nativeAssetCrosscheck() returns exactly these two errorKey values.
    family: FAMILIES.CROSSCHECK,
    ids: {
      'crosscheck.bid.native_invalid_request': ['warn'],
      'crosscheck.bid.native_invalid_adm': ['warn'],
    },
  },
  {
    site: "crosscheck.js  C(`crosscheck.bid.native_${issue.code}`, false, issue.code === 'unsafe_scheme' ? CRIT : WARN, …)",
    // issue.code is pushed as a literal in nativeFitness(): unsafe_scheme,
    // asset_empty, asset_kind, over_length, img_size.
    family: FAMILIES.CROSSCHECK,
    ids: {
      'crosscheck.bid.native_unsafe_scheme': ['crit'],
      'crosscheck.bid.native_asset_empty': ['warn'],
      'crosscheck.bid.native_asset_kind': ['warn'],
      'crosscheck.bid.native_over_length': ['warn'],
      'crosscheck.bid.native_img_size': ['warn'],
    },
  },
];

// ── source masking ──────────────────────────────────────────────────────────

/**
 * Return `src` with comment bodies, string/template bodies and regex literal
 * bodies replaced by spaces, preserving length so offsets stay usable against
 * the original text.
 *
 * Why: spec-refs.test.js greps raw text for a quoted id after the factory name
 * and accepts that anything inside a comment is a false positive — a missing
 * spec-ref is the only thing it can get wrong. A severity registry cannot be
 * that relaxed: findings.js documents its own signature in prose, and a raw
 * grep reads the parameter names out of the docblock as a finding.
 */
function maskSource(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prevSig = ''; // last non-space char, to tell a regex literal from a divide
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && c2 === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) out[i] = ' ';
      if (i + 1 < n) out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out[i] = ' ';
          if (i + 1 < n) out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (src[i] === c) break;
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      i++;
      prevSig = c;
      continue;
    }
    // A `/` after an operator or an opening bracket starts a regex literal;
    // after an identifier or a closing bracket it is division.
    if (c === '/' && /[=(,:[!&|?{;+\-*%<>~^]/.test(prevSig)) {
      i++;
      while (i < n && src[i] !== '/' && src[i] !== '\n') {
        if (src[i] === '\\') out[i++] = ' ';
        out[i] = ' ';
        i++;
      }
      i++;
      prevSig = '/';
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

/**
 * Split the argument list of the call whose `(` sits at `openIdx`.
 * Bracket depth is counted on `masked`; the returned slices come from `src`.
 * Returns null for an unterminated call (truncated file).
 */
function splitArgs(src, masked, openIdx) {
  const args = [];
  let depth = 0;
  let start = openIdx + 1;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        args.push(src.slice(start, i));
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

/** Index of the first `ch` at bracket depth 0, ignoring strings/comments. */
function topLevelIndex(expr, ch, from) {
  const masked = maskSource(expr);
  let depth = 0;
  for (let i = from || 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === ch) return i;
  }
  return -1;
}

/**
 * Split a top-level ternary into { test, consequent, alternate }, or null.
 * Nested ternaries in a branch are left to the recursive caller.
 */
function splitTernary(expr) {
  const q = topLevelIndex(expr, '?');
  if (q < 0) return null;
  const c = topLevelIndex(expr, ':', q + 1);
  if (c < q) return null;
  return {
    test: expr.slice(0, q).trim(),
    consequent: expr.slice(q + 1, c),
    alternate: expr.slice(c + 1),
  };
}

// ── expression resolution ───────────────────────────────────────────────────

/** `LEVELS.ERROR` / `CROSS_LEVELS.CRIT` / `'question'` → ['error'] etc, or null. */
function resolveLevelExpr(expr) {
  const e = String(expr == null ? '' : expr).trim();

  let m = /^LEVELS\.([A-Z_]+)$/.exec(e);
  if (m) return VALIDATOR_LEVELS[m[1]] ? [VALIDATOR_LEVELS[m[1]]] : null;

  m = /^CROSS_LEVELS\.([A-Z_]+)$/.exec(e);
  if (m) return CROSSCHECK_LEVELS[m[1]] ? [CROSSCHECK_LEVELS[m[1]]] : null;

  m = /^'([a-z]+)'$|^"([a-z]+)"$/.exec(e);
  if (m) {
    const v = m[1] || m[2];
    const known =
      Object.values(VALIDATOR_LEVELS).indexOf(v) >= 0 ||
      Object.values(CROSSCHECK_LEVELS).indexOf(v) >= 0;
    return known ? [v] : null;
  }

  const t = splitTernary(e);
  if (t) {
    const a = resolveLevelExpr(t.consequent);
    const b = resolveLevelExpr(t.alternate);
    if (a && b) return uniq(a.concat(b));
  }
  return null;
}

/** `'imp.foo'` → ['imp.foo']; `x ? 'a' : 'b'` → ['a','b']; else null. */
function resolveIdExpr(expr) {
  const e = String(expr == null ? '' : expr).trim();
  const m = /^'([^']+)'$|^"([^"]+)"$/.exec(e);
  if (m) return [m[1] || m[2]];
  const t = splitTernary(e);
  if (t) {
    const a = resolveIdExpr(t.consequent);
    const b = resolveIdExpr(t.alternate);
    if (a && b) return a.concat(b);
  }
  return null;
}

/**
 * Pair a conditional id with a conditional level.
 *
 * `crosscheck.js` emits both from one call:
 *
 *     C(isVast ? 'crosscheck.bid.video_vast' : 'crosscheck.bid.video_not_vast',
 *       isVast, isVast ? CROSS_LEVELS.OK : CROSS_LEVELS.WARN, …)
 *
 * Taking the union would claim `video_vast` can be `warn`, which it cannot.
 * Branches are paired only when the two ternaries test the *same* expression
 * (compared with whitespace collapsed); otherwise the branches are independent
 * and pairing them would be a guess, so the caller falls back to the union.
 */
function pairConditional(idExpr, levelExpr) {
  const ti = splitTernary(String(idExpr || ''));
  const tl = splitTernary(String(levelExpr || ''));
  if (!ti || !tl) return null;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  if (norm(ti.test) !== norm(tl.test)) return null;
  const ids = [resolveIdExpr(ti.consequent), resolveIdExpr(ti.alternate)];
  const levels = [resolveLevelExpr(tl.consequent), resolveLevelExpr(tl.alternate)];
  if (!ids[0] || !ids[1] || !levels[0] || !levels[1]) return null;
  if (ids[0].length !== 1 || ids[1].length !== 1) return null;
  return [
    { id: ids[0][0], levels: levels[0] },
    { id: ids[1][0], levels: levels[1] },
  ];
}

function uniq(arr) {
  return arr.filter((v, i) => arr.indexOf(v) === i);
}

// ── scan ────────────────────────────────────────────────────────────────────

function walkJsFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return out;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.charAt(0) === '.') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Mirror note ids. mirror.js pushes `{id, params}` objects and passes ids to
 * `unsupported(noteId, …)`, so there is no single call shape to key on — but
 * every `'mirror.…'` string literal in that file is a note id and nothing else.
 */
const MIRROR_NOTE_RE = /'(mirror\.[a-zA-Z0-9._-]+)'/g;

function buildRegistry() {
  /** @type {Map<string, {id:string, family:string, levels:string[], sites:number, via:string}>} */
  const byId = new Map();
  const unresolvedLevels = [];
  const computedIdSites = [];

  const add = (id, family, levels, via) => {
    let rec = byId.get(id);
    if (!rec) {
      rec = { id, family, levels: [], sites: 0, via };
      byId.set(id, rec);
    }
    for (const l of levels) if (rec.levels.indexOf(l) < 0) rec.levels.push(l);
    rec.sites++;
  };

  const files = walkJsFiles(CORE_DIR, []).sort();

  for (const file of files) {
    // findings.js documents the call shape in prose and defines the factory
    // itself; scanning it would register the parameter names as an id.
    if (path.basename(file) === 'findings.js' && path.dirname(file) === CORE_DIR) continue;
    if (path.basename(file) === 'severity-registry.js') continue;

    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch (_e) {
      continue;
    }
    const masked = maskSource(src);
    const rel = path.relative(CORE_DIR, file);

    if (rel === 'mirror.js') {
      // Matched against `src` because masking blanks string bodies; the masked
      // text still holds the quote characters, so `masked[i] === "'"` confirms
      // the hit is a real literal and not the same words inside a comment.
      let mm;
      MIRROR_NOTE_RE.lastIndex = 0;
      while ((mm = MIRROR_NOTE_RE.exec(src))) {
        if (masked[mm.index] !== "'") continue;
        add(mm[1], FAMILIES.MIRROR_NOTE, [], 'scanned');
      }
    }

    // Rule files alias the factories (`const F = makeFinding;`). Resolve the
    // aliases per file instead of hardcoding `F` and `C`, so a file that picks
    // a different letter is not invisible.
    const findingNames = ['makeFinding'];
    const crossNames = ['makeCross'];
    const aliasRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(makeFinding|makeCross)\s*;/g;
    let am;
    while ((am = aliasRe.exec(masked))) {
      (am[2] === 'makeFinding' ? findingNames : crossNames).push(am[1]);
    }

    const names = findingNames.concat(crossNames);
    // `$` is legal in identifiers and special in a regex, so escape before
    // building the alternation.
    const callRe = new RegExp(
      '\\b(' + names.map((n) => n.replace(/[$]/g, '\\$&')).join('|') + ')\\s*\\(',
      'g',
    );
    let cm;
    while ((cm = callRe.exec(masked))) {
      const isCross = crossNames.indexOf(cm[1]) >= 0;
      const family = isCross ? FAMILIES.CROSSCHECK : FAMILIES.VALIDATOR;
      const open = cm.index + cm[0].length - 1;
      const args = splitArgs(src, masked, open);
      if (!args) continue;
      const line = src.slice(0, open).split('\n').length;
      // makeFinding(id, level, …) / makeCross(id, ok, level, …)
      const levelExpr = args[isCross ? 2 : 1];

      const paired = pairConditional(args[0], levelExpr);
      if (paired) {
        for (const p of paired) add(p.id, family, p.levels, 'scanned');
        continue;
      }

      const ids = resolveIdExpr(args[0]);
      if (!ids) {
        computedIdSites.push({ file: rel, line, expr: brief(args[0]) });
        continue;
      }
      const levels = resolveLevelExpr(levelExpr);
      if (!levels) {
        // Recorded, not guessed. The id stays out of the registry entirely.
        unresolvedLevels.push({ file: rel, line, id: ids.join('|'), expr: brief(levelExpr) });
        continue;
      }
      for (const id of ids) add(id, family, levels, 'scanned');
    }
  }

  // Computed-id call sites: level is static at the site, id set is declared.
  for (const decl of COMPUTED_ID_SITES) {
    for (const id of Object.keys(decl.ids)) add(id, decl.family, decl.ids[id], 'declared');
  }

  return { byId, unresolvedLevels, computedIdSites };
}

function brief(expr) {
  return String(expr == null ? '(missing)' : expr)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

let _registry = null;
function registry() {
  if (!_registry) {
    try {
      _registry = buildRegistry();
    } catch (_e) {
      // Never throw at the catalog's expense: an empty registry answers
      // UNKNOWN for everything, which is honest. A wrong severity is not.
      _registry = { byId: new Map(), unresolvedLevels: [], computedIdSites: [] };
    }
  }
  return _registry;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Full record for an id.
 *
 * `severity` is the value to show. For an id whose level is decided at runtime
 * (`payload.duplicate_key` is error on a consequential path and warning
 * elsewhere) it is the most severe of the possible levels — a reference table
 * that under-states is worse than one that over-states — and `levels` carries
 * all of them so a caller can say "error or warning" instead.
 *
 * @param {string} id
 * @returns {{id:string, family:string, severity:string, levels:string[],
 *            conditional:boolean, via:string}}
 */
function describe(id) {
  const rec = registry().byId.get(id);
  if (!rec) {
    return {
      id,
      family: FAMILIES.UNKNOWN,
      severity: UNKNOWN,
      levels: [],
      conditional: false,
      via: 'none',
    };
  }
  if (rec.family === FAMILIES.MIRROR_NOTE) {
    return {
      id,
      family: FAMILIES.MIRROR_NOTE,
      severity: NONE,
      levels: [],
      conditional: false,
      via: rec.via,
    };
  }
  const levels = rec.levels
    .slice()
    .sort((a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b));
  return {
    id,
    family: rec.family,
    severity: levels[0] || UNKNOWN,
    levels,
    conditional: levels.length > 1,
    via: rec.via,
  };
}

/** Canonical severity string for an id. Never guesses; 'unknown' when unknown. */
function severityOf(id) {
  return describe(id).severity;
}

/** Every id the registry knows, sorted. */
function knownIds() {
  return [...registry().byId.keys()].sort();
}

/**
 * Call sites whose level expression could not be resolved statically. Expected
 * to be empty; the test asserts it, because a non-empty list means some id is
 * silently answering UNKNOWN in the public catalog.
 */
function unresolvedLevelSites() {
  return registry().unresolvedLevels.slice();
}

/**
 * Call sites that build the id at runtime. Covered by COMPUTED_ID_SITES; the
 * test asserts the counts still line up so a new one cannot slip through.
 */
function computedIdSites() {
  return registry().computedIdSites.slice();
}

module.exports = {
  FAMILIES,
  NONE,
  UNKNOWN,
  VALIDATOR_LEVELS,
  CROSSCHECK_LEVELS,
  COMPUTED_ID_SITES,
  describe,
  severityOf,
  knownIds,
  unresolvedLevelSites,
  computedIdSites,
};
