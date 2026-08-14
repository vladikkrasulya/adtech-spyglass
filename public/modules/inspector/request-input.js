/* ============================================================
   Inspector request-input boundary.

   The request pane accepts either an OpenRTB JSON value or a legacy
   HTTP(S) feed URL. Keep parsing and editor serialisation symmetrical:

     raw URL -> string -> raw URL
     JSON    -> value  -> pretty JSON

   In particular, do not JSON.stringify() a URL before putting it in
   History. That turns it into a quoted JSON scalar and makes a later
   History load look different from the request the user pasted.
   ============================================================ */
'use strict';

/**
 * Permissive: the text LOOKS like an http(s) URL, however mangled. This is the
 * routing test, and it is deliberately just a prefix match. People paste URLs
 * with spaces from wrapped log lines and truncated hosts from chat — those must
 * still travel to the server as URL-style requests so validate() can produce a
 * verdict about THEM, alongside the response-side findings. A strict
 * `new URL()` gate here once made a mangled URL throw as "not valid JSON",
 * which aborted the whole analysis and blamed the wrong format.
 */
export function isUrlLikeInput(text) {
  return typeof text === 'string' && /^https?:\/\//i.test(text.trim());
}

/** Strict: a well-formed absolute http(s) URL. Display-grade, used by the badge. */
export function isHttpUrlInput(text) {
  if (!isUrlLikeInput(text)) return false;
  try {
    const parsed = new URL(text.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
}

export function parseRequestInput(text) {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (jsonError) {
    const trimmed = text.trim();
    if (isUrlLikeInput(trimmed)) return trimmed;
    throw jsonError;
  }
}

export function serializeRequestInput(value) {
  // Bare only for what the URL branch produced — the same permissive test
  // parseRequestInput routes on, so the two stay symmetrical by construction.
  // An unconditional bare-string branch stored a JSON string scalar ("hello")
  // unquoted, and the History reload then threw on its own stored entry.
  return typeof value === 'string' && isUrlLikeInput(value)
    ? value
    : JSON.stringify(value, null, 2);
}

export function inputBadgeState(text, opts = {}) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return { kind: 'empty', key: 'badge.empty' };
  if (opts.allowUrl && isHttpUrlInput(trimmed)) {
    return { kind: 'url', key: 'badge.url_request' };
  }

  try {
    JSON.parse(trimmed);
    return { kind: 'valid', key: 'badge.valid' };
  } catch {
    return { kind: 'invalid', key: 'badge.invalid' };
  }
}

export function renderInputBadge(text, badge, translate, opts = {}) {
  const state = inputBadgeState(text, opts);
  badge.textContent = translate(state.key);
  badge.className = `json-badge ${state.kind}`;
  return state;
}
