'use strict';

/**
 * Specimen replay — runs the full validation pipeline (validate +
 * crosscheck + behavior) over an array of samples and returns per-sample
 * results plus an aggregate summary. Foundation for the Stream Pivot:
 * any external pipeline that wants to bulk-grade RTB samples gets a
 * single-call endpoint instead of stitching `analyze` + `analyze-behavior`
 * round-trips.
 *
 * Each sample is a slim envelope:
 *   {
 *     bidReq?: object,            // oRTB BidRequest
 *     bidRes?: object,            // oRTB BidResponse
 *     behaviorEvents?: object[],  // creative-probe.js event stream
 *     adm?: string,               // creative for static-only behavior scan
 *     label?: string              // optional freeform tag (echoed back)
 *   }
 *
 * At least one of bidReq / bidRes / behaviorEvents must be present.
 *
 * Per-sample result mirrors `/api/analyze` + `/api/analyze-behavior` shape:
 *   {
 *     index, label,
 *     status,                     // worst across validate+crosscheck+behavior
 *     validation: { type, version, status, findings: [...] } | null,
 *     crosscheck: [...] | null,
 *     behavior:   { findings, status, eventCount } | null,
 *     errorCount, warningCount, infoCount, critCount,
 *     reason?: 'empty_sample' | 'invalid_shape'
 *   }
 *
 * Aggregate summary tallies status histogram, per-finding-id frequency
 * (top-K returned), and total error/warning counts.
 */

const REASON_EMPTY = 'empty_sample';
const REASON_INVALID = 'invalid_shape';

const SEVERITY_RANK = { invalid: 4, errors: 3, warnings: 2, clean: 1, ok: 0 };

function rollupSampleStatus(parts) {
  let worst = 'clean';
  let worstRank = SEVERITY_RANK.clean;
  for (const p of parts) {
    if (!p || !p.status) continue;
    const r = SEVERITY_RANK[p.status] != null ? SEVERITY_RANK[p.status] : 0;
    if (r > worstRank) {
      worstRank = r;
      worst = p.status;
    }
  }
  return worst;
}

/**
 * @param {Array<object>} samples
 * @param {{
 *   validate: (payload, opts?) => any,
 *   crosscheck: (req, res, opts?) => any[],
 *   analyzeBehavior: (events, opts?) => { findings, status, eventCount },
 *   locale?: string,
 *   dialect?: string,
 *   topK?: number,
 *   maxSamples?: number
 * }} deps
 * @returns {{
 *   results: object[],
 *   summary: {
 *     total: number, accepted: number, skipped: number,
 *     statusCounts: Record<string, number>,
 *     totalFindings: { errors: number, warnings: number, info: number, crits: number },
 *     topFindings: Array<{ id: number, count: number }>,
 *     locale: string, dialect: string
 *   }
 * }}
 */
function replay(samples, deps) {
  const { validate, crosscheck, analyzeBehavior } = deps;
  const locale = deps.locale || 'en';
  const dialect = deps.dialect || 'iab';
  const topK = Math.min(Math.max(Number(deps.topK) || 10, 1), 50);
  const maxSamples = Math.min(Math.max(Number(deps.maxSamples) || 100, 1), 1000);

  if (!Array.isArray(samples)) {
    throw new Error('samples_must_be_array');
  }
  const trimmed = samples.slice(0, maxSamples);

  const findingTally = new Map();
  const statusCounts = { invalid: 0, errors: 0, warnings: 0, clean: 0, skipped: 0 };
  const totalFindings = { errors: 0, warnings: 0, info: 0, crits: 0 };
  let accepted = 0;
  let skipped = 0;

  const results = trimmed.map((s, index) => {
    if (!s || typeof s !== 'object') {
      skipped++;
      statusCounts.skipped++;
      return { index, label: null, status: 'skipped', reason: REASON_INVALID };
    }
    const hasReq = s.bidReq && typeof s.bidReq === 'object';
    const hasRes = s.bidRes && typeof s.bidRes === 'object';
    const hasEvents = Array.isArray(s.behaviorEvents) && s.behaviorEvents.length > 0;
    if (!hasReq && !hasRes && !hasEvents) {
      skipped++;
      statusCounts.skipped++;
      return { index, label: s.label || null, status: 'skipped', reason: REASON_EMPTY };
    }

    let validation = null;
    let crossFindings = null;
    let behavior = null;

    if (hasReq) {
      validation = validate(s.bidReq, { locale, dialect });
    }
    if (hasRes) {
      const resV = validate(s.bidRes, { locale, dialect });
      if (validation) {
        validation.findings = (validation.findings || []).concat(
          (resV.findings || []).map((f) => Object.assign({}, f, { side: 'response' })),
        );
      } else {
        validation = resV;
      }
    }
    if (hasReq && hasRes) {
      crossFindings = crosscheck(s.bidReq, s.bidRes, { locale, dialect });
    }
    if (hasEvents) {
      behavior = analyzeBehavior(s.behaviorEvents, {
        locale,
        adm: typeof s.adm === 'string' ? s.adm : '',
      });
    }

    // Per-sample severity counts and finding tally
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    let critCount = 0;
    const tallyOne = (id) => {
      findingTally.set(id, (findingTally.get(id) || 0) + 1);
    };
    if (validation && validation.findings) {
      for (const f of validation.findings) {
        if (!f || !f.id) continue;
        tallyOne(f.id);
        if (f.level === 'error') errorCount++;
        else if (f.level === 'warning') warningCount++;
        else if (f.level === 'info') infoCount++;
      }
    }
    if (crossFindings) {
      for (const f of crossFindings) {
        if (!f || !f.id) continue;
        tallyOne(f.id);
        if (f.level === 'crit') critCount++;
        else if (f.level === 'warn') warningCount++;
      }
    }
    if (behavior && behavior.findings) {
      for (const f of behavior.findings) {
        if (!f || !f.id) continue;
        tallyOne(f.id);
        if (f.level === 'error') errorCount++;
        else if (f.level === 'warning') warningCount++;
        else if (f.level === 'info') infoCount++;
      }
    }

    const status = rollupSampleStatus([
      validation,
      // crosscheck doesn't emit a top-level status; derive from CRIT count
      critCount > 0 ? { status: 'errors' } : null,
      behavior,
    ]);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    accepted++;
    totalFindings.errors += errorCount;
    totalFindings.warnings += warningCount;
    totalFindings.info += infoCount;
    totalFindings.crits += critCount;

    return {
      index,
      label: s.label || null,
      status,
      validation: validation
        ? {
            type: validation.type,
            version: validation.version,
            status: validation.status,
            findings: validation.findings || [],
          }
        : null,
      crosscheck: crossFindings,
      behavior: behavior
        ? {
            status: behavior.status,
            eventCount: behavior.eventCount,
            findings: behavior.findings || [],
          }
        : null,
      errorCount,
      warningCount,
      infoCount,
      critCount,
    };
  });

  // Top-K most frequent finding ids
  const topFindings = Array.from(findingTally.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, topK)
    .map(([id, count]) => ({ id, count }));

  return {
    results,
    summary: {
      total: trimmed.length,
      accepted,
      skipped,
      statusCounts,
      totalFindings,
      topFindings,
      locale,
      dialect,
    },
  };
}

module.exports = { replay };
