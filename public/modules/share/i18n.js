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
        uk: 'Посилання скопійовано — payload зашитий у URL-фрагменті, на сервер не потрапляє',
        en: 'Link copied — payload is embedded in the URL fragment, never reaches the server',
        ru: 'Ссылка скопирована — payload встроен в URL-фрагмент, на сервер не попадает',
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
        en: "Browser doesn't support share-link compression — use \"download\".",
        ru: 'Браузер не поддерживает сжатие для share-ссылок — используй "скачать".',
      },
      'toast.share_link_manual_copy': {
        uk: 'Скопіюй це посилання вручну (буфер обміну заблоковано):',
        en: 'Copy this link manually (clipboard blocked):',
        ru: 'Скопируй ссылку вручную (буфер обмена заблокирован):',
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
