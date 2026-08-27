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
const log = require('./lib/logger').child('email');

const RESEND_HOST = 'api.resend.com';
const RESEND_PATH = '/emails';
const REQUEST_TIMEOUT_MS = 10_000;

function isDevMode() {
  return process.env.NODE_ENV !== 'production' || !process.env.RESEND_API_KEY;
}

function getFrom() {
  return process.env.EMAIL_FROM || 'ortbtools@kyivtech.com.ua';
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

// Three-locale copy tables for the transactional templates below. Kept as
// plain data (not packages/core/messages/*.json — those are Core finding
// messages, a different domain/consumer) so verifyTemplate/resetTemplate stay
// a single HTML/text skeleton with only the words swapped per locale. uk/ru
// use informal singular address (ти/ты) to match the rest of the product;
// past-tense/possessive phrasing below is written to sidestep Ukrainian/
// Russian gendered-verb agreement (e.g. "запит на скидання..." instead of
// "ти запитав(-ла)...") rather than guessing the recipient's gender.
const VERIFY_COPY = {
  en: {
    subject: 'Confirm your email — ortbtools',
    heading: 'Confirm your email',
    intro: (safeEmail) => `Welcome to ortbtools, ${safeEmail}.`,
    cta: 'Click the button below within 7 days to confirm this address:',
    button: 'Confirm address',
    copyHint: 'Or copy this URL into your browser:',
    footer: "If this registration wasn't you, just ignore this email.",
    textIntro: 'Confirm your email — ortbtools',
    textCta: 'Open this link within 7 days:',
    textFooter: "If this registration wasn't you, ignore this email.",
  },
  uk: {
    subject: 'Підтверди свою адресу — ortbtools',
    heading: 'Підтвердження адреси',
    intro: (safeEmail) => `Вітаємо в ortbtools, ${safeEmail}.`,
    cta: 'Натисни кнопку нижче протягом 7 днів, щоб підтвердити цю адресу:',
    button: 'Підтвердити адресу',
    copyHint: 'Або скопіюй URL в браузер:',
    footer: 'Якщо ця реєстрація не від тебе — просто проігноруй цей лист.',
    textIntro: 'Підтвердження адреси ortbtools',
    textCta: 'Перейди за посиланням протягом 7 днів:',
    textFooter: 'Якщо ця реєстрація не від тебе — проігноруй.',
  },
  ru: {
    subject: 'Подтверди свой адрес — ortbtools',
    heading: 'Подтверждение адреса',
    intro: (safeEmail) => `Добро пожаловать в ortbtools, ${safeEmail}.`,
    cta: 'Нажми кнопку ниже в течение 7 дней, чтобы подтвердить этот адрес:',
    button: 'Подтвердить адрес',
    copyHint: 'Или скопируй URL в браузер:',
    footer: 'Если эта регистрация не от тебя — просто проигнорируй это письмо.',
    textIntro: 'Подтверждение адреса ortbtools',
    textCta: 'Перейди по ссылке в течение 7 дней:',
    textFooter: 'Если эта регистрация не от тебя — проигнорируй.',
  },
};

const RESET_COPY = {
  en: {
    subject: 'Reset your password — ortbtools',
    heading: 'Password reset',
    intro: (safeEmail) => `A password reset was requested for <b>${safeEmail}</b>.`,
    validity: 'This link is valid for 15 minutes:',
    button: 'Reset password',
    copyHint: 'Or copy this URL into your browser:',
    footer: "If this wasn't you, just ignore this email — nothing will happen to your account.",
    textIntro: 'Password reset — ortbtools',
    textCta: 'Open this link within 15 minutes:',
    textFooter: "If this wasn't you, ignore this email.",
  },
  uk: {
    subject: 'Скидання паролю — ortbtools',
    heading: 'Скидання паролю',
    intro: (safeEmail) => `Надійшов запит на скидання паролю для <b>${safeEmail}</b>.`,
    validity: 'Посилання діє 15 хвилин:',
    button: 'Скинути пароль',
    copyHint: 'Або скопіюй URL в браузер:',
    footer: 'Якщо це не твій запит — просто проігноруй лист, з твоїм акаунтом нічого не станеться.',
    textIntro: 'Скидання паролю ortbtools',
    textCta: 'Перейди за посиланням протягом 15 хвилин:',
    textFooter: 'Якщо це не твій запит — проігноруй.',
  },
  ru: {
    subject: 'Сброс пароля — ortbtools',
    heading: 'Сброс пароля',
    intro: (safeEmail) => `Поступил запрос на сброс пароля для <b>${safeEmail}</b>.`,
    validity: 'Ссылка действует 15 минут:',
    button: 'Сбросить пароль',
    copyHint: 'Или скопируй URL в браузер:',
    footer:
      'Если это не твой запрос — просто проигнорируй письмо, с твоим аккаунтом ничего не случится.',
    textIntro: 'Сброс пароля ortbtools',
    textCta: 'Перейди по ссылке в течение 15 минут:',
    textFooter: 'Если это не твой запрос — проигнорируй.',
  },
};

function normalizeLocale(locale) {
  return locale === 'uk' || locale === 'ru' ? locale : 'en';
}

/**
 * @param {{email: string}} user
 * @param {string} link
 * @param {string} [locale] 'en' | 'uk' | 'ru' — defaults to 'en' when absent/invalid
 */
function verifyTemplate(user, link, locale) {
  const c = VERIFY_COPY[normalizeLocale(locale)];
  const safeEmail = escapeHtml(user.email);
  const safeLink = escapeHtml(link);
  return {
    subject: c.subject,
    html: `<!DOCTYPE html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; max-width: 560px; margin: 24px auto; padding: 0 16px;">
<h2 style="margin: 0 0 16px;">${c.heading}</h2>
<p>${c.intro(safeEmail)}</p>
<p>${c.cta}</p>
<p style="margin: 24px 0;"><a href="${safeLink}" style="display:inline-block; padding:12px 24px; background:#0066cc; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">${c.button}</a></p>
<p style="font-size:12px; color:#666;">${c.copyHint}<br><code style="word-break:break-all;">${safeLink}</code></p>
<p style="font-size:12px; color:#666; margin-top:32px;">${c.footer}</p>
</body></html>`,
    text: `${c.textIntro}\n\n${c.textCta}\n${link}\n\n${c.textFooter}`,
  };
}

/**
 * @param {{email: string}} user
 * @param {string} link
 * @param {string} [locale] 'en' | 'uk' | 'ru' — defaults to 'en' when absent/invalid
 */
function resetTemplate(user, link, locale) {
  const c = RESET_COPY[normalizeLocale(locale)];
  const safeEmail = escapeHtml(user.email);
  const safeLink = escapeHtml(link);
  return {
    subject: c.subject,
    html: `<!DOCTYPE html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; max-width: 560px; margin: 24px auto; padding: 0 16px;">
<h2 style="margin: 0 0 16px;">${c.heading}</h2>
<p>${c.intro(safeEmail)}</p>
<p>${c.validity}</p>
<p style="margin: 24px 0;"><a href="${safeLink}" style="display:inline-block; padding:12px 24px; background:#0066cc; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">${c.button}</a></p>
<p style="font-size:12px; color:#666;">${c.copyHint}<br><code style="word-break:break-all;">${safeLink}</code></p>
<p style="font-size:12px; color:#666; margin-top:32px;">${c.footer}</p>
</body></html>`,
    text: `${c.textIntro}\n\n${c.textCta}\n${link}\n\n${c.textFooter}`,
  };
}

async function sendTemplate(user, tpl, link) {
  if (isDevMode()) {
    log.info(
      {
        to: user.email,
        subject: tpl.subject,
        link,
        resendKey: process.env.RESEND_API_KEY ? 'set' : 'missing',
        nodeEnv: process.env.NODE_ENV,
        devMode: true,
      },
      'email dev-mode short-circuit',
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
 * @param {string} [locale] 'en' | 'uk' | 'ru' — defaults to 'en' when absent/invalid
 */
async function sendVerifyEmail(user, token, baseUrl, locale) {
  // Server route: GET /api/auth/verify-email/confirm — 302-redirects with
  // ?verified=1 / ?verify_error=. Front-end has NO handler for `/?verify=`,
  // so any other URL shape would land on the home page silently.
  const link = `${getBaseUrl(baseUrl)}/api/auth/verify-email/confirm?token=${encodeURIComponent(token)}`;
  return sendTemplate(user, verifyTemplate(user, link, locale), link);
}

/**
 * @param {{email: string}} user
 * @param {string} token
 * @param {string} [baseUrl]
 * @param {string} [locale] 'en' | 'uk' | 'ru' — defaults to 'en' when absent/invalid
 */
async function sendResetEmail(user, token, baseUrl, locale) {
  const link = `${getBaseUrl(baseUrl)}/?reset=${encodeURIComponent(token)}`;
  return sendTemplate(user, resetTemplate(user, link, locale), link);
}

module.exports = { sendVerifyEmail, sendResetEmail };
