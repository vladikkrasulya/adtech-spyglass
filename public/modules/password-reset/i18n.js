/* ============================================================
   modules/password-reset/i18n.js — per-module translations.

   31 keys × 3 locales for the forgot-password / reset-password flow.
   Loaded LAZY by index.js — pushed into window.kt_i18n_modules
   queue, drained by central /i18n.js (or registered directly via
   window.registerI18nModule when the queue has already been drained).

   Excluded — kept in the central /i18n.js because they're consumed
   by SHELL-LEVEL surfaces too (login modal, unlock modal, ?verify_error
   boot path):
     - auth.forgot_password           — login + unlock modal link label
     - auth.label.email               — forgot modal + login modal share
     - reset.err.link_expired         — used by ?verify_error= boot
     - reset.err.link_tampered        — used by ?verify_error= boot
     - reset.err.verify_failed        — used by ?verify_error= boot
   ============================================================ */
(function () {
  'use strict';

  const PASSWORD_RESET_I18N = {
    id: 'password-reset',
    keys: {
      'modal.password_reset.title': {
        uk: 'скидання паролю',
        en: 'reset password',
        ru: 'сброс пароля',
      },
      'toast.password_reset': {
        uk: 'Пароль скинуто. Ти увійшов(ла).',
        en: 'Password reset. You’re signed in.',
        ru: 'Пароль сброшен. Ты вошёл(ла).',
      },

      // ── forgot password ───────────────────────────────────
      'forgot.subtitle': {
        uk: 'введи email — пришлемо посилання для скидання паролю (діє 15 хв).',
        en: 'Enter your email — we’ll send a reset link (valid for 15 min).',
        ru: 'введи email — пришлём ссылку для сброса пароля (действует 15 мин).',
      },
      'forgot.btn.back_to_login': {
        uk: 'назад до входу',
        en: 'back to sign in',
        ru: 'назад ко входу',
      },
      'forgot.btn.send': {
        uk: 'надіслати',
        en: 'send',
        ru: 'отправить',
      },
      'forgot.sending': {
        uk: 'Відправляємо…',
        en: 'Sending…',
        ru: 'Отправляем…',
      },
      'forgot.sent': {
        uk: 'Якщо такий email існує, лист відправлено. Перевір пошту (і спам).',
        en: 'If this email exists, a link was sent. Check your inbox (and spam).',
        ru: 'Если такой email существует, письмо отправлено. Проверь почту (и спам).',
      },
      'forgot.email_required': {
        uk: 'Введи email',
        en: 'Enter an email',
        ru: 'Введи email',
      },
      'forgot.invalid_email': {
        uk: 'Це не схоже на email — перевір введене значення',
        en: 'Doesn’t look like an email — check the value',
        ru: 'Это не похоже на email — проверь введённое значение',
      },

      // ── reset password — modes ────────────────────────────
      'reset.mode.rotate': {
        uk: 'Я памʼятаю поточний пароль',
        en: 'I remember my current password',
        ru: 'Я помню текущий пароль',
      },
      'reset.mode.rotate_hint': {
        uk: 'Бібліотека збережеться. Просто ротуємо пароль.',
        en: 'Library is preserved. We just rotate the password.',
        ru: 'Библиотека сохранится. Просто ротируем пароль.',
      },
      'reset.mode.recover': {
        uk: 'У мене є recovery key',
        en: 'I have my recovery key',
        ru: 'У меня есть recovery key',
      },
      'reset.mode.recover_hint': {
        uk: '32-символьний ключ, який показували при реєстрації. Бібліотека збережеться.',
        en: '32-char key shown at registration. Library is preserved.',
        ru: '32-символьный ключ, который показывали при регистрации. Библиотека сохранится.',
      },
      'reset.mode.wipe': {
        uk: 'Я втратив обидва — стерти все',
        en: 'I lost both — wipe everything',
        ru: 'Я потерял оба — стереть всё',
      },
      'reset.mode.wipe_hint': {
        uk: 'Усі збережені запити та партнери будуть видалені.',
        en: 'All saved samples and partners will be deleted.',
        ru: 'Все сохранённые запросы и партнёры будут удалены.',
      },

      // ── reset password — labels ───────────────────────────
      'reset.label.new_password': {
        uk: 'новий пароль (мін. 8 символів)',
        en: 'new password (min. 8 chars)',
        ru: 'новый пароль (мин. 8 символов)',
      },
      'reset.label.old_password': {
        uk: 'поточний пароль',
        en: 'current password',
        ru: 'текущий пароль',
      },
      'reset.label.recovery': {
        uk: 'recovery key (32 символи)',
        en: 'recovery key (32 chars)',
        ru: 'recovery key (32 символа)',
      },
      'reset.wipe_warn': {
        uk: '<b>Це знищить всі ваші збережені запити та партнерів.</b> Зашифровані дані не можна відновити без паролю чи recovery key.',
        en: '<b>This will destroy all your saved samples and partners.</b> Encrypted data cannot be recovered without password or recovery key.',
        ru: '<b>Это уничтожит все ваши сохранённые запросы и партнёров.</b> Зашифрованные данные нельзя восстановить без пароля или recovery key.',
      },
      'reset.wipe_confirm': {
        uk: 'Я розумію і приймаю втрату даних',
        en: 'I understand and accept the data loss',
        ru: 'Я понимаю и принимаю потерю данных',
      },

      // ── reset password — buttons ──────────────────────────
      'reset.btn.reset': {
        uk: 'скинути пароль',
        en: 'reset password',
        ru: 'сбросить пароль',
      },
      'reset.btn.wipe_reset': {
        uk: 'стерти й скинути',
        en: 'wipe and reset',
        ru: 'стереть и сбросить',
      },

      // ── reset password — errors ───────────────────────────
      'reset.err.short_password': {
        uk: 'Новий пароль має бути хоча б 8 символів',
        en: 'New password must be at least 8 chars',
        ru: 'Новый пароль должен быть минимум 8 символов',
      },
      'reset.err.session_lost': {
        uk: 'Сесія скидання втрачена — відкрий посилання заново',
        en: 'Reset session lost — open the link again',
        ru: 'Сессия сброса потеряна — открой ссылку заново',
      },
      'reset.err.wipe_unconfirmed': {
        uk: 'Підтверди, що приймаєш втрату даних',
        en: 'Confirm that you accept the data loss',
        ru: 'Подтверди, что принимаешь потерю данных',
      },
      'reset.err.no_state': {
        uk: 'Немає стану шифрування — використай "стерти все"',
        en: 'No encryption state — use "wipe everything"',
        ru: 'Нет состояния шифрования — используй "стереть всё"',
      },
      'reset.err.old_required': {
        uk: 'Введи поточний пароль',
        en: 'Enter your current password',
        ru: 'Введи текущий пароль',
      },
      'reset.err.old_wrong': {
        uk: 'Невірний поточний пароль',
        en: 'Wrong current password',
        ru: 'Неверный текущий пароль',
      },
      'reset.err.recovery_format': {
        uk: 'Recovery key має бути 32 hex символи',
        en: 'Recovery key must be 32 hex chars',
        ru: 'Recovery key должен быть 32 hex символа',
      },
      'reset.err.recovery_wrong': {
        uk: 'Невірний recovery key',
        en: 'Wrong recovery key',
        ru: 'Неверный recovery key',
      },
      'reset.err.link_invalid': {
        uk: 'Посилання недійсне або застаріле: {error}',
        en: 'Link is invalid or expired: {error}',
        ru: 'Ссылка недействительна или устарела: {error}',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(PASSWORD_RESET_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(PASSWORD_RESET_I18N);
  }
})();
