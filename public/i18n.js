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

  var I18N = {
    uk: {
      // ── toasts ─────────────────────────────────────────────
      'toast.copied':              'Скопійовано',
      'toast.copy_failed':         'Не вдалося скопіювати',
      'toast.copy_failed_select':  'Не вдалося скопіювати — виділи мишею',
      'toast.empty_field_copy':    'Поле пусте — нічого копіювати',
      'toast.invalid_json':        'Невалідний JSON: {error}',
      'toast.loaded':              'Завантажено · {title}',
      'toast.history_cleared':     'Історію очищено',
      'toast.paste_request':       'Встав BidRequest у ліве поле',
      'toast.error_generic':       'Помилка: {error}',
      'toast.recovery_key_copied': 'Recovery key скопійовано',
      'toast.saved':               'Збережено · {title}',
      'toast.updated':             'Оновлено · {title}',
      'toast.save_failed':         'Не вдалося зберегти: {error}',
      'toast.save_changes_failed': 'Не вдалося зберегти зміни: {error}',
      'toast.deleted':             'Видалено',
      'toast.delete_failed':       'Не вдалося видалити: {error}',
      'toast.crypto_session_lost': 'Сесія шифрування не активна — увійди в акаунт ще раз',
      'toast.decrypt_failed':      'Не вдалося розшифрувати — увійди в акаунт ще раз',
      'toast.partner_add_failed':  'Не вдалося додати партнера: {error}',
      'toast.partner_deleted':     'Партнера видалено',
      'toast.partner_delete_failed':'Не вдалося видалити партнера: {error}',
      'toast.library_unlocked':    'Бібліотеку розблоковано',
      'toast.hello':               'Привіт, {email}',
      'toast.account_created':     'Акаунт створено, {email}',
      'toast.signed_out':          'Ви вийшли з акаунту',
      'toast.analysis_complete':   'Аналіз завершено · {status}',
      'toast.email_verified':      'Email підтверджено ✓',
      'toast.verify_email_sent':   'Лист підтвердження відправлено на {email}',
      'toast.send_failed':         'Не вдалося відправити: {error}',
      'toast.password_reset':      'Пароль скинуто. Ти увійшов(ла).',
      'toast.partner_name_required':'Введи назву партнера',
      'toast.added':               'Додано · {name}',
      'toast.nothing_to_save':     'Нічого зберігати — обидва поля порожні',

      // ── confirm() dialogs ─────────────────────────────────
      'confirm.recovery_save':     'Ти точно зберіг recovery key? Без нього неможливо відновити дані якщо забудеш пароль.',
      'confirm.delete_sample':     'Видалити цей запит з бібліотеки?',
      'confirm.delete_partner':    'Видалити цього партнера? Запити що були з ним повʼязані стануть "без партнера" (не видаляються).',
      'confirm.clear_history':     'Очистити всю історію? Збережені у бібліотеці записи не зачіпаються.',
      'confirm.clobber_load':      'Поточні зміни не збережено. Завантажити цей запит і відкинути зміни?',

      // ── modal titles ──────────────────────────────────────
      'modal.unlock.title':        'розблокувати бібліотеку',
      'modal.recovery.title':      '⚠ recovery key — збережи зараз',
      'modal.password_reset.title':'скидання паролю',
      'modal.edit_sample.title':   'редагувати запит',
      'modal.partners.title':      'партнери',
      'modal.save_sample.title':   'зберегти запит',
      'modal.save_sample.update_title':'оновити запис · #{id}',

      // ── modal common labels + buttons ─────────────────────
      'btn.cancel':                'скасувати',
      'btn.save':                  'зберегти',
      'btn.update':                'оновити',
      'btn.save_as_new':           'зберегти як новий',
      'btn.copy':                  'копіювати',
      'btn.copied':                'скопійовано ✓',
      'btn.recovery_saved':        'я зберіг',
      'btn.unlock':                'розблокувати',
      'btn.signout_instead':       'вийти замість цього',
      'btn.add':                   'додати',
      'btn.close':                 'закрити',
      'btn.load_to_editor':        'завантажити в редактор',

      // ── empty / placeholder hints ─────────────────────────
      'empty.partners':            'Партнерів ще немає',
      'empty.samples':             'Збережених запитів ще немає',

      // ── status pills ──────────────────────────────────────
      'status.errors':             'критичні помилки',
      'status.warnings':           'попередження',
      'status.clean':              'чисто',
      'status.invalid':            'невалідний payload',
      'status.local':              'локально',

      // ── auth modal ────────────────────────────────────────
      'auth.login.title':          'увійти',
      'auth.register.title':       'створити акаунт',
      'auth.label.email':          'email',
      'auth.label.password':       'пароль',
      'auth.label.password_hint':  'пароль (мінімум 8 символів)',
      'auth.btn.login':            'увійти',
      'auth.btn.register':         'створити',
      'auth.switch_to_login':      'вже є акаунт? увійти',
      'auth.switch_to_register':   'немає акаунту? створити',
      'auth.forgot_password':      'забув пароль?',
      'auth.err.invalid_email':    'Невалідний email',
      'auth.err.weak_password':    'Пароль має бути хоча б 8 символів',
      'auth.err.email_taken':      'Цей email вже зареєстровано',
      'auth.err.invalid_creds':    'Невірний email або пароль',
      'auth.err.rate_limited':     'Забагато спроб — спробуй пізніше',

      // ── unlock modal ──────────────────────────────────────
      'unlock.subtitle':           '{email} · введи пароль щоб розшифрувати збережені запити',
      'unlock.err.no_crypto':      'Шифрування не налаштовано — спробуй увійти спочатку',
      'unlock.err.wrong_password': 'Невірний пароль',

      // ── recovery-key modal ────────────────────────────────
      'recovery.body':             'Це <b>єдиний</b> спосіб відновити доступ до твоєї бібліотеки якщо забудеш пароль. Я (оператор сервера) не маю його і не зможу відновити твої дані без нього. Запиши його у password-manager або на папері.',

      // ── save / edit sample modal ──────────────────────────
      'sample.label.title':        'назва',
      'sample.label.partner':      'партнер',
      'sample.label.notes':        'нотатки (необовʼязково)',
      'sample.label.notes_short':  'нотатки',
      'sample.partner_none':       '— без партнера —',
      'sample.partner_all':        'усі партнери',
      'sample.partner_unassigned': 'без партнера',
      'sample.empty':              'Збережених запитів ще немає',
      'sample.anon_cta':           'Увійди в акаунт щоб зберігати запити в особисту бібліотеку.',
      'sample.unlock_cta':         'Бібліотека зашифрована. Введи пароль щоб розблокувати.',
      'sample.btn.signin':         'увійти або створити акаунт',
      'sample.btn.unlock':         'розблокувати',

      // ── partner modal ─────────────────────────────────────
      'partner.label.add_new':     'додати нового',
      'partner.placeholder':       'наприклад MyVendor, BidMachine',

      // ── forgot password ───────────────────────────────────
      'forgot.subtitle':           'введи email — пришлемо посилання для скидання паролю (діє 15 хв).',
      'forgot.btn.back_to_login':  'назад до входу',
      'forgot.btn.send':           'надіслати',
      'forgot.sending':            'Відправляємо…',
      'forgot.sent':               'Якщо такий email існує, лист відправлено. Перевір пошту (і спам).',
      'forgot.email_required':     'Введи email',
      'forgot.invalid_email':      'Це не схоже на email — перевір введене значення',

      // ── reset password ────────────────────────────────────
      'reset.mode.rotate':         'Я памʼятаю поточний пароль',
      'reset.mode.rotate_hint':    'Бібліотека збережеться. Просто ротуємо пароль.',
      'reset.mode.recover':        'У мене є recovery key',
      'reset.mode.recover_hint':   '32-символьний ключ, який показували при реєстрації. Бібліотека збережеться.',
      'reset.mode.wipe':           'Я втратив обидва — стерти все',
      'reset.mode.wipe_hint':      'Усі збережені запити та партнери будуть видалені.',
      'reset.label.new_password':  'новий пароль (мін. 8 символів)',
      'reset.label.old_password':  'поточний пароль',
      'reset.label.recovery':      'recovery key (32 символи)',
      'reset.wipe_warn':           '<b>Це знищить всі ваші збережені запити та партнерів.</b> Зашифровані дані не можна відновити без паролю чи recovery key.',
      'reset.wipe_confirm':        'Я розумію і приймаю втрату даних',
      'reset.btn.reset':           'скинути пароль',
      'reset.btn.wipe_reset':      'стерти й скинути',
      'reset.err.short_password':  'Новий пароль має бути хоча б 8 символів',
      'reset.err.session_lost':    'Сесія скидання втрачена — відкрий посилання заново',
      'reset.err.wipe_unconfirmed':'Підтверди, що приймаєш втрату даних',
      'reset.err.no_state':        'Немає стану шифрування — використай "стерти все"',
      'reset.err.old_required':    'Введи поточний пароль',
      'reset.err.old_wrong':       'Невірний поточний пароль',
      'reset.err.recovery_format': 'Recovery key має бути 32 hex символи',
      'reset.err.recovery_wrong':  'Невірний recovery key',
      'reset.err.link_invalid':    'Посилання недійсне або застаріле: {error}',
      'reset.err.link_expired':    'Посилання застаріло — запитай нове',
      'reset.err.link_tampered':   'Посилання пошкоджено',
      'reset.err.verify_failed':   'Не вдалося підтвердити email',

      // ── peek modal ────────────────────────────────────────
      'peek.label.bid_req':        'bid request',
      'peek.label.bid_res':        'bid response',
    },

    en: {
      // ── toasts ─────────────────────────────────────────────
      'toast.copied':              'Copied',
      'toast.copy_failed':         'Couldn’t copy',
      'toast.copy_failed_select':  'Couldn’t copy — select with mouse',
      'toast.empty_field_copy':    'Field is empty — nothing to copy',
      'toast.invalid_json':        'Invalid JSON: {error}',
      'toast.loaded':              'Loaded · {title}',
      'toast.history_cleared':     'History cleared',
      'toast.paste_request':       'Paste a BidRequest in the left pane',
      'toast.error_generic':       'Error: {error}',
      'toast.recovery_key_copied': 'Recovery key copied',
      'toast.saved':               'Saved · {title}',
      'toast.updated':             'Updated · {title}',
      'toast.save_failed':         'Save failed: {error}',
      'toast.save_changes_failed': 'Couldn’t save changes: {error}',
      'toast.deleted':             'Deleted',
      'toast.delete_failed':       'Delete failed: {error}',
      'toast.crypto_session_lost': 'Encryption session lost — sign in again',
      'toast.decrypt_failed':      'Decryption failed — sign in again',
      'toast.partner_add_failed':  'Couldn’t add partner: {error}',
      'toast.partner_deleted':     'Partner deleted',
      'toast.partner_delete_failed':'Couldn’t delete partner: {error}',
      'toast.library_unlocked':    'Library unlocked',
      'toast.hello':               'Hi, {email}',
      'toast.account_created':     'Account created, {email}',
      'toast.signed_out':          'Signed out',
      'toast.analysis_complete':   'Analysis complete · {status}',
      'toast.email_verified':      'Email verified ✓',
      'toast.verify_email_sent':   'Verification email sent to {email}',
      'toast.send_failed':         'Send failed: {error}',
      'toast.password_reset':      'Password reset. You’re signed in.',
      'toast.partner_name_required':'Enter a partner name',
      'toast.added':               'Added · {name}',
      'toast.nothing_to_save':     'Nothing to save — both fields are empty',

      // ── confirm() dialogs ─────────────────────────────────
      'confirm.recovery_save':     'Did you really save your recovery key? You can’t recover data without it if you forget your password.',
      'confirm.delete_sample':     'Delete this sample from the library?',
      'confirm.delete_partner':    'Delete this partner? Linked samples become "no partner" (they’re not deleted).',
      'confirm.clear_history':     'Clear the whole history? Saved-library entries are unaffected.',
      'confirm.clobber_load':      'Current edits aren’t saved. Load this and discard them?',

      // ── modal titles ──────────────────────────────────────
      'modal.unlock.title':        'unlock library',
      'modal.recovery.title':      '⚠ recovery key — save now',
      'modal.password_reset.title':'reset password',
      'modal.edit_sample.title':   'edit sample',
      'modal.partners.title':      'partners',
      'modal.save_sample.title':   'save sample',
      'modal.save_sample.update_title':'update sample · #{id}',

      // ── modal common labels + buttons ─────────────────────
      'btn.cancel':                'cancel',
      'btn.save':                  'save',
      'btn.update':                'update',
      'btn.save_as_new':           'save as new',
      'btn.copy':                  'copy',
      'btn.copied':                'copied ✓',
      'btn.recovery_saved':        'I saved it',
      'btn.unlock':                'unlock',
      'btn.signout_instead':       'sign out instead',
      'btn.add':                   'add',
      'btn.close':                 'close',
      'btn.load_to_editor':        'load to editor',

      // ── empty / placeholder hints ─────────────────────────
      'empty.partners':            'No partners yet',
      'empty.samples':             'No saved samples yet',

      // ── status pills ──────────────────────────────────────
      'status.errors':             'critical errors',
      'status.warnings':           'warnings',
      'status.clean':              'clean',
      'status.invalid':            'invalid payload',
      'status.local':              'local',

      // ── auth modal ────────────────────────────────────────
      'auth.login.title':          'sign in',
      'auth.register.title':       'create account',
      'auth.label.email':          'email',
      'auth.label.password':       'password',
      'auth.label.password_hint':  'password (min. 8 chars)',
      'auth.btn.login':            'sign in',
      'auth.btn.register':         'create',
      'auth.switch_to_login':      'have an account? sign in',
      'auth.switch_to_register':   'no account? create one',
      'auth.forgot_password':      'forgot password?',
      'auth.err.invalid_email':    'Invalid email',
      'auth.err.weak_password':    'Password must be at least 8 chars',
      'auth.err.email_taken':      'This email is already registered',
      'auth.err.invalid_creds':    'Wrong email or password',
      'auth.err.rate_limited':     'Too many attempts — try again later',

      // ── unlock modal ──────────────────────────────────────
      'unlock.subtitle':           '{email} · enter your password to decrypt saved samples',
      'unlock.err.no_crypto':      'Encryption not set up — sign in first',
      'unlock.err.wrong_password': 'Wrong password',

      // ── recovery-key modal ────────────────────────────────
      'recovery.body':             'This is the <b>only</b> way to recover access to your library if you forget your password. I (the operator) don’t hold it and can’t recover your data without it. Save it in a password manager or on paper.',

      // ── save / edit sample modal ──────────────────────────
      'sample.label.title':        'title',
      'sample.label.partner':      'partner',
      'sample.label.notes':        'notes (optional)',
      'sample.label.notes_short':  'notes',
      'sample.partner_none':       '— no partner —',
      'sample.partner_all':        'all partners',
      'sample.partner_unassigned': 'unassigned',
      'sample.empty':              'No saved samples yet',
      'sample.anon_cta':           'Sign in to save samples to your personal library.',
      'sample.unlock_cta':         'Library is encrypted. Enter your password to unlock.',
      'sample.btn.signin':         'sign in or create account',
      'sample.btn.unlock':         'unlock',

      // ── partner modal ─────────────────────────────────────
      'partner.label.add_new':     'add new',
      'partner.placeholder':       'e.g. MyVendor, BidMachine',

      // ── forgot password ───────────────────────────────────
      'forgot.subtitle':           'Enter your email — we’ll send a reset link (valid for 15 min).',
      'forgot.btn.back_to_login':  'back to sign in',
      'forgot.btn.send':           'send',
      'forgot.sending':            'Sending…',
      'forgot.sent':               'If this email exists, a link was sent. Check your inbox (and spam).',
      'forgot.email_required':     'Enter an email',
      'forgot.invalid_email':      'Doesn’t look like an email — check the value',

      // ── reset password ────────────────────────────────────
      'reset.mode.rotate':         'I remember my current password',
      'reset.mode.rotate_hint':    'Library is preserved. We just rotate the password.',
      'reset.mode.recover':        'I have my recovery key',
      'reset.mode.recover_hint':   '32-char key shown at registration. Library is preserved.',
      'reset.mode.wipe':           'I lost both — wipe everything',
      'reset.mode.wipe_hint':      'All saved samples and partners will be deleted.',
      'reset.label.new_password':  'new password (min. 8 chars)',
      'reset.label.old_password':  'current password',
      'reset.label.recovery':      'recovery key (32 chars)',
      'reset.wipe_warn':           '<b>This will destroy all your saved samples and partners.</b> Encrypted data cannot be recovered without password or recovery key.',
      'reset.wipe_confirm':        'I understand and accept the data loss',
      'reset.btn.reset':           'reset password',
      'reset.btn.wipe_reset':      'wipe and reset',
      'reset.err.short_password':  'New password must be at least 8 chars',
      'reset.err.session_lost':    'Reset session lost — open the link again',
      'reset.err.wipe_unconfirmed':'Confirm that you accept the data loss',
      'reset.err.no_state':        'No encryption state — use "wipe everything"',
      'reset.err.old_required':    'Enter your current password',
      'reset.err.old_wrong':       'Wrong current password',
      'reset.err.recovery_format': 'Recovery key must be 32 hex chars',
      'reset.err.recovery_wrong':  'Wrong recovery key',
      'reset.err.link_invalid':    'Link is invalid or expired: {error}',
      'reset.err.link_expired':    'Link expired — request a new one',
      'reset.err.link_tampered':   'Link is tampered',
      'reset.err.verify_failed':   'Couldn’t verify email',

      // ── peek modal ────────────────────────────────────────
      'peek.label.bid_req':        'bid request',
      'peek.label.bid_res':        'bid response',
    },
  };

  // Locale source of truth: <html lang="…"> (set server-side per /uk/ or
  // /en/ route by the inline IIFE in each HTML file). localStorage is only
  // read as a fallback for surfaces that haven't set the attribute yet.
  function activeLocale() {
    try {
      var fromHtml = document.documentElement.getAttribute('lang') ||
                     document.documentElement.getAttribute('data-lang');
      if (fromHtml === 'en' || fromHtml === 'uk') return fromHtml;
      var v = localStorage.getItem('kt-lang');
      return v === 'en' ? 'en' : 'uk';
    } catch (e) {
      return 'uk';
    }
  }

  // Resolve a key in the active locale, with UK fallback. {var} placeholders
  // are interpolated from the params object (missing → literal `{var}` so a
  // bug surfaces visually rather than silently dropping the variable).
  window.t = function (key, params) {
    var lang = activeLocale();
    var tpl = (I18N[lang] && I18N[lang][key]) || I18N.uk[key];
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
