'use strict';

/**
 * lib/openrouter.js — minimal OpenRouter chat client (used by the AI blog
 * moderator for high-quality EN→UK/RU translation). Dependency-free.
 *
 * Key resolution order:
 *   1. process.env.OPENROUTER_API_KEY  (how the container gets it, via .env)
 *   2. OPENROUTER_API_KEY line in the secrets vault file (host / dev fallback)
 *
 * Default model is overridable via OPENROUTER_MODEL. DeepSeek chat is a good
 * cheap default for translation (non-reasoning → no wasted thinking tokens).
 */

const fs = require('fs');

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';
const SECRETS_FILE = process.env.SECRETS_FILE || '/srv/DATA/.secrets/api-tokens.env';
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) || 60_000;

let _fileKeyChecked = false;
let _fileKey = '';
function readKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (!_fileKeyChecked) {
    _fileKeyChecked = true;
    try {
      const m = fs.readFileSync(SECRETS_FILE, 'utf8').match(/^OPENROUTER_API_KEY=(\S+)/m);
      _fileKey = m ? m[1] : '';
    } catch {
      _fileKey = '';
    }
  }
  return _fileKey;
}

function hasKey() {
  return !!readKey();
}

/**
 * @param {Array<{role:string, content:string}>} messages
 * @param {{model?:string, temperature?:number, jsonObject?:boolean, maxTokens?:number, timeoutMs?:number}} [opts]
 * @returns {Promise<{ content: string, usage: object, model: string }>}
 */
async function callOpenRouter(messages, opts = {}) {
  const key = readKey();
  if (!key) throw new Error('OPENROUTER_API_KEY not configured');

  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages,
    temperature: opts.temperature != null ? opts.temperature : 0.2,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonObject) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(OR_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ortbtools.com',
        'X-Title': 'Spyglass news moderator',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 300)}`);
    }
    const json = await resp.json();
    const content =
      (json.choices &&
        json.choices[0] &&
        json.choices[0].message &&
        json.choices[0].message.content) ||
      '';
    return { content, usage: json.usage || {}, model: json.model || body.model };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callOpenRouter, hasKey, DEFAULT_MODEL };
