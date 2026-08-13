'use strict';

const { OPENRTB_ARRAY_IDENTITIES, OPENRTB_SET_PATHS } = require('./registry');

const IDENTITY_BY_PATH = new Map(OPENRTB_ARRAY_IDENTITIES.map((entry) => [entry.path, entry.key]));
const SET_PATHS = new Set(OPENRTB_SET_PATHS);
const MAX_JSON_DEPTH = 512;

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

function appendSchemaPath(schemaPath, segment) {
  return `${schemaPath}/${escapePointerSegment(segment)}`;
}

function valueKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort(compareText);
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
    .join(',')}}`;
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

function assertJsonCompatible(value, label) {
  const ancestors = new Set();

  function visit(current, pointer, depth) {
    if (depth > MAX_JSON_DEPTH) {
      throw new TypeError(
        `${label} is not JSON-compatible at ${pointer || '/'}: nesting depth exceeds ${MAX_JSON_DEPTH}`,
      );
    }

    const kind = typeof current;
    if (current === null || kind === 'string' || kind === 'boolean') return;
    if (kind === 'number') {
      if (Number.isFinite(current)) return;
      throw new TypeError(
        `${label} is not JSON-compatible at ${pointer || '/'}: non-finite number`,
      );
    }
    if (kind !== 'object') {
      throw new TypeError(`${label} is not JSON-compatible at ${pointer || '/'}: ${kind}`);
    }
    if (ancestors.has(current)) {
      throw new TypeError(`${label} is not JSON-compatible at ${pointer || '/'}: cyclic value`);
    }

    if (!Array.isArray(current)) {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(
          `${label} is not JSON-compatible at ${pointer || '/'}: non-plain object`,
        );
      }
      if (Object.getOwnPropertySymbols(current).length) {
        throw new TypeError(`${label} is not JSON-compatible at ${pointer || '/'}: symbol key`);
      }
    }

    ancestors.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index++) {
        if (!Object.hasOwn(current, index)) {
          throw new TypeError(
            `${label} is not JSON-compatible at ${appendPointer(pointer, index)}: sparse array`,
          );
        }
        visit(current[index], appendPointer(pointer, index), depth + 1);
      }
    } else {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of Object.keys(descriptors).sort(compareText)) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable) continue;
        if (!Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(
            `${label} is not JSON-compatible at ${appendPointer(pointer, key)}: accessor property`,
          );
        }
        visit(descriptor.value, appendPointer(pointer, key), depth + 1);
      }
    }
    ancestors.delete(current);
  }

  visit(value, '', 0);
}

function addChange(state, op, path, leftPath, rightPath, before, after) {
  const change = { op, path, leftPath, rightPath };
  if (op !== 'add') change.before = cloneJson(before);
  if (op !== 'remove') change.after = cloneJson(after);
  state.changes.push(change);
}

function inspectIdentities(values, key) {
  const missingIndices = [];
  const invalidIndices = [];
  const byIdentity = new Map();

  for (let index = 0; index < values.length; index++) {
    const item = values[index];
    if (
      item === null ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      !Object.hasOwn(item, key)
    ) {
      missingIndices.push(index);
      continue;
    }

    const identity = item[key];
    const validString = typeof identity === 'string' && identity.length > 0;
    const validNumber = typeof identity === 'number' && Number.isFinite(identity);
    if (!validString && !validNumber) {
      invalidIndices.push(index);
      continue;
    }

    const canonical = canonicalStringify(identity);
    const existing = byIdentity.get(canonical);
    if (existing) {
      existing.indices.push(index);
    } else {
      byIdentity.set(canonical, { value: identity, indices: [index] });
    }
  }

  const duplicates = [...byIdentity.entries()]
    .filter(([, entry]) => entry.indices.length > 1)
    .sort(([left], [right]) => compareText(left, right))
    .map(([, entry]) => ({ value: cloneJson(entry.value), indices: [...entry.indices] }));

  return {
    missingIndices,
    invalidIndices,
    duplicates,
    byIdentity,
    usable: !missingIndices.length && !invalidIndices.length && !duplicates.length,
  };
}

function publicIdentityInspection(inspection) {
  return {
    missingIndices: inspection.missingIndices,
    invalidIndices: inspection.invalidIndices,
    duplicates: inspection.duplicates,
  };
}

function compareObjects(left, right, location, state) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of [...keys].sort(compareText)) {
    const leftHas = Object.hasOwn(left, key);
    const rightHas = Object.hasOwn(right, key);
    const path = appendPointer(location.path, key);
    const leftPath = appendPointer(location.leftPath, key);
    const rightPath = appendPointer(location.rightPath, key);
    const schemaPath = appendSchemaPath(location.schemaPath, key);

    if (!leftHas) {
      addChange(state, 'add', path, null, rightPath, undefined, right[key]);
    } else if (!rightHas) {
      addChange(state, 'remove', path, leftPath, null, left[key], undefined);
    } else {
      compareValues(left[key], right[key], { path, leftPath, rightPath, schemaPath }, state);
    }
  }
}

function comparePositionalArrays(left, right, location, state) {
  const commonLength = Math.min(left.length, right.length);
  const elementSchemaPath = appendSchemaPath(location.schemaPath, '*');

  for (let index = 0; index < commonLength; index++) {
    compareValues(
      left[index],
      right[index],
      {
        path: appendPointer(location.path, index),
        leftPath: appendPointer(location.leftPath, index),
        rightPath: appendPointer(location.rightPath, index),
        schemaPath: elementSchemaPath,
      },
      state,
    );
  }

  for (let index = commonLength; index < left.length; index++) {
    addChange(
      state,
      'remove',
      appendPointer(location.path, index),
      appendPointer(location.leftPath, index),
      null,
      left[index],
      undefined,
    );
  }
  for (let index = commonLength; index < right.length; index++) {
    addChange(
      state,
      'add',
      appendPointer(location.path, index),
      null,
      appendPointer(location.rightPath, index),
      undefined,
      right[index],
    );
  }
}

function indexSetValues(values) {
  const indexed = new Map();
  for (let index = 0; index < values.length; index++) {
    const canonical = canonicalStringify(values[index]);
    if (!indexed.has(canonical)) indexed.set(canonical, { value: values[index], index });
  }
  return indexed;
}

function compareSetArrays(left, right, location, state) {
  const leftValues = indexSetValues(left);
  const rightValues = indexSetValues(right);
  const members = new Set([...leftValues.keys(), ...rightValues.keys()]);

  for (const canonical of [...members].sort(compareText)) {
    const leftEntry = leftValues.get(canonical);
    const rightEntry = rightValues.get(canonical);
    if (leftEntry && rightEntry) continue;

    const path = appendPointer(location.path, `@set=${encodeURIComponent(canonical)}`);
    if (leftEntry) {
      addChange(
        state,
        'remove',
        path,
        appendPointer(location.leftPath, leftEntry.index),
        null,
        leftEntry.value,
        undefined,
      );
    } else {
      addChange(
        state,
        'add',
        path,
        null,
        appendPointer(location.rightPath, rightEntry.index),
        undefined,
        rightEntry.value,
      );
    }
  }
}

function compareIdentityArrays(left, right, location, state, identityKey) {
  const leftInspection = inspectIdentities(left, identityKey);
  const rightInspection = inspectIdentities(right, identityKey);

  if (!leftInspection.usable || !rightInspection.usable) {
    state.warnings.push({
      code: 'array_identity_fallback',
      path: location.path,
      leftPath: location.leftPath,
      rightPath: location.rightPath,
      identityKey,
      left: publicIdentityInspection(leftInspection),
      right: publicIdentityInspection(rightInspection),
    });
    comparePositionalArrays(left, right, location, state);
    return;
  }

  const identities = new Set([
    ...leftInspection.byIdentity.keys(),
    ...rightInspection.byIdentity.keys(),
  ]);
  const elementSchemaPath = appendSchemaPath(location.schemaPath, '*');

  for (const canonical of [...identities].sort(compareText)) {
    const leftEntry = leftInspection.byIdentity.get(canonical);
    const rightEntry = rightInspection.byIdentity.get(canonical);
    const selector = `@${identityKey}=${encodeURIComponent(canonical)}`;
    const path = appendPointer(location.path, selector);

    if (!leftEntry) {
      const rightIndex = rightEntry.indices[0];
      addChange(
        state,
        'add',
        path,
        null,
        appendPointer(location.rightPath, rightIndex),
        undefined,
        right[rightIndex],
      );
      continue;
    }
    if (!rightEntry) {
      const leftIndex = leftEntry.indices[0];
      addChange(
        state,
        'remove',
        path,
        appendPointer(location.leftPath, leftIndex),
        null,
        left[leftIndex],
        undefined,
      );
      continue;
    }

    const leftIndex = leftEntry.indices[0];
    const rightIndex = rightEntry.indices[0];
    compareValues(
      left[leftIndex],
      right[rightIndex],
      {
        path,
        leftPath: appendPointer(location.leftPath, leftIndex),
        rightPath: appendPointer(location.rightPath, rightIndex),
        schemaPath: elementSchemaPath,
      },
      state,
    );
  }
}

function compareArrays(left, right, location, state) {
  if (state.mode === 'semantic' && SET_PATHS.has(location.schemaPath)) {
    compareSetArrays(left, right, location, state);
    return;
  }

  const identityKey =
    state.mode === 'semantic' ? IDENTITY_BY_PATH.get(location.schemaPath) : undefined;
  if (identityKey) {
    compareIdentityArrays(left, right, location, state, identityKey);
    return;
  }

  comparePositionalArrays(left, right, location, state);
}

function compareValues(left, right, location, state) {
  const leftKind = valueKind(left);
  const rightKind = valueKind(right);
  if (leftKind !== rightKind) {
    addChange(state, 'replace', location.path, location.leftPath, location.rightPath, left, right);
    return;
  }

  if (leftKind === 'array') {
    compareArrays(left, right, location, state);
  } else if (leftKind === 'object') {
    compareObjects(left, right, location, state);
  } else if (left !== right) {
    addChange(state, 'replace', location.path, location.leftPath, location.rightPath, left, right);
  }
}

function sortOutput(state) {
  state.changes.sort((left, right) => {
    const byPath = compareText(left.path, right.path);
    return byPath || compareText(left.op, right.op);
  });
  state.warnings.sort((left, right) => {
    const byPath = compareText(left.path, right.path);
    return byPath || compareText(left.code, right.code);
  });
}

/**
 * Compare two JSON-compatible values.
 *
 * Raw mode compares every array by index. Semantic mode additionally applies
 * the explicit OpenRTB identity and set registries exported by this module.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @param {{mode?: 'raw'|'semantic'}} [options]
 * @returns {{mode: 'raw'|'semantic', equal: boolean, changes: object[], warnings: object[]}}
 */
function diffJson(left, right, options) {
  const mode = options && options.mode ? options.mode : 'raw';
  if (mode !== 'raw' && mode !== 'semantic') {
    throw new TypeError(`Unsupported diff mode: ${String(mode)}`);
  }
  assertJsonCompatible(left, 'left');
  assertJsonCompatible(right, 'right');

  const state = { mode, changes: [], warnings: [] };
  compareValues(left, right, { path: '', leftPath: '', rightPath: '', schemaPath: '' }, state);
  sortOutput(state);
  return {
    mode,
    equal: state.changes.length === 0,
    changes: state.changes,
    warnings: state.warnings,
  };
}

function rawDiff(left, right) {
  return diffJson(left, right, { mode: 'raw' });
}

function semanticDiff(left, right) {
  return diffJson(left, right, { mode: 'semantic' });
}

module.exports = {
  diffJson,
  rawDiff,
  semanticDiff,
  OPENRTB_ARRAY_IDENTITIES,
  OPENRTB_SET_PATHS,
};
