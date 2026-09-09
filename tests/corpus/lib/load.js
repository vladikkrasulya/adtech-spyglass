'use strict';

/**
 * tests/corpus/lib/load.js — read every case file, validate it, and resolve
 * mutations against their base pairs into runnable "materialized" cases.
 *
 * Layout (all under tests/corpus/):
 *   pairs/<format>/<id>.json       base pairs, kind: 'pair'
 *   mutations/<category>/<id>.json negative mutations, kind: 'mutation'
 *   known-gaps.json                ledger of recorded implementation deviations
 *
 * Filtering for a single run:
 *   CORPUS_CASE=banner-web-26-html-001            one case
 *   CORPUS_CASE=banner-web-26-html-001,video-*    comma list, trailing * prefix
 *   CORPUS_FORMAT=video                           one format
 *
 * Order is deterministic (sorted by relative path) so every run and every
 * report reads the same way.
 */

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { validateCase } = require('./schema');
const { applyPatch } = require('./patch');

const CORPUS_DIR = path.join(__dirname, '..');
const PAIRS_DIR = path.join(CORPUS_DIR, 'pairs');
const MUTATIONS_DIR = path.join(CORPUS_DIR, 'mutations');
const KNOWN_GAPS_FILE = path.join(CORPUS_DIR, 'known-gaps.json');

/**
 * @param {string} dir
 * @returns {string[]} absolute file paths, sorted
 */
function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  const walk = (d) => {
    for (const entry of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * @param {string} file
 * @returns {any}
 */
function readCaseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path.relative(CORPUS_DIR, file)}: invalid JSON — ${err.message}`, {
      cause: err,
    });
  }
  const problems = validateCase(parsed);
  if (problems.length) {
    throw new Error(
      `${path.relative(CORPUS_DIR, file)} violates the corpus schema:\n  - ${problems.join('\n  - ')}`,
    );
  }
  const expectedName = `${parsed.id}.json`;
  if (path.basename(file) !== expectedName) {
    throw new Error(
      `${path.relative(CORPUS_DIR, file)}: file name must equal id (${expectedName})`,
    );
  }
  return parsed;
}

/**
 * @param {string} [file]
 * @returns {Record<string, any>}
 */
/**
 * Ledger shards: tests/corpus/known-gaps/<owner>.json files with the same
 * {schemaVersion:1, gaps:{...}} shape are merged into the main ledger so that
 * independent authors can record deviations without editing one shared file.
 * A gap id present in two files is an error, never a silent override.
 *
 * @param {string} file main ledger path
 * @returns {Record<string, any>}
 */
function loadKnownGaps(file = KNOWN_GAPS_FILE) {
  /** @type {Record<string, any>} */
  const merged = {};
  const shardDir = path.join(path.dirname(file), 'known-gaps');
  const files = [file];
  if (fs.existsSync(shardDir)) {
    for (const name of fs.readdirSync(shardDir).sort()) {
      if (name.endsWith('.json')) files.push(path.join(shardDir, name));
    }
  }
  for (const f of files) {
    for (const [id, record] of Object.entries(loadKnownGapsFile(f))) {
      if (merged[id]) throw new Error(`${f}: gap ${id} is already defined in another ledger file`);
      merged[id] = record;
    }
  }
  return merged;
}

/**
 * @param {string} file
 * @returns {Record<string, any>}
 */
function loadKnownGapsFile(file) {
  if (!fs.existsSync(file)) return {};
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !ledger ||
    ledger.schemaVersion !== 1 ||
    !ledger.gaps ||
    typeof ledger.gaps !== 'object' ||
    Array.isArray(ledger.gaps)
  )
    throw new Error(`${file}: expected {schemaVersion:1,gaps:{...}}`);
  for (const [id, record] of Object.entries(ledger.gaps)) {
    if (
      !/^DEF-\d{3}$/.test(id) ||
      !record ||
      record.id !== id ||
      typeof record.title !== 'string' ||
      !record.title.trim() ||
      !Array.isArray(record.cases) ||
      record.cases.some((c) => typeof c !== 'string' || !c)
    )
      throw new Error(`${file}: invalid ledger entry ${id}; id, title and cases are required`);
  }
  return ledger.gaps;
}

/**
 * @typedef {object} Materialized
 * @property {string} id
 * @property {'pair'|'mutation'} kind
 * @property {any} meta the original case object (metadata + expect)
 * @property {any} [request] parsed request (object or URL string) — absent when omitted
 * @property {any} [response] parsed response (object or array) — absent when omitted
 * @property {string} [rawRequest] raw text when the case is about unparseable input
 * @property {string} [rawResponse]
 * @property {string} [baseId]
 * @property {string} file relative path
 */

/**
 * Resolve one mutation against the base pair table.
 *
 * @param {any} m
 * @param {Map<string, any>} bases
 * @param {string} file
 * @returns {Materialized}
 */
function materializeMutation(m, bases, file) {
  const base = bases.get(m.base);
  if (!base) throw new Error(`${file}: base pair "${m.base}" not found`);
  /** @type {Materialized} */
  const out = {
    id: m.id,
    kind: 'mutation',
    meta: {
      ...m,
      provenance: m.provenance ?? base.provenance,
      reference: m.reference ?? base.reference,
      assetRefs: m.assetRefs ?? base.assetRefs,
    },
    baseId: m.base,
    file,
  };
  const p = m.patch;
  let request = base.request === undefined ? undefined : JSON.parse(JSON.stringify(base.request));
  let response =
    base.response === undefined ? undefined : JSON.parse(JSON.stringify(base.response));
  if ('replaceRequest' in p) request = p.replaceRequest === null ? undefined : p.replaceRequest;
  if ('replaceResponse' in p) response = p.replaceResponse === null ? undefined : p.replaceResponse;
  if (p.request === null) request = undefined;
  else if (Array.isArray(p.request)) {
    if (request === undefined)
      throw new Error(`${file}: patch.request on a case without a request`);
    request = applyPatch(request, p.request);
  }
  if (p.response === null) response = undefined;
  else if (Array.isArray(p.response)) {
    if (response === undefined)
      throw new Error(`${file}: patch.response on a case without a response`);
    response = applyPatch(response, p.response);
  }
  if (typeof p.rawRequest === 'string') {
    out.rawRequest = p.rawRequest;
    request = undefined;
  }
  if (typeof p.rawResponse === 'string') {
    out.rawResponse = p.rawResponse;
    response = undefined;
  }
  if (request !== undefined) out.request = request;
  if (response !== undefined) out.response = response;
  const requestChanged =
    out.rawRequest !== undefined
      ? out.rawRequest !== JSON.stringify(base.request)
      : !isDeepStrictEqual(request, base.request);
  const responseChanged =
    out.rawResponse !== undefined
      ? out.rawResponse !== JSON.stringify(base.response)
      : !isDeepStrictEqual(response, base.response);
  if (!requestChanged && !responseChanged)
    throw new Error(`${file}: mutation does not change the base payload`);
  validateMaterialized(out);
  return out;
}

/** Recheck assertions against the actual post-patch sides, not assumed base presence.
 * @param {Materialized} c
 */
function validateMaterialized(c) {
  const present = (side) =>
    c[side] !== undefined || c[side === 'request' ? 'rawRequest' : 'rawResponse'] !== undefined;
  const hasReq = present('request');
  const hasRes = present('response');
  const scenario =
    hasReq && hasRes ? 'pair' : hasReq ? 'request-only' : hasRes ? 'response-only' : 'empty';
  if (scenario !== c.meta.scenario)
    throw new Error(
      `${c.file}: materialized scenario ${scenario} differs from declared ${c.meta.scenario}`,
    );
  for (const side of ['request', 'response']) {
    const e = c.meta.expect[side];
    if (!present(side) && e)
      throw new Error(`${c.file}: expect.${side} asserts an absent materialized side`);
    const raw = c[side === 'request' ? 'rawRequest' : 'rawResponse'];
    let invalid = false;
    if (raw !== undefined) {
      try {
        JSON.parse(raw);
      } catch {
        invalid = true;
      }
    }
    if (e?.parse === 'invalid-json' && !invalid)
      throw new Error(`${c.file}: expect.${side}.parse says invalid-json but input parses`);
    if (invalid && e && e.parse !== 'invalid-json')
      throw new Error(`${c.file}: malformed ${side} cannot have Core semantic expectations`);
  }
  if ((!hasReq || !hasRes) && c.meta.expect.crosscheck && c.meta.expect.crosscheck.empty !== true)
    throw new Error(`${c.file}: crosscheck findings require both materialized sides`);
}

/**
 * @param {string} pattern
 * @param {string} id
 */
function idMatches(pattern, id) {
  if (pattern.endsWith('*')) return id.startsWith(pattern.slice(0, -1));
  return pattern === id;
}

/**
 * @param {{ caseFilter?: string, formatFilter?: string, kinds?: Array<'pair'|'mutation'>, corpusDir?: string }} [opts]
 * @returns {{ pairs: Materialized[], mutations: Materialized[], all: Materialized[], knownGaps: Record<string, any>, skippedByFilter: number }}
 */
function loadCorpus(opts = {}) {
  const corpusDir = opts.corpusDir || CORPUS_DIR;
  const caseFilter = opts.caseFilter ?? process.env.CORPUS_CASE ?? '';
  const formatFilter = opts.formatFilter ?? process.env.CORPUS_FORMAT ?? '';
  const kinds = opts.kinds || ['pair', 'mutation'];
  const patterns = caseFilter
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  /** @type {Map<string, any>} */
  const bases = new Map();
  /** @type {Materialized[]} */
  const pairs = [];
  for (const file of listJson(path.join(corpusDir, 'pairs'))) {
    const c = readCaseFile(file);
    if (c.kind !== 'pair') throw new Error(`${file}: pairs/ may only hold kind "pair"`);
    if (bases.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    bases.set(c.id, c);
    /** @type {Materialized} */
    const mat = { id: c.id, kind: 'pair', meta: c, file: path.relative(CORPUS_DIR, file) };
    if (c.request !== undefined) mat.request = c.request;
    if (c.response !== undefined) mat.response = c.response;
    validateMaterialized(mat);
    pairs.push(mat);
  }
  /** @type {Materialized[]} */
  const mutations = [];
  const seen = new Set(bases.keys());
  for (const file of listJson(path.join(corpusDir, 'mutations'))) {
    const c = readCaseFile(file);
    if (c.kind !== 'mutation') throw new Error(`${file}: mutations/ may only hold kind "mutation"`);
    if (seen.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    seen.add(c.id);
    mutations.push(materializeMutation(c, bases, path.relative(CORPUS_DIR, file)));
  }

  const keep = (m) => {
    if (!kinds.includes(m.kind)) return false;
    if (formatFilter && m.meta.format !== formatFilter) return false;
    if (patterns.length && !patterns.some((p) => idMatches(p, m.id))) return false;
    return true;
  };
  const knownGaps = loadKnownGaps(path.join(corpusDir, 'known-gaps.json'));
  for (const m of [...pairs, ...mutations]) {
    const g = m.meta.knownGap;
    if (g && !knownGaps[g.id]) {
      throw new Error(
        `${m.file}: knownGap ${g.id} is not recorded in tests/corpus/known-gaps.json`,
      );
    }
    if (
      g &&
      knownGaps[g.id] &&
      Array.isArray(knownGaps[g.id].cases) &&
      !knownGaps[g.id].cases.includes(m.id)
    ) {
      throw new Error(`${m.file}: known-gaps.json entry ${g.id} does not list case ${m.id}`);
    }
  }
  const total = pairs.length + mutations.length;
  const keptPairs = pairs.filter(keep);
  const keptMutations = mutations.filter(keep);
  return {
    pairs: keptPairs,
    mutations: keptMutations,
    all: [...keptPairs, ...keptMutations],
    knownGaps,
    skippedByFilter: total - keptPairs.length - keptMutations.length,
  };
}

module.exports = {
  loadCorpus,
  CORPUS_DIR,
  PAIRS_DIR,
  MUTATIONS_DIR,
  KNOWN_GAPS_FILE,
  listJson,
  readCaseFile,
  materializeMutation,
  validateMaterialized,
  loadKnownGaps,
};
