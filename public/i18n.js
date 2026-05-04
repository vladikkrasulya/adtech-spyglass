/* ============================================================
   Spyglass frontend i18n (Phase 3 — partial).
   - `t(key, params)` resolves a UI string in the active locale.
   - Active locale: localStorage['kt-lang'] (uk | en); default 'uk'.
   - Missing keys fall back: en → uk → '[key]' placeholder.
   - Backend finding/crosscheck messages still resolve server-side via
     /api/analyze?locale=…; this file covers chrome (toasts, modals,
     button labels, confirm-dialogs, empty-states).
   ============================================================ */
(function () {
  'use strict';

  const I18N = {
    uk: {
      // ── toasts ─────────────────────────────────────────────
      'toast.copied': 'Скопійовано',
      'toast.copy_failed': 'Не вдалося скопіювати',
      'toast.copy_failed_select': 'Не вдалося скопіювати — виділи мишею',
      'toast.empty_field_copy': 'Поле пусте — нічого копіювати',
      'toast.invalid_json': 'Невалідний JSON: {error}',
      'toast.loaded': 'Завантажено · {title}',
      'toast.history_cleared': 'Історію очищено',
      'toast.paste_request': 'Встав BidRequest у ліве поле',
      'toast.nothing_to_analyze': 'Нічого аналізувати — обидва поля порожні',
      'toast.error_generic': 'Помилка: {error}',
      'toast.recovery_key_copied': 'Recovery key скопійовано',
      'toast.saved': 'Збережено · {title}',
      'toast.updated': 'Оновлено · {title}',
      'toast.save_failed': 'Не вдалося зберегти: {error}',
      'toast.save_changes_failed': 'Не вдалося зберегти зміни: {error}',
      'toast.deleted': 'Видалено',
      'toast.delete_failed': 'Не вдалося видалити: {error}',
      'toast.crypto_session_lost': 'Сесія шифрування не активна — увійди в акаунт ще раз',
      'toast.decrypt_failed': 'Не вдалося розшифрувати — увійди в акаунт ще раз',
      'toast.partner_add_failed': 'Не вдалося додати партнера: {error}',
      'toast.partner_deleted': 'Партнера видалено',
      'toast.partner_delete_failed': 'Не вдалося видалити партнера: {error}',
      'toast.library_unlocked': 'Бібліотеку розблоковано',
      'toast.hello': 'Привіт, {email}',
      'toast.account_created': 'Акаунт створено, {email}',
      'toast.signed_out': 'Ви вийшли з акаунту',
      'toast.analysis_complete': 'Аналіз завершено · {status}',
      'toast.email_verified': 'Email підтверджено ✓',
      'toast.verify_email_sent': 'Лист підтвердження відправлено на {email}',
      'toast.send_failed': 'Не вдалося відправити: {error}',
      'toast.password_reset': 'Пароль скинуто. Ти увійшов(ла).',
      'toast.partner_name_required': 'Введи назву партнера',
      'toast.added': 'Додано · {name}',
      'toast.nothing_to_save': 'Нічого зберігати — обидва поля порожні',

      // ── confirm() dialogs ─────────────────────────────────
      'confirm.recovery_save':
        'Ти точно зберіг recovery key? Без нього неможливо відновити дані якщо забудеш пароль.',
      'confirm.delete_sample': 'Видалити цей запит з бібліотеки?',
      'confirm.delete_partner':
        'Видалити цього партнера? Запити що були з ним повʼязані стануть "без партнера" (не видаляються).',
      'confirm.clear_history':
        'Очистити всю історію? Збережені у бібліотеці записи не зачіпаються.',
      'confirm.clobber_load':
        'Поточні зміни не збережено. Завантажити цей запит і відкинути зміни?',

      // ── modal titles ──────────────────────────────────────
      'modal.unlock.title': 'розблокувати бібліотеку',
      'modal.recovery.title': '⚠ recovery key — збережи зараз',
      'modal.password_reset.title': 'скидання паролю',
      'modal.edit_sample.title': 'редагувати запит',
      'modal.partners.title': 'партнери',
      'modal.save_sample.title': 'зберегти запит',
      'modal.save_sample.update_title': 'оновити запис · #{id}',

      // ── modal common labels + buttons ─────────────────────
      'btn.cancel': 'скасувати',
      'btn.save': 'зберегти',
      'btn.update': 'оновити',
      'btn.save_as_new': 'зберегти як новий',
      'btn.copy': 'копіювати',
      'btn.copied': 'скопійовано ✓',
      'btn.recovery_saved': 'я зберіг',
      'btn.unlock': 'розблокувати',
      'btn.signout_instead': 'вийти замість цього',
      'btn.add': 'додати',
      'btn.close': 'закрити',
      'btn.load_to_editor': 'завантажити в редактор',

      // ── empty / placeholder hints ─────────────────────────
      'empty.partners': 'Партнерів ще немає',
      'empty.samples': 'Збережених запитів ще немає',

      // ── status pills ──────────────────────────────────────
      'status.errors': 'критичні помилки',
      'status.warnings': 'попередження',
      'status.clean': 'чисто',
      'status.invalid': 'невалідний payload',
      'status.local': 'локально',

      // ── theme toggle tooltips ─────────────────────────────
      'theme.tooltip.auto': 'тема: авто · клік → світла',
      'theme.tooltip.light': 'тема: світла · клік → темна',
      'theme.tooltip.dark': 'тема: темна · клік → авто',

      // ── auth modal ────────────────────────────────────────
      'auth.login.title': 'увійти',
      'auth.register.title': 'створити акаунт',
      'auth.label.email': 'email',
      'auth.label.password': 'пароль',
      'auth.label.password_hint': 'пароль (мінімум 8 символів)',
      'auth.btn.login': 'увійти',
      'auth.btn.register': 'створити',
      'auth.switch_to_login': 'вже є акаунт? увійти',
      'auth.switch_to_register': 'немає акаунту? створити',
      'auth.forgot_password': 'забув пароль?',
      'auth.err.invalid_email': 'Невалідний email',
      'auth.err.weak_password': 'Пароль має бути хоча б 8 символів',
      'auth.err.email_taken': 'Цей email вже зареєстровано',
      'auth.err.invalid_creds': 'Невірний email або пароль',
      'auth.err.rate_limited': 'Забагато спроб — спробуй пізніше',

      // ── unlock modal ──────────────────────────────────────
      'unlock.subtitle': '{email} · введи пароль щоб розшифрувати збережені запити',
      'unlock.err.no_crypto': 'Шифрування не налаштовано — спробуй увійти спочатку',
      'unlock.err.wrong_password': 'Невірний пароль',

      // ── recovery-key modal ────────────────────────────────
      'recovery.body':
        'Це <b>єдиний</b> спосіб відновити доступ до твоєї бібліотеки якщо забудеш пароль. Я (оператор сервера) не маю його і не зможу відновити твої дані без нього. Запиши його у password-manager або на папері.',

      // ── save / edit sample modal ──────────────────────────
      'sample.label.title': 'назва',
      'sample.label.partner': 'партнер',
      'sample.label.notes': 'нотатки (необовʼязково)',
      'sample.label.notes_short': 'нотатки',
      'sample.partner_none': '— без партнера —',
      'sample.partner_all': 'усі партнери',
      'sample.partner_unassigned': 'без партнера',
      'sample.empty': 'Збережених запитів ще немає',
      'sample.anon_cta': 'Увійди в акаунт щоб зберігати запити в особисту бібліотеку.',
      'sample.unlock_cta': 'Бібліотека зашифрована. Введи пароль щоб розблокувати.',
      'sample.btn.signin': 'увійти або створити акаунт',
      'sample.btn.unlock': 'розблокувати',

      // ── partner modal ─────────────────────────────────────
      'partner.label.add_new': 'додати нового',
      'partner.placeholder': 'наприклад MyVendor, BidMachine',

      // ── forgot password ───────────────────────────────────
      'forgot.subtitle': 'введи email — пришлемо посилання для скидання паролю (діє 15 хв).',
      'forgot.btn.back_to_login': 'назад до входу',
      'forgot.btn.send': 'надіслати',
      'forgot.sending': 'Відправляємо…',
      'forgot.sent': 'Якщо такий email існує, лист відправлено. Перевір пошту (і спам).',
      'forgot.email_required': 'Введи email',
      'forgot.invalid_email': 'Це не схоже на email — перевір введене значення',

      // ── reset password ────────────────────────────────────
      'reset.mode.rotate': 'Я памʼятаю поточний пароль',
      'reset.mode.rotate_hint': 'Бібліотека збережеться. Просто ротуємо пароль.',
      'reset.mode.recover': 'У мене є recovery key',
      'reset.mode.recover_hint':
        '32-символьний ключ, який показували при реєстрації. Бібліотека збережеться.',
      'reset.mode.wipe': 'Я втратив обидва — стерти все',
      'reset.mode.wipe_hint': 'Усі збережені запити та партнери будуть видалені.',
      'reset.label.new_password': 'новий пароль (мін. 8 символів)',
      'reset.label.old_password': 'поточний пароль',
      'reset.label.recovery': 'recovery key (32 символи)',
      'reset.wipe_warn':
        '<b>Це знищить всі ваші збережені запити та партнерів.</b> Зашифровані дані не можна відновити без паролю чи recovery key.',
      'reset.wipe_confirm': 'Я розумію і приймаю втрату даних',
      'reset.btn.reset': 'скинути пароль',
      'reset.btn.wipe_reset': 'стерти й скинути',
      'reset.err.short_password': 'Новий пароль має бути хоча б 8 символів',
      'reset.err.session_lost': 'Сесія скидання втрачена — відкрий посилання заново',
      'reset.err.wipe_unconfirmed': 'Підтверди, що приймаєш втрату даних',
      'reset.err.no_state': 'Немає стану шифрування — використай "стерти все"',
      'reset.err.old_required': 'Введи поточний пароль',
      'reset.err.old_wrong': 'Невірний поточний пароль',
      'reset.err.recovery_format': 'Recovery key має бути 32 hex символи',
      'reset.err.recovery_wrong': 'Невірний recovery key',
      'reset.err.link_invalid': 'Посилання недійсне або застаріле: {error}',
      'reset.err.link_expired': 'Посилання застаріло — запитай нове',
      'reset.err.link_tampered': 'Посилання пошкоджено',
      'reset.err.verify_failed': 'Не вдалося підтвердити email',

      // ── peek modal ────────────────────────────────────────
      'peek.label.bid_req': 'bid request',
      'peek.label.bid_res': 'bid response',
    },

    en: {
      // ── toasts ─────────────────────────────────────────────
      'toast.copied': 'Copied',
      'toast.copy_failed': 'Couldn’t copy',
      'toast.copy_failed_select': 'Couldn’t copy — select with mouse',
      'toast.empty_field_copy': 'Field is empty — nothing to copy',
      'toast.invalid_json': 'Invalid JSON: {error}',
      'toast.loaded': 'Loaded · {title}',
      'toast.history_cleared': 'History cleared',
      'toast.paste_request': 'Paste a BidRequest in the left pane',
      'toast.nothing_to_analyze': 'Nothing to analyze — both fields are empty',
      'toast.error_generic': 'Error: {error}',
      'toast.recovery_key_copied': 'Recovery key copied',
      'toast.saved': 'Saved · {title}',
      'toast.updated': 'Updated · {title}',
      'toast.save_failed': 'Save failed: {error}',
      'toast.save_changes_failed': 'Couldn’t save changes: {error}',
      'toast.deleted': 'Deleted',
      'toast.delete_failed': 'Delete failed: {error}',
      'toast.crypto_session_lost': 'Encryption session lost — sign in again',
      'toast.decrypt_failed': 'Decryption failed — sign in again',
      'toast.partner_add_failed': 'Couldn’t add partner: {error}',
      'toast.partner_deleted': 'Partner deleted',
      'toast.partner_delete_failed': 'Couldn’t delete partner: {error}',
      'toast.library_unlocked': 'Library unlocked',
      'toast.hello': 'Hi, {email}',
      'toast.account_created': 'Account created, {email}',
      'toast.signed_out': 'Signed out',
      'toast.analysis_complete': 'Analysis complete · {status}',
      'toast.email_verified': 'Email verified ✓',
      'toast.verify_email_sent': 'Verification email sent to {email}',
      'toast.send_failed': 'Send failed: {error}',
      'toast.password_reset': 'Password reset. You’re signed in.',
      'toast.partner_name_required': 'Enter a partner name',
      'toast.added': 'Added · {name}',
      'toast.nothing_to_save': 'Nothing to save — both fields are empty',

      // ── confirm() dialogs ─────────────────────────────────
      'confirm.recovery_save':
        'Did you really save your recovery key? You can’t recover data without it if you forget your password.',
      'confirm.delete_sample': 'Delete this sample from the library?',
      'confirm.delete_partner':
        'Delete this partner? Linked samples become "no partner" (they’re not deleted).',
      'confirm.clear_history': 'Clear the whole history? Saved-library entries are unaffected.',
      'confirm.clobber_load': 'Current edits aren’t saved. Load this and discard them?',

      // ── modal titles ──────────────────────────────────────
      'modal.unlock.title': 'unlock library',
      'modal.recovery.title': '⚠ recovery key — save now',
      'modal.password_reset.title': 'reset password',
      'modal.edit_sample.title': 'edit sample',
      'modal.partners.title': 'partners',
      'modal.save_sample.title': 'save sample',
      'modal.save_sample.update_title': 'update sample · #{id}',

      // ── modal common labels + buttons ─────────────────────
      'btn.cancel': 'cancel',
      'btn.save': 'save',
      'btn.update': 'update',
      'btn.save_as_new': 'save as new',
      'btn.copy': 'copy',
      'btn.copied': 'copied ✓',
      'btn.recovery_saved': 'I saved it',
      'btn.unlock': 'unlock',
      'btn.signout_instead': 'sign out instead',
      'btn.add': 'add',
      'btn.close': 'close',
      'btn.load_to_editor': 'load to editor',

      // ── empty / placeholder hints ─────────────────────────
      'empty.partners': 'No partners yet',
      'empty.samples': 'No saved samples yet',

      // ── status pills ──────────────────────────────────────
      'status.errors': 'critical errors',
      'status.warnings': 'warnings',
      'status.clean': 'clean',
      'status.invalid': 'invalid payload',
      'status.local': 'local',

      // ── theme toggle tooltips ─────────────────────────────
      'theme.tooltip.auto': 'theme: auto · click → light',
      'theme.tooltip.light': 'theme: light · click → dark',
      'theme.tooltip.dark': 'theme: dark · click → auto',

      // ── auth modal ────────────────────────────────────────
      'auth.login.title': 'sign in',
      'auth.register.title': 'create account',
      'auth.label.email': 'email',
      'auth.label.password': 'password',
      'auth.label.password_hint': 'password (min. 8 chars)',
      'auth.btn.login': 'sign in',
      'auth.btn.register': 'create',
      'auth.switch_to_login': 'have an account? sign in',
      'auth.switch_to_register': 'no account? create one',
      'auth.forgot_password': 'forgot password?',
      'auth.err.invalid_email': 'Invalid email',
      'auth.err.weak_password': 'Password must be at least 8 chars',
      'auth.err.email_taken': 'This email is already registered',
      'auth.err.invalid_creds': 'Wrong email or password',
      'auth.err.rate_limited': 'Too many attempts — try again later',

      // ── unlock modal ──────────────────────────────────────
      'unlock.subtitle': '{email} · enter your password to decrypt saved samples',
      'unlock.err.no_crypto': 'Encryption not set up — sign in first',
      'unlock.err.wrong_password': 'Wrong password',

      // ── recovery-key modal ────────────────────────────────
      'recovery.body':
        'This is the <b>only</b> way to recover access to your library if you forget your password. I (the operator) don’t hold it and can’t recover your data without it. Save it in a password manager or on paper.',

      // ── save / edit sample modal ──────────────────────────
      'sample.label.title': 'title',
      'sample.label.partner': 'partner',
      'sample.label.notes': 'notes (optional)',
      'sample.label.notes_short': 'notes',
      'sample.partner_none': '— no partner —',
      'sample.partner_all': 'all partners',
      'sample.partner_unassigned': 'unassigned',
      'sample.empty': 'No saved samples yet',
      'sample.anon_cta': 'Sign in to save samples to your personal library.',
      'sample.unlock_cta': 'Library is encrypted. Enter your password to unlock.',
      'sample.btn.signin': 'sign in or create account',
      'sample.btn.unlock': 'unlock',

      // ── partner modal ─────────────────────────────────────
      'partner.label.add_new': 'add new',
      'partner.placeholder': 'e.g. MyVendor, BidMachine',

      // ── forgot password ───────────────────────────────────
      'forgot.subtitle': 'Enter your email — we’ll send a reset link (valid for 15 min).',
      'forgot.btn.back_to_login': 'back to sign in',
      'forgot.btn.send': 'send',
      'forgot.sending': 'Sending…',
      'forgot.sent': 'If this email exists, a link was sent. Check your inbox (and spam).',
      'forgot.email_required': 'Enter an email',
      'forgot.invalid_email': 'Doesn’t look like an email — check the value',

      // ── reset password ────────────────────────────────────
      'reset.mode.rotate': 'I remember my current password',
      'reset.mode.rotate_hint': 'Library is preserved. We just rotate the password.',
      'reset.mode.recover': 'I have my recovery key',
      'reset.mode.recover_hint': '32-char key shown at registration. Library is preserved.',
      'reset.mode.wipe': 'I lost both — wipe everything',
      'reset.mode.wipe_hint': 'All saved samples and partners will be deleted.',
      'reset.label.new_password': 'new password (min. 8 chars)',
      'reset.label.old_password': 'current password',
      'reset.label.recovery': 'recovery key (32 chars)',
      'reset.wipe_warn':
        '<b>This will destroy all your saved samples and partners.</b> Encrypted data cannot be recovered without password or recovery key.',
      'reset.wipe_confirm': 'I understand and accept the data loss',
      'reset.btn.reset': 'reset password',
      'reset.btn.wipe_reset': 'wipe and reset',
      'reset.err.short_password': 'New password must be at least 8 chars',
      'reset.err.session_lost': 'Reset session lost — open the link again',
      'reset.err.wipe_unconfirmed': 'Confirm that you accept the data loss',
      'reset.err.no_state': 'No encryption state — use "wipe everything"',
      'reset.err.old_required': 'Enter your current password',
      'reset.err.old_wrong': 'Wrong current password',
      'reset.err.recovery_format': 'Recovery key must be 32 hex chars',
      'reset.err.recovery_wrong': 'Wrong recovery key',
      'reset.err.link_invalid': 'Link is invalid or expired: {error}',
      'reset.err.link_expired': 'Link expired — request a new one',
      'reset.err.link_tampered': 'Link is tampered',
      'reset.err.verify_failed': 'Couldn’t verify email',

      // ── peek modal ────────────────────────────────────────
      'peek.label.bid_req': 'bid request',
      'peek.label.bid_res': 'bid response',

      // ── json-input badge (live) ───────────────────────────
      'badge.empty': 'empty',
      'badge.valid': 'valid',
      'badge.invalid': 'invalid',
    },
    ru: {
      'toast.copied': 'Скопировано',
      'toast.copy_failed': 'Не удалось скопировать',
      'toast.copy_failed_select': 'Не удалось скопировать — выдели мышью',
      'toast.empty_field_copy': 'Поле пустое — нечего копировать',
      'toast.invalid_json': 'Невалидный JSON: {error}',
      'toast.loaded': 'Загружено · {title}',
      'toast.history_cleared': 'История очищена',
      'toast.paste_request': 'Вставь BidRequest в левое поле',
      'toast.nothing_to_analyze': 'Нечего анализировать — оба поля пусты',
      'toast.error_generic': 'Ошибка: {error}',
      'toast.recovery_key_copied': 'Recovery key скопирован',
      'toast.saved': 'Сохранено · {title}',
      'toast.updated': 'Обновлено · {title}',
      'toast.save_failed': 'Не удалось сохранить: {error}',
      'toast.save_changes_failed': 'Не удалось сохранить изменения: {error}',
      'toast.deleted': 'Удалено',
      'toast.delete_failed': 'Не удалось удалить: {error}',
      'toast.crypto_session_lost': 'Сессия шифрования не активна — войди в аккаунт ещё раз',
      'toast.decrypt_failed': 'Не удалось расшифровать — войди в аккаунт ещё раз',
      'toast.partner_add_failed': 'Не удалось добавить партнёра: {error}',
      'toast.partner_deleted': 'Партнёр удалён',
      'toast.partner_delete_failed': 'Не удалось удалить партнёра: {error}',
      'toast.library_unlocked': 'Библиотека разблокирована',
      'toast.hello': 'Привет, {email}',
      'toast.account_created': 'Аккаунт создан, {email}',
      'toast.signed_out': 'Вы вышли из аккаунта',
      'toast.analysis_complete': 'Анализ завершён · {status}',
      'toast.email_verified': 'Email подтверждён ✓',
      'toast.verify_email_sent': 'Письмо подтверждения отправлено на {email}',
      'toast.send_failed': 'Не удалось отправить: {error}',
      'toast.password_reset': 'Пароль сброшен. Ты вошёл(ла).',
      'toast.partner_name_required': 'Введи название партнёра',
      'toast.added': 'Добавлено · {name}',
      'toast.nothing_to_save': 'Нечего сохранять — оба поля пусты',
      'confirm.recovery_save':
        'Ты точно сохранил recovery key? Без него невозможно восстановить данные если забудешь пароль.',
      'confirm.delete_sample': 'Удалить этот запрос из библиотеки?',
      'confirm.delete_partner':
        'Удалить этого партнёра? Запросы, которые с ним были связаны, станут "без партнёра" (не удаляются).',
      'confirm.clear_history':
        'Очистить всю историю? Сохранённые в библиотеке записи не затрагиваются.',
      'confirm.clobber_load':
        'Текущие изменения не сохранены. Загрузить этот запрос и отбросить изменения?',
      'modal.unlock.title': 'разблокировать библиотеку',
      'modal.recovery.title': '⚠ recovery key — сохрани сейчас',
      'modal.password_reset.title': 'сброс пароля',
      'modal.edit_sample.title': 'редактировать запрос',
      'modal.partners.title': 'партнёры',
      'modal.save_sample.title': 'сохранить запрос',
      'modal.save_sample.update_title': 'обновить запись · #{id}',
      'btn.cancel': 'отмена',
      'btn.save': 'сохранить',
      'btn.update': 'обновить',
      'btn.save_as_new': 'сохранить как новый',
      'btn.copy': 'копировать',
      'btn.copied': 'скопировано ✓',
      'btn.recovery_saved': 'я сохранил',
      'btn.unlock': 'разблокировать',
      'btn.signout_instead': 'выйти вместо этого',
      'btn.add': 'добавить',
      'btn.close': 'закрыть',
      'btn.load_to_editor': 'загрузить в редактор',
      'empty.partners': 'Партнёров пока нет',
      'empty.samples': 'Сохранённых запросов пока нет',
      'status.errors': 'критические ошибки',
      'status.warnings': 'предупреждения',
      'status.clean': 'чисто',
      'status.invalid': 'невалидный payload',
      'status.local': 'локально',
      'theme.tooltip.auto': 'тема: авто · клик → светлая',
      'theme.tooltip.light': 'тема: светлая · клик → тёмная',
      'theme.tooltip.dark': 'тема: тёмная · клик → авто',
      'auth.login.title': 'войти',
      'auth.register.title': 'создать аккаунт',
      'auth.label.email': 'email',
      'auth.label.password': 'пароль',
      'auth.label.password_hint': 'пароль (минимум 8 символов)',
      'auth.btn.login': 'войти',
      'auth.btn.register': 'создать',
      'auth.switch_to_login': 'уже есть аккаунт? войти',
      'auth.switch_to_register': 'нет аккаунта? создать',
      'auth.forgot_password': 'забыл пароль?',
      'auth.err.invalid_email': 'Невалидный email',
      'auth.err.weak_password': 'Пароль должен быть минимум 8 символов',
      'auth.err.email_taken': 'Этот email уже зарегистрирован',
      'auth.err.invalid_creds': 'Неверный email или пароль',
      'auth.err.rate_limited': 'Слишком много попыток — попробуй позже',
      'unlock.subtitle': '{email} · введи пароль чтобы расшифровать сохранённые запросы',
      'unlock.err.no_crypto': 'Шифрование не настроено — попробуй сначала войти',
      'unlock.err.wrong_password': 'Неверный пароль',
      'recovery.body':
        'Это <b>единственный</b> способ восстановить доступ к твоей библиотеке если забудешь пароль. Я (оператор сервера) не имею его и не смогу восстановить твои данные без него. Запиши его в password-manager или на бумаге.',
      'sample.label.title': 'название',
      'sample.label.partner': 'партнёр',
      'sample.label.notes': 'заметки (необязательно)',
      'sample.label.notes_short': 'заметки',
      'sample.partner_none': '— без партнёра —',
      'sample.partner_all': 'все партнёры',
      'sample.partner_unassigned': 'без партнёра',
      'sample.empty': 'Сохранённых запросов пока нет',
      'sample.anon_cta': 'Войди в аккаунт чтобы сохранять запросы в личную библиотеку.',
      'sample.unlock_cta': 'Библиотека зашифрована. Введи пароль чтобы разблокировать.',
      'sample.btn.signin': 'войти или создать аккаунт',
      'sample.btn.unlock': 'разблокировать',
      'partner.label.add_new': 'добавить нового',
      'partner.placeholder': 'например MyVendor, BidMachine',
      'forgot.subtitle': 'введи email — пришлём ссылку для сброса пароля (действует 15 мин).',
      'forgot.btn.back_to_login': 'назад ко входу',
      'forgot.btn.send': 'отправить',
      'forgot.sending': 'Отправляем…',
      'forgot.sent': 'Если такой email существует, письмо отправлено. Проверь почту (и спам).',
      'forgot.email_required': 'Введи email',
      'forgot.invalid_email': 'Это не похоже на email — проверь введённое значение',
      'reset.mode.rotate': 'Я помню текущий пароль',
      'reset.mode.rotate_hint': 'Библиотека сохранится. Просто ротируем пароль.',
      'reset.mode.recover': 'У меня есть recovery key',
      'reset.mode.recover_hint':
        '32-символьный ключ, который показывали при регистрации. Библиотека сохранится.',
      'reset.mode.wipe': 'Я потерял оба — стереть всё',
      'reset.mode.wipe_hint': 'Все сохранённые запросы и партнёры будут удалены.',
      'reset.label.new_password': 'новый пароль (мин. 8 символов)',
      'reset.label.old_password': 'текущий пароль',
      'reset.label.recovery': 'recovery key (32 символа)',
      'reset.wipe_warn':
        '<b>Это уничтожит все ваши сохранённые запросы и партнёров.</b> Зашифрованные данные нельзя восстановить без пароля или recovery key.',
      'reset.wipe_confirm': 'Я понимаю и принимаю потерю данных',
      'reset.btn.reset': 'сбросить пароль',
      'reset.btn.wipe_reset': 'стереть и сбросить',
      'reset.err.short_password': 'Новый пароль должен быть минимум 8 символов',
      'reset.err.session_lost': 'Сессия сброса потеряна — открой ссылку заново',
      'reset.err.wipe_unconfirmed': 'Подтверди, что принимаешь потерю данных',
      'reset.err.no_state': 'Нет состояния шифрования — используй "стереть всё"',
      'reset.err.old_required': 'Введи текущий пароль',
      'reset.err.old_wrong': 'Неверный текущий пароль',
      'reset.err.recovery_format': 'Recovery key должен быть 32 hex символа',
      'reset.err.recovery_wrong': 'Неверный recovery key',
      'reset.err.link_invalid': 'Ссылка недействительна или устарела: {error}',
      'reset.err.link_expired': 'Ссылка устарела — запроси новую',
      'reset.err.link_tampered': 'Ссылка повреждена',
      'reset.err.verify_failed': 'Не удалось подтвердить email',
      'peek.label.bid_req': 'bid request',
      'peek.label.bid_res': 'bid response',
    },
  };

  // EN locale doesn't have these by default — they were added together with
  // the locale flip, after the original 131-key Tier-1 cut.
  I18N.uk['badge.empty'] = 'порожньо';
  I18N.uk['badge.valid'] = 'валідний';
  I18N.uk['badge.invalid'] = 'невалідний';
  I18N.uk['history.empty'] = 'Історія порожня — встав запит щоб почати';
  I18N.en['history.empty'] = 'History empty — paste a request to get started';
  I18N.ru['badge.empty'] = 'пусто';
  I18N.ru['badge.valid'] = 'валидный';
  I18N.ru['badge.invalid'] = 'невалидный';
  I18N.ru['history.empty'] = 'История пустая — вставь запрос чтобы начать';

  // Locale source of truth: <html lang="…"> (set server-side per /uk/ or
  // /en/ route by the inline IIFE in each HTML file). localStorage is only
  // read as a fallback for surfaces that haven't set the attribute yet.
  function activeLocale() {
    try {
      const fromHtml =
        document.documentElement.getAttribute('lang') ||
        document.documentElement.getAttribute('data-lang');
      if (fromHtml === 'en' || fromHtml === 'uk' || fromHtml === 'ru') return fromHtml;
      const v = localStorage.getItem('kt-lang');
      if (v === 'en' || v === 'ru') return v;
      return 'uk';
    } catch (e) {
      return 'uk';
    }
  }

  // Resolve a key in the active locale, with UK fallback. {var} placeholders
  // are interpolated from the params object (missing → literal `{var}` so a
  // bug surfaces visually rather than silently dropping the variable).
  window.t = function (key, params) {
    const lang = activeLocale();
    const tpl = (I18N[lang] && I18N[lang][key]) || I18N.uk[key];
    if (typeof tpl !== 'string') return '[' + key + ']';
    if (!params) return tpl;
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      return params[k] != null ? String(params[k]) : '{' + k + '}';
    });
  };

  // Expose for debugging + future expansion.
  window.tInfo = function () {
    return {
      locale: activeLocale(),
      keys_uk: Object.keys(I18N.uk).length,
      keys_en: Object.keys(I18N.en).length,
    };
  };
})();
