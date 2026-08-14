/**
 * index.js — deterministic OpenRTB 2.5 → 2.6 migration advisor.
 *
 * Isomorphic on purpose: this one canonical source runs unchanged in Node
 * (`module.exports`) and in the browser (`window.OrtbtoolsMigrate`), and
 * scripts/gen-browser-core.js mirrors it verbatim into public/core/ behind a CI
 * parity guard.
 *
 * The advisor only ever DESCRIBES a change. Applying one is the caller's
 * explicit decision — see public/modules/migrate/ for the UI that does it
 * behind a mandatory Undo.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules'));
  else root.OrtbtoolsMigrate = factory(root.OrtbtoolsMigrateRules);
})(globalThis, function (rulesModule) {
  'use strict';

  const { MIGRATION_RULES } = rulesModule;

  const RULE_BY_ID = new Map(MIGRATION_RULES.map((rule) => [rule.id, rule]));
  const INVALID_VALUE = Symbol('invalid migration value');

  /** @param {unknown} value @returns {value is Record<string, any>} */
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function compareText(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  function escapePointerSegment(value) {
    return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function appendPointer(pointer, segment) {
    return `${pointer}/${escapePointerSegment(segment)}`;
  }

  function cloneJson(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(cloneJson);
    const clone = Object.getPrototypeOf(value) === null ? Object.create(null) : {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(clone, key, {
        value: cloneJson(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  }

  function jsonEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
      return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
        return false;
      for (let index = 0; index < left.length; index++) {
        if (!jsonEqual(left[index], right[index])) return false;
      }
      return true;
    }
    const leftKeys = Object.keys(left).sort(compareText);
    const rightKeys = Object.keys(right).sort(compareText);
    if (leftKeys.length !== rightKeys.length) return false;
    for (let index = 0; index < leftKeys.length; index++) {
      const key = leftKeys[index];
      if (key !== rightKeys[index] || !jsonEqual(left[key], right[key])) return false;
    }
    return true;
  }

  /**
   * @param {string} ruleId
   * @param {string} path
   * @param {'add'|'remove'} op
   * @param {any} before
   * @param {any} after
   * @param {{confidence?: 'certain'|'likely'|'review', rationale?: string}} [metadata]
   */
  function makeOperation(ruleId, path, op, before, after, metadata = {}) {
    const rule = RULE_BY_ID.get(ruleId);
    return {
      path,
      op,
      before: cloneJson(before),
      after: cloneJson(after),
      rule: rule.id,
      spec: rule.spec,
      confidence: metadata.confidence || rule.confidence,
      rationale: metadata.rationale || rule.rationale,
    };
  }

  function proposePromotion(operations, options) {
    const { ruleId, source, sourceKey, sourcePath, target, targetKey, targetPath, normalize } =
      options;
    if (!isObject(source) || !Object.hasOwn(source, sourceKey) || !isObject(target)) return;

    const sourceValue = source[sourceKey];
    const targetValue = normalize ? normalize(sourceValue) : sourceValue;
    if (targetValue === INVALID_VALUE) return;

    if (Object.hasOwn(target, targetKey)) {
      if (!jsonEqual(target[targetKey], targetValue)) return;
    } else {
      operations.push(makeOperation(ruleId, targetPath, 'add', null, targetValue));
    }
    operations.push(makeOperation(ruleId, sourcePath, 'remove', sourceValue, null));
  }

  function normalizeBinary(value) {
    if (value === true) return 1;
    if (value === false) return 0;
    if (value === 0 || value === 1) return value;
    return INVALID_VALUE;
  }

  function normalizeInteger(value) {
    return Number.isInteger(value) ? value : INVALID_VALUE;
  }

  function normalizeNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0 ? value : INVALID_VALUE;
  }

  function normalizeObject(value) {
    return isObject(value) ? value : INVALID_VALUE;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : INVALID_VALUE;
  }

  function collectCategoryTargets(payload) {
    const targets = [{ value: payload, path: '', categoryKeys: ['bcat'] }];
    for (const contextKey of ['site', 'app']) {
      const context = payload[contextKey];
      if (!isObject(context)) continue;
      const contextPath = appendPointer('', contextKey);
      targets.push({
        value: context,
        path: contextPath,
        categoryKeys: ['cat', 'sectioncat', 'pagecat'],
      });

      if (isObject(context.publisher)) {
        targets.push({
          value: context.publisher,
          path: appendPointer(contextPath, 'publisher'),
          categoryKeys: ['cat'],
        });
      }
      if (isObject(context.content)) {
        const contentPath = appendPointer(contextPath, 'content');
        targets.push({ value: context.content, path: contentPath, categoryKeys: ['cat'] });
        if (isObject(context.content.producer)) {
          targets.push({
            value: context.content.producer,
            path: appendPointer(contentPath, 'producer'),
            categoryKeys: ['cat'],
          });
        }
      }
    }
    return targets;
  }

  function collectCategoryOperations(payload, operations) {
    for (const target of collectCategoryTargets(payload)) {
      const categoryArrays = target.categoryKeys
        .filter((key) => Object.hasOwn(target.value, key) && Array.isArray(target.value[key]))
        .map((key) => target.value[key]);
      if (categoryArrays.length && !Object.hasOwn(target.value, 'cattax')) {
        const categoryCodes = categoryArrays.flat();
        const looksLikeTaxonomyOne =
          categoryCodes.length > 0 &&
          categoryCodes.every((code) => typeof code === 'string' && /^IAB\d+(?:-\d+)?$/.test(code));
        const metadata = looksLikeTaxonomyOne
          ? {
              confidence: /** @type {const} */ ('certain'),
              rationale: 'Make the OpenRTB 2.5 default Content Taxonomy 1.0 explicit for 2.6.',
            }
          : {
              confidence: /** @type {const} */ ('review'),
              rationale:
                'Category codes do not all look like Content Taxonomy 1.0; confirm the suggested cattax value manually before applying it.',
            };
        operations.push(
          makeOperation(
            'ortb26.category.cattax',
            appendPointer(target.path, 'cattax'),
            'add',
            null,
            1,
            metadata,
          ),
        );
      }
    }
  }

  function collectContentOperations(payload, operations) {
    for (const contextKey of ['site', 'app']) {
      const context = payload[contextKey];
      if (!isObject(context) || !isObject(context.content)) continue;
      const content = context.content;
      const contentPath = appendPointer(appendPointer('', contextKey), 'content');
      proposePromotion(operations, {
        ruleId: 'ortb26.content.prodq',
        source: content,
        sourceKey: 'videoquality',
        sourcePath: appendPointer(contentPath, 'videoquality'),
        target: content,
        targetKey: 'prodq',
        targetPath: appendPointer(contentPath, 'prodq'),
        normalize: normalizeInteger,
      });
    }
  }

  function collectImpressionOperations(payload, operations) {
    for (let index = 0; index < payload.imp.length; index++) {
      const impression = payload.imp[index];
      if (!isObject(impression) || !isObject(impression.video)) continue;
      const impressionPath = appendPointer(appendPointer('', 'imp'), index);
      const video = impression.video;
      const videoPath = appendPointer(impressionPath, 'video');

      if (isObject(video.ext)) {
        proposePromotion(operations, {
          ruleId: 'ortb26.imp.rwdd',
          source: video.ext,
          sourceKey: 'rewarded',
          sourcePath: appendPointer(appendPointer(videoPath, 'ext'), 'rewarded'),
          target: impression,
          targetKey: 'rwdd',
          targetPath: appendPointer(impressionPath, 'rwdd'),
          normalize: normalizeBinary,
        });
      }

      proposePromotion(operations, {
        ruleId: 'ortb26.video.protocols',
        source: video,
        sourceKey: 'protocol',
        sourcePath: appendPointer(videoPath, 'protocol'),
        target: video,
        targetKey: 'protocols',
        targetPath: appendPointer(videoPath, 'protocols'),
        normalize(value) {
          const protocol = normalizeInteger(value);
          return protocol === INVALID_VALUE ? INVALID_VALUE : [protocol];
        },
      });
    }
  }

  function collectExtensionPromotions(payload, operations) {
    if (isObject(payload.regs) && isObject(payload.regs.ext)) {
      proposePromotion(operations, {
        ruleId: 'ortb26.regs.gdpr',
        source: payload.regs.ext,
        sourceKey: 'gdpr',
        sourcePath: '/regs/ext/gdpr',
        target: payload.regs,
        targetKey: 'gdpr',
        targetPath: '/regs/gdpr',
        normalize: normalizeBinary,
      });
      // Same shape as the GDPR flag directly above: a pre-2.6 extension field
      // that 2.6 standardised at the top of Regs. Left out until now, so a 2.5
      // payload carrying only the extension form was migrated with its CCPA
      // signal still in the old home, where a 2.6 reader does not look.
      proposePromotion(operations, {
        ruleId: 'ortb26.regs.us_privacy',
        source: payload.regs.ext,
        sourceKey: 'us_privacy',
        sourcePath: '/regs/ext/us_privacy',
        target: payload.regs,
        targetKey: 'us_privacy',
        targetPath: '/regs/us_privacy',
        normalize: normalizeNonEmptyString,
      });
    }
    if (isObject(payload.source) && isObject(payload.source.ext)) {
      proposePromotion(operations, {
        ruleId: 'ortb26.source.schain',
        source: payload.source.ext,
        sourceKey: 'schain',
        sourcePath: '/source/ext/schain',
        target: payload.source,
        targetKey: 'schain',
        targetPath: '/source/schain',
        normalize: normalizeObject,
      });
    }
    if (isObject(payload.user) && isObject(payload.user.ext)) {
      proposePromotion(operations, {
        ruleId: 'ortb26.user.consent',
        source: payload.user.ext,
        sourceKey: 'consent',
        sourcePath: '/user/ext/consent',
        target: payload.user,
        targetKey: 'consent',
        targetPath: '/user/consent',
        normalize: normalizeNonEmptyString,
      });
      proposePromotion(operations, {
        ruleId: 'ortb26.user.eids',
        source: payload.user.ext,
        sourceKey: 'eids',
        sourcePath: '/user/ext/eids',
        target: payload.user,
        targetKey: 'eids',
        targetPath: '/user/eids',
        normalize: normalizeArray,
      });
    }
  }

  function sortOperations(operations) {
    return operations.sort((left, right) => {
      return (
        compareText(left.path, right.path) ||
        compareText(left.rule, right.rule) ||
        compareText(left.op, right.op)
      );
    });
  }

  /**
   * Return deterministic, declarative OpenRTB 2.5 → 2.6 migration proposals.
   * The input is never mutated and no operation is applied by this module.
   * Non-BidRequest JSON values return an empty patch.
   *
   * @param {unknown} payload
   * @returns {Array<{
   *   path: string,
   *   op: 'add'|'remove',
   *   before: any,
   *   after: any,
   *   rule: string,
   *   spec: string,
   *   confidence: 'certain'|'likely'|'review',
   *   rationale: string
   * }>}
   */
  function adviseMigration25To26(payload) {
    if (!isObject(payload) || !Array.isArray(payload.imp)) return [];

    const operations = [];
    collectCategoryOperations(payload, operations);
    collectContentOperations(payload, operations);
    collectImpressionOperations(payload, operations);
    collectExtensionPromotions(payload, operations);
    return sortOperations(operations);
  }

  return { adviseMigration25To26, MIGRATION_RULES };
});
