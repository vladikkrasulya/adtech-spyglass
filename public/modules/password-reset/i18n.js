/* ============================================================
   modules/password-reset/i18n.js — per-module translations.

   36 keys × 3 locales for the forgot-password / reset-password flow.
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
        uk: 'Я втратив обидва — видалити збережені дані акаунта',
        en: 'I lost both — delete saved account data',
        ru: 'Я потерял оба — удалить сохранённые данные аккаунта',
      },
      'reset.mode.wipe_hint': {
        uk: 'Збережені зразки, партнери, власні діалекти, історію активності та записи Behavior Corpus буде видалено з активного акаунта. Усі старі сесії завершаться; цей браузер увійде знову. Локальна History браузера не очищується; операційні журнали й резервні копії мають окремі строки зберігання.',
        en: 'Saved samples, partners, custom dialects, activity history, and Behavior Corpus entries will be removed from the active account. All old sessions end; this browser is signed back in. Local browser History is not cleared; operational logs and backups have separate retention periods.',
        ru: 'Сохранённые образцы, партнёры, собственные диалекты, история активности и записи Behavior Corpus будут удалены из активного аккаунта. Все старые сессии завершатся; этот браузер войдёт снова. Локальная History браузера не очищается; для операционных журналов и резервных копий действуют отдельные сроки хранения.',
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
        uk: '<b>Це видалить перелічені вище дані з активного акаунта.</b> Локальна History не очищується; операційні журнали й резервні копії мають окремі строки зберігання. Зашифровані bid-тіла не можна відновити без пароля чи recovery key.',
        en: '<b>This removes the account data listed above from the active account.</b> Local History is not cleared; operational logs and backups have separate retention periods. Encrypted bid bodies cannot be recovered without the password or recovery key.',
        ru: '<b>Это удалит перечисленные выше данные из активного аккаунта.</b> Локальная History не очищается; для операционных журналов и резервных копий действуют отдельные сроки хранения. Зашифрованные bid-тела нельзя восстановить без пароля или recovery key.',
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
        uk: 'Немає стану шифрування — вибери видалення збережених даних акаунта',
        en: 'No encryption state — choose delete saved account data',
        ru: 'Нет состояния шифрования — выбери удаление сохранённых данных аккаунта',
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
      // No {error} placeholder any more: the server's sentence is
      // English-only, so appending it produced half-Ukrainian toasts.
      // The reason now comes from the code map in index.js
      // (humanResetError) and this is only the last-resort fallback.
      'reset.err.link_invalid': {
        uk: 'Посилання недійсне або застаріле — запитай нове',
        en: 'Link is invalid or expired — request a new one',
        ru: 'Ссылка недействительна или устарела — запроси новую',
      },
      'reset.err.link_stale': {
        uk: 'Посилання більше не дійсне — запитай нове',
        en: 'Link is no longer valid — request a new one',
        ru: 'Ссылка больше не действительна — запроси новую',
      },
      'reset.err.rate_limited': {
        uk: 'Забагато спроб скидання — спробуй за 15 хвилин',
        en: 'Too many reset attempts — try again in 15 minutes',
        ru: 'Слишком много попыток сброса — попробуй через 15 минут',
      },
      'reset.err.bad_request': {
        uk: 'Не вдалося обробити запит — відкрий посилання з листа заново',
        en: 'Could not process the request — open the link from the email again',
        ru: 'Не удалось обработать запрос — открой ссылку из письма заново',
      },
      'reset.err.sessions_partial': {
        uk: 'Пароль змінено частково — спробуй ще раз і вважай старі сесії активними',
        en: 'Password reset only partially applied — retry, and treat old sessions as still active',
        ru: 'Пароль изменён частично — попробуй ещё раз и считай старые сессии активными',
      },
      'reset.err.generic': {
        uk: 'Не вдалося скинути пароль — спробуй ще раз',
        en: 'Could not reset the password — try again',
        ru: 'Не удалось сбросить пароль — попробуй ещё раз',
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
