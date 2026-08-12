'use strict';

/**
 * lib/traffic-class.js — pure request classifier for product telemetry.
 *
 * Answers one question: "is this request a real external human, or is it us?"
 * Product metrics (activation, repeat usage, D1/D7/D30 retention) are only
 * meaningful once owner traffic, dev agents, CI, uptime monitors and crawlers
 * are separable from genuine users.
 *
 * PURE by design — no I/O, no clock, no ClickHouse. It takes the already-
 * resolved client IP (auth.clientIp() applies the loopback-XFF rule) plus the
 * raw headers, and returns a small derived record. This keeps the whole
 * classification matrix unit-testable without a live server.
 *
 * ── Security property ──────────────────────────────────────────────────────
 * A caller-supplied hint can only ever DEMOTE a request out of `external`.
 * `external` is exclusively the fall-through result, and no hint value maps to
 * it. So a bot that sends `X-Ortbtools-Traffic: external` (or a beacon body
 * claiming the same) still classifies by its UA/IP. Self-reported "I am
 * internal" is trusted, because lying in that direction only removes the liar
 * from the numbers.
 *
 * ── Precedence ─────────────────────────────────────────────────────────────
 *   1. explicit hint  — `X-Ortbtools-Traffic` header, or a beacon `internal`
 *                       flag (ci | agent | monitor | internal | owner)
 *   2. owner identity — authenticated as a uid in ORTBTOOLS_OWNER_USER_IDS
 *   3. monitor UA     — uptime-kuma, prometheus, blackbox_exporter, …
 *   4. ci UA          — github-actions, the ortbtools smoke script, …
 *   5. agent UA       — claudebot, gptbot, perplexity, … (AI fetchers)
 *   6. bot UA         — crawlers, HTTP libraries, headless drivers, empty UA
 *   7. private IP     — RFC1918 / loopback / link-local / CGNAT (Tailscale)
 *   8. owner IP       — ORTBTOOLS_OWNER_IPS allowlist (IPv4 + CIDR, IPv6 exact)
 *   9. external       — everything left over
 *
 * Any address we cannot positively identify as public ('unknown', a spoofed
 * XFF token, a hostname) counts as private: it is better to under-count real
 * users than to inflate them with traffic we cannot place.
 *
 * Env:
 *   ORTBTOOLS_OWNER_IPS       comma-separated IPv4/IPv6/IPv4-CIDR allowlist
 *   ORTBTOOLS_OWNER_USER_IDS  comma-separated numeric user ids
 */

/** Every class this module can emit. `external` is the only "real user" one. */
const TRAFFIC_CLASSES = Object.freeze([
  'external',
  'owner',
  'internal',
  'bot',
  'monitor',
  'ci',
  'agent',
]);

/**
 * Values a caller may assert about itself. Deliberately excludes `external` —
 * see the security property above.
 */
const HINT_CLASSES = Object.freeze(['owner', 'internal', 'bot', 'monitor', 'ci', 'agent']);

const UA_CLASSES = Object.freeze(['desktop', 'mobile', 'tablet', 'bot', 'unknown']);

// Uptime/health probes. Checked before the generic bot list so a
// `curl`-flavoured health probe still lands in `monitor`.
const MONITOR_RE =
  /(uptime[\s_-]?kuma|uptimerobot|prometheus|blackbox[\s_-]?exporter|node[\s_-]?exporter|kube-probe|docker[\s_-]?health|health[\s_-]?check|pingdom|statuscake|better[\s_-]?uptime|site24x7|newrelic|datadog|nagios|zabbix|checkly|hetrixtools)/i;

// Build/CI runners plus this repo's own smoke scripts (scripts/smoke.sh and
// scripts/ci-docker-smoke.sh set the UA explicitly).
const CI_RE =
  /(github-actions|gitlab-runner|jenkins|circleci|buildkite|travis|drone|woodpecker|teamcity|ortbtools-smoke|ortbtools-ci)/i;

// AI fetchers and coding agents. Separated from `bot` so the operator can see
// how much of the traffic is model-driven rather than crawler-driven.
const AGENT_RE =
  /(claude(-?bot|-?user|-?web)?[/ ]|anthropic|gptbot|chatgpt-user|oai-searchbot|openai|perplexity(bot)?|cohere-ai|google-extended|applebot-extended|meta-externalagent|bytespider|ccbot|diffbot|youbot|amazonbot|duckassistbot)/i;

// Crawlers, HTTP client libraries, headless drivers, link unfurlers.
const BOT_RE =
  /(bot\b|bot[/;)]|crawler|spider|slurp|scrapy|curl[/ ]|wget[/ ]|python-requests|python-urllib|aiohttp|node-fetch|undici|go-http-client|okhttp|java[/ ]|libwww-perl|apache-httpclient|axios[/ ]|got[/ ]|postmanruntime|insomnia|headlesschrome|phantomjs|puppeteer|playwright|selenium|chrome-lighthouse|ahrefs|semrush|mj12|dotbot|petalbot|yandex|baiduspider|sogou|exabot|facebookexternalhit|embedly|whatsapp|telegrambot|slackbot|discordbot|twitterbot|linkedinbot|bingpreview|archive\.org_bot|ia_archiver|masscan|zgrab|nmap)/i;

const TABLET_RE = /(ipad|android(?!.*\bmobile\b)|tablet|kindle|silk|playbook)/i;
const MOBILE_RE = /(iphone|ipod|android.*\bmobile\b|windows phone|blackberry|iemobile|opera mini)/i;

// ── IP helpers ──────────────────────────────────────────────────────────────

/**
 * Canonicalise an address for comparison: strip brackets, an IPv6 zone index,
 * and the `::ffff:` IPv4-mapped prefix. Returns '' when nothing usable is left.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeIp(value) {
  if (typeof value !== 'string') return '';
  let ip = value.trim().toLowerCase();
  if (!ip || ip === 'unknown') return '';
  if (ip.startsWith('[')) ip = ip.slice(1);
  const close = ip.indexOf(']');
  if (close !== -1) ip = ip.slice(0, close);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  return ip;
}

/**
 * Parse dotted-quad IPv4 into a uint32, or null when it is not a valid IPv4.
 * Rejects octal-ish padding (`01.2.3.4`) so two spellings of one address can
 * never disagree between the allowlist and the request.
 * @param {string} ip
 * @returns {number | null}
 */
function parseIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const part = m[i];
    if (part.length > 1 && part[0] === '0') return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

/** @type {Array<[number, number]>} [network, prefixLength] */
const PRIVATE_V4 = [
  [parseIpv4('0.0.0.0') || 0, 8], // "this network"
  [parseIpv4('10.0.0.0') || 0, 8], // RFC1918
  [parseIpv4('127.0.0.0') || 0, 8], // loopback
  [parseIpv4('169.254.0.0') || 0, 16], // link-local
  [parseIpv4('172.16.0.0') || 0, 12], // RFC1918
  [parseIpv4('192.168.0.0') || 0, 16], // RFC1918
  [parseIpv4('100.64.0.0') || 0, 10], // CGNAT — also the Tailscale range
];

/**
 * @param {number} addr uint32
 * @param {number} network uint32
 * @param {number} prefix 0-32
 */
function inV4Net(addr, network, prefix) {
  if (prefix <= 0) return true;
  if (prefix > 32) return false;
  // `<<32` is a no-op in JS (shift count is mod 32), so /32 needs its own path.
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return (addr & mask) >>> 0 === (network & mask) >>> 0;
}

/**
 * True for loopback / RFC1918 / link-local / CGNAT / ULA addresses, and for any
 * value we cannot positively identify as a public address.
 *
 * Written as an allowlist on purpose: an address only escapes as "public" when
 * it parses as a valid IPv4 outside the private ranges, or as a syntactically
 * plausible IPv6 outside them. Garbage ('unknown', a spoofed XFF token, a
 * hostname) therefore lands on the private side, which under-counts real users
 * instead of inflating them.
 *
 * @param {string} normalizedIp output of normalizeIp()
 */
function isPrivateIp(normalizedIp) {
  if (!normalizedIp) return true; // unresolvable → never counted as external
  const v4 = parseIpv4(normalizedIp);
  if (v4 !== null) return PRIVATE_V4.some(([net, bits]) => inV4Net(v4, net, bits));
  // Not IPv4. Only something that at least LOOKS like IPv6 may be public.
  if (!normalizedIp.includes(':') || !/^[0-9a-f:.]+$/.test(normalizedIp)) return true;
  if (normalizedIp === '::' || normalizedIp === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(normalizedIp)) return true; // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]:/.test(normalizedIp)) return true; // fe80::/10 link-local
  return false;
}

/**
 * Parse a comma-separated allowlist into match rules. Accepts exact IPv4, IPv4
 * CIDR, and literal IPv6 (IPv6 CIDR is deliberately unsupported — list IPv6
 * hosts individually). Unparseable entries are skipped rather than throwing, so
 * one typo in an env var cannot take the app down.
 *
 * @param {string} raw
 * @returns {Array<{v4: number, prefix: number} | {literal: string}>}
 */
function parseIpRules(raw) {
  /** @type {Array<{v4: number, prefix: number} | {literal: string}>} */
  const rules = [];
  for (const entry of String(raw || '').split(',')) {
    const token = normalizeIp(entry);
    if (!token) continue;
    const slash = token.indexOf('/');
    if (slash !== -1) {
      const net = parseIpv4(token.slice(0, slash));
      const prefix = Number(token.slice(slash + 1));
      if (net !== null && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
        rules.push({ v4: net, prefix });
      }
      continue;
    }
    const v4 = parseIpv4(token);
    if (v4 !== null) rules.push({ v4, prefix: 32 });
    else rules.push({ literal: token });
  }
  return rules;
}

/**
 * @param {string} normalizedIp output of normalizeIp()
 * @param {ReturnType<typeof parseIpRules>} rules
 */
function ipMatchesRules(normalizedIp, rules) {
  if (!normalizedIp || !rules || rules.length === 0) return false;
  const v4 = parseIpv4(normalizedIp);
  for (const rule of rules) {
    if ('literal' in rule) {
      if (rule.literal === normalizedIp) return true;
    } else if (v4 !== null && inV4Net(v4, rule.v4, rule.prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Memoise a parsed env allowlist on its raw string, so a change takes effect
 * without a process restart and repeated calls stay cheap.
 * @param {string} envName
 */
function makeEnvRuleCache(envName) {
  let cachedRaw = null;
  /** @type {ReturnType<typeof parseIpRules>} */
  let cachedRules = [];
  return () => {
    const raw = process.env[envName] || '';
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedRules = parseIpRules(raw);
    }
    return cachedRules;
  };
}

const ownerIpRules = makeEnvRuleCache('ORTBTOOLS_OWNER_IPS');

/**
 * @param {string} normalizedIp
 * @returns {boolean}
 */
function isOwnerIp(normalizedIp) {
  return ipMatchesRules(normalizedIp, ownerIpRules());
}

let _ownerUidsRaw = null;
/** @type {Set<number>} */
let _ownerUids = new Set();

/** Parse ORTBTOOLS_OWNER_USER_IDS on demand, memoised on the raw string. */
function ownerUserIds() {
  const raw = process.env.ORTBTOOLS_OWNER_USER_IDS || '';
  if (raw === _ownerUidsRaw) return _ownerUids;
  _ownerUidsRaw = raw;
  _ownerUids = new Set();
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0) _ownerUids.add(n);
  }
  return _ownerUids;
}

/**
 * True when this user id is configured as an owner account.
 * @param {unknown} userId
 */
function isOwnerUserId(userId) {
  const n = Number(userId);
  if (!Number.isInteger(n) || n <= 0) return false;
  return ownerUserIds().has(n);
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Coarse device bucket derived from the UA. The raw UA string is never stored —
 * only this five-value enum reaches the telemetry row.
 * @param {string} ua
 * @returns {string} one of UA_CLASSES
 */
function classifyUa(ua) {
  if (!ua) return 'unknown';
  if (MONITOR_RE.test(ua) || CI_RE.test(ua) || AGENT_RE.test(ua) || BOT_RE.test(ua)) return 'bot';
  if (MOBILE_RE.test(ua)) return 'mobile';
  if (TABLET_RE.test(ua)) return 'tablet';
  if (/mozilla|webkit|gecko|trident|opera/i.test(ua)) return 'desktop';
  return 'unknown';
}

/**
 * Normalise a self-reported class. Returns '' unless the value is one of
 * HINT_CLASSES — notably, `external` never survives.
 * @param {unknown} value
 */
function normalizeHint(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim().toLowerCase();
  return HINT_CLASSES.includes(v) ? v : '';
}

/**
 * Classify one request.
 *
 * @param {object} [input]
 * @param {string} [input.ip]           already-resolved client IP
 * @param {string} [input.userAgent]    raw UA; falls back to headers
 * @param {object} [input.headers]      raw node request headers
 * @param {unknown} [input.userId]      authenticated user id, if any
 * @param {unknown} [input.clientHint]  self-reported class from a beacon body
 * @returns {{ traffic_class: string, is_external: boolean, ua_class: string }}
 */
function classifyTraffic(input) {
  const src = input || {};
  const headers = src.headers && typeof src.headers === 'object' ? src.headers : {};
  const rawUa =
    typeof src.userAgent === 'string'
      ? src.userAgent
      : typeof headers['user-agent'] === 'string'
        ? headers['user-agent']
        : '';
  const ua = rawUa.slice(0, 512);
  const ua_class = classifyUa(ua);
  const ip = normalizeIp(src.ip);

  const decide = (traffic_class) => ({
    traffic_class,
    is_external: traffic_class === 'external',
    ua_class,
  });

  const hint = normalizeHint(headers['x-ortbtools-traffic']) || normalizeHint(src.clientHint);
  if (hint) return decide(hint);

  if (isOwnerUserId(src.userId)) return decide('owner');

  if (ua) {
    if (MONITOR_RE.test(ua)) return decide('monitor');
    if (CI_RE.test(ua)) return decide('ci');
    if (AGENT_RE.test(ua)) return decide('agent');
    if (BOT_RE.test(ua)) return decide('bot');
  } else {
    // A real browser always sends a UA; sendBeacon and fetch both do too.
    return decide('bot');
  }

  if (isPrivateIp(ip)) return decide('internal');
  if (isOwnerIp(ip)) return decide('owner');

  return decide('external');
}

module.exports = {
  classifyTraffic,
  classifyUa,
  normalizeIp,
  normalizeHint,
  isPrivateIp,
  isOwnerIp,
  isOwnerUserId,
  // Shared with lib/client-ip.js so the CIDR matcher has exactly one impl.
  parseIpRules,
  ipMatchesRules,
  makeEnvRuleCache,
  TRAFFIC_CLASSES,
  HINT_CLASSES,
  UA_CLASSES,
};
