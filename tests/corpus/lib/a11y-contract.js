'use strict';

const { deviationVerdict } = require('./report');

// Shared by the browser writer and the report reader. A missing scenario is
// missing execution, even when the remaining scenarios and findings are empty.
const A11Y_SCENARIOS = Object.freeze([
  'viewport-1440x900',
  'viewport-1100x800',
  'viewport-768x1024',
  'viewport-390x844',
  'contrast-light',
  'contrast-dark',
  'names-desktop',
  'names-mobile',
  'keyboard',
  'state-empty',
  'state-unsupported',
  'state-request-only',
  'state-response-only',
  'state-partial',
  'state-warning',
  'state-error',
  'state-large-json',
  'zoom-dsf2',
  'zoom-css150',
]);

const STATUSES = ['pass', 'known-gap', 'fail', 'skip'];
/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const labelValue = (value) => (typeof value === 'string' ? value : `<${typeof value}>`);

/** Validate both the evidence shape and the completeness of the recorded audit.
 * Unexpected input produces problems and normalized arrays, never a shape error.
 * @param {unknown} value
 */
function validateA11yReport(value) {
  const problems = [];
  const scenarios = [];
  const findings = [];
  const seen = new Set();
  const byId = new Map();
  const report = isObject(value) ? value : {};
  if (!isObject(value)) problems.push('report must be an object');
  if (report.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!Array.isArray(report.scenarios)) problems.push('scenarios must be an array');
  if (!Array.isArray(report.findings)) problems.push('findings must be an array');

  for (const [index, row] of (Array.isArray(report.scenarios) ? report.scenarios : []).entries()) {
    const label = `scenario[${index}]`;
    if (!isObject(row)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    if (!A11Y_SCENARIOS.includes(row.id)) {
      problems.push(`${label}: unknown id ${labelValue(row.id)}`);
      continue;
    }
    if (seen.has(row.id)) problems.push(`duplicate scenario ${row.id}`);
    seen.add(row.id);
    if (!STATUSES.includes(row.status)) {
      problems.push(`${row.id}: unknown status ${labelValue(row.status)}`);
      continue;
    }
    if (!Array.isArray(row.failures) || row.failures.some((failure) => !nonempty(failure))) {
      problems.push(`${row.id}: failures must be an array of nonempty strings`);
      continue;
    }
    const normalized = {
      ...row,
      id: row.id,
      status: row.status,
      failures: [...row.failures],
      gap: row.gap ?? null,
    };
    scenarios.push(normalized);
    byId.set(row.id, normalized);
    if (row.status === 'pass') {
      if (row.failures.length) problems.push(`${row.id}: pass cannot contain failures`);
      if (row.gap != null) problems.push(`${row.id}: pass cannot declare a gap`);
    } else if (row.status === 'known-gap') {
      const gap = row.gap;
      if (!isObject(gap) || !nonempty(gap.id)) {
        problems.push(`${row.id}: known-gap requires a gap with a nonempty id`);
        continue;
      }
      if (!Array.isArray(gap.matches) || !gap.matches.length) {
        problems.push(`${row.id}: known-gap requires nonempty anchored matches`);
        continue;
      }
      let signaturesValid = true;
      for (const pattern of gap.matches) {
        if (!nonempty(pattern) || !pattern.startsWith('^') || !pattern.endsWith('$')) {
          problems.push(`${row.id}: gap matches must be anchored regex strings`);
          signaturesValid = false;
          continue;
        }
        try {
          new RegExp(pattern);
        } catch {
          problems.push(`${row.id}: invalid gap regex ${pattern}`);
          signaturesValid = false;
        }
      }
      if (signaturesValid) {
        const verdict = deviationVerdict(row.failures, { id: gap.id, matches: gap.matches });
        if (!verdict.stillPresent) problems.push(`${row.id}: ${verdict.reason}`);
      }
    } else {
      problems.push(`${row.id}: ${row.status} — required scenario not completed`);
    }
  }
  for (const id of A11Y_SCENARIOS) if (!seen.has(id)) problems.push(`missing scenario ${id}`);

  for (const [index, finding] of (Array.isArray(report.findings)
    ? report.findings
    : []
  ).entries()) {
    const label = `finding[${index}]`;
    if (!isObject(finding)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    let valid = true;
    if (!A11Y_SCENARIOS.includes(finding.scenarioId)) {
      problems.push(`${label}: unknown scenarioId ${labelValue(finding.scenarioId)}`);
      valid = false;
    }
    if (!['observation', 'deviation'].includes(finding.kind)) {
      problems.push(`${label}: kind must be observation or deviation`);
      valid = false;
    }
    for (const field of ['area', 'severity', 'repro', 'expected', 'actual']) {
      if (!nonempty(finding[field])) {
        problems.push(`${label}: ${field} must be a nonempty string`);
        valid = false;
      }
    }
    if (finding.screenshot != null && !nonempty(finding.screenshot)) {
      problems.push(`${label}: screenshot must be a nonempty string or null`);
      valid = false;
    }
    if (!valid) continue;
    findings.push({
      ...finding,
      scenarioId: finding.scenarioId,
      kind: finding.kind,
      severity: finding.severity,
      screenshot: finding.screenshot ?? null,
    });
    if (
      finding.kind === 'deviation' &&
      !['known-gap', 'fail'].includes(byId.get(finding.scenarioId)?.status)
    )
      problems.push(`${label}: deviation requires a known-gap or fail scenario`);
  }

  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const scenario of scenarios) byStatus[scenario.status]++;
  const byKind = { observation: 0, deviation: 0 };
  const severityCounts = new Map();
  for (const finding of findings) {
    byKind[finding.kind]++;
    severityCounts.set(finding.severity, (severityCounts.get(finding.severity) || 0) + 1);
  }
  return {
    valid: problems.length === 0,
    problems,
    scenarios,
    findings,
    productConformant:
      problems.length === 0 && scenarios.every((row) => row.status === 'pass') && !byKind.deviation,
    summary: {
      scenarios: scenarios.length,
      findings: findings.length,
      byStatus,
      byKind,
      bySeverity: Object.fromEntries(severityCounts),
      missing: A11Y_SCENARIOS.filter((id) => !seen.has(id)).length,
    },
  };
}

module.exports = { A11Y_SCENARIOS, validateA11yReport };
