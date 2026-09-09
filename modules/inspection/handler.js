'use strict';

const { readJson, sendJson, sendError, makeError } = require('../../lib/http');

const MAX_INSPECTION_BYTES = 256 * 1024;

function inspectionFailure(res) {
  return sendError(
    res,
    500,
    'inspection_failed',
    'Inspection could not complete. Try again shortly.',
  );
}

function invalidContext(name) {
  return makeError('invalid_input', `${name} must be a complete, explicitly declared context`);
}

function contextObject(value, name, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(fields, key)) ||
    Object.entries(fields).some(
      ([key, limit]) =>
        typeof value[key] !== 'string' ||
        !value[key].trim() ||
        value[key].length > limit ||
        Array.from(value[key]).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    ) ||
    value.provenance !== 'declared'
  ) {
    throw invalidContext(name);
  }
  return Object.fromEntries(Object.keys(fields).map((key) => [key, value[key]]));
}

// Shared by the human-paste endpoint and isolated SChain inspection. No payload
// field, endpoint or partner label can fill in a missing declaration.
function readDeclaredContext(body) {
  const out = {};
  if (body.declaredSender !== undefined) {
    out.declaredSender = contextObject(body.declaredSender, 'declaredSender', {
      asi: 253,
      sid: 256,
      provenance: 8,
    });
  }
  if (body.declaredRoute !== undefined) {
    out.declaredRoute = contextObject(body.declaredRoute, 'declaredRoute', {
      adapterId: 64,
      direction: 64,
      revision: 128,
      provenance: 8,
    });
  }
  return out;
}

/** A bounded, stateless facade over pure Core inspection. */
function createInspectionModule({
  auth,
  analyzeLimiter,
  readLimiter,
  inspectSchain,
  listInspectionProfiles,
}) {
  function profiles(req, res, parsed) {
    if (!readLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Too many inspection requests. Try again shortly.',
      );
    }
    const requestedLocale = parsed.searchParams.get('locale');
    const locale = ['en', 'uk', 'ru'].includes(requestedLocale) ? requestedLocale : 'en';
    try {
      return sendJson(res, 200, { success: true, profiles: listInspectionProfiles({ locale }) });
    } catch {
      return inspectionFailure(res);
    }
  }

  function schain(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!analyzeLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Too many inspection requests. Try again shortly.',
      );
    }
    return readJson(req, { maxBytes: MAX_INSPECTION_BYTES })
      .then((body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw makeError('invalid_input', 'Provide an inspection object with input');
        }
        const { input } = body;
        if (!(
          (typeof input === 'string' && input.trim() && input.length <= 200000) ||
          (input && typeof input === 'object' && !Array.isArray(input))
        )) {
          throw makeError('invalid_input', 'input must be a structured chain or bounded text');
        }
        const { declaredSender } = readDeclaredContext(body);
        const locale = ['en', 'uk', 'ru'].includes(body.locale) ? body.locale : 'en';
        // Core reports malformed chains as structured findings. An exception
        // here is an implementation failure, regardless of its error code.
        try {
          return sendJson(res, 200, {
            success: true,
            inspection: inspectSchain(input, { locale, declaredSender }),
          });
        } catch {
          return inspectionFailure(res);
        }
      })
      .catch((error) => {
        // Parsing errors may contain a pasted value. Return a fixed envelope;
        // neither the body nor exception is logged by this module.
        if (!['invalid_input', 'invalid_json', 'payload_too_large'].includes(error?.code))
          return inspectionFailure(res);
        const code = error.code === 'invalid_json' ? 'invalid_input' : error.code;
        return sendError(res, 400, code, 'Inspection input or declared context is invalid');
      });
  }

  return {
    id: 'inspection',
    routes: [
      { method: 'GET', path: '/api/inspection/profiles', handler: profiles },
      { method: 'POST', path: '/api/inspection/schain', handler: schain },
    ],
  };
}

module.exports = { createInspectionModule, readDeclaredContext, MAX_INSPECTION_BYTES };
