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

export function isHttpUrlInput(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
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
    if (isHttpUrlInput(trimmed)) return trimmed;
    throw jsonError;
  }
}

export function serializeRequestInput(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
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
