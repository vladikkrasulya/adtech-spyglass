'use strict';

const { LEVELS, makeFinding, sortFindings } = require('../findings');
const F = makeFinding;
const { resolve } = require('../messages');
const specRefs = require('../spec-refs.json');
const { collectCopies, inspectCopies, MAX_NODES } = require('../rules/schain');
const { listInspectionProfiles, evaluateDeclaredRoute } = require('./routes');

const MAX_INPUT_LENGTH = 200000;
const SOURCES = [
  {
    id: 'iab.supplychain.1.0',
    title: 'IAB SupplyChain object and serialization',
    url: 'https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/supplychainobject.md',
  },
];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseSerialized(text) {
  const parts = text.split('!');
  if (parts.length < 2 || parts.length > MAX_NODES + 1) return { reason: 'serialized_shape' };
  try {
    const header = parts[0].split(',').map((v) => decodeURIComponent(v));
    if (header.length !== 2) return { reason: 'serialized_shape' };
    const number = (value) => (/^(0|1)$/.test(value) ? Number(value) : value);
    const chain = { ver: header[0], complete: number(header[1]), nodes: [] };
    for (const part of parts.slice(1)) {
      const values = part.split(',').map((v) => decodeURIComponent(v));
      if (values.length < 3 || values.length > 7) return { reason: 'serialized_shape' };
      const node = { asi: values[0], sid: values[1], hp: number(values[2]) };
      for (const [idx, key] of [
        [3, 'rid'],
        [4, 'name'],
        [5, 'domain'],
        [6, 'ext'],
      ]) {
        if (values[idx]) node[key] = values[idx];
      }
      chain.nodes.push(node);
    }
    return { chain, reason: null };
  } catch {
    return { reason: 'malformed_encoding' };
  }
}

function queryValue(text) {
  let search = text;
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return { reason: 'invalid_url' };
    }
    if (!['https:', 'http:'].includes(url.protocol)) return { reason: 'unsupported_scheme' };
    search = url.search;
  }
  if (search.startsWith('?')) search = search.slice(1);
  search = search.split('#')[0];
  const values = [];
  try {
    for (const part of search.split('&')) {
      const at = part.indexOf('=');
      const key = decodeURIComponent(at < 0 ? part : part.slice(0, at));
      if (key === 'schain') values.push(at < 0 ? '' : part.slice(at + 1));
    }
    if (!values.length) return { reason: 'no_schain_parameter' };
    if (values.length !== 1) return { reason: 'duplicate_parameter' };
    // A literal header comma means the serialization is already exposed in
    // the query. Split its fields before decoding their escaped delimiters.
    // Otherwise decode exactly one outer URL layer, then parse the fields.
    const value = values[0];
    return {
      value: value.split('!')[0].includes(',') ? value : decodeURIComponent(value),
      reason: null,
    };
  } catch {
    return { reason: 'malformed_encoding' };
  }
}

function readInput(input) {
  let value = input;
  if (typeof value === 'string') {
    if (value.length > MAX_INPUT_LENGTH)
      return { kind: 'unknown', reason: 'input_limit', copies: [] };
    value = value.trim();
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        value = JSON.parse(value);
      } catch {
        return { kind: 'structured', reason: 'invalid_json', copies: [] };
      }
    } else {
      const query =
        value.startsWith('?') || value.startsWith('schain=') || /^[a-z][a-z\d+.-]*:/i.test(value);
      const kind = query ? 'query' : 'serialized';
      const raw = query ? queryValue(value) : { value, reason: null };
      if (raw.reason) return { kind, reason: raw.reason, copies: [] };
      const parsed = parseSerialized(raw.value);
      return {
        kind,
        reason: parsed.reason,
        copies: parsed.chain
          ? [{ path: query ? 'query.schain' : 'serialized', chain: parsed.chain }]
          : [],
      };
    }
  }
  if (!isObject(value)) return { kind: 'unknown', reason: 'unsupported_input', copies: [] };
  try {
    if (JSON.stringify(value).length > MAX_INPUT_LENGTH)
      return { kind: 'structured', reason: 'input_limit', copies: [] };
    // Detach the result from the caller; mutation of inspection output must
    // never mutate the analyzed request or subsequent calls.
    value = JSON.parse(JSON.stringify(value));
  } catch {
    return { kind: 'structured', reason: 'unsupported_input', copies: [] };
  }
  let copies;
  if (['ver', 'complete', 'nodes'].some((key) => Object.hasOwn(value, key)))
    copies = [{ path: '$', chain: value }];
  else if (isObject(value.openrtb) && isObject(value.openrtb.request))
    copies = collectCopies(value.openrtb.request, 'openrtb.request.');
  else copies = collectCopies(value);
  return { kind: 'structured', reason: copies.length ? null : 'no_schain', copies };
}

/**
 * Inspect only supplied chain data; URLs are parsed and never requested.
 * @param {unknown} input
 * @param {{locale?:string,declaredSender?:unknown}} [options]
 */
function inspectSchain(input, { locale = 'en', declaredSender } = {}) {
  const parsed = readInput(input);
  const inspected = inspectCopies(parsed.copies, declaredSender, {
    serializedNodeExt: parsed.kind === 'serialized' || parsed.kind === 'query',
  });
  if (
    parsed.reason &&
    !['no_schain', 'no_schain_parameter', 'unsupported_input'].includes(parsed.reason)
  ) {
    inspected.findings.push(
      F('schain.input_invalid', LEVELS.ERROR, parsed.kind === 'query' ? 'query.schain' : '', {
        reason: parsed.reason,
      }),
    );
  }
  const findings = sortFindings(inspected.findings).map((finding) => ({
    ...finding,
    specRef: specRefs[finding.id] || null,
    msg: resolve(finding.id, finding.params, locale),
  }));
  const status = findings.some((f) => f.level === LEVELS.ERROR)
    ? 'invalid'
    : findings.some((f) => f.level === LEVELS.WARNING)
      ? 'warning'
      : parsed.copies.length
        ? 'valid'
        : 'unknown';
  return {
    schemaVersion: 1,
    kind: parsed.kind,
    status,
    reason: parsed.reason,
    copies: parsed.copies.map((copy) => ({
      ...copy,
      nodeCount: Array.isArray(copy.chain && copy.chain.nodes) ? copy.chain.nodes.length : 0,
      valid: inspected.validPaths.includes(copy.path),
    })),
    findings,
    comparison: inspected.comparison,
    sources: SOURCES.map((source) => ({ ...source })),
  };
}

module.exports = { inspectSchain, listInspectionProfiles, evaluateDeclaredRoute, MAX_INPUT_LENGTH };
