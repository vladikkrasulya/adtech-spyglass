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
      'toast.account_created_email_failed':
        'Акаунт створено, але лист не пройшов — натисни «надіслати» у банері пізніше',
      'toast.password_reset': 'Пароль скинуто. Ти увійшов(ла).',
      'toast.partner_name_required': 'Введи назву партнера',
      'toast.added': 'Додано · {name}',
      'toast.nothing_to_save': 'Нічого зберігати — обидва поля порожні',
      'toast.signin_to_save': 'Увійдіть, щоб зберігати запити в особисту бібліотеку',
      'toast.bundle_downloaded': 'Завантажено · {name}',
      // toast.share_* keys live in modules/share/i18n.js (registered at boot)

      // ── embed modal ───────────────────────────────────────
      'embed.title': 'Вбудувати в інший сайт',
      'embed.body':
        'Вставиш цей сніпет у блог, Notion або документ — і він покаже інтерактивний Spyglass з поточним bid. Payload зашитий у hash-фрагмент URL — на сервер не йде.',
      'embed.label.height': 'Висота (px)',
      'embed.label.snippet': 'iframe-сніпет',
      'embed.btn.copy': 'скопіювати',
      'embed.toast.copied': 'iframe-сніпет скопійовано',

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
      // modal.mirror.* + toast.mirror_share_* keys live in modules/mirror/i18n.js
      'modal.live.title': 'live · потік RTB-зразків',
      'modal.live.connecting': '· підключаюсь…',
      'modal.live.connected': '· live',
      'modal.live.paused': '· пауза',
      'modal.live.connection_lost': '· звʼязок втрачено',
      'modal.live.pause': '⏸ пауза',
      'modal.live.resume': '▶ продовжити',
      'modal.live.empty': 'чекаємо першого зразка…',
      'modal.live.hint': 'Клік по рядку — завантажити зразок у відповідне поле та закрити вікно.',
      'toast.live_loaded': 'Зразок завантажено · можна аналізувати',
      'toast.live_load_failed': 'Не вдалось розпарсити зразок',
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
      'modal.corpus_save.title': 'зберегти behavior як corpus',
      'modal.corpus_save.summary':
        'Поточний probe має {count} події. Збережемо їх з міткою для подальшого аналізу.',
      'modal.corpus_save.label': 'Як класифікувати',
      'modal.corpus_save.label.legitimate': 'легітимно — реальний користувач',
      'modal.corpus_save.label.fraud': 'шахрайство — бот / фейкова активність',
      'modal.corpus_save.label.ambiguous': 'неоднозначно — потребує review',
      'modal.corpus_save.notes': 'Нотатки (опційно)',
      'modal.corpus_save.notes_placeholder':
        'Що тригернуло цю мітку, що варто запамʼятати на майбутнє…',
      'toast.corpus_saved': 'Збережено в corpus · {count} events як «{label}»',
      'toast.corpus_save_failed': 'Не вдалось зберегти: {error}',
      'toast.corpus_no_events': 'Запусти probe — без подій нема що зберігати',
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
      'modal.simbids.title': '🤖 симуляція 3 DSP-стратегій',
      'modal.simbids.hint':
        'Локальна gemma3:4b симулює як три типи DSP відповіли б на твій запит. Тільки метадані запиту (формат, розмір, гео, floor) — bid VALUES не передаємо в LLM.',
      'modal.simbids.loading': 'gemma думає… (3 паралельні prompts, ~10s)',
      'modal.simbids.ollama_down':
        'Ollama недоступна. AI-bridge падає тихо — попроси адміна перевірити контейнер.',
      'modal.simbids.bid': '✓ ставить',
      'modal.simbids.pass': '✗ пропускає',
      'modal.simbids.strat.aggressive': 'aggressive · max scale',
      'modal.simbids.strat.conservative': 'conservative · ROAS guard',
      'modal.simbids.strat.quality': 'quality · premium only',
      'toast.simbids_no_request': 'Встав BidRequest у ліве поле',
      'toast.simbids_invalid_json': 'Не вдалось розпарсити BidRequest JSON',
      'toast.simbids_failed': 'Симуляція впала: {error}',

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
      'btn.signout': 'вийти',
      'btn.add': 'додати',
      'btn.close': 'закрити',
      'btn.load_to_editor': 'завантажити в редактор',

      // ── keyboard shortcuts cheat-sheet ────────────────────
      'shortcuts.title': 'Гарячі клавіші',
      'shortcuts.row.help': 'Показати цю довідку',
      'shortcuts.row.run': 'Запустити аналіз',
      'shortcuts.row.save': 'Зберегти в бібліотеку',
      'shortcuts.row.mirror': 'Дзеркало запит ↔ відповідь',
      'shortcuts.row.close': 'Закрити модалку',

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
      'empty.partners': 'Партнерів ще немає',
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
      // Phase C-1 — gemma-inferred partner banner.
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
      'toast.account_created_email_failed':
        'Account created, but the verify email didn’t send — use “send” in the banner later',
      'toast.password_reset': 'Password reset. You’re signed in.',
      'toast.partner_name_required': 'Enter a partner name',
      'toast.added': 'Added · {name}',
      'toast.nothing_to_save': 'Nothing to save — both fields are empty',
      'toast.signin_to_save': 'Sign in to save samples to your personal library',
      'toast.bundle_downloaded': 'Downloaded · {name}',
      // toast.share_* keys live in modules/share/i18n.js (registered at boot)

      // ── embed modal ───────────────────────────────────────
      'embed.title': 'Embed in another site',
      'embed.body':
        'Paste this snippet into a blog, Notion or doc — it will render an interactive Spyglass view with the current bid. The payload is in the URL hash fragment — never reaches the server.',
      'embed.label.height': 'Height (px)',
      'embed.label.snippet': 'iframe snippet',
      'embed.btn.copy': 'copy',
      'embed.toast.copied': 'iframe snippet copied',

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
      // modal.mirror.* + toast.mirror_share_* keys live in modules/mirror/i18n.js
      'modal.live.title': 'live · RTB sample stream',
      'modal.live.connecting': '· connecting…',
      'modal.live.connected': '· live',
      'modal.live.paused': '· paused',
      'modal.live.connection_lost': '· connection lost',
      'modal.live.pause': '⏸ pause',
      'modal.live.resume': '▶ resume',
      'modal.live.empty': 'waiting for the first sample…',
      'modal.live.hint':
        'Click a row to load that sample into the matching editor and close the modal.',
      'toast.live_loaded': 'Sample loaded · ready to analyze',
      'toast.live_load_failed': 'Could not parse the sample',
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
      'modal.corpus_save.title': 'save behavior as corpus',
      'modal.corpus_save.summary':
        'Current probe has {count} events. Save them with a label for later analysis.',
      'modal.corpus_save.label': 'Classify as',
      'modal.corpus_save.label.legitimate': 'legitimate — real user',
      'modal.corpus_save.label.fraud': 'fraud — bot / fake activity',
      'modal.corpus_save.label.ambiguous': 'ambiguous — needs review',
      'modal.corpus_save.notes': 'Notes (optional)',
      'modal.corpus_save.notes_placeholder':
        'What triggered this label, anything worth remembering for later…',
      'toast.corpus_saved': 'Saved to corpus · {count} events as "{label}"',
      'toast.corpus_save_failed': 'Save failed: {error}',
      'toast.corpus_no_events': 'Run a probe first — nothing to save without events',
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
      'modal.simbids.title': '🤖 simulate 3 DSP strategies',
      'modal.simbids.hint':
        'Local gemma3:4b simulates how three DSP types would respond to your request. Metadata only (format, size, geo, floor) — bid VALUES never reach the LLM.',
      'modal.simbids.loading': 'gemma is thinking… (3 parallel prompts, ~10s)',
      'modal.simbids.ollama_down':
        'Ollama unavailable. AI bridge fails quietly — ask the admin to check the container.',
      'modal.simbids.bid': '✓ bids',
      'modal.simbids.pass': '✗ passes',
      'modal.simbids.strat.aggressive': 'aggressive · max scale',
      'modal.simbids.strat.conservative': 'conservative · ROAS guard',
      'modal.simbids.strat.quality': 'quality · premium only',
      'toast.simbids_no_request': 'Paste a BidRequest in the left pane',
      'toast.simbids_invalid_json': 'Could not parse BidRequest JSON',
      'toast.simbids_failed': 'Simulation failed: {error}',

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
      'btn.signout': 'sign out',
      'btn.add': 'add',
      'btn.close': 'close',
      'btn.load_to_editor': 'load to editor',

      // ── keyboard shortcuts cheat-sheet ────────────────────
      'shortcuts.title': 'Keyboard shortcuts',
      'shortcuts.row.help': 'Show this help',
      'shortcuts.row.run': 'Run analysis',
      'shortcuts.row.save': 'Save to library',
      'shortcuts.row.mirror': 'Mirror request ↔ response',
      'shortcuts.row.close': 'Close modal',

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
      'empty.partners': 'No partners yet',
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
      // Phase C-1 — gemma-inferred partner banner.
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
      'toast.account_created_email_failed':
        'Аккаунт создан, но письмо не отправлено — нажми «отправить» в баннере позже',
      'toast.password_reset': 'Пароль сброшен. Ты вошёл(ла).',
      'toast.partner_name_required': 'Введи название партнёра',
      'toast.added': 'Добавлено · {name}',
      'toast.nothing_to_save': 'Нечего сохранять — оба поля пусты',
      'toast.signin_to_save': 'Войди, чтобы сохранять запросы в личную библиотеку',
      'toast.bundle_downloaded': 'Скачано · {name}',
      // toast.share_* keys live in modules/share/i18n.js (registered at boot)
      'embed.title': 'Встроить в другой сайт',
      'embed.body':
        'Вставь этот сниппет в блог, Notion или документ — и он покажет интерактивный Spyglass с текущим bid. Payload зашит в hash-фрагменте URL — на сервер не идёт.',
      'embed.label.height': 'Высота (px)',
      'embed.label.snippet': 'iframe-сниппет',
      'embed.btn.copy': 'скопировать',
      'embed.toast.copied': 'iframe-сниппет скопирован',
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
      // modal.mirror.* + toast.mirror_share_* keys live in modules/mirror/i18n.js
      'modal.live.title': 'live · поток RTB-образцов',
      'modal.live.connecting': '· подключаюсь…',
      'modal.live.connected': '· live',
      'modal.live.paused': '· пауза',
      'modal.live.connection_lost': '· связь потеряна',
      'modal.live.pause': '⏸ пауза',
      'modal.live.resume': '▶ продолжить',
      'modal.live.empty': 'ждём первый образец…',
      'modal.live.hint':
        'Клик по строке — загрузить образец в соответствующее поле и закрыть окно.',
      'toast.live_loaded': 'Образец загружен · можно анализировать',
      'toast.live_load_failed': 'Не удалось распарсить образец',
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
      'modal.corpus_save.title': 'сохранить behavior как corpus',
      'modal.corpus_save.summary':
        'Текущий probe имеет {count} событий. Сохраним их с меткой для дальнейшего анализа.',
      'modal.corpus_save.label': 'Как классифицировать',
      'modal.corpus_save.label.legitimate': 'легитимно — реальный пользователь',
      'modal.corpus_save.label.fraud': 'мошенничество — бот / фейковая активность',
      'modal.corpus_save.label.ambiguous': 'неоднозначно — требует review',
      'modal.corpus_save.notes': 'Заметки (опционально)',
      'modal.corpus_save.notes_placeholder':
        'Что триггернуло эту метку, что стоит запомнить на будущее…',
      'toast.corpus_saved': 'Сохранено в corpus · {count} events как «{label}»',
      'toast.corpus_save_failed': 'Не удалось сохранить: {error}',
      'toast.corpus_no_events': 'Запусти probe — без событий нечего сохранять',
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
      'modal.simbids.title': '🤖 симуляция 3 DSP-стратегий',
      'modal.simbids.hint':
        'Локальная gemma3:4b симулирует как три типа DSP ответили бы на твой запрос. Только метаданные (формат, размер, гео, floor) — bid VALUES не передаются в LLM.',
      'modal.simbids.loading': 'gemma думает… (3 параллельных prompts, ~10s)',
      'modal.simbids.ollama_down':
        'Ollama недоступна. AI-bridge падает тихо — попроси админа проверить контейнер.',
      'modal.simbids.bid': '✓ ставит',
      'modal.simbids.pass': '✗ пропускает',
      'modal.simbids.strat.aggressive': 'aggressive · max scale',
      'modal.simbids.strat.conservative': 'conservative · ROAS guard',
      'modal.simbids.strat.quality': 'quality · premium only',
      'toast.simbids_no_request': 'Вставь BidRequest в левое поле',
      'toast.simbids_invalid_json': 'Не удалось распарсить BidRequest JSON',
      'toast.simbids_failed': 'Симуляция упала: {error}',
      'btn.cancel': 'отмена',
      'btn.save': 'сохранить',
      'btn.update': 'обновить',
      'btn.save_as_new': 'сохранить как новый',
      'btn.copy': 'копировать',
      'btn.copied': 'скопировано ✓',
      'btn.recovery_saved': 'я сохранил',
      'btn.unlock': 'разблокировать',
      'btn.signout_instead': 'выйти вместо этого',
      'btn.signout': 'выйти',
      'btn.add': 'добавить',
      'btn.close': 'закрыть',
      'btn.load_to_editor': 'загрузить в редактор',
      'shortcuts.title': 'Горячие клавиши',
      'shortcuts.row.help': 'Показать эту справку',
      'shortcuts.row.run': 'Запустить анализ',
      'shortcuts.row.save': 'Сохранить в библиотеку',
      'shortcuts.row.mirror': 'Зеркало запрос ↔ ответ',
      'shortcuts.row.close': 'Закрыть модалку',
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
      'empty.partners': 'Партнёров пока нет',
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
      // Phase C-1 — gemma-inferred partner banner.
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
    'confirm.delete_partner_with_count': {
      en: 'Delete this partner? {count} sample(s) currently assigned to it will become "no partner" (they are NOT deleted).',
      uk: 'Видалити цього партнера? {count} запит(ів) що зараз йому привʼязані стануть "без партнера" (записи НЕ видаляються).',
      ru: 'Удалить этого партнёра? {count} запрос(ов), которые сейчас к нему привязаны, станут "без партнёра" (записи НЕ удаляются).',
    },
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
