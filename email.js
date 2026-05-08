'use strict';

/**
 * Transactional email via Resend HTTPS API.
 *
 * Dev-mode short-circuit: when NODE_ENV !== 'production' OR RESEND_API_KEY is
 * missing, log the email subject + link to console instead of sending. Lets
 * local dev run without a key, and graceful-degrades in prod if env is
 * misconfigured (caller still gets a resolved promise — they can inspect
 * `result.dev === true` if they care).
 *
 * Why no nodemailer: VANILLA ONLY rule (see spyglass_working_rules). Resend
 * has a JSON HTTPS API; node:https is enough.
 *
 * Env (see .env.example):
 *   RESEND_API_KEY   — from https://resend.com/api-keys (Bearer)
 *   EMAIL_FROM       — from-address on a domain verified in Resend
 *   PUBLIC_BASE_URL  — origin used in email links (no trailing slash)
 */

const https = require('https');

const RESEND_HOST = 'api.resend.com';
const RESEND_PATH = '/emails';
const REQUEST_TIMEOUT_MS = 10_000;

function isDevMode() {
  return process.env.NODE_ENV !== 'production' || !process.env.RESEND_API_KEY;
}

function getFrom() {
  return process.env.EMAIL_FROM || 'spyglass@kyivtech.com.ua';
}

function getBaseUrl(override) {
  return override || process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * Posts to Resend; resolves with parsed body, rejects with typed error.
 * @param {object} payload
 * @returns {Promise<{id?: string}>}
 */
function postToResend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        host: RESEND_HOST,
        path: RESEND_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(chunks ? JSON.parse(chunks) : {});
            } catch {
              reject(new Error(`Resend returned non-JSON 2xx: ${chunks}`));
            }
          } else {
            const err = /** @type {Error & {code?: string, status?: number}} */ (
              new Error(`Resend returned ${res.statusCode}: ${chunks}`)
            );
            err.code = 'RESEND_API_ERROR';
            err.status = res.statusCode;
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Resend request timeout')));
    req.write(body);
    req.end();
  });
}

function verifyTemplate(user, link) {
  const safeEmail = escapeHtml(user.email);
  const safeLink = escapeHtml(link);
  return {
    subject: 'Підтвердіть свою адресу — Spyglass',
    html: `<!DOCTYPE html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; max-width: 560px; margin: 24px auto; padding: 0 16px;">
<h2 style="margin: 0 0 16px;">Підтвердження адреси</h2>
<p>Вітаємо в Spyglass, ${safeEmail}.</p>
<p>Натисніть кнопку нижче протягом 7 днів, щоб підтвердити цю адресу:</p>
<p style="margin: 24px 0;"><a href="${safeLink}" style="display:inline-block; padding:12px 24px; background:#0066cc; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Підтвердити адресу</a></p>
<p style="font-size:12px; color:#666;">Або скопіюйте URL в браузер:<br><code style="word-break:break-all;">${safeLink}</code></p>
<p style="font-size:12px; color:#666; margin-top:32px;">Якщо ви не реєструвались — просто проігноруйте цей лист.</p>
</body></html>`,
    text: `Підтвердження адреси Spyglass\n\nПерейдіть за посиланням протягом 7 днів:\n${link}\n\nЯкщо ви не реєструвались — проігноруйте.`,
  };
}

function resetTemplate(user, link) {
  const safeEmail = escapeHtml(user.email);
  const safeLink = escapeHtml(link);
  return {
    subject: 'Скидання паролю — Spyglass',
    html: `<!DOCTYPE html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; max-width: 560px; margin: 24px auto; padding: 0 16px;">
<h2 style="margin: 0 0 16px;">Скидання паролю</h2>
<p>Хтось (можливо ви) запитав скидання паролю для <b>${safeEmail}</b>.</p>
<p>Посилання діє 15 хвилин:</p>
<p style="margin: 24px 0;"><a href="${safeLink}" style="display:inline-block; padding:12px 24px; background:#0066cc; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Скинути пароль</a></p>
<p style="font-size:12px; color:#666;">Або скопіюйте URL в браузер:<br><code style="word-break:break-all;">${safeLink}</code></p>
<p style="font-size:12px; color:#666; margin-top:32px;">Якщо ви не запитували скидання — просто проігноруйте лист, з вашим акаунтом нічого не станеться.</p>
</body></html>`,
    text: `Скидання паролю Spyglass\n\nПерейдіть за посиланням протягом 15 хвилин:\n${link}\n\nЯкщо ви не запитували скидання — проігноруйте.`,
  };
}

async function sendTemplate(user, tpl, link) {
  if (isDevMode()) {
    console.log(
      `[email:DEV] → ${user.email}\n  subject: ${tpl.subject}\n  link: ${link}\n  (RESEND_API_KEY ${process.env.RESEND_API_KEY ? 'set' : 'missing'}, NODE_ENV=${process.env.NODE_ENV})`,
    );
    return { dev: true, link };
  }
  return postToResend({
    from: getFrom(),
    to: [user.email],
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
}

/**
 * @param {{email: string}} user
 * @param {string} token
 * @param {string} [baseUrl] override PUBLIC_BASE_URL
 */
async function sendVerifyEmail(user, token, baseUrl) {
  // Server route: GET /api/auth/verify-email/confirm — 302-redirects with
  // ?verified=1 / ?verify_error=. Front-end has NO handler for `/?verify=`,
  // so any other URL shape would land on the home page silently.
  const link = `${getBaseUrl(baseUrl)}/api/auth/verify-email/confirm?token=${encodeURIComponent(token)}`;
  return sendTemplate(user, verifyTemplate(user, link), link);
}

/**
 * @param {{email: string}} user
 * @param {string} token
 * @param {string} [baseUrl]
 */
async function sendResetEmail(user, token, baseUrl) {
  const link = `${getBaseUrl(baseUrl)}/?reset=${encodeURIComponent(token)}`;
  return sendTemplate(user, resetTemplate(user, link), link);
}

module.exports = { sendVerifyEmail, sendResetEmail };
