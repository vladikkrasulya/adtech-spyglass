/* ============================================================
   modules/share/i18n.js — per-module translations.

   Pushes share-tool keys into window.kt_i18n_modules. The central
   /i18n.js merges this queue into the global I18N table at boot
   (or on-the-fly via registerI18nModule for late-loaded modules).

   Loaded BEFORE /i18n.js in HTML shells, so this file uses the
   queue-push pattern. After /i18n.js loads, the queue is drained.

   Keys are namespaced under "toast.share_*" and "modal.share_*"
   (no module-specific prefix beyond the existing scheme — keeps
   call sites stable: t('toast.share_link_copied') still works).
   ============================================================ */
(function () {
  'use strict';

  const SHARE_I18N = {
    id: 'share',
    keys: {
      'toast.share_link_copied': {
        uk: 'Посилання скопійовано — payload у URL-фрагменті не надсилається з першим запитом, але після відкриття передається в /api/analyze',
        en: 'Link copied — the URL fragment is absent from the initial request, but opening the link submits the payload to /api/analyze',
        ru: 'Ссылка скопирована — URL-фрагмент отсутствует в первом запросе, но после открытия payload отправляется в /api/analyze',
      },
      'toast.share_link_loaded': {
        uk: 'Завантажено зі share-посилання',
        en: 'Loaded from share link',
        ru: 'Загружено из share-ссылки',
      },
      'toast.share_link_invalid': {
        uk: 'Не вдалося розпакувати share-посилання: {error}',
        en: "Couldn't decode share link: {error}",
        ru: 'Не удалось декодировать share-ссылку: {error}',
      },
      // A share link that fails to decode has, in practice, one cause:
      // a chat client truncated it. The message names that cause and
      // says what to do next; the raw stream error is kept in brackets
      // for a bug report but is no longer the whole message.
      'toast.share_link_truncated': {
        uk: 'Share-посилання обрізане або пошкоджене — месенджери часто ріжуть довгі URL. Попроси надіслати payload файлом або зашифрованим посиланням. ({error})',
        en: 'This share link is truncated or damaged — chat clients often cut long URLs. Ask for the payload as a file or an encrypted link instead. ({error})',
        ru: 'Share-ссылка обрезана или повреждена — мессенджеры часто режут длинные URL. Попроси прислать payload файлом или зашифрованной ссылкой. ({error})',
      },
      'toast.share_link_failed': {
        uk: 'Не вдалося згенерувати посилання: {error}',
        en: "Couldn't build share link: {error}",
        ru: 'Не удалось сгенерировать ссылку: {error}',
      },
      'toast.share_link_too_long': {
        uk: 'Payload завеликий для share-посилання ({size} символів). Спробуй "завантажити" — JSON-бандл як файл.',
        en: 'Payload too large for a share link ({size} chars). Try "download" instead — JSON bundle as a file.',
        ru: 'Payload слишком большой для share-ссылки ({size} символов). Попробуй "скачать" — JSON-бандл файлом.',
      },
      'toast.share_unsupported': {
        uk: 'Браузер не підтримує стиснення для share-посилань — використай "завантажити".',
        en: 'Browser doesn\'t support share-link compression — use "download".',
        ru: 'Браузер не поддерживает сжатие для share-ссылок — используй "скачать".',
      },
      'toast.share_link_manual_copy': {
        uk: 'Скопіюй це посилання вручну (буфер обміну заблоковано):',
        en: 'Copy this link manually (clipboard blocked):',
        ru: 'Скопируй ссылку вручную (буфер обмена заблокирован):',
      },
      // ── Encrypted gists ──────────────────────────────────────────
      // The confirm text has to be exact about the trade: this is the one
      // share mode that transmits anything, and the user is agreeing to an
      // upload. It says what the server gets (ciphertext), what it does not
      // get (the key), and where the key lives (the link itself).
      'confirm.share_gist_upload': {
        uk:
          'Payload завеликий для звичайного посилання ({size} символів).\n\n' +
          'Створити зашифроване посилання? Дані буде стиснуто й зашифровано у твоєму браузері, ' +
          'на сервер піде лише шифротекст. Ключ залишиться у самому посиланні — сервер його не отримає ' +
          'і прочитати вміст не зможе.\n\n' +
          'Хто має посилання — той має доступ. Термін дії: 30 днів.',
        en:
          'Payload is too large for a plain link ({size} chars).\n\n' +
          'Create an encrypted link? The data is compressed and encrypted in your browser, and only ' +
          'the ciphertext is uploaded. The key stays inside the link itself — the server never receives ' +
          'it and cannot read the contents.\n\n' +
          'Anyone with the link has access. It expires in 30 days.',
        ru:
          'Payload слишком большой для обычной ссылки ({size} символов).\n\n' +
          'Создать зашифрованную ссылку? Данные будут сжаты и зашифрованы в твоём браузере, ' +
          'на сервер уйдёт только шифротекст. Ключ останется в самой ссылке — сервер его не получит ' +
          'и содержимое прочитать не сможет.\n\n' +
          'У кого есть ссылка — у того есть доступ. Срок действия: 30 дней.',
      },
      'toast.share_gist_failed': {
        uk: 'Не вдалося створити зашифроване посилання: {error}',
        en: "Couldn't create the encrypted link: {error}",
        ru: 'Не удалось создать зашифрованную ссылку: {error}',
      },
      'toast.share_gist_loaded': {
        uk: 'Завантажено із зашифрованого посилання — розшифровано у твоєму браузері',
        en: 'Loaded from an encrypted link — decrypted in your browser',
        ru: 'Загружено из зашифрованной ссылки — расшифровано в твоём браузере',
      },
      'toast.share_gist_no_key': {
        uk: 'У посиланні немає ключа — без частини після "#key=" вміст не прочитає ніхто, включно з сервером.',
        en: 'The link carries no key — without the part after "#key=" nobody can read it, the server included.',
        ru: 'В ссылке нет ключа — без части после "#key=" содержимое не прочитает никто, включая сервер.',
      },
      'toast.share_gist_invalid': {
        uk: 'Не вдалося відкрити зашифроване посилання: {error}. Воно могло застаріти, бути обрізаним або зміненим.',
        en: "Couldn't open the encrypted link: {error}. It may have expired, been truncated, or been altered.",
        ru: 'Не удалось открыть зашифрованную ссылку: {error}. Она могла устареть, быть обрезанной или изменённой.',
      },
      // Server tells these two apart precisely (410 vs 404) — see
      // modules/gists/handler.js — so we can name the cause instead of
      // falling through to the hedged toast.share_gist_invalid above.
      'toast.share_gist_expired': {
        uk: 'Термін дії цього посилання сплив — попроси надіслати нове.',
        en: 'This share link has expired — ask for a new one.',
        ru: 'Срок действия этой ссылки истёк — попроси прислать новую.',
      },
      'toast.share_gist_not_found': {
        uk: 'Такого посилання не існує — перевір, чи скопійоване воно повністю.',
        en: "This share link doesn't exist — check that you copied it in full.",
        ru: 'Такой ссылки не существует — проверь, скопирована ли она полностью.',
      },
    },
  };

  // Two-mode registration: if /i18n.js already loaded, register directly.
  // Otherwise queue, and i18n.js drains the queue on its own boot.
  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SHARE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(SHARE_I18N);
  }
})();
