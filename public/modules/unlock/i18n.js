/* ============================================================
   modules/unlock/i18n.js — per-module translations.

   8 keys × 3 locales. Loaded LAZY by the unlock dispatcher case
   alongside index.js — pushed into window.kt_i18n_modules queue,
   drained by central /i18n.js (or registered directly via
   window.registerI18nModule when the queue has already been
   drained, which is always the case here since /i18n.js loads
   eagerly at boot).

   Note: auth.label.password + auth.forgot_password STAY in the
   central /i18n.js — they're shared with the auth modal.
   sample.btn.unlock + sample.unlock_cta STAY too — they belong to
   the saved-list locked-state CTA, which lives in ortbtools.app.js
   itself (renderSaved fallback rendering, not in any modal).
   ============================================================ */
(function () {
  'use strict';

  const UNLOCK_I18N = {
    id: 'unlock',
    keys: {
      'modal.unlock.title': {
        uk: 'розблокувати бібліотеку',
        en: 'unlock library',
        ru: 'разблокировать библиотеку',
      },
      'unlock.subtitle': {
        uk: '{email} · введи пароль щоб розшифрувати збережені запити',
        en: '{email} · enter your password to decrypt saved samples',
        ru: '{email} · введи пароль чтобы расшифровать сохранённые запросы',
      },
      'unlock.err.no_crypto': {
        uk: 'Шифрування не налаштовано — спробуй увійти спочатку',
        en: 'Encryption not set up — sign in first',
        ru: 'Шифрование не настроено — попробуй сначала войти',
      },
      // Shown when the cookie session died while this modal was open
      // (sign-out in another tab, password reset, expiry). Deliberately
      // not "wrong password" and not "encryption not set up" — both were
      // wrong about the account rather than about the session.
      'unlock.err.session_expired': {
        uk: 'Сесія завершилась — увійди ще раз',
        en: 'Your session ended — sign in again',
        ru: 'Сессия завершилась — войди ещё раз',
      },
      'unlock.err.wrong_password': {
        uk: 'Невірний пароль',
        en: 'Wrong password',
        ru: 'Неверный пароль',
      },
      'btn.unlock': {
        uk: 'розблокувати',
        en: 'unlock',
        ru: 'разблокировать',
      },
      'btn.signout_instead': {
        uk: 'вийти замість цього',
        en: 'sign out instead',
        ru: 'выйти вместо этого',
      },
      'toast.library_unlocked': {
        uk: 'Бібліотеку розблоковано',
        en: 'Library unlocked',
        ru: 'Библиотека разблокирована',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(UNLOCK_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(UNLOCK_I18N);
  }
})();
