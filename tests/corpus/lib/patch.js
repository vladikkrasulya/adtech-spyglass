'use strict';

/**
 * tests/corpus/lib/patch.js — the RFC 6902 subset mutations use.
 *
 * Only `add`, `replace` and `remove` with plain JSON-pointer paths. Enough to
 * express every negative scenario the corpus needs (drop a field, retype it,
 * insert a duplicate, reorder an array by replacing it) while keeping the
 * mutation file readable next to the base pair it changes. `~0`/`~1` escapes
 * are honoured; `-` appends to an array on `add`.
 */

/**
 * @param {string} pointer
 * @returns {string[]}
 */
function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new Error('JSON pointer must be a string');
  if (pointer === '') return [];
  if (pointer[0] !== '/') throw new Error(`JSON pointer must start with "/": ${pointer}`);
  if (/~(?:[^01]|$)/.test(pointer)) throw new Error(`invalid JSON pointer escape: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Apply one op to a deep clone of `doc` and return the clone.
 *
 * @param {unknown} doc
 * @param {{op: string, path: string, value?: unknown}} op
 * @returns {unknown}
 */
function applyOp(doc, op) {
  if (!op || !['add', 'replace', 'remove'].includes(op.op)) {
    throw new Error(`unsupported op ${op && op.op}`);
  }
  if (Object.keys(op).some((k) => !['op', 'path', 'value'].includes(k))) {
    throw new Error('patch op has unknown keys');
  }
  if (op.op !== 'remove' && !Object.hasOwn(op, 'value')) {
    throw new Error(`patch ${op.op} requires value`);
  }
  const segs = parsePointer(op.path);
  if (!segs.length) {
    if (op.op === 'remove') return undefined;
    return clone(op.value);
  }
  const root = clone(doc);
  let cur = /** @type {any} */ (root);
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (Array.isArray(cur) && !/^(0|[1-9]\d*)$/.test(seg)) {
      throw new Error(`invalid patch array index: ${op.path}`);
    }
    const key = Array.isArray(cur) ? Number(seg) : seg;
    if (cur == null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) {
      throw new Error(`patch path not found: ${op.path} (at "${seg}")`);
    }
    cur = cur[key];
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(cur)) {
    if (!(op.op === 'add' && last === '-') && !/^(0|[1-9]\d*)$/.test(last)) {
      throw new Error(`invalid patch array index: ${op.path}`);
    }
    const idx = last === '-' ? cur.length : Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx > cur.length) {
      throw new Error(`patch index out of range: ${op.path}`);
    }
    if (op.op === 'add') cur.splice(idx, 0, clone(op.value));
    else if (op.op === 'replace') {
      if (idx >= cur.length) throw new Error(`patch replace beyond array end: ${op.path}`);
      cur[idx] = clone(op.value);
    } else if (op.op === 'remove') {
      if (idx >= cur.length) throw new Error(`patch remove beyond array end: ${op.path}`);
      cur.splice(idx, 1);
    } else throw new Error(`unsupported op ${op.op}`);
    return root;
  }
  if (cur == null || typeof cur !== 'object') {
    throw new Error(`patch parent is not a container: ${op.path}`);
  }
  if (op.op === 'add' || op.op === 'replace') {
    if (op.op === 'replace' && !Object.hasOwn(cur, last)) {
      throw new Error(`patch replace of missing member: ${op.path}`);
    }
    // A literal JSON member named __proto__ must remain a data property.
    Object.defineProperty(cur, last, {
      value: clone(op.value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else if (op.op === 'remove') {
    if (!Object.hasOwn(cur, last)) throw new Error(`patch remove of missing member: ${op.path}`);
    delete cur[last];
  } else throw new Error(`unsupported op ${op.op}`);
  return root;
}

/**
 * @param {unknown} doc
 * @param {Array<{op: string, path: string, value?: unknown}>} ops
 * @returns {unknown}
 */
function applyPatch(doc, ops) {
  let out = clone(doc);
  for (const op of ops) out = applyOp(out, op);
  return out;
}

module.exports = { applyPatch, applyOp, parsePointer };
