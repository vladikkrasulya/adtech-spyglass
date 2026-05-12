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
      // ── action-button flash statuses (post-success label swap) ──
      'button.status.copied': 'скопійовано',
      'button.status.formatted': 'відформатовано',
      'button.status.cleared': 'очищено',
      'button.status.analyzing': 'аналізую…',

      // ── toasts ─────────────────────────────────────────────
      'toast.copied': 'Скопійовано',
      'toast.copy_failed': 'Не вдалося скопіювати',
      'toast.copy_failed_select': 'Не вдалося скопіювати — виділи мишею',
      'toast.empty_field_copy': 'Поле пусте — нічого копіювати',
      'toast.invalid_json': 'Невалідний JSON: {error}',
      'toast.loaded': 'Завантажено · {title}',
      'toast.history_cleared': 'Історію очищено',
      'toast.layout.reset': 'Layout скинуто — обидві панелі знову видимі',
      'toast.paste_request': 'Встав BidRequest у ліве поле',
      'toast.nothing_to_analyze': 'Нічого аналізувати — обидва поля порожні',
      // toast.nothing_to_mirror + toast.mirror_* keys live in modules/mirror/i18n.js
      'toast.error_generic': 'Помилка: {error}',
      // toast.recovery_key_copied lives in modules/recovery/i18n.js
      'toast.saved': 'Збережено · {title}',
      'toast.updated': 'Оновлено · {title}',
      'toast.save_failed': 'Не вдалося зберегти: {error}',
      'toast.save_changes_failed': 'Не вдалося зберегти зміни: {error}',
      'toast.deleted': 'Видалено',
      'toast.delete_failed': 'Не вдалося видалити: {error}',
      'toast.crypto_session_lost': 'Сесія шифрування не активна — увійди в акаунт ще раз',
      'toast.decrypt_failed': 'Не вдалося розшифрувати — увійди в акаунт ще раз',
      // toast.library_unlocked → /modules/unlock/i18n.js
      // toast.hello + toast.account_created + toast.account_created_email_failed
      //   → /modules/auth/i18n.js
      'toast.signed_out': 'Ви вийшли з акаунту',
      'toast.analysis_complete': 'Аналіз завершено · {status}',
      'toast.email_verified': 'Email підтверджено ✓',
      'toast.verify_email_sent': 'Лист підтвердження відправлено на {email}',
      'toast.send_failed': 'Не вдалося відправити: {error}',
      // toast.password_reset lives in modules/password-reset/i18n.js (lazy)
      'toast.added': 'Додано · {name}',
      'toast.nothing_to_save': 'Нічого зберігати — обидва поля порожні',
      'toast.signin_to_save': 'Увійдіть, щоб зберігати запити в особисту бібліотеку',
      'toast.bundle_downloaded': 'Завантажено · {name}',
      // toast.share_* keys live in modules/share/i18n.js (registered at boot)

      // ── embed modal ───────────────────────────────────────

      // ── confirm() dialogs ─────────────────────────────────
      // confirm.recovery_save lives in modules/recovery/i18n.js
      'confirm.delete_sample': 'Видалити цей запит з бібліотеки?',
      'confirm.clear_history':
        'Очистити всю історію? Збережені у бібліотеці записи не зачіпаються.',
      'confirm.clobber_load':
        'Поточні зміни не збережено. Завантажити цей запит і відкинути зміни?',

      // ── modal titles ──────────────────────────────────────
      // modal.unlock.title → /modules/unlock/i18n.js
      // modal.recovery.title → /modules/recovery/i18n.js
      // modal.password_reset.title → /modules/password-reset/i18n.js
      'modal.edit_sample.title': 'редагувати запит',
      // modal.save_sample.* keys live in modules/save-sample/i18n.js
      // modal.mirror.* + toast.mirror_share_* keys live in modules/mirror/i18n.js
      // modal.live.* + toast.live_* keys live in modules/live/i18n.js
      'finding.detail.path': 'Шлях у JSON',
      'finding.detail.value_at_path': 'Поточне значення',
      'finding.detail.value_missing': 'Поле відсутнє у вставленому JSON (тому й знахідка).',
      'finding.detail.severity': 'Серйозність',
      'finding.detail.spec': 'Специфікація',
      'finding.detail.rule_id': 'ID правила',
      'finding.severity.error.label': 'error',
      'finding.severity.error.text': 'Біржі відхилять запит/ставку — bid не дійде до аукціону.',
      'finding.severity.warning.label': 'warning',
      'finding.severity.warning.text':
        'Більшість бірж толерують, але fill-rate знизиться — варто виправити.',
      'finding.severity.info.label': 'info',
      'finding.severity.info.text': 'Best-practice примітка — не баг, але краще робити так.',
      'corpus.bar.label':
        '{count} події у поточному probe — можна зберегти як приклад для майбутнього confusion matrix.',
      'corpus.bar.save_btn': 'зберегти як corpus',
      'corpus.cabinet.total': 'усього',
      'corpus.cabinet.empty':
        'Поки нічого не збережено. Згенеруй або завантаж зразок, відкрий behavior tab — і там зʼявиться кнопка «зберегти як corpus».',
      'corpus.cabinet.delete_title': 'видалити цей запис',
      'corpus.label.legitimate': 'легітимно',
      'corpus.label.fraud': 'шахрайство',
      'corpus.label.ambiguous': 'неоднозначно',
      'toast.corpus_deleted': 'Запис видалено',
      'toast.corpus_delete_failed': 'Не вдалось видалити: {error}',
      'confirm.corpus_delete': 'Видалити цей запис corpus? Це незворотно.',
      'matrix.empty':
        'Поки порожньо. Збережи хоча б по одному «легітимному» і «шахрайському» зразку — і таблиця заповниться.',
      'matrix.no_patterns':
        'Жоден патерн не спрацював на твоєму корпусі. Або корпус замалий, або детектори не бачать що в подіях.',
      'matrix.summary.patterns': 'патернів',
      'matrix.col.pattern': 'патерн',
      'matrix.col.precision': 'precision',
      'matrix.col.recall': 'recall',
      'builder.title': 'Конструктор тимчасового діалекту',
      'builder.name_label': 'Назва діалекту',
      'builder.name_placeholder': 'наприклад, SSP-Custom',
      'builder.clusters_heading': 'Знайдені кластери',
      'builder.fields_heading': 'Усі знайдені поля',
      'builder.empty': 'Поки що немає достатньо даних. Запусти аналіз кількох запитів.',
      'builder.use_cluster': 'Використати',
      'builder.cancel': 'Скасувати',
      'builder.create': 'Створити тимчасовий діалект',
      'builder.info': '{n} полів обрано',
      'builder.suggest_name': 'Запропонувати',
      'builder.suggest_name_tooltip': 'Запропонувати назву через локальну LLM',
      'builder.suggesting': 'Думаю…',
      'banner.new_patterns': 'Виявлено {n} нових патернів полів',
      // modal.simbids.* + toast.simbids_* keys live in modules/simulate/i18n.js

      // ── modal common labels + buttons ─────────────────────
      'btn.cancel': 'скасувати',
      'btn.save': 'зберегти',
      'btn.update': 'оновити',
      'btn.save_as_new': 'зберегти як новий',
      'btn.copy': 'копіювати',
      'btn.copied': 'скопійовано ✓',
      // btn.recovery_saved → /modules/recovery/i18n.js
      // btn.unlock + btn.signout_instead → /modules/unlock/i18n.js
      'btn.signout': 'вийти',
      'btn.add': 'додати',
      'btn.close': 'закрити',
      'btn.load_to_editor': 'завантажити в редактор',

      // ── keyboard shortcuts cheat-sheet ────────────────────

      // ── behavior tab (creative-probe) ─────────────────────
      'behavior.empty':
        'Відрендер креатив справа — Behavior-двигун аналізує спроби клік-джекінгу, бот-патерни, маніпуляції з фреймами та важкі креативи.',
      'behavior.label.trigger': 'тригер',
      'behavior.kind.click_skim_suspect': 'підозра на click-skim',
      'behavior.kind.auto_navigate': 'авто-навігація без gesture',
      'behavior.kind.window_open': 'window.open',
      'behavior.kind.location_set': 'зміна location',
      'behavior.kind.programmatic_click': 'програмний клік',
      'behavior.kind.navigation': 'навігація',
      'behavior.kind.invisible_overlay_click': 'клік по невидимій пастці',
      'behavior.kind.center_synth_click': 'центрований синтетичний клік',
      'behavior.kind.click_burst': 'серія кліків (бот)',
      'behavior.kind.phantom_click': 'phantom-клік (без gesture)',
      'behavior.kind.frame_bust_anchor': 'frame-bust через <a target=_top>',
      'behavior.kind.frame_bust_form': 'frame-bust через <form target=_top>',
      'behavior.kind.heavy_ad_cpu': 'heavy ad: CPU поріг пробитий',
      'behavior.kind.heavy_ad_network': 'heavy ad: > 4 MB сабресурсів',
      'behavior.kind.frozen_thread': 'iframe завис (watchdog)',
      'behavior.kind.permission_abuse': 'запит системного дозволу',
      'behavior.kind.static_obfuscation': 'статика: обфускація',
      'behavior.kind.static_miner': 'статика: підпис майнера',
      'behavior.kind.static_xss_marker': 'статика: DOM-XSS-сінк',
      'behavior.kind.static_high_entropy': 'статика: base64 high-entropy blob',
      'behavior.heading.findings': 'Знайдено загроз',
      'behavior.heading.timeline': 'Хронологія подій',

      // ── empty / placeholder hints ─────────────────────────
      'empty.samples': 'Збережених запитів ще немає',

      // ── status pills ──────────────────────────────────────
      'status.errors': 'критичні помилки',
      'status.warnings': 'попередження',
      'status.clean': 'чисто',
      'status.invalid': 'невалідний payload',
      'status.local': 'локально',
      'validation.all_passed': 'Усі перевірки пройдено — {type} валідний',

      // ── theme toggle tooltips ─────────────────────────────
      'theme.tooltip.auto': 'тема: авто · клік → світла',
      'theme.tooltip.light': 'тема: світла · клік → темна',
      'theme.tooltip.dark': 'тема: темна · клік → авто',

      // ── auth modal ────────────────────────────────────────
      // Most keys moved to /modules/auth/i18n.js. Three labels stay
      // here because they're shared with sibling modals (unlock,
      // forgot/reset password): auth.label.email, auth.label.password,
      // auth.forgot_password.
      'auth.label.email': 'email',
      'auth.label.password': 'пароль',
      'auth.forgot_password': 'забув пароль?',

      // ── unlock modal ──────────────────────────────────────
      // unlock.subtitle + unlock.err.* → /modules/unlock/i18n.js

      // ── recovery-key modal ────────────────────────────────
      // recovery.body lives in modules/recovery/i18n.js (with its
      // siblings modal.recovery.title / btn.recovery_saved /
      // toast.recovery_key_copied / confirm.recovery_save).

      // ── history merge (post-register import prompt) ───────
      'merge.title': 'Перенести історію в бібліотеку?',
      'merge.body':
        'У тебе є {count} записів у локальній історії. Перенести їх у твою зашифровану бібліотеку? Локальна історія залишиться доступною — це лише копіювання у архів.',
      'merge.btn.skip': 'не зараз',
      'merge.btn.import': 'перенести {count}',
      'merge.progress': 'переношу {i} / {total}…',
      'toast.merge_done': 'Перенесено {count} записів',
      'toast.merge_partial': 'Перенесено {imported}, не вдалося {failed}',
      'toast.merge_failed': 'Не вдалося перенести жодного запису ({failed})',

      // ── save / edit sample modal ──────────────────────────
      'sample.label.title': 'назва',
      'sample.label.partner': 'партнер',
      'sample.label.notes': 'нотатки (необовʼязково)',
      // Phase C-1 — LLM-inferred partner banner.
      'hint.partner.suggestion': 'Виглядає як <b>{name}</b> ({conf} впевненість)',
      'hint.partner.use_existing': 'Обрати',
      'hint.partner.create_new': 'Створити',
      'toast.partner_created': 'Партнер «{name}» створений',
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

      // forgot.* + reset.* keys live in modules/password-reset/i18n.js
      // (lazy). Three exceptions stay here because they're used by the
      // shell-level ?verify_error= boot path, NOT by the password-reset
      // modal:
      'reset.err.link_expired': 'Посилання застаріло — запитай нове',
      'reset.err.link_tampered': 'Посилання пошкоджено',
      'reset.err.verify_failed': 'Не вдалося підтвердити email',

      // ── peek modal ────────────────────────────────────────
      'peek.label.bid_req': 'bid request',
      'peek.label.bid_res': 'bid response',
    },

    en: {
      // ── action-button flash statuses (post-success label swap) ──
      'button.status.copied': 'copied',
      'button.status.formatted': 'formatted',
      'button.status.cleared': 'cleared',
      'button.status.analyzing': 'analyzing…',

      // ── toasts ─────────────────────────────────────────────
      'toast.copied': 'Copied',
      'toast.copy_failed': 'Couldn’t copy',
      'toast.copy_failed_select': 'Couldn’t copy — select with mouse',
      'toast.empty_field_copy': 'Field is empty — nothing to copy',
      'toast.invalid_json': 'Invalid JSON: {error}',
      'toast.loaded': 'Loaded · {title}',
      'toast.history_cleared': 'History cleared',
      'toast.layout.reset': 'Layout reset — both panels are back',
      'toast.paste_request': 'Paste a BidRequest in the left pane',
      'toast.nothing_to_analyze': 'Nothing to analyze — both fields are empty',
      // toast.nothing_to_mirror + toast.mirror_* keys live in modules/mirror/i18n.js
      'toast.error_generic': 'Error: {error}',
      // toast.recovery_key_copied lives in modules/recovery/i18n.js
      'toast.saved': 'Saved · {title}',
      'toast.updated': 'Updated · {title}',
      'toast.save_failed': 'Save failed: {error}',
      'toast.save_changes_failed': 'Couldn’t save changes: {error}',
      'toast.deleted': 'Deleted',
      'toast.delete_failed': 'Delete failed: {error}',
      'toast.crypto_session_lost': 'Encryption session lost — sign in again',
      'toast.decrypt_failed': 'Decryption failed — sign in again',
      // toast.library_unlocked → /modules/unlock/i18n.js
      // toast.hello + toast.account_created + toast.account_created_email_failed
      //   → /modules/auth/i18n.js
      'toast.signed_out': 'Signed out',
      'toast.analysis_complete': 'Analysis complete · {status}',
      'toast.email_verified': 'Email verified ✓',
      'toast.verify_email_sent': 'Verification email sent to {email}',
      'toast.send_failed': 'Send failed: {error}',
      // toast.password_reset lives in modules/password-reset/i18n.js (lazy)
      'toast.added': 'Added · {name}',
      'toast.nothing_to_save': 'Nothing to save — both fields are empty',
      'toast.signin_to_save': 'Sign in to save samples to your personal library',
      'toast.bundle_downloaded': 'Downloaded · {name}',
      // toast.share_* keys live in modules/share/i18n.js (registered at boot)

      // ── embed modal ───────────────────────────────────────

      // ── confirm() dialogs ─────────────────────────────────
      // confirm.recovery_save lives in modules/recovery/i18n.js
      'confirm.delete_sample': 'Delete this sample from the library?',
      'confirm.clear_history': 'Clear the whole history? Saved-library entries are unaffected.',
      'confirm.clobber_load': 'Current edits aren’t saved. Load this and discard them?',

      // ── modal titles ──────────────────────────────────────
      // modal.unlock.title → /modules/unlock/i18n.js
      // modal.recovery.title → /modules/recovery/i18n.js
      // modal.password_reset.title → /modules/password-reset/i18n.js
      'modal.edit_sample.title': 'edit sample',
      // modal.save_sample.* keys live in modules/save-sample/i18n.js
      // modal.mirror.* + toast.mirror_share_* keys live in modules/mirror/i18n.js
      // modal.live.* + toast.live_* keys live in modules/live/i18n.js
      'finding.detail.path': 'JSON path',
      'finding.detail.value_at_path': 'Current value',
      'finding.detail.value_missing':
        'Field is absent in the pasted JSON (which is exactly why this finding fires).',
      'finding.detail.severity': 'Severity',
      'finding.detail.spec': 'Spec reference',
      'finding.detail.rule_id': 'Rule id',
      'finding.severity.error.label': 'error',
      'finding.severity.error.text':
        'Exchanges will reject the request/bid — it won’t reach the auction.',
      'finding.severity.warning.label': 'warning',
      'finding.severity.warning.text':
        'Most exchanges tolerate this but fill rate suffers — worth fixing.',
      'finding.severity.info.label': 'info',
      'finding.severity.info.text': 'Best-practice note — not a bug, but recommended.',
      'corpus.bar.label':
        '{count} events in this probe — save them as a labelled example for the upcoming confusion-matrix runner.',
      'corpus.bar.save_btn': 'save as corpus',
      'corpus.cabinet.total': 'total',
      'corpus.cabinet.empty':
        'Nothing saved yet. Generate or load a sample, open the behavior tab — the "save as corpus" button shows up there.',
      'corpus.cabinet.delete_title': 'delete this entry',
      'corpus.label.legitimate': 'legitimate',
      'corpus.label.fraud': 'fraud',
      'corpus.label.ambiguous': 'ambiguous',
      'toast.corpus_deleted': 'Entry deleted',
      'toast.corpus_delete_failed': 'Delete failed: {error}',
      'confirm.corpus_delete': 'Delete this corpus entry? This cannot be undone.',
      'matrix.empty':
        'Empty for now. Save at least one "legitimate" and one "fraud" sample — the table fills in.',
      'matrix.no_patterns':
        "No pattern fired across your corpus. Either the corpus is too thin, or the detectors don't see anything in the events.",
      'matrix.summary.patterns': 'patterns',
      'matrix.col.pattern': 'pattern',
      'matrix.col.precision': 'precision',
      'matrix.col.recall': 'recall',
      'builder.title': 'Temporary Dialect Builder',
      'builder.name_label': 'Dialect name',
      'builder.name_placeholder': 'e.g. SSP-Custom',
      'builder.clusters_heading': 'Suggested clusters',
      'builder.fields_heading': 'All discovered fields',
      'builder.empty': 'Not enough data yet. Run analyze on a few requests first.',
      'builder.use_cluster': 'Use cluster',
      'builder.cancel': 'Cancel',
      'builder.create': 'Create temporary dialect',
      'builder.info': '{n} fields selected',
      'builder.suggest_name': 'Suggest',
      'builder.suggest_name_tooltip': 'Suggest a name with the local LLM',
      'builder.suggesting': 'Thinking…',
      'banner.new_patterns': '{n} new field patterns detected',
      // modal.simbids.* + toast.simbids_* keys live in modules/simulate/i18n.js

      // ── modal common labels + buttons ─────────────────────
      'btn.cancel': 'cancel',
      'btn.save': 'save',
      'btn.update': 'update',
      'btn.save_as_new': 'save as new',
      'btn.copy': 'copy',
      'btn.copied': 'copied ✓',
      // btn.recovery_saved → /modules/recovery/i18n.js
      // btn.unlock + btn.signout_instead → /modules/unlock/i18n.js
      'btn.signout': 'sign out',
      'btn.add': 'add',
      'btn.close': 'close',
      'btn.load_to_editor': 'load to editor',

      // ── keyboard shortcuts cheat-sheet ────────────────────

      // ── behavior tab (creative-probe) ─────────────────────
      'behavior.empty':
        'Render a creative on the right — the Behavior engine analyses click-jacking attempts, bot patterns, frame manipulations, and heavy ads.',
      'behavior.label.trigger': 'trigger',
      'behavior.kind.click_skim_suspect': 'click-skim suspect',
      'behavior.kind.auto_navigate': 'auto-navigate (no gesture)',
      'behavior.kind.window_open': 'window.open',
      'behavior.kind.location_set': 'location change',
      'behavior.kind.programmatic_click': 'programmatic click',
      'behavior.kind.navigation': 'navigation',
      'behavior.kind.invisible_overlay_click': 'invisible-overlay click',
      'behavior.kind.center_synth_click': 'center-point synthetic click',
      'behavior.kind.click_burst': 'click burst (bot)',
      'behavior.kind.phantom_click': 'phantom click (no gesture)',
      'behavior.kind.frame_bust_anchor': 'frame-bust via <a target=_top>',
      'behavior.kind.frame_bust_form': 'frame-bust via <form target=_top>',
      'behavior.kind.heavy_ad_cpu': 'heavy ad: CPU threshold breached',
      'behavior.kind.heavy_ad_network': 'heavy ad: > 4 MB sub-resources',
      'behavior.kind.frozen_thread': 'iframe frozen (watchdog)',
      'behavior.kind.permission_abuse': 'system permission request',
      'behavior.kind.static_obfuscation': 'static: obfuscation pattern',
      'behavior.kind.static_miner': 'static: miner signature',
      'behavior.kind.static_xss_marker': 'static: DOM-XSS sink',
      'behavior.kind.static_high_entropy': 'static: base64 high-entropy blob',
      'behavior.heading.findings': 'Threats detected',
      'behavior.heading.timeline': 'Event timeline',

      // ── empty / placeholder hints ─────────────────────────
      'empty.samples': 'No saved samples yet',

      // ── status pills ──────────────────────────────────────
      'status.errors': 'critical errors',
      'status.warnings': 'warnings',
      'status.clean': 'clean',
      'status.invalid': 'invalid payload',
      'status.local': 'local',
      'validation.all_passed': 'All checks passed — {type} is valid',

      // ── theme toggle tooltips ─────────────────────────────
      'theme.tooltip.auto': 'theme: auto · click → light',
      'theme.tooltip.light': 'theme: light · click → dark',
      'theme.tooltip.dark': 'theme: dark · click → auto',

      // ── auth modal ────────────────────────────────────────
      // Most keys moved to /modules/auth/i18n.js. Three labels stay
      // here because they're shared with sibling modals (unlock,
      // forgot/reset password): auth.label.email, auth.label.password,
      // auth.forgot_password.
      'auth.label.email': 'email',
      'auth.label.password': 'password',
      'auth.forgot_password': 'forgot password?',

      // ── unlock modal ──────────────────────────────────────
      // unlock.subtitle + unlock.err.* → /modules/unlock/i18n.js

      // ── recovery-key modal ────────────────────────────────
      // recovery.body lives in modules/recovery/i18n.js (with its
      // siblings modal.recovery.title / btn.recovery_saved /
      // toast.recovery_key_copied / confirm.recovery_save).

      // ── history merge (post-register import prompt) ───────
      'merge.title': 'Move history to your library?',
      'merge.body':
        'You have {count} entries in local history. Copy them into your encrypted library? Local history stays available — this only mirrors entries into the archive.',
      'merge.btn.skip': 'not now',
      'merge.btn.import': 'import {count}',
      'merge.progress': 'importing {i} / {total}…',
      'toast.merge_done': 'Imported {count} entries',
      'toast.merge_partial': 'Imported {imported}, failed {failed}',
      'toast.merge_failed': 'No entries imported ({failed} failed)',

      // ── save / edit sample modal ──────────────────────────
      'sample.label.title': 'title',
      'sample.label.partner': 'partner',
      'sample.label.notes': 'notes (optional)',
      // Phase C-1 — LLM-inferred partner banner.
      'hint.partner.suggestion': 'Looks like <b>{name}</b> ({conf} confidence)',
      'hint.partner.use_existing': 'Use this',
      'hint.partner.create_new': 'Create',
      'toast.partner_created': 'Partner "{name}" created',
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

      // forgot.* + reset.* keys live in modules/password-reset/i18n.js
      // (lazy). Three exceptions stay here for the shell-level
      // ?verify_error= boot path:
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
      // ── action-button flash statuses (post-success label swap) ──
      'button.status.copied': 'скопировано',
      'button.status.formatted': 'отформатировано',
      'button.status.cleared': 'очищено',
      'button.status.analyzing': 'анализирую…',

      'toast.copied': 'Скопировано',
      'toast.copy_failed': 'Не удалось скопировать',
      'toast.copy_failed_select': 'Не удалось скопировать — выдели мышью',
      'toast.empty_field_copy': 'Поле пустое — нечего копировать',
      'toast.invalid_json': 'Невалидный JSON: {error}',
      'toast.loaded': 'Загружено · {title}',
      'toast.history_cleared': 'История очищена',
      'toast.layout.reset': 'Layout сброшен — обе панели снова видимы',
      'toast.paste_request': 'Вставь BidRequest в левое поле',
      'toast.nothing_to_analyze': 'Нечего анализировать — оба поля пусты',
      // toast.nothing_to_mirror + toast.mirror_* keys live in modules/mirror/i18n.js
      'toast.error_generic': 'Ошибка: {error}',
      // toast.recovery_key_copied lives in modules/recovery/i18n.js
      'toast.saved': 'Сохранено · {title}',
      'toast.updated': 'Обновлено · {title}',
      'toast.save_failed': 'Не удалось сохранить: {error}',
      'toast.save_changes_failed': 'Не удалось сохранить изменения: {error}',
      'toast.deleted': 'Удалено',
      'toast.delete_failed': 'Не удалось удалить: {error}',
      'toast.crypto_session_lost': 'Сессия шифрования не активна — войди в аккаунт ещё раз',
      'toast.decrypt_failed': 'Не удалось расшифровать — войди в аккаунт ещё раз',
      // toast.library_unlocked → /modules/unlock/i18n.js
      // toast.hello + toast.account_created + toast.account_created_email_failed
      //   → /modules/auth/i18n.js
      'toast.signed_out': 'Вы вышли из аккаунта',
      'toast.analysis_complete': 'Анализ завершён · {status}',
      'toast.email_verified': 'Email подтверждён ✓',
      'toast.verify_email_sent': 'Письмо подтверждения отправлено на {email}',
      'toast.send_failed': 'Не удалось отправить: {error}',
      // toast.password_reset lives in modules/password-reset/i18n.js (lazy)
      'toast.added': 'Добавлено · {name}',
      'toast.nothing_to_save': 'Нечего сохранять — оба поля пусты',
      'toast.signin_to_save': 'Войди, чтобы сохранять запросы в личную библиотеку',
      'toast.bundle_downloaded': 'Скачано · {name}',
      // toast.share_* keys live in modules/share/i18n.js (registered at boot)
      // confirm.recovery_save lives in modules/recovery/i18n.js
      'confirm.delete_sample': 'Удалить этот запрос из библиотеки?',
      'confirm.clear_history':
        'Очистить всю историю? Сохранённые в библиотеке записи не затрагиваются.',
      'confirm.clobber_load':
        'Текущие изменения не сохранены. Загрузить этот запрос и отбросить изменения?',
      // modal.unlock.title → /modules/unlock/i18n.js
      // modal.recovery.title → /modules/recovery/i18n.js
      // modal.password_reset.title → /modules/password-reset/i18n.js
      'modal.edit_sample.title': 'редактировать запрос',
      // modal.save_sample.* keys live in modules/save-sample/i18n.js
      // modal.mirror.* + toast.mirror_share_* keys live in modules/mirror/i18n.js
      // modal.live.* + toast.live_* keys live in modules/live/i18n.js
      'finding.detail.path': 'Путь в JSON',
      'finding.detail.value_at_path': 'Текущее значение',
      'finding.detail.value_missing':
        'Поле отсутствует во вставленном JSON (именно поэтому находка).',
      'finding.detail.severity': 'Серьёзность',
      'finding.detail.spec': 'Спецификация',
      'finding.detail.rule_id': 'ID правила',
      'finding.severity.error.label': 'error',
      'finding.severity.error.text': 'Биржи отклонят запрос/ставку — bid не дойдёт до аукциона.',
      'finding.severity.warning.label': 'warning',
      'finding.severity.warning.text':
        'Большинство бирж толерируют, но fill-rate упадёт — стоит исправить.',
      'finding.severity.info.label': 'info',
      'finding.severity.info.text': 'Best-practice заметка — не баг, но лучше делать так.',
      'corpus.bar.label':
        '{count} событий в текущем probe — можно сохранить как пример для будущего confusion matrix.',
      'corpus.bar.save_btn': 'сохранить как corpus',
      'corpus.cabinet.total': 'всего',
      'corpus.cabinet.empty':
        'Пока ничего не сохранено. Сгенерируй или загрузи образец, открой behavior tab — там появится кнопка «сохранить как corpus».',
      'corpus.cabinet.delete_title': 'удалить эту запись',
      'corpus.label.legitimate': 'легитимно',
      'corpus.label.fraud': 'мошенничество',
      'corpus.label.ambiguous': 'неоднозначно',
      'toast.corpus_deleted': 'Запись удалена',
      'toast.corpus_delete_failed': 'Не удалось удалить: {error}',
      'confirm.corpus_delete': 'Удалить эту запись corpus? Это необратимо.',
      'matrix.empty':
        'Пока пусто. Сохрани хотя бы по одному «легитимному» и «мошенническому» образцу — таблица заполнится.',
      'matrix.no_patterns':
        'Ни один паттерн не сработал на твоём корпусе. Либо корпус мал, либо детекторы ничего не видят в событиях.',
      'matrix.summary.patterns': 'паттернов',
      'matrix.col.pattern': 'паттерн',
      'matrix.col.precision': 'precision',
      'matrix.col.recall': 'recall',
      'builder.title': 'Конструктор временного диалекта',
      'builder.name_label': 'Название диалекта',
      'builder.name_placeholder': 'например, SSP-Custom',
      'builder.clusters_heading': 'Обнаруженные кластеры',
      'builder.fields_heading': 'Все обнаруженные поля',
      'builder.empty': 'Пока недостаточно данных. Запусти анализ нескольких запросов.',
      'builder.use_cluster': 'Использовать',
      'builder.cancel': 'Отмена',
      'builder.create': 'Создать временный диалект',
      'builder.info': '{n} полей выбрано',
      'builder.suggest_name': 'Предложить',
      'builder.suggest_name_tooltip': 'Предложить название через локальную LLM',
      'builder.suggesting': 'Думаю…',
      'banner.new_patterns': 'Обнаружено {n} новых паттернов полей',
      // modal.simbids.* + toast.simbids_* keys live in modules/simulate/i18n.js
      'btn.cancel': 'отмена',
      'btn.save': 'сохранить',
      'btn.update': 'обновить',
      'btn.save_as_new': 'сохранить как новый',
      'btn.copy': 'копировать',
      'btn.copied': 'скопировано ✓',
      // btn.recovery_saved → /modules/recovery/i18n.js
      // btn.unlock + btn.signout_instead → /modules/unlock/i18n.js
      'btn.signout': 'выйти',
      'btn.add': 'добавить',
      'btn.close': 'закрыть',
      'btn.load_to_editor': 'загрузить в редактор',
      'behavior.empty':
        'Отрендерь креатив справа — Behavior-движок анализирует попытки клик-джекинга, бот-паттерны, манипуляции с фреймами и тяжёлые креативы.',
      'behavior.label.trigger': 'триггер',
      'behavior.kind.click_skim_suspect': 'подозрение на click-skim',
      'behavior.kind.auto_navigate': 'авто-навигация без gesture',
      'behavior.kind.window_open': 'window.open',
      'behavior.kind.location_set': 'смена location',
      'behavior.kind.programmatic_click': 'программный клик',
      'behavior.kind.navigation': 'навигация',
      'behavior.kind.invisible_overlay_click': 'клик по невидимой ловушке',
      'behavior.kind.center_synth_click': 'центрированный синтетический клик',
      'behavior.kind.click_burst': 'серия кликов (бот)',
      'behavior.kind.phantom_click': 'phantom-клик (без gesture)',
      'behavior.kind.frame_bust_anchor': 'frame-bust через <a target=_top>',
      'behavior.kind.frame_bust_form': 'frame-bust через <form target=_top>',
      'behavior.kind.heavy_ad_cpu': 'heavy ad: CPU порог пробит',
      'behavior.kind.heavy_ad_network': 'heavy ad: > 4 MB сабресурсов',
      'behavior.kind.frozen_thread': 'iframe завис (watchdog)',
      'behavior.kind.permission_abuse': 'запрос системного разрешения',
      'behavior.kind.static_obfuscation': 'статика: обфускация',
      'behavior.kind.static_miner': 'статика: подпись майнера',
      'behavior.kind.static_xss_marker': 'статика: DOM-XSS-синк',
      'behavior.kind.static_high_entropy': 'статика: base64 high-entropy blob',
      'behavior.heading.findings': 'Найдено угроз',
      'behavior.heading.timeline': 'Хронология событий',
      'empty.samples': 'Сохранённых запросов пока нет',
      'status.errors': 'критические ошибки',
      'status.warnings': 'предупреждения',
      'status.clean': 'чисто',
      'status.invalid': 'невалидный payload',
      'status.local': 'локально',
      'validation.all_passed': 'Все проверки пройдены — {type} валиден',
      'theme.tooltip.auto': 'тема: авто · клик → светлая',
      'theme.tooltip.light': 'тема: светлая · клик → тёмная',
      'theme.tooltip.dark': 'тема: тёмная · клик → авто',
      // ── auth modal ────────────────────────────────────────
      // Most keys moved to /modules/auth/i18n.js. Three labels stay
      // here because they're shared with sibling modals (unlock,
      // forgot/reset password): auth.label.email, auth.label.password,
      // auth.forgot_password.
      'auth.label.email': 'email',
      'auth.label.password': 'пароль',
      'auth.forgot_password': 'забыл пароль?',
      // unlock.subtitle + unlock.err.* → /modules/unlock/i18n.js
      // recovery.body lives in modules/recovery/i18n.js (with siblings
      // modal.recovery.title / btn.recovery_saved /
      // toast.recovery_key_copied / confirm.recovery_save).

      // ── history merge (post-register import prompt) ───────
      'merge.title': 'Перенести историю в библиотеку?',
      'merge.body':
        'У тебя {count} записей в локальной истории. Перенести их в твою зашифрованную библиотеку? Локальная история останется доступной — это только копирование в архив.',
      'merge.btn.skip': 'не сейчас',
      'merge.btn.import': 'перенести {count}',
      'merge.progress': 'переношу {i} / {total}…',
      'toast.merge_done': 'Перенесено {count} записей',
      'toast.merge_partial': 'Перенесено {imported}, не удалось {failed}',
      'toast.merge_failed': 'Не удалось перенести ни одной записи ({failed})',

      'sample.label.title': 'название',
      'sample.label.partner': 'партнёр',
      'sample.label.notes': 'заметки (необязательно)',
      // Phase C-1 — LLM-inferred partner banner.
      'hint.partner.suggestion': 'Похоже на <b>{name}</b> ({conf} уверенность)',
      'hint.partner.use_existing': 'Выбрать',
      'hint.partner.create_new': 'Создать',
      'toast.partner_created': 'Партнёр «{name}» создан',
      'sample.label.notes_short': 'заметки',
      'sample.partner_none': '— без партнёра —',
      'sample.partner_all': 'все партнёры',
      'sample.partner_unassigned': 'без партнёра',
      'sample.empty': 'Сохранённых запросов пока нет',
      'sample.anon_cta': 'Войди в аккаунт чтобы сохранять запросы в личную библиотеку.',
      'sample.unlock_cta': 'Библиотека зашифрована. Введи пароль чтобы разблокировать.',
      'sample.btn.signin': 'войти или создать аккаунт',
      'sample.btn.unlock': 'разблокировать',
      // forgot.* + reset.* keys live in modules/password-reset/i18n.js
      // (lazy). Three exceptions stay here for the shell-level
      // ?verify_error= boot path:
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

  // Ad-preview empty hint — was hardcoded UK in spyglass.app.js setAdPreview;
  // 2026-05-06 i18n hotfix surfaced it as a leak when EN/RU users saw "у
  // відповіді немає adm/nurl" instead of their locale.
  I18N.en['preview.no_adm'] = 'No adm/nurl in response';
  I18N.uk['preview.no_adm'] = 'У відповіді немає adm/nurl';
  I18N.ru['preview.no_adm'] = 'В ответе нет adm/nurl';

  // ── Tier-2 i18n batch (2026-05-09 v0.15.0) ──
  // 21 strings that were still hardcoded UK in spyglass.app.js after the
  // original Tier-1 cut. Captured by `grep -nE "[А-Яа-яЇїІіЄєҐґ]" public/spyglass.app.js`
  // — closes the i18n debt bucket from spyglass_i18n_debt memory.
  const tier2 = {
    'toast.internal_ui_error': {
      en: 'Internal UI error: {error}',
      uk: 'Внутрішня помилка інтерфейсу: {error}',
      ru: 'Внутренняя ошибка интерфейса: {error}',
    },
    'toast.uncaught_error': {
      en: 'Uncaught error: {error}',
      uk: 'Невловлений збій: {error}',
      ru: 'Необработанный сбой: {error}',
    },
    'toast.template_inserted_req': {
      en: 'Template inserted into BidRequest',
      uk: 'Шаблон вставлено у BidRequest',
      ru: 'Шаблон вставлен в BidRequest',
    },
    'toast.template_inserted_res': {
      en: 'Template inserted into BidResponse',
      uk: 'Шаблон вставлено у BidResponse',
      ru: 'Шаблон вставлен в BidResponse',
    },
    'toast.template_inserted': {
      en: 'Template inserted',
      uk: 'Шаблон вставлено',
      ru: 'Шаблон вставлен',
    },
    'toast.partners_load_failed': {
      en: 'Failed to load partners: {error}',
      uk: 'Не вдалося завантажити список партнерів: {error}',
      ru: 'Не удалось загрузить список партнёров: {error}',
    },
    'toast.samples_load_failed': {
      en: 'Failed to load samples: {error}',
      uk: 'Не вдалося завантажити запити: {error}',
      ru: 'Не удалось загрузить запросы: {error}',
    },
    'toast.sample_load_failed': {
      en: "Couldn't load example",
      uk: 'Не вдалось завантажити приклад',
      ru: 'Не удалось загрузить пример',
    },
    'error.generic': {
      en: 'Error',
      uk: 'Помилка',
      ru: 'Ошибка',
    },
    'tooltip.peek_no_load': {
      en: 'Peek without loading',
      uk: 'Переглянути без завантаження',
      ru: 'Посмотреть без загрузки',
    },
    'tooltip.history_delete': {
      en: 'Remove from history',
      uk: 'Видалити з історії',
      ru: 'Удалить из истории',
    },
    'tooltip.partner_edit': {
      en: 'Rename / change partner',
      uk: 'Перейменувати / змінити партнера',
      ru: 'Переименовать / изменить партнёра',
    },
    'tooltip.delete': {
      en: 'Delete',
      uk: 'Видалити',
      ru: 'Удалить',
    },
    'fallback.history_entry': {
      en: 'history',
      uk: 'історія',
      ru: 'история',
    },
    'fallback.local_request': {
      en: 'local request',
      uk: 'локальний запит',
      ru: 'локальный запрос',
    },
    'fallback.partner_id': {
      en: 'partner #{id}',
      uk: 'партнер #{id}',
      ru: 'партнёр #{id}',
    },
    'empty.no_imp_slots': {
      en: 'Request has no imp[] — no slots found',
      uk: 'У запиті немає imp[] — слоти не знайдено',
      ru: 'В запросе нет imp[] — слоты не найдены',
    },
    'empty.no_iab_categories': {
      en: 'No IAB categories in payload (cat[] / bcat[] / pcat[] empty)',
      uk: 'Жодних IAB-категорій у payload (cat[] / bcat[] / pcat[] порожні)',
      ru: 'Никаких IAB-категорий в payload (cat[] / bcat[] / pcat[] пустые)',
    },
    'crosscheck.summary': {
      en: '{crit} critical · {warn} warnings · {ok} ok',
      uk: '{crit} критичних · {warn} попереджень · {ok} ok',
      ru: '{crit} критичных · {warn} предупреждений · {ok} ok',
    },
    'crosscheck.all_passed': {
      en: 'All {count} crosschecks passed',
      uk: 'Усі {count} звірок пройдено',
      ru: 'Все {count} сверок пройдены',
    },
    'crosscheck.need_response': {
      en: 'Crosscheck needs a BidResponse in the right pane',
      uk: 'Для звірки потрібен ще BidResponse у правому полі',
      ru: 'Для сверки нужен BidResponse в правом поле',
    },
  };
  for (const key of Object.keys(tier2)) {
    I18N.en[key] = tier2[key].en;
    I18N.uk[key] = tier2[key].uk;
    I18N.ru[key] = tier2[key].ru;
  }

  // ── Cabinet keys (2026-05-09 v0.17.0) — used by /account/*.html.
  // Static text lives in the per-locale account.{en,uk,ru}.html files;
  // dynamic strings (pills, empty states, status mix) live here.
  // Tier-3 i18n batch (2026-05-09 v0.19.0) — added during the partner-CRUD
  // audit fix bundle. New string was needed when delete-partner confirm
  // got the sample-count parameter.
  const tier3 = {
    // confirm.delete_partner_with_count moved to modules/partners/i18n.js
    'toast.partner_gone': {
      en: 'The partner you picked was deleted in another tab. Picker refreshed — pick again.',
      uk: 'Партнера, якого ти обрав(ла), видалили у іншій вкладці. Список оновлено — обери ще раз.',
      ru: 'Партнёра, которого ты выбрал(а), удалили в другой вкладке. Список обновлён — выбери заново.',
    },
    // 2026-05-09 v0.23.0 — replaces the old generic 'toast.decrypt_failed'
    // text in loadSample(). Adds an actionable hint instead of a raw
    // crypto error name nobody understands.
    'toast.decrypt_failed_with_hint': {
      en: "Couldn't decrypt this sample. Most likely your session expired — sign out and back in to refresh.",
      uk: 'Не вдалось розшифрувати цей запит. Найімовірніше сесія застаріла — вийди й увійди ще раз.',
      ru: 'Не удалось расшифровать этот запрос. Скорее всего сессия истекла — выйди и войди заново.',
    },
  };
  for (const key of Object.keys(tier3)) {
    I18N.en[key] = tier3[key].en;
    I18N.uk[key] = tier3[key].uk;
    I18N.ru[key] = tier3[key].ru;
  }

  const cab = {
    'cabinet.pill.verified': { en: 'verified ✓', uk: 'підтверджено ✓', ru: 'подтверждён ✓' },
    'cabinet.pill.not_verified': {
      en: 'not verified',
      uk: 'не підтверджено',
      ru: 'не подтверждён',
    },
    'cabinet.pill.enabled': { en: 'enabled', uk: 'увімкнено', ru: 'включено' },
    'cabinet.pill.configured': { en: 'configured', uk: 'налаштовано', ru: 'настроен' },
    'cabinet.pill.not_configured': {
      en: 'not configured',
      uk: 'не налаштовано',
      ru: 'не настроен',
    },
    'cabinet.pill.encrypted': { en: 'encrypted', uk: 'зашифровано', ru: 'зашифровано' },
    'cabinet.pill.plain': { en: 'plain', uk: 'plain', ru: 'plain' },
    'cabinet.pill.items': { en: '{n} items', uk: '{n} записів', ru: '{n} записей' },
    'cabinet.pill.empty': { en: 'empty', uk: 'порожньо', ru: 'пусто' },
    'cabinet.recent.empty': {
      en: 'No saved samples yet — go to Spyglass and save your first bid.',
      uk: 'Збережених запитів ще немає — перейди у Spyglass і збережи перший bid.',
      ru: 'Сохранённых запросов ещё нет — перейди в Spyglass и сохрани первый bid.',
    },
    'cabinet.recent.loading': { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
    'cabinet.untitled': { en: '(untitled)', uk: '(без назви)', ru: '(без названия)' },
    'cabinet.no_analyses': {
      en: '— (no analyses yet)',
      uk: '— (ще не було аналізів)',
      ru: '— (ещё не было анализов)',
    },
    'cabinet.status.clean_pct': { en: 'clean {pct}%', uk: 'чисто {pct}%', ru: 'чисто {pct}%' },
    'cabinet.status.warn_pct': { en: 'warn {pct}%', uk: 'warn {pct}%', ru: 'warn {pct}%' },
    'cabinet.status.err_pct': { en: 'err {pct}%', uk: 'err {pct}%', ru: 'err {pct}%' },
    'cabinet.heatmap.tooltip': {
      en: '{date}: {n} analyses',
      uk: '{date}: {n} аналізів',
      ru: '{date}: {n} анализов',
    },
    'cabinet.heatmap.empty': {
      en: 'No activity in the last 30 days yet — run an analysis to see your dots fill in.',
      uk: 'За останні 30 днів ще нічого — запусти аналіз щоб побачити свої клітинки.',
      ru: 'За последние 30 дней ещё ничего — запусти анализ чтобы увидеть свои клетки.',
    },
  };
  for (const key of Object.keys(cab)) {
    I18N.en[key] = cab[key].en;
    I18N.uk[key] = cab[key].uk;
    I18N.ru[key] = cab[key].ru;
  }

  // ── Per-module i18n registration ──────────────────────────────
  // Modules push their key tables into window.kt_i18n_modules BEFORE
  // /i18n.js loads (they run as <script> tags earlier in the shell);
  // we drain that queue here. Late-loaded modules call
  // window.registerI18nModule(spec) directly. Spec shape:
  //   { id: 'share', keys: { 'toast.share_link_copied': { uk, en, ru }, … } }
  function mergeModuleI18n(m) {
    if (!m || !m.keys) return;
    const keys = m.keys;
    for (const key in keys) {
      const v = keys[key] || {};
      if (typeof v.uk === 'string') I18N.uk[key] = v.uk;
      if (typeof v.en === 'string') I18N.en[key] = v.en;
      if (typeof v.ru === 'string') I18N.ru[key] = v.ru;
    }
  }
  const queued = Array.isArray(window.kt_i18n_modules) ? window.kt_i18n_modules : [];
  queued.forEach(mergeModuleI18n);
  window.kt_i18n_modules = []; // sentinel — further pushes ignored
  window.registerI18nModule = mergeModuleI18n;

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
    } catch (_e) {
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
