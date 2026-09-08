#!/usr/bin/env node
'use strict';

/**
 * scripts/corpus-axes.js — pairwise coverage axes for the verification corpus.
 *
 * The full cross-product format × protocol × context × dialect × scenario ×
 * preview state has thousands of cells. Applicability is bounded by the
 * referenced specifications and vendor contracts; preview restrictions come
 * from the product contract. This module keeps the
 * pairwise projections that matter and marks every cell as one of:
 *
 *   covered        at least one base pair or mutation occupies the cell
 *   unverified     the combination is applicable but no case exercises it
 *   unsupported    the product contract or a recorded capability gap rules the
 *                  combination out; cite the reason, do not count it as coverage
 *   n/a            no applicable form in the referenced specifications/contracts
 *
 * Applicability comes from the IAB specifications and the product contracts
 * (specs/012 creative preview, specs/014 push preview, the frontend contract),
 * never from what the corpus happens to contain. Critical links — format ×
 * protocol × context for OpenRTB formats, and format × preview state — are
 * also listed exhaustively for the applicable triples.
 */

const { FORMATS, PROTOCOLS, CONTEXTS, DIALECTS, SCENARIOS } = require('../tests/corpus/lib/schema');

const OPENRTB = ['banner', 'video', 'audio', 'native'];
const FEEDS = ['push', 'pop', 'inpage'];
const OPENRTB_PROTOCOLS = ['ortb-2.5', 'ortb-2.6', 'ortb-3.0'];
const LAYERS = ['core', 'http', 'browser'];

// tests/corpus/assets/sources.json records both vendor references:
// EXADS RTB request, "Banner: JSON" and "Banner: URL" (accessed 2026-09-07):
// https://docs.exads.com/docs/rtb-publishers/exads-rtb/bid-request/exads-rtb-publishers-request/
// Kadam Feed Integration, supported ad types and Native request/response examples:
// https://wiki.kadam.net/en/index.php?title=OpenRTB/Feed_Integration_SSP&oldid=7231
const DOCUMENTED_FEED_FORMATS = [...FEEDS, 'banner', 'native'];

/**
 * @typedef {{status: 'applicable'|'unsupported'|'n/a', reason?: string}} Applicability
 */

/** @type {(format: string, protocol: string) => Applicability} */
function protocolApplies(format, protocol) {
  if (protocol === 'ortb-2.5' || protocol === 'ortb-2.6') return { status: 'applicable' };
  if (protocol === 'ortb-3.0') {
    return OPENRTB.includes(format)
      ? { status: 'applicable' }
      : { status: 'n/a', reason: 'no documented OpenRTB 3.0 form for this vendor format' };
  }
  if (protocol === 'jsonfeed') {
    return DOCUMENTED_FEED_FORMATS.includes(format)
      ? { status: 'applicable' }
      : { status: 'n/a', reason: 'no JSON-feed form in the referenced contracts' };
  }
  if (protocol === 'url-request') {
    return DOCUMENTED_FEED_FORMATS.includes(format)
      ? { status: 'applicable' }
      : { status: 'n/a', reason: 'no URL-request form in the referenced contracts' };
  }
  return { status: 'n/a' };
}

/** @type {(format: string, context: string) => Applicability} */
function contextApplies(format, context) {
  if (context === 'web') return { status: 'applicable' };
  if (context === 'n/a') {
    // OpenRTB 2.6 §3.1 and §3.2.1 make context objects recommended, not required.
    // Response-only input also need not identify the runtime context.
    return { status: 'applicable', reason: 'runtime context is absent or unspecified' };
  }
  if (context === 'inapp') return { status: 'applicable' };
  // Native is an Imp type independently of device/context: OpenRTB 2.6
  // §§3.1, 3.2.1, 3.2.9, 3.2.32 (source revision in assets/sources.json):
  // https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidrequest
  // AdCOM Device Types includes Connected TV; neither contract restricts it
  // to banner/video/audio. DOOH excludes simultaneous Site/App, not Native.
  // https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md#list_devicetypes
  if (context === 'ctv') {
    return OPENRTB.includes(format)
      ? { status: 'applicable' }
      : { status: 'n/a', reason: 'no CTV form in the referenced vendor contracts' };
  }
  if (context === 'dooh') {
    return OPENRTB.includes(format)
      ? { status: 'applicable' }
      : { status: 'n/a', reason: 'no DOOH form in the referenced vendor contracts' };
  }
  return { status: 'n/a' };
}

/** @type {(format: string, dialect: string) => Applicability} */
function dialectApplies(format, dialect) {
  if (dialect === 'iab') {
    return FEEDS.includes(format)
      ? {
          status: 'applicable',
          reason: 'vendor formats analyzed with the baseline dialect show the contract difference',
        }
      : { status: 'applicable' };
  }
  if (dialect === 'ext-rtb') return { status: 'applicable' };
  if (dialect === 'inpage-push') {
    return format === 'inpage'
      ? { status: 'applicable' }
      : { status: 'n/a', reason: 'the inpage-push dialect only claims in-page card bids' };
  }
  return { status: 'n/a' };
}

/** @type {(format: string, scenario: string) => Applicability} */
function scenarioApplies(_format, _scenario) {
  return { status: 'applicable' };
}

const PREVIEW_KINDS = ['markup', 'native', 'push', 'vast', 'json', 'url', 'unidentified', 'empty'];
const RENDERED = ['full', 'partial', 'inert-text', 'empty'];
const MEDIA = ['yes', 'no', 'n/a'];

/** @type {(format: string, kind: string) => Applicability} */
function previewKindApplies(format, kind) {
  const table = {
    banner: ['markup', 'empty', 'url', 'json', 'unidentified'],
    video: ['vast', 'markup', 'empty', 'unidentified'],
    audio: ['vast', 'empty', 'unidentified'],
    native: ['native', 'json', 'empty', 'unidentified'],
    push: ['push', 'native', 'empty', 'unidentified'],
    pop: ['url', 'markup', 'empty', 'unidentified'],
    inpage: ['native', 'push', 'empty', 'unidentified'],
  };
  if (table[format].includes(kind)) return { status: 'applicable' };
  return { status: 'n/a', reason: 'the format never produces this creative body kind' };
}

/** @type {(format: string, rendered: string) => Applicability} */
function renderedApplies(format, rendered) {
  if (rendered === 'inert-text') {
    return ['video', 'audio', 'pop', 'banner', 'native'].includes(format)
      ? { status: 'applicable' }
      : { status: 'n/a', reason: 'no inert-text body for this format' };
  }
  if (rendered === 'full' || rendered === 'partial') {
    if (format === 'video' || format === 'audio') {
      return {
        status: 'unsupported',
        reason: 'VAST/DAAST is shown as inert text by contract (specs/012); no player exists',
      };
    }
    return { status: 'applicable' };
  }
  if (rendered === 'empty') return { status: 'applicable' };
  return { status: 'n/a' };
}

/** @type {(format: string, media: string) => Applicability} */
function mediaApplies(format, media) {
  if (media === 'yes') {
    return {
      status: 'unsupported',
      reason: "the preview frame policy sets media-src 'none'; no media can play (contract)",
    };
  }
  if (media === 'no') {
    return ['video', 'audio', 'banner'].includes(format)
      ? { status: 'applicable', reason: 'a media element is present but blocked' }
      : { status: 'n/a', reason: 'the format carries no media element' };
  }
  return { status: 'applicable' };
}

/**
 * @typedef {{id: string, layer: string, outcome: string, reason?: string}} LayerResult
 * @typedef {{conformant: number, deviating: number, incomplete: number, notApplicable: number}} Conformance
 * @typedef {{status: string, reason?: string, cases: string[], conformance: Conformance|null}} AxisCell
 */

/**
 * @param {Array<{id: string, kind: string, meta: any}>} cases materialized corpus cases
 * @param {LayerResult[]} rows measured per-layer results
 */
function buildAxes(cases, rows = []) {
  const previewOf = (c) => (c.meta.expect && c.meta.expect.preview) || null;
  // FR-003, specs/020: no skipped or unasserted layer counts as pass. Each
  // case needs exactly one Core, HTTP and browser result. Explicit N/A needs
  // a reason and cannot by itself demonstrate any conformance.
  /** @type {Map<string, Map<string, LayerResult[]>>} */
  const outcomes = new Map();
  for (const r of rows) {
    if (!r || !r.id || !LAYERS.includes(r.layer)) continue;
    const byLayer = outcomes.get(r.id) || new Map();
    const layerRows = byLayer.get(r.layer) || [];
    layerRows.push(r);
    byLayer.set(r.layer, layerRows);
    outcomes.set(r.id, byLayer);
  }
  const conformanceOf = (ids) => {
    const c = { conformant: 0, deviating: 0, incomplete: 0, notApplicable: 0 };
    for (const id of ids) {
      const byLayer = outcomes.get(id);
      let incomplete = false;
      let deviating = false;
      let passed = 0;
      for (const layer of LAYERS) {
        const layerRows = byLayer?.get(layer) || [];
        if (layerRows.length !== 1) incomplete = true;
        for (const r of layerRows) {
          if (r.outcome === 'known-gap' || r.outcome === 'fail') deviating = true;
          else if (r.outcome === 'pass') passed++;
          else if (
            r.outcome !== 'not-applicable' ||
            typeof r.reason !== 'string' ||
            !r.reason.trim()
          )
            incomplete = true;
        }
      }
      // A measured deviation remains visible even when another layer is
      // missing. These two counts can overlap; neither is conformance.
      if (deviating) c.deviating++;
      if (incomplete) c.incomplete++;
      if (!incomplete && !deviating) {
        if (passed) c.conformant++;
        else c.notApplicable++;
      }
    }
    return c;
  };
  const axes = [
    {
      title: 'Format × protocol',
      key: 'protocol',
      cols: PROTOCOLS,
      applies: protocolApplies,
      value: (c) => c.meta.protocol,
    },
    {
      title: 'Format × context',
      key: 'context',
      cols: CONTEXTS,
      applies: contextApplies,
      value: (c) => c.meta.context,
    },
    {
      title: 'Format × dialect',
      key: 'dialect',
      cols: DIALECTS,
      applies: dialectApplies,
      value: (c) => c.meta.dialect,
    },
    {
      title: 'Format × scenario',
      key: 'scenario',
      cols: SCENARIOS,
      applies: scenarioApplies,
      value: (c) => c.meta.scenario,
    },
    {
      title: 'Format × preview kind (expected by contract)',
      key: 'kind',
      cols: PREVIEW_KINDS,
      applies: previewKindApplies,
      value: (c) => (previewOf(c) ? previewOf(c).kind : null),
    },
    {
      title: 'Format × rendered state',
      key: 'rendered',
      cols: RENDERED,
      applies: renderedApplies,
      value: (c) => (previewOf(c) ? previewOf(c).rendered : null),
    },
    {
      title: 'Format × media plays',
      key: 'mediaPlays',
      cols: MEDIA,
      applies: mediaApplies,
      value: (c) => (previewOf(c) ? previewOf(c).mediaPlays : null),
    },
  ];
  const summary = { covered: 0, unverified: 0, unsupported: 0, notApplicable: 0 };
  const tables = axes.map((axis) => {
    /** @type {Record<string, AxisCell>} */
    const cells = {};
    for (const format of FORMATS) {
      for (const col of axis.cols) {
        const app = axis.applies(format, col);
        const hits = cases
          .filter((c) => c.meta.format === format && axis.value(c) === col)
          .map((c) => c.id);
        /** @type {AxisCell['status']} */
        let status = app.status;
        if (status === 'applicable') status = hits.length ? 'covered' : 'unverified';
        if (status === 'covered') summary.covered++;
        else if (status === 'unverified') summary.unverified++;
        else if (status === 'unsupported') summary.unsupported++;
        else summary.notApplicable++;
        cells[`${format}|${col}`] = {
          status,
          reason: app.reason,
          cases: hits,
          conformance: hits.length ? conformanceOf(hits) : null,
        };
      }
    }
    return { title: axis.title, rows: FORMATS, cols: axis.cols, cells };
  });
  const triples = [];
  for (const format of OPENRTB) {
    for (const protocol of OPENRTB_PROTOCOLS) {
      for (const context of CONTEXTS) {
        if (contextApplies(format, context).status !== 'applicable') continue;
        triples.push({
          format,
          protocol,
          context,
          cases: cases
            .filter(
              (c) =>
                c.meta.format === format &&
                c.meta.protocol === protocol &&
                c.meta.context === context,
            )
            .map((c) => c.id),
        });
      }
    }
  }
  return { tables, triples, summary, measured: outcomes.size > 0 };
}

/**
 * @param {ReturnType<typeof buildAxes>} axes
 * @returns {string}
 */
function markdown(axes) {
  const mark = (cell) => {
    if (cell.status === 'covered') {
      const c = cell.conformance;
      if (axes.measured && c) {
        return `✓ ${cell.cases.length} (${c.conformant} ok / ${c.deviating} deviating / ${c.incomplete} incomplete / ${c.notApplicable} all N/A)`;
      }
      return `✓ ${cell.cases.length}`;
    }
    if (cell.status === 'unverified') return '? unverified';
    if (cell.status === 'unsupported') return '✗ unsupported';
    return '— n/a';
  };
  const lines = [
    '# Coverage axes (pairwise)',
    '',
    'Legend: `✓ n` covered by n cases (presence of cases, not conformance) · `? unverified` applicable but no case · `✗ unsupported` ruled out by a product contract (reason listed below the table) · `— n/a` no applicable form in the referenced specifications or vendor contracts. Context `n/a` means absent or unspecified runtime context.',
    '',
    axes.measured
      ? 'Measured results follow each case count: `ok` requires exactly one Core, HTTP and browser result, every applicable layer passed, and at least one pass; other layers must explicitly report not-applicable with a reason. `deviating` means at least one measured known-gap or failure. `incomplete` means missing, skipped, duplicate or invalid layer results; a deviating case can also be incomplete. `all N/A` means all three layers explicitly reported not-applicable with reasons, so no conformance was measured. A covered cell alone does not claim product conformance.'
      : 'This view was built from case metadata alone: it records which combinations have cases, not whether the product conforms. Run the dedicated audit for the measured view.',
    '',
    `Cells: ${axes.summary.covered} covered, ${axes.summary.unverified} unverified, ${axes.summary.unsupported} unsupported by contract, ${axes.summary.notApplicable} not applicable.`,
    '',
  ];
  for (const t of axes.tables) {
    lines.push(
      `## ${t.title}`,
      '',
      `| format | ${t.cols.join(' | ')} |`,
      `| --- | ${t.cols.map(() => '---').join(' | ')} |`,
    );
    for (const row of t.rows)
      lines.push(`| ${row} | ${t.cols.map((col) => mark(t.cells[`${row}|${col}`])).join(' | ')} |`);
    const reasons = new Map();
    for (const [key, cell] of Object.entries(t.cells)) {
      if (cell.status === 'unsupported' && cell.reason)
        reasons.set(cell.reason, [...(reasons.get(cell.reason) || []), key.replace('|', ' × ')]);
    }
    if (reasons.size) {
      lines.push('');
      for (const [reason, keys] of reasons)
        lines.push(`- unsupported (${keys.join(', ')}): ${reason}`);
    }
    lines.push('');
  }
  lines.push(
    '## Critical link: format × protocol × context (OpenRTB formats)',
    '',
    '| format | protocol | context | cases |',
    '| --- | --- | --- | --- |',
  );
  for (const t of axes.triples)
    lines.push(
      `| ${t.format} | ${t.protocol} | ${t.context} | ${t.cases.length ? t.cases.join(', ') : '? unverified'} |`,
    );
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  buildAxes,
  markdown,
  protocolApplies,
  contextApplies,
  dialectApplies,
  previewKindApplies,
  renderedApplies,
  mediaApplies,
};

if (require.main === module) {
  const { loadCorpus } = require('../tests/corpus/lib/load');
  process.stdout.write(markdown(buildAxes(loadCorpus().all)));
}
