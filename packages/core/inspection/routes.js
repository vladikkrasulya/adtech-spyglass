'use strict';

const catalog = require('./profiles.json');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Only declared profile paths are walked. Bound the total work across all
// statements/carrier aliases and the nesting of each walk, including direct
// Core inputs with cycles, without scanning unrelated payload extensions.
const MAX_ROUTE_VISITS = 10000;
const MAX_ROUTE_DEPTH = 32;

function publicProfile(profile, locale) {
  return {
    adapterId: profile.adapterId,
    direction: 'request',
    revision: catalog.revision,
    provenance: 'pinned-source',
    sources: profile.sources.map((source) => ({ ...source })),
    statements: profile.statements.map((statement) => ({
      id: statement.id,
      field: statement.field,
      disposition: statement.disposition,
      detail: statement.detail[locale] || statement.detail.en,
      sourceRef: statement.sourceRef,
    })),
  };
}

function listInspectionProfiles({ locale = 'en' } = {}) {
  return catalog.profiles.map((profile) => publicProfile(profile, locale));
}

function typedRoute(route) {
  if (
    !isObject(route) ||
    Object.keys(route).some(
      (key) => !['adapterId', 'direction', 'revision', 'provenance'].includes(key),
    )
  )
    return false;
  return (
    route.provenance === 'declared' &&
    [
      ['adapterId', 64],
      ['direction', 64],
      ['revision', 128],
    ].every(
      ([key, limit]) =>
        typeof route[key] === 'string' &&
        route[key].length > 0 &&
        route[key].length <= Number(limit),
    )
  );
}

function present(value, parts, budget) {
  const pending = [{ value, at: 0, depth: 0 }];
  while (pending.length) {
    if (--budget.remaining < 0) throw new Error('route traversal limit');
    const current = pending.pop();
    if (current.at === parts.length) {
      if (current.value !== undefined && current.value !== null) return true;
      continue;
    }
    if (current.depth >= MAX_ROUTE_DEPTH) throw new Error('route traversal depth');
    if (Array.isArray(current.value)) {
      if (current.value.length > budget.remaining - pending.length)
        throw new Error('route traversal limit');
      for (let i = current.value.length - 1; i >= 0; i--)
        pending.push({ value: current.value[i], at: current.at, depth: current.depth + 1 });
    } else if (isObject(current.value) && Object.hasOwn(current.value, parts[current.at])) {
      pending.push({
        value: current.value[parts[current.at]],
        at: current.at + 1,
        depth: current.depth + 1,
      });
    }
  }
  return false;
}

function evaluateDeclaredRoute(input, declaredRoute, { locale = 'en' } = {}) {
  const result = {
    status: 'unknown',
    reason: 'missing_context',
    provenance: declaredRoute == null ? 'none' : 'declared',
    declaredRoute: null,
    profile: null,
    statements: [],
  };
  if (declaredRoute == null) return result;
  if (!typedRoute(declaredRoute)) return { ...result, reason: 'invalid_context' };
  result.declaredRoute = { ...declaredRoute };
  const profile = catalog.profiles.find((item) => item.adapterId === declaredRoute.adapterId);
  if (!profile) return { ...result, reason: 'unsupported_adapter' };
  if (declaredRoute.direction !== 'request') return { ...result, reason: 'unsupported_direction' };
  if (declaredRoute.revision !== catalog.revision)
    return { ...result, reason: 'revision_mismatch' };
  // These pinned adapters accept the OpenRTB 2.x MakeRequests contract.
  // A declared profile does not manufacture an auction from arbitrary data.
  if (
    !isObject(input) ||
    !Array.isArray(input.imp) ||
    !input.imp.length ||
    input.imp.length > MAX_ROUTE_VISITS ||
    !input.imp.every(isObject) ||
    input.openrtb
  )
    return { ...result, reason: 'incompatible_input' };
  const metadata = publicProfile(profile, locale);
  const budget = { remaining: MAX_ROUTE_VISITS - input.imp.length };
  try {
    const statements = metadata.statements.map((statement, index) => {
      const context = profile.statements[index].context;
      const parts = statement.field.replace(/\[\]/g, '').split('.');
      let supplied = present(input, parts, budget);
      // Adapter params have three documented Prebid carriers. The typed caller
      // selects the adapter; parameter names alone never select a profile.
      if (!supplied && parts.slice(0, 3).join('.') === 'imp.ext.bidder') {
        const tail = parts.slice(3);
        supplied =
          present(input, ['imp', 'ext', declaredRoute.adapterId, ...tail], budget) ||
          present(
            input,
            ['imp', 'ext', 'prebid', 'bidder', declaredRoute.adapterId, ...tail],
            budget,
          );
      }
      return {
        ...statement,
        applicability:
          context && !isObject(input[context]) ? 'absent' : supplied ? 'present' : 'absent',
      };
    });
    return { ...result, status: 'known', reason: null, profile: metadata, statements };
  } catch {
    return { ...result, reason: 'incompatible_input' };
  }
}

module.exports = { listInspectionProfiles, evaluateDeclaredRoute };
