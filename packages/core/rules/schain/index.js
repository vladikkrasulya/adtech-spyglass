'use strict';

/**
 * Supply Chain (SChain) validation — IAB OpenRTB 2.6.
 *
 * The SupplyChain object travels in:
 *   - `source.schain`     (oRTB 2.6 native — promoted from ext)
 *   - `source.ext.schain` (oRTB 2.x legacy)
 *
 * Legacy BidRequest.ext.schain is also supported. Valid copies are compared
 * without treating object-key order as a difference; node order is meaningful.
 *
 * Spec reference: https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#3224-object-source
 * SChain spec: https://github.com/InteractiveAdvertisingBureau/SupplyChain/blob/main/Specification.md
 *
 * Rules:
 *   err-schain-invalid              — schain value present but not a plain object
 *   err-schain-version              — schain.ver missing or not "1.0"
 *   err-schain-complete             — schain.complete not 0 or 1
 *   err-schain-nodes-empty          — schain.nodes missing or empty array
 *   err-schain-node-invalid         — a node is not a plain object
 *   err-schain-node-asi             — node.asi missing or not a valid domain
 *   err-schain-node-sid             — node.sid missing or empty
 *   err-schain-node-hp              — node.hp not 0 or 1
 *   warn-schain-node-rid-missing    — optional metadata guidance (info)
 *   err-schain-node-rid-invalid     — node.rid present but not a non-empty string
 *   warn-schain-node-domain-missing — optional metadata guidance (info)
 *   err-schain-node-domain-invalid  — node.domain present but not a valid domain
 */

const { LEVELS, makeFinding } = require('../../findings');
const { isValidDomain } = require('../../utils/domain');

const F = makeFinding;
const MAX_NODES = 256;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateSchainObject(schain, basePath, findings, serializedNodeExt) {
  // Type guard: must be a plain object
  if (!isPlainObject(schain)) {
    findings.push(F('err-schain-invalid', LEVELS.ERROR, basePath, { type: typeof schain }));
    return;
  }

  // ver — must be string "1.0"
  if (typeof schain.ver !== 'string' || schain.ver !== '1.0') {
    findings.push(
      F('err-schain-version', LEVELS.ERROR, basePath + '.ver', { ver: String(schain.ver ?? '') }),
    );
  }

  // complete — must be 0 or 1
  if (schain.complete !== 0 && schain.complete !== 1) {
    findings.push(
      F('err-schain-complete', LEVELS.ERROR, basePath + '.complete', {
        val: String(schain.complete ?? ''),
      }),
    );
  }

  if (Object.hasOwn(schain, 'ext') && !isPlainObject(schain.ext)) {
    findings.push(F('schain.ext_invalid', LEVELS.ERROR, basePath + '.ext'));
  }

  // nodes — must be array with >=1 entry
  if (!Array.isArray(schain.nodes) || schain.nodes.length === 0) {
    findings.push(F('err-schain-nodes-empty', LEVELS.ERROR, basePath + '.nodes'));
    return; // can't walk nodes
  }
  if (schain.nodes.length > MAX_NODES) {
    findings.push(F('schain.nodes_limit', LEVELS.ERROR, basePath + '.nodes', { limit: MAX_NODES }));
    return;
  }

  // Walk each node
  schain.nodes.forEach((node, i) => {
    const np = `${basePath}.nodes[${i}]`;

    // Type guard: node must be a plain object
    if (!isPlainObject(node)) {
      findings.push(F('err-schain-node-invalid', LEVELS.ERROR, np, { idx: i, type: typeof node }));
      return; // can't validate fields on non-object
    }

    // asi — required, non-empty, valid domain
    if (!isValidDomain(node.asi)) {
      findings.push(
        F('err-schain-node-asi', LEVELS.ERROR, np + '.asi', {
          idx: i,
          val: String(node.asi ?? ''),
        }),
      );
    }

    // sid — required, non-empty string
    if (typeof node.sid !== 'string' || node.sid.length === 0) {
      findings.push(F('err-schain-node-sid', LEVELS.ERROR, np + '.sid', { idx: i }));
    }

    // hp — must be 0 or 1
    if (node.hp !== 0 && node.hp !== 1) {
      findings.push(
        F('err-schain-node-hp', LEVELS.ERROR, np + '.hp', { idx: i, val: String(node.hp ?? '') }),
      );
    }

    if (Object.hasOwn(node, 'name') && typeof node.name !== 'string') {
      findings.push(F('schain.node.name_invalid', LEVELS.ERROR, np + '.name', { idx: i }));
    }
    // IAB leaves serialized node ext encoding exchange-specific. Only the
    // isolated serialization parser can admit that opaque field; structured
    // objects (including ordinary validation) still require an object ext.
    if (Object.hasOwn(node, 'ext') && !serializedNodeExt && !isPlainObject(node.ext)) {
      findings.push(F('schain.node.ext_invalid', LEVELS.ERROR, np + '.ext', { idx: i }));
    }

    // Legacy IDs remain readable, but optional omissions do not lower status.
    if (node.rid == null) {
      findings.push(F('warn-schain-node-rid-missing', LEVELS.INFO, np + '.rid', { idx: i }));
    } else if (typeof node.rid !== 'string' || node.rid.length === 0) {
      findings.push(
        F('err-schain-node-rid-invalid', LEVELS.ERROR, np + '.rid', {
          idx: i,
          val: String(node.rid),
        }),
      );
    }

    // The seller's business domain need not be the inventory domain or bundle.
    if (node.domain == null) {
      findings.push(F('warn-schain-node-domain-missing', LEVELS.INFO, np + '.domain', { idx: i }));
    } else if (!isValidDomain(node.domain)) {
      findings.push(
        F('err-schain-node-domain-invalid', LEVELS.ERROR, np + '.domain', {
          idx: i,
          val: String(node.domain),
        }),
      );
    }
  });
}

function collectCopies(req, prefix = '') {
  if (!isPlainObject(req)) return [];
  const candidates = [
    [req.source, 'schain', 'source.schain'],
    [req.source && req.source.ext, 'schain', 'source.ext.schain'],
    [req.ext, 'schain', 'ext.schain'],
  ];
  return candidates
    .filter(([parent, key]) => isPlainObject(parent) && Object.hasOwn(parent, key))
    .map(([parent, key, path]) => ({ path: prefix + path, chain: parent[key] }));
}

function validDeclaredSender(sender) {
  return (
    isPlainObject(sender) &&
    Object.keys(sender).every((key) => ['asi', 'sid', 'provenance'].includes(key)) &&
    sender.provenance === 'declared' &&
    isValidDomain(sender.asi) &&
    sender.asi.length <= 253 &&
    typeof sender.sid === 'string' &&
    sender.sid.length > 0 &&
    sender.sid.length <= 256
  );
}

// JSON key order is immaterial, while ordered arrays and seller-account case
// retain their wire meaning. The depth guard also makes malformed extensions
// in direct Core calls fail safely instead of recursing indefinitely.
function semanticValue(value, depth = 0) {
  if (depth > 32) throw new Error('schain comparison depth');
  if (Array.isArray(value)) return value.map((v) => semanticValue(v, depth + 1));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, semanticValue(value[k], depth + 1)]),
  );
}

function inspectCopies(copies, declaredSender, { serializedNodeExt = false } = {}) {
  const findings = [];
  const valid = [];
  const comparison = {
    status: 'unknown',
    provenance: declaredSender == null ? 'none' : 'declared',
    reason: declaredSender == null ? 'missing_sender' : 'invalid_sender',
    declaredSender: null,
    copies: [],
  };
  const senderOK = validDeclaredSender(declaredSender);
  if (senderOK) {
    comparison.declaredSender = {
      asi: declaredSender.asi,
      sid: declaredSender.sid,
      provenance: 'declared',
    };
    comparison.reason = 'no_valid_chain';
  }
  for (const copy of copies) {
    const own = [];
    validateSchainObject(copy.chain, copy.path, own, serializedNodeExt);
    findings.push(...own);
    if (own.some((finding) => finding.level === LEVELS.ERROR)) continue;
    let signature;
    try {
      signature = JSON.stringify(
        semanticValue({
          ...copy.chain,
          nodes: copy.chain.nodes.map((node) => ({
            ...node,
            asi: node.asi.toLowerCase(),
            ...(typeof node.domain === 'string' ? { domain: node.domain.toLowerCase() } : {}),
          })),
        }),
      );
    } catch {
      findings.push(F('schain.comparison_limit', LEVELS.ERROR, copy.path));
      continue;
    }
    valid.push({ ...copy, signature });
    const seen = new Map();
    copy.chain.nodes.forEach((node, idx) => {
      const identity = JSON.stringify([node.asi.toLowerCase(), node.sid]);
      if (seen.has(identity)) {
        findings.push(
          F('schain.duplicate_identity', LEVELS.WARNING, `${copy.path}.nodes[${idx}]`, {
            first: seen.get(identity),
            idx,
            asi: node.asi,
            sid: node.sid,
          }),
        );
      } else seen.set(identity, idx);
    });
    if (senderOK) {
      const idx = copy.chain.nodes.length - 1;
      const node = copy.chain.nodes[idx];
      const status =
        node.asi.toLowerCase() === declaredSender.asi.toLowerCase() &&
        node.sid === declaredSender.sid
          ? 'match'
          : 'mismatch';
      comparison.copies.push({ path: copy.path, status });
      if (status === 'mismatch')
        findings.push(
          F('schain.declared_sender_mismatch', LEVELS.WARNING, `${copy.path}.nodes[${idx}]`, {
            asi: declaredSender.asi,
            sid: declaredSender.sid,
          }),
        );
    }
  }
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].signature !== valid[0].signature)
      findings.push(
        F('schain.copy_conflict', LEVELS.WARNING, valid[i].path, { otherPath: valid[0].path }),
      );
  }
  if (comparison.copies.length) {
    comparison.status = comparison.copies.some((copy) => copy.status === 'mismatch')
      ? 'mismatch'
      : 'match';
    comparison.reason = null;
  }
  return { findings, comparison, validPaths: valid.map((copy) => copy.path) };
}

function validate(req, ctx = {}) {
  return inspectCopies(collectCopies(req), ctx.declaredSender).findings;
}

module.exports = {
  id: 'schain',
  description:
    'Validates IAB SupplyChain structure, repeated seller identities, conflicting copies and explicitly declared sender context at current and legacy locations.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
  collectCopies,
  inspectCopies,
  validDeclaredSender,
  MAX_NODES,
  // Expose for tests (back-compat)
  _isValidDomain: isValidDomain,
};
