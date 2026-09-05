'use strict';

/**
 * lib/label-ceilings.js — the persona's ceilings as a deterministic final pass.
 *
 * lib/label-persona.js states four ceilings and calls them "the last step,
 * not advice": the model is told to pick a label and a number, then walk the
 * ceilings and cap. Feature 005 (T024) measured that it does not always walk
 * them — a bare boolean under `enabled` came back at 0.6 against the persona's
 * own 0.5 for short/generic keys. The number beside the answer is what an
 * operator reads to decide whether to check the claim themselves (spec 005,
 * User Story 2), so a ceiling the persona promises has to hold whether or not
 * the model remembered it. This module enforces the persona's ceilings on the
 * way out, exactly as written there. It mirrors the persona; it does not
 * extend it — a new ceiling is added to the persona text first, then here.
 *
 * Not covered on purpose: "unreadable abbreviation" (persona ceiling 1) is a
 * judgement the model makes; there is no deterministic test for it.
 */

const { isNumericCode } = require('../packages/core/dialects/signal-lexicon');

/** Persona: «Коротка чи загальна назва ключа (limit, flag, mode, type, slot, enabled, val, x, zx) → не вище 0.5». */
const GENERIC_KEYS = new Set([
  'limit',
  'flag',
  'mode',
  'type',
  'slot',
  'enabled',
  'val',
  'x',
  'zx',
]);

/** Persona: «Числове значення без словника вендора → стеля 0.3 ЛИШЕ на конкретний формат». */
const FORMAT_LABELS = new Set([
  'pop',
  'native',
  'banner',
  'video',
  'audio',
  'push',
  'in-page-push',
  'interstitial-banner',
]);

const CEILING = Object.freeze({
  emptyValue: 0.3, // «Порожнє значення, null … → не вище 0.3»
  numericCode: 0.3, // «Числове значення без словника вендора → стеля 0.3 ЛИШЕ на конкретний формат»
  genericKey: 0.5, // «Коротка чи загальна назва ключа → не вище 0.5»
  neverAbsolute: 0.95, // «1.0 не ставиться ніколи … Стеля для найочевидніших випадків — 0.95»
});

function lastKey(signalPath) {
  return String(signalPath || '')
    .split('.')
    .pop()
    .toLowerCase();
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Cap a model confidence by the persona's own ceilings.
 *
 * @param {{signalPath: string, signalValue: unknown, label: string, confidence: number}} input
 * @returns {{confidence: number, ceilings: string[]}} the capped number and the
 *   names of the ceilings that actually lowered it (empty when none did)
 */
function applyCeilings({ signalPath, signalValue, label, confidence }) {
  let c = Number(confidence);
  if (!Number.isFinite(c)) c = 0;
  c = Math.max(0, Math.min(1, c));
  const ceilings = [];
  const cap = (name, limit) => {
    if (c > limit) {
      c = limit;
      ceilings.push(name);
    }
  };
  if (isEmptyValue(signalValue)) cap('empty-value', CEILING.emptyValue);
  if (isNumericCode(signalValue) && FORMAT_LABELS.has(label)) {
    cap('numeric-code', CEILING.numericCode);
  }
  if (GENERIC_KEYS.has(lastKey(signalPath))) cap('generic-key', CEILING.genericKey);
  cap('never-absolute', CEILING.neverAbsolute);
  return { confidence: c, ceilings };
}

module.exports = { applyCeilings, isEmptyValue, GENERIC_KEYS, FORMAT_LABELS, CEILING };
