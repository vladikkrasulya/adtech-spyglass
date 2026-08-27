'use strict';

/**
 * signal-lexicon — deterministic resolution of vendor ext signals to semantic
 * labels. Pure function, no I/O, no model.
 *
 * This sits in FRONT of the AI labeller (modules/ai-label). Most unknown
 * vendor signals are not actually mysterious: a key called `preroll_video`
 * next to an `imp.video` object is a video slot, and a key called
 * `request_uuid` is not a format at all. Sending those to a language model
 * costs a GPU second, introduces a chance of hallucination, and produces an
 * answer we could have derived from a table. The model's budget is better
 * spent on the genuinely ambiguous remainder.
 *
 * Why this lives in packages/core rather than in the module that calls it:
 * the vocabulary here is the same vocabulary non-iab-formats.js already
 * encodes for pop/push, extended to the canonical IAB families. Keeping it
 * next to its sibling means the two can be reconciled when the recognition
 * table grows, instead of drifting into two half-tables in two layers.
 *
 * ── The conservatism rule ────────────────────────────────────────────────
 * This resolver answers or abstains. It never guesses. `resolveSignal()`
 * returns null far more often than it returns a label, and that is the
 * intended behaviour: a null costs one model call, whereas a wrong label
 * gets saved into the user's dialect and then silently re-applied to every
 * future payload they analyse. The asymmetry of those two costs is the
 * whole design.
 *
 * Concretely it abstains on:
 *   - numeric codes (`adtype: 8`). Vendors number formats privately; there
 *     is no shared registry. Without that vendor's dictionary the code is
 *     unreadable, and a plausible-looking guess is worse than no answer.
 *   - format words CONTRADICTED by the impression (`type: "video_slider"`
 *     on an imp carrying only `banner`). Either the vendor's naming is
 *     misleading or the slot is a hybrid; both deserve a human.
 *   - anything not in the vocabulary.
 *
 * @see packages/core/non-iab-formats.js — pop/push recognition this extends
 * @see modules/ai-label/handler.js — the caller, and the model fallback
 */

const {
  normaliseFormatName,
  POP_FORMAT_NAMES,
  PUSH_FORMAT_NAMES,
  FLAG_HINT_KEYS,
  POP_SHAPE_FLAG_KEYS,
} = require('../non-iab-formats');

/**
 * Semantic labels the dialect store accepts. Mirrors SEMANTIC_LABELS in
 * modules/dialects/handler.js — a mismatch here produces a suggestion the
 * user cannot save, so tests/ai-label.test.js asserts the two sets agree.
 */
const SEMANTIC_LABELS = Object.freeze([
  'pop',
  'native',
  'banner',
  'video',
  'audio',
  'in-page-push',
  'push',
  'interstitial-banner',
  'ignore',
  'informational',
  'custom',
]);

/**
 * Format words → semantic label, keyed by NORMALISED token (lowercase, no
 * separators — `normaliseFormatName` does this, so `pre-roll` and `pre_roll`
 * both arrive as `preroll`).
 *
 * Only words that name a format on their own belong here. `slider`,
 * `sticky`, `top` and friends describe placement, not family, and are
 * deliberately absent — a slot called `video_slider` gets its family from
 * `video`, and its ambiguity resolved against the impression below.
 */
const FORMAT_WORDS = new Map([
  // video family
  ['video', 'video'],
  ['preroll', 'video'],
  ['midroll', 'video'],
  ['postroll', 'video'],
  ['instream', 'video'],
  ['outstream', 'video'],
  ['vast', 'video'],
  ['ctv', 'video'],
  // audio family
  ['audio', 'audio'],
  ['podcast', 'audio'],
  ['daast', 'audio'],
  // native
  ['native', 'native'],
  ['contentad', 'native'],
  ['recommendation', 'native'],
  // banner / display
  ['banner', 'banner'],
  ['display', 'banner'],
  ['mrec', 'banner'],
  ['leaderboard', 'banner'],
  // interstitial (in-page fullscreen, NOT a new window — that is pop)
  ['interstitial', 'interstitial-banner'],
  ['fullscreen', 'interstitial-banner'],
  // in-page push (a widget imitating a notification)
  ['inpagepush', 'in-page-push'],
  ['ipp', 'in-page-push'],
]);

/**
 * Key names that declare a format. Superset of non-iab-formats'
 * STRING_HINT_KEYS: that list gates pop/push RULES (where a false positive
 * fires a warning at the user), this one gates a SUGGESTION the user must
 * confirm, so it can afford to be broader.
 */
const FORMAT_DECLARING_KEYS = new Set([
  'adtype',
  'ad_type',
  'adformat',
  'ad_format',
  'format',
  'type',
  'placement',
  'placementtype',
  'slottype',
  'inventorytype',
]);

/**
 * Key-name patterns that are structurally not formats. Matched against the
 * normalised key. `ignore` = machine bookkeeping the reader can skip;
 * `informational` = a value a human might want to read (partner name, SDK
 * version) that still says nothing about the format.
 */
const NON_FORMAT_KEY_PATTERNS = [
  {
    rx: /^(request|transaction|session|auction|user|imp|slot|tag|zone|placement)?_?(id|uuid|guid)$/,
    label: 'ignore',
  },
  { rx: /(^|_)(tid|rid|sid|uid|guid|uuid)$/, label: 'ignore' },
  // Generic id suffix — `custom_tracking_id`, `partnerRequestId`. Runs after
  // the pop shape-flags above, which is what keeps `sizeID` out of here.
  { rx: /(^|_)?id$/, label: 'ignore' },
  { rx: /(^|_)(token|signature|sign|hash|checksum|nonce|salt)$/, label: 'ignore' },
  { rx: /(^|_)(timestamp|ts|time|epoch|expires|expiry)$/, label: 'ignore' },
  { rx: /(^|_)(debug|test|sandbox|dryrun|trace|log)$/, label: 'ignore' },
  {
    rx: /^(v|pv|sv|ver|version|apiversion|sdkversion|sdkver|protocolversion)$/,
    label: 'informational',
  },
  { rx: /(^|_)(version|ver)$/, label: 'informational' },
  {
    rx: /^(ssp|dsp|partner|vendor|network|source|seller|publisher|adapter|integration)(_?(name|id))?$/,
    label: 'informational',
  },
  { rx: /(^|_)(country|geo|lang|language|locale|currency)$/, label: 'informational' },
];

/**
 * Which IAB object the impression actually carries. Used to corroborate — or
 * contradict — a format word found in the value.
 *
 * A `banner` whose declared size is 1x1 is not display inventory; it is the
 * placeholder pop networks send because oRTB requires *some* media object.
 * Reporting it as banner evidence would let `type: "video_slider"` on a pop
 * slot look corroborated, so 1x1 is reported as no banner at all. The same
 * 1x1 reading drives analyzeShape's pop scoring in shape-fingerprint.js.
 *
 * @param {any} imp — a single imp object, or null when the caller has none;
 *   untrusted input, so every access below is type-guarded
 * @returns {Set<string>} subset of {'video','audio','native','banner'}
 */
function impMediaFamilies(imp) {
  const out = new Set();
  if (!imp || typeof imp !== 'object' || Array.isArray(imp)) return out;
  if (imp.video && typeof imp.video === 'object') out.add('video');
  if (imp.audio && typeof imp.audio === 'object') out.add('audio');
  if (imp.native && typeof imp.native === 'object') out.add('native');
  const b = imp.banner;
  if (b && typeof b === 'object') {
    const w = Number(b.w);
    const h = Number(b.h);
    if (!(w === 1 && h === 1)) out.add('banner');
  }
  return out;
}

/**
 * Split a signal value into normalised word tokens.
 * `"Pre-Roll_Video"` → ['preroll', 'video'] and also the whole-string form
 * `'prerollvideo'`, so both `FORMAT_WORDS` styles resolve.
 *
 * @param {any} value  any scalar; coerced to string before splitting
 * @returns {string[]}
 */
function tokenise(value) {
  const raw = String(value == null ? '' : value);
  const parts = raw
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  const whole = normaliseFormatName(raw);
  const out = whole ? [whole] : [];
  for (const p of parts) if (p && !out.includes(p)) out.push(p);
  return out;
}

/** Numeric, or a string that is nothing but digits — the unreadable-code case. */
function isNumericCode(value) {
  if (typeof value === 'number') return true;
  if (typeof value !== 'string') return false;
  return /^\s*\d+\s*$/.test(value);
}

/**
 * Localized `reason:` sentences for every branch below that returns a
 * suggestion. Keyed by locale then by an internal reason id, so a branch
 * only ever names WHICH sentence fires — never its language.
 *
 * Inline rather than a `packages/core/messages/*.json` catalog on purpose:
 * this table is intrinsic to resolveSignal()'s own branches (adding a branch
 * means adding a reason id right here), not a general finding-message
 * registry, and Core stays a deterministic data-to-data function with no
 * network call (Constitution IV) either way. `pop`/`push`/the semantic
 * label names are never translated — they are the same identifiers
 * SEMANTIC_LABELS exports, not prose.
 */
const REASONS = {
  uk: {
    sizeIdZero: () =>
      'Ключ «sizeID» зі значенням [0] — характерна ознака pop-інвентаря: розміру немає, бо креатив відкривається в окремому вікні.',
    popShapeFlag: (key) =>
      `Ключ «${key}» — vendor-прапорець, який pop-мережі надсилають замість оголошення формату; рушій читає його як ознаку pop.`,
    flagKey: (key, family) =>
      `Ключ «${key}» сам називає формат (${family}-родина), значення — лише прапорець.`,
    nonFormatIgnore: (key) =>
      `Ключ «${key}» — службовий ідентифікатор або технічне поле, а не оголошення формату.`,
    nonFormatInformational: (key) =>
      `Ключ «${key}» несе метадані (версія, партнер, локаль), а не формат.`,
    popToken: (value) => `Значення «${value}» прямо називає pop-родину (нове вікно або вкладка).`,
    pushToken: (value) => `Значення «${value}» прямо називає push-родину.`,
    nonMediaWithInstl: (label, value) =>
      `Значення «${value}» називає ${label}, і imp.instl=1 це підтверджує.`,
    nonMediaNoInstl: (label, value) =>
      `Значення «${value}» називає ${label}, але в impression немає поля, яке б це підтвердило.`,
    mediaCorroborated: (label, value) =>
      `Значення «${value}» називає ${label}, і impression несе відповідний об'єкт imp.${label}.`,
    mediaNoObject: (label, value) =>
      `Значення «${value}» називає ${label}; impression не містить медіа-об'єкта, тож підтвердити нічим.`,
  },
  ru: {
    sizeIdZero: () =>
      'Ключ «sizeID» со значением [0] — характерный признак pop-инвентаря: размера нет, потому что креатив открывается в отдельном окне.',
    popShapeFlag: (key) =>
      `Ключ «${key}» — vendor-флаг, который pop-сети присылают вместо объявления формата; движок читает его как признак pop.`,
    flagKey: (key, family) =>
      `Ключ «${key}» сам называет формат (${family}-семейство), значение — лишь флаг.`,
    nonFormatIgnore: (key) =>
      `Ключ «${key}» — служебный идентификатор или техническое поле, а не объявление формата.`,
    nonFormatInformational: (key) =>
      `Ключ «${key}» несёт метаданные (версия, партнёр, локаль), а не формат.`,
    popToken: (value) =>
      `Значение «${value}» прямо называет pop-семейство (новое окно или вкладка).`,
    pushToken: (value) => `Значение «${value}» прямо называет push-семейство.`,
    nonMediaWithInstl: (label, value) =>
      `Значение «${value}» называет ${label}, и imp.instl=1 это подтверждает.`,
    nonMediaNoInstl: (label, value) =>
      `Значение «${value}» называет ${label}, но в impression нет поля, которое бы это подтвердило.`,
    mediaCorroborated: (label, value) =>
      `Значение «${value}» называет ${label}, и impression несёт соответствующий объект imp.${label}.`,
    mediaNoObject: (label, value) =>
      `Значение «${value}» называет ${label}; impression не содержит медиа-объекта, так что подтвердить нечем.`,
  },
  en: {
    sizeIdZero: () =>
      'The "sizeID" key with value [0] is a characteristic pop-inventory marker: there is no size because the creative opens in a separate window.',
    popShapeFlag: (key) =>
      `The "${key}" key is a vendor flag that pop networks send instead of declaring a format; the engine reads it as a pop signal.`,
    flagKey: (key, family) =>
      `The "${key}" key names the format itself (${family} family); its value is just a flag.`,
    nonFormatIgnore: (key) =>
      `The "${key}" key is a bookkeeping identifier or technical field, not a format declaration.`,
    nonFormatInformational: (key) =>
      `The "${key}" key carries metadata (version, partner, locale), not a format.`,
    popToken: (value) =>
      `The value "${value}" names the pop family directly (a new window or tab).`,
    pushToken: (value) => `The value "${value}" names the push family directly.`,
    nonMediaWithInstl: (label, value) =>
      `The value "${value}" names ${label}, and imp.instl=1 confirms it.`,
    nonMediaNoInstl: (label, value) =>
      `The value "${value}" names ${label}, but the impression has no field to confirm it.`,
    mediaCorroborated: (label, value) =>
      `The value "${value}" names ${label}, and the impression carries the matching imp.${label} object.`,
    mediaNoObject: (label, value) =>
      `The value "${value}" names ${label}; the impression carries no media object, so there is nothing to confirm it against.`,
  },
};

/** Look up one localized reason sentence, falling back to `en` for an unknown locale. */
function reason(locale, id, ...args) {
  const dict = REASONS[locale] || REASONS.en;
  const build = dict[id] || REASONS.en[id];
  return build(...args);
}

/**
 * Resolve a single vendor ext signal, or abstain.
 *
 * @param {object} input
 * @param {string} input.signalPath  e.g. 'imp[0].ext.type' or 'ext.pv'
 * @param {unknown} input.signalValue  raw value (string | number | bool | object)
 * @param {object|null} [input.imp]  the impression the signal was found on, when
 *   the signal is imp-scoped. Request-level signals pass null and therefore
 *   never get media corroboration — which is why format words at request level
 *   resolve at lower confidence.
 * @param {string} [input.locale='en']  'en' | 'uk' | 'ru' — governs only the
 *   human-readable `reason` text; label/confidence/source/evidence are the
 *   same for every locale. Defaults to 'en' so callers that predate locale
 *   awareness (e.g. scripts/label-calibration.js, which only checks whether
 *   the return value is null) keep working unchanged.
 * @returns {{label: string, confidence: number, reason: string, source: 'lexicon',
 *            evidence: string[]}|null} null = abstain, ask the model
 */
function resolveSignal({ signalPath, signalValue, imp, locale = 'en' }) {
  const key = String(signalPath || '')
    .split('.')
    .pop()
    .toLowerCase();
  if (!key) return null;

  // ── 0. Keys that ARE the signal ───────────────────────────────────────
  // Two vendor conventions put the format in the key rather than the value:
  // `ext.popunder = 1` (FLAG_HINT_KEYS) and the allow-flag family pop SSPs
  // send instead of any format declaration at all (POP_SHAPE_FLAG_KEYS —
  // allowMT/allowShock/viewOnClick/…). The engine's rules already read both
  // via scanExtForFormatHints, so resolving them here costs nothing and
  // keeps the labeller from paying a model call for something the engine
  // has already decided.
  //
  // This runs FIRST because `sizeID` would otherwise be swallowed by the
  // id-suffix pattern below and mislabelled as bookkeeping.
  const normKey = normaliseFormatName(key);

  // `sizeID:[0]` — a single-element array holding zero. Deliberately NOT in
  // POP_SHAPE_FLAG_KEYS (that list tests permissive scalar values); the
  // engine tests its array shape separately in scanExtForFormatHints, and
  // the predicate is mirrored here exactly. A `sizeID` of any other shape is
  // a real size reference and must fall through.
  if (normKey === 'sizeid') {
    if (Array.isArray(signalValue) && signalValue.length === 1 && signalValue[0] === 0) {
      return {
        label: 'pop',
        confidence: 0.8,
        reason: reason(locale, 'sizeIdZero'),
        source: 'lexicon',
        evidence: ['pop-shape:sizeID=[0]'],
      };
    }
    return null;
  }

  for (const flag of POP_SHAPE_FLAG_KEYS) {
    if (normaliseFormatName(flag) !== normKey) continue;
    return {
      label: 'pop',
      confidence: 0.8,
      reason: reason(locale, 'popShapeFlag', key),
      source: 'lexicon',
      evidence: [`pop-shape-flag:${key}`],
    };
  }
  for (const flag of FLAG_HINT_KEYS) {
    if (flag !== normKey) continue;
    // Only a truthy value marks the flag as set; `popunder: 0` is the vendor
    // explicitly saying this slot is NOT one.
    if (!signalValue) return null;
    const isPush = PUSH_FORMAT_NAMES.has(flag);
    return {
      label: isPush ? 'push' : 'pop',
      confidence: 0.9,
      reason: reason(locale, 'flagKey', key, isPush ? 'push' : 'pop'),
      source: 'lexicon',
      evidence: [`flag-key:${key}`],
    };
  }

  // ── 1. Keys that structurally cannot be a format ──────────────────────
  // Checked BEFORE the value, because `session_id: "video-42"` must resolve
  // on its key, not on the word that happens to sit in its value.
  for (const { rx, label } of NON_FORMAT_KEY_PATTERNS) {
    if (!rx.test(key)) continue;
    // A format-declaring key wins over a generic pattern: `ad_format_version`
    // is metadata, but a bare `format` is not, whatever else it matches.
    if (FORMAT_DECLARING_KEYS.has(key)) break;
    return {
      label,
      confidence: 0.9,
      reason:
        label === 'ignore'
          ? reason(locale, 'nonFormatIgnore', key)
          : reason(locale, 'nonFormatInformational', key),
      source: 'lexicon',
      evidence: [`key:${key}`],
    };
  }

  // ── 2. Numeric codes — abstain, always ────────────────────────────────
  // See the conservatism rule in the file header. There is no shared numeric
  // registry across vendors, so any mapping we produced here would be a
  // coin flip dressed up as an answer.
  if (isNumericCode(signalValue)) return null;

  // Objects and arrays carry no single word to read; the model gets a better
  // look at their shape than a regex would.
  if (signalValue !== null && typeof signalValue === 'object') return null;
  if (typeof signalValue === 'boolean') return null;

  const tokens = tokenise(signalValue);
  if (tokens.length === 0) return null;

  // ── 3. Pop / push family — delegate to the engine's own vocabulary ─────
  // These names are unambiguous by construction: nothing is called
  // "popunder" that is not one. No impression corroboration needed — pops
  // arrive on 1x1 banner placeholders precisely because they have no real
  // media object.
  for (const tok of tokens) {
    if (POP_FORMAT_NAMES.has(tok)) {
      return {
        label: 'pop',
        confidence: 0.95,
        reason: reason(locale, 'popToken', signalValue),
        source: 'lexicon',
        evidence: [`value-token:${tok}`],
      };
    }
    if (PUSH_FORMAT_NAMES.has(tok)) {
      return {
        label: tok === 'nativepush' ? 'in-page-push' : 'push',
        confidence: 0.9,
        reason: reason(locale, 'pushToken', signalValue),
        source: 'lexicon',
        evidence: [`value-token:${tok}`],
      };
    }
  }

  // ── 4. Canonical IAB families — require the key to be format-declaring ─
  // Without this gate a key like `creative_video_url` would resolve to
  // "video" off its own name. The key has to be the kind of key that
  // declares a format before its value is read as one.
  if (!FORMAT_DECLARING_KEYS.has(key)) return null;

  let hit = null;
  for (const tok of tokens) {
    const label = FORMAT_WORDS.get(tok);
    if (label) {
      hit = { tok, label };
      break;
    }
  }
  if (!hit) return null;

  // ── 5. Corroborate against the impression ─────────────────────────────
  const families = impMediaFamilies(imp);
  const mediaLabels = new Set(['video', 'audio', 'native', 'banner']);

  if (!mediaLabels.has(hit.label)) {
    // interstitial-banner / in-page-push have no dedicated oRTB media object,
    // so there is nothing to corroborate against. instl:1 is the one real
    // corroborator available, and only for interstitial.
    const instl = imp && Number(imp.instl) === 1;
    return {
      label: hit.label,
      confidence: instl ? 0.85 : 0.7,
      reason: instl
        ? reason(locale, 'nonMediaWithInstl', hit.label, signalValue)
        : reason(locale, 'nonMediaNoInstl', hit.label, signalValue),
      source: 'lexicon',
      evidence: instl ? [`value-token:${hit.tok}`, 'imp.instl=1'] : [`value-token:${hit.tok}`],
    };
  }

  if (families.has(hit.label)) {
    return {
      label: hit.label,
      confidence: 0.95,
      reason: reason(locale, 'mediaCorroborated', hit.label, signalValue),
      source: 'lexicon',
      evidence: [`value-token:${hit.tok}`, `imp.${hit.label}`],
    };
  }

  if (families.size === 0) {
    // Request-level signal, or an imp with no media object at all. The word
    // is all we have; say so rather than implying corroboration.
    return {
      label: hit.label,
      confidence: 0.6,
      reason: reason(locale, 'mediaNoObject', hit.label, signalValue),
      source: 'lexicon',
      evidence: [`value-token:${hit.tok}`],
    };
  }

  // CONTRADICTION — the word says one family, the impression carries another.
  // This is the `type: "video_slider"` on a banner-only imp case. Abstain:
  // either the vendor's naming is misleading or the slot is a hybrid, and
  // both are exactly the situation a human should look at.
  return null;
}

module.exports = {
  resolveSignal,
  impMediaFamilies,
  tokenise,
  isNumericCode,
  SEMANTIC_LABELS,
  FORMAT_WORDS,
  FORMAT_DECLARING_KEYS,
};
