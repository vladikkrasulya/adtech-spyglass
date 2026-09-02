'use strict';

/**
 * key-role-alphabet — exact-case lookup of a vendor ext key's ROLE over the
 * committed manifests (016 FR-001/FR-006, contracts/key-role-layer.md).
 *
 * Pure, no I/O at call time: manifests are require()d once at module scope,
 * and a missing or unparseable REQUIRED manifest throws at load — a loud
 * startup failure, never a silent degradation to the legacy resolver alone.
 * The adjudication manifest is the one STAGED artifact (tasks T008/T010):
 * until it lands, data/README.md carries `STAGING: adjudication=pending`
 * and this module treats every corpus-only name as an explicit `abstain`.
 *
 * Identity is exact code-point spelling (R-01). No lowercasing, trimming or
 * separator folding anywhere in this file; an unlisted casing abstains and
 * never inherits a neighbour's role. The legacy resolver keeps its own
 * lowercased derivation, untouched — the two layers meet only in
 * resolve-precedence.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const { EXACT_SCORES } = require('./key-role-authority');

const DATA = path.join(__dirname, 'data');

/** @param {string} f */
function loadRequired(f) {
  // Deliberately no try/catch around the parse: a broken required manifest
  // must throw at load (016 §snapshot construction, loud-failure rule).
  return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
}

const corpus = loadRequired('key-role-corpus.v1.json');
const named = loadRequired('key-role-named-rules.v1.json');

/** @type {{records: Array<object>}|null} staged: null until the US2 increment */
let adjudication = null;
const adjPath = path.join(DATA, 'key-role-adjudication.v1.json');
if (fs.existsSync(adjPath)) {
  adjudication = JSON.parse(fs.readFileSync(adjPath, 'utf8'));
} else {
  const readme = fs.readFileSync(path.join(DATA, 'README.md'), 'utf8');
  if (!/STAGING: adjudication=pending/.test(readme)) {
    throw new Error(
      'key-role-alphabet: adjudication manifest missing without the staging marker in data/README.md',
    );
  }
}

/** @type {Map<string, object>} exact name -> corpus entry */
const corpusByName = new Map(corpus.entries.map((e) => [e.name, e]));
/** @type {Map<string, object>} exact key -> named rule */
const namedByKey = new Map(named.rules.map((r) => [r.key, r]));
/** @type {Map<string, Array<object>>} exact name -> adjudication records */
const adjByName = new Map();
if (adjudication) {
  for (const r of adjudication.records) {
    if (!adjByName.has(r.name)) adjByName.set(r.name, []);
    adjByName.get(r.name).push(r);
  }
}

/** Supported signal namespaces: `ext.<key>` or `imp[].ext.<key>`. */
const NAMESPACE_RX = /^(?:ext|imp\[\]\.ext)\.([^.[\]]+)$/;

/**
 * Does a named rule's condition hold for this observation?
 * @param {object|undefined} condition
 * @param {unknown} value
 * @returns {boolean}
 */
function conditionHolds(condition, value) {
  if (!condition) return true;
  if (condition.valueForm === 'digit-only') {
    return typeof value === 'string' && /^[0-9]+$/.test(value);
  }
  // Unknown predicate: treat the rule as not present rather than guessing.
  return false;
}

/** Localized reason sentences for role-layer answers. Same inline pattern
 * as signal-lexicon's REASONS: a branch names WHICH sentence, never its
 * language (015 precedent; Principle VI). */
const REASONS = {
  uk: {
    fmtNumeric: (key) =>
      `Ключ «${key}» оголошує рекламний формат — це видно з самої назви. Який саме формат позначає це числове значення, без словника вендора не встановлюється: код приватний.`,
    roleResolved: (key, role) =>
      `Ключ «${key}» за зібраними доказами виконує роль «${role}», а не оголошує формат.`,
    ambiguous: (key) =>
      `Ключ «${key}» засвідчений у кількох несумісних ролях; докази наведено, вибір за тобою.`,
  },
  ru: {
    fmtNumeric: (key) =>
      `Ключ «${key}» объявляет рекламный формат — это видно из самого имени. Какой именно формат обозначает это числовое значение, без словаря вендора не устанавливается: код приватный.`,
    roleResolved: (key, role) =>
      `Ключ «${key}» по собранным доказательствам выполняет роль «${role}», а не объявляет формат.`,
    ambiguous: (key) =>
      `Ключ «${key}» засвидетельствован в нескольких несовместимых ролях; доказательства приведены, выбор за тобой.`,
  },
  en: {
    fmtNumeric: (key) =>
      `The "${key}" key declares an ad format — the name itself says so. Which format this numeric value means cannot be established without the vendor's dictionary: the code is private.`,
    roleResolved: (key, role) =>
      `By the collected evidence the "${key}" key plays the "${role}" role rather than declaring a format.`,
    ambiguous: (key) =>
      `The "${key}" key is attested in more than one incompatible role; the evidence is shown, the choice is yours.`,
  },
};

/** @param {string} locale @param {string} id */
function reason(locale, id, ...args) {
  const dict = REASONS[locale] || REASONS.en;
  return (dict[id] || REASONS.en[id])(...args);
}

/**
 * Look up one signal's role state. Never returns null: absence is an
 * explicit `abstain` carrying its evidence (contracts/key-role-layer.md).
 *
 * @param {object} input
 * @param {string} input.signalPath   'ext.<key>' or 'imp[].ext.<key>'
 * @param {unknown} input.signalValue
 * @param {object|null} [input.context] allowlisted payload context (partitions; unused in slice A)
 * @param {string} [input.locale='en']
 * @returns {{state:'resolved', role:string, score:number, reason:string, evidence:object[]}
 *          |{state:'ambiguous', roleCandidates:string[], reason:string, evidence:object[]}
 *          |{state:'abstain', evidence:object[]}}
 */
function lookupKeyRole({ signalPath, signalValue, locale = 'en' }) {
  const m = NAMESPACE_RX.exec(String(signalPath || ''));
  if (!m) return { state: 'abstain', evidence: [{ type: 'unsupported-namespace' }] };
  const key = m[1]; // verbatim — exact code-point identity

  /** @type {object[]} */
  const evidence = [];
  const corpusEntry = corpusByName.get(key);
  if (corpusEntry) {
    evidence.push({
      type: 'corpus',
      coverage: corpusEntry.coverage,
      schemaAttestations: corpusEntry.schemaEvidence.length,
      adapterAttestations: corpusEntry.adapterEvidence.length,
      unverifiedOnly:
        corpusEntry.adapterEvidence.length > 0 &&
        corpusEntry.adapterEvidence.every((a) => a.status === 'unverified'),
      source: 'key-role-corpus.v1',
    });
  }

  // ── Named rules: the narrower, specification-frozen adjudication.
  // On disagreement with corpus adjudication the named rule wins and the
  // disagreement is recorded (016 §snapshot identity).
  const rule = namedByKey.get(key);
  let cap = null;
  if (rule && conditionHolds(rule.condition, signalValue)) {
    evidence.push({ type: 'named-rule', provenance: rule.provenance, citation: rule.citation });
    const o = rule.outcome;
    if (o.kind === 'resolved') {
      const adjHere = adjByName.get(key) || [];
      for (const adj of adjHere) {
        if (adj.state !== 'resolved' || adj.roleCandidates[0] !== o.role) {
          evidence.push({ type: 'disagreement', namedRuleWins: true, corpusState: adj.state });
        }
      }
      return {
        state: 'resolved',
        role: o.role,
        score: o.score,
        reason:
          o.role === 'format-declaration'
            ? reason(locale, 'fmtNumeric', key)
            : reason(locale, 'roleResolved', key, o.role),
        evidence,
      };
    }
    if (o.kind === 'ambiguous') {
      return {
        state: 'ambiguous',
        roleCandidates: o.roleCandidates,
        reason: reason(locale, 'ambiguous', key),
        evidence,
      };
    }
    if (o.kind === 'abstain') return { state: 'abstain', evidence };
    if (o.kind === 'cap') cap = o.maxScore; // does not establish anything itself
  }

  // ── Corpus adjudication (staged: absent until the US2 increment).
  const records = adjByName.get(key) || [];
  for (const adj of records) {
    // Slice A has no partition-scoped lookups; a record with a partition
    // constraint is skipped until context matching lands with slice B.
    if (adj.partition) continue;
    evidence.push({ type: 'adjudication', state: adj.state, source: 'key-role-adjudication.v1' });
    if (adj.state === 'resolved') {
      let score = adj.score;
      if (cap !== null) score = Math.min(score, cap);
      if (!EXACT_SCORES.includes(score)) score = 0.4;
      return {
        state: 'resolved',
        role: adj.roleCandidates[0],
        score,
        reason: reason(locale, 'roleResolved', key, adj.roleCandidates[0]),
        evidence,
      };
    }
    if (adj.state === 'ambiguous') {
      return {
        state: 'ambiguous',
        roleCandidates: adj.roleCandidates,
        reason: reason(locale, 'ambiguous', key),
        evidence,
      };
    }
  }

  // Membership alone never supplies a role; a cap alone resolves nothing.
  return { state: 'abstain', evidence };
}

module.exports = { lookupKeyRole };
