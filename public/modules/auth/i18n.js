/* ============================================================
   modules/auth/i18n.js — per-module translations.

   13 keys × 3 locales. Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot and the auth module is fetched
   only on first auth-modal activation).

   NOTE: keys that look "auth-y" but live OUTSIDE this modal —
   used by the unlock modal (`auth.label.password`,
   `auth.forgot_password`) or the forgot/reset password modals
   (`auth.label.email`, `auth.forgot_password`) — DELIBERATELY
   stay in the central /i18n.js. Same logic as
   /modules/partners/i18n.js: a key moves into a module's i18n.js
   only when no other surface reads it.

   `toast.hello`, `toast.account_created`,
   `toast.account_created_email_failed` are auth-modal-exclusive
   (no other call site) so they live here.
   ============================================================ */
(function () {
  'use strict';

  const AUTH_I18N = {
    id: 'auth',
    keys: {
      'auth.login.title': {
        uk: 'увійти',
        en: 'sign in',
        ru: 'войти',
      },
      'auth.register.title': {
        uk: 'створити акаунт',
        en: 'create account',
        ru: 'создать аккаунт',
      },
      'auth.label.password_hint': {
        uk: 'пароль (мінімум 8 символів)',
        en: 'password (min. 8 chars)',
        ru: 'пароль (минимум 8 символов)',
      },
      'auth.btn.login': {
        uk: 'увійти',
        en: 'sign in',
        ru: 'войти',
      },
      'auth.btn.register': {
        uk: 'створити',
        en: 'create',
        ru: 'создать',
      },
      'auth.switch_to_login': {
        uk: 'вже є акаунт? увійти',
        en: 'have an account? sign in',
        ru: 'уже есть аккаунт? войти',
      },
      'auth.switch_to_register': {
        uk: 'немає акаунту? створити',
        en: 'no account? create one',
        ru: 'нет аккаунта? создать',
      },
      'auth.err.invalid_email': {
        uk: 'Невалідний email',
        en: 'Invalid email',
        ru: 'Невалидный email',
      },
      'auth.err.weak_password': {
        uk: 'Пароль має бути хоча б 8 символів',
        en: 'Password must be at least 8 chars',
        ru: 'Пароль должен быть минимум 8 символов',
      },
      'auth.err.email_taken': {
        uk: 'Цей email вже зареєстровано',
        en: 'This email is already registered',
        ru: 'Этот email уже зарегистрирован',
      },
      'auth.err.invalid_creds': {
        uk: 'Невірний email або пароль',
        en: 'Wrong email or password',
        ru: 'Неверный email или пароль',
      },
      'auth.err.rate_limited': {
        uk: 'Забагато спроб — спробуй пізніше',
        en: 'Too many attempts — try again later',
        ru: 'Слишком много попыток — попробуй позже',
      },
      'toast.hello': {
        uk: 'Привіт, {email}',
        en: 'Hi, {email}',
        ru: 'Привет, {email}',
      },
      'toast.account_created': {
        uk: 'Акаунт створено, {email}',
        en: 'Account created, {email}',
        ru: 'Аккаунт создан, {email}',
      },
      'toast.account_created_email_failed': {
        uk: 'Акаунт створено, але лист не пройшов — натисни «надіслати» у банері пізніше',
        en: 'Account created, but the verify email didn’t send — use “send” in the banner later',
        ru: 'Аккаунт создан, но письмо не прошло — нажми «отправить» в баннере позже',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(AUTH_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(AUTH_I18N);
  }
})();
