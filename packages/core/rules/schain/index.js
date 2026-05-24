'use strict';

/**
 * Supply Chain (SChain) validation — IAB OpenRTB 2.6.
 *
 * The SupplyChain object travels in:
 *   - `source.schain`     (oRTB 2.6 native — promoted from ext)
 *   - `source.ext.schain` (oRTB 2.x legacy)
 *
 * Both paths are checked independently when present. If both are present,
 * both are validated and findings from each are included.
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
 *   warn-schain-node-rid-missing    — node.rid absent (recommended)
 *   err-schain-node-rid-invalid     — node.rid present but not a non-empty string
 *   warn-schain-node-domain-missing — node.domain absent (recommended)
 *   err-schain-node-domain-invalid  — node.domain present but not a valid domain
 */

const { LEVELS, makeFinding } = require('../../findings');
const { isValidDomain } = require('../../utils/domain');

const F = makeFinding;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateSchainObject(schain, basePath, findings) {
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

  // nodes — must be array with >=1 entry
  if (!Array.isArray(schain.nodes) || schain.nodes.length === 0) {
    findings.push(F('err-schain-nodes-empty', LEVELS.ERROR, basePath + '.nodes'));
    return; // can't walk nodes
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

    // rid — optional but recommended; if present must be a non-empty string
    if (node.rid == null) {
      findings.push(F('warn-schain-node-rid-missing', LEVELS.WARNING, np + '.rid', { idx: i }));
    } else if (typeof node.rid !== 'string' || node.rid.length === 0) {
      findings.push(
        F('err-schain-node-rid-invalid', LEVELS.ERROR, np + '.rid', {
          idx: i,
          val: String(node.rid),
        }),
      );
    }

    // domain — optional but recommended; if present must be a valid domain
    if (node.domain == null) {
      findings.push(
        F('warn-schain-node-domain-missing', LEVELS.WARNING, np + '.domain', { idx: i }),
      );
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

function validate(req /*, ctx */) {
  const findings = [];
  if (!req || typeof req !== 'object') return findings;

  // oRTB 2.6 native: source.schain
  if (req.source && req.source.schain != null) {
    validateSchainObject(req.source.schain, 'source.schain', findings);
  }

  // oRTB 2.x legacy: source.ext.schain
  if (req.source && req.source.ext && req.source.ext.schain != null) {
    validateSchainObject(req.source.ext.schain, 'source.ext.schain', findings);
  }

  return findings;
}

module.exports = {
  id: 'schain',
  description:
    'Validates IAB SupplyChain (SChain) object at source.schain (oRTB 2.6) and source.ext.schain (legacy 2.x): ver/complete/nodes + per-node asi/sid/hp/rid/domain.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
  // Expose for tests (back-compat)
  _isValidDomain: isValidDomain,
};
