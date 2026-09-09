import { escapeHtml } from '/core/utils.js';

const WORDS = {
  en: {
    title: 'SChain and declared route',
    input: 'Chain or request',
    hint: 'Paste a chain object, an OpenRTB request, a serialized chain or a URL with schain=. No URL is fetched.',
    inspect: 'Inspect chain',
    sender: 'Compare with a sender you declare',
    asi: 'Sender advertising system domain (asi)',
    sid: 'Sender seller account (sid)',
    route: 'Declared request route',
    none: 'Unknown — no route declared',
    routeHint:
      'Select the adapter you intend to use. This compares the pasted request with a pinned adapter profile; it does not observe traffic.',
    apply: 'Apply to next analysis',
    close: 'Close',
    loading: 'Loading…',
    failed: 'Inspection could not complete. Check the input and try again.',
    profilesFailed: 'Route profiles could not load. Close and reopen to retry.',
    invalidSender: 'Enter both the sender domain and seller account.',
    empty: 'Paste a chain or request first.',
    count: 'Nodes',
    inputKind: 'Input format',
    structured: 'Structured JSON',
    serialized: 'Serialized chain',
    query: 'URL or query',
    source: 'Sources',
    comparison: 'Declared sender comparison',
    noFindings: 'No chain finding.',
    noChain: 'No supported chain was found in this input.',
    pending: 'Declared context selected — run analysis',
    known: 'Declared route profile applies',
    unknown: 'Route applicability is unknown',
    unknownState: 'Unknown',
    declared: 'Declared context',
    requestOnly: 'Route relevance applies to requests.',
    valid: 'Valid',
    warning: 'Warning',
    invalid: 'Invalid',
    match: 'Match',
    mismatch: 'Mismatch',
    present: 'Present',
    absent: 'Absent',
    required: 'Required',
    forbidden: 'Forbidden',
    injected: 'Injected',
    rewritten: 'Rewritten',
    moved: 'Moved',
    validated: 'Validated',
    conditional: 'Conditional',
    optional: 'Optional',
  },
  uk: {
    title: 'SChain і заявлений маршрут',
    input: 'Ланцюжок або запит',
    hint: 'Встав об’єкт ланцюжка, запит OpenRTB, серіалізований ланцюжок або URL зі schain=. URL не завантажується.',
    inspect: 'Перевірити ланцюжок',
    sender: 'Порівняти із заданим тобою відправником',
    asi: 'Домен рекламної системи відправника (asi)',
    sid: 'Акаунт продавця відправника (sid)',
    route: 'Заявлений маршрут запиту',
    none: 'Невідомий — маршрут не задано',
    routeHint:
      'Обери адаптер, який плануєш використовувати. Запит порівнюється із зафіксованим профілем адаптера; це не спостереження за трафіком.',
    apply: 'Застосувати до наступного аналізу',
    close: 'Закрити',
    loading: 'Завантаження…',
    failed: 'Не вдалося завершити перевірку. Перевір вхідні дані й спробуй ще раз.',
    profilesFailed: 'Не вдалося завантажити профілі. Закрий і відкрий вікно ще раз.',
    invalidSender: 'Вкажи домен відправника й акаунт продавця.',
    empty: 'Спочатку встав ланцюжок або запит.',
    count: 'Вузлів',
    inputKind: 'Формат вхідних даних',
    structured: 'Структурований JSON',
    serialized: 'Серіалізований ланцюжок',
    query: 'URL або рядок параметрів',
    source: 'Джерела',
    comparison: 'Порівняння із заявленим відправником',
    noFindings: 'Зауважень до ланцюжка немає.',
    noChain: 'У цих даних не знайдено підтримуваного ланцюжка.',
    pending: 'Контекст задано — запусти аналіз',
    known: 'Профіль заявленого маршруту застосовний',
    unknown: 'Застосовність маршруту невідома',
    unknownState: 'Невідомо',
    declared: 'Заявлений контекст',
    requestOnly: 'Застосовність маршруту визначається для запитів.',
    valid: 'Валідний',
    warning: 'Попередження',
    invalid: 'Невалідний',
    match: 'Збігається',
    mismatch: 'Не збігається',
    present: 'Є',
    absent: 'Немає',
    required: 'Обов’язкове',
    forbidden: 'Заборонене',
    injected: 'Додається',
    rewritten: 'Перезаписується',
    moved: 'Переноситься',
    validated: 'Перевіряється',
    conditional: 'Умовне',
    optional: 'Необов’язкове',
  },
  ru: {
    title: 'SChain и заявленный маршрут',
    input: 'Цепочка или запрос',
    hint: 'Вставь объект цепочки, запрос OpenRTB, сериализованную цепочку или URL со schain=. URL не загружается.',
    inspect: 'Проверить цепочку',
    sender: 'Сравнить с заданным тобой отправителем',
    asi: 'Домен рекламной системы отправителя (asi)',
    sid: 'Аккаунт продавца отправителя (sid)',
    route: 'Заявленный маршрут запроса',
    none: 'Неизвестен — маршрут не задан',
    routeHint:
      'Выбери адаптер, который планируешь использовать. Запрос сравнивается с зафиксированным профилем адаптера; это не наблюдение за трафиком.',
    apply: 'Применить к следующему анализу',
    close: 'Закрыть',
    loading: 'Загрузка…',
    failed: 'Не удалось завершить проверку. Проверь входные данные и попробуй ещё раз.',
    profilesFailed: 'Не удалось загрузить профили. Закрой и открой окно ещё раз.',
    invalidSender: 'Укажи домен отправителя и аккаунт продавца.',
    empty: 'Сначала вставь цепочку или запрос.',
    count: 'Узлов',
    inputKind: 'Формат входных данных',
    structured: 'Структурированный JSON',
    serialized: 'Сериализованная цепочка',
    query: 'URL или строка параметров',
    source: 'Источники',
    comparison: 'Сравнение с заявленным отправителем',
    noFindings: 'Замечаний к цепочке нет.',
    noChain: 'В этих данных не найдена поддерживаемая цепочка.',
    pending: 'Контекст задан — запусти анализ',
    known: 'Профиль заявленного маршрута применим',
    unknown: 'Применимость маршрута неизвестна',
    unknownState: 'Неизвестно',
    declared: 'Заявленный контекст',
    requestOnly: 'Применимость маршрута определяется для запросов.',
    valid: 'Валидна',
    warning: 'Предупреждение',
    invalid: 'Невалидна',
    match: 'Совпадает',
    mismatch: 'Не совпадает',
    present: 'Есть',
    absent: 'Нет',
    required: 'Обязательное',
    forbidden: 'Запрещено',
    injected: 'Добавляется',
    rewritten: 'Перезаписывается',
    moved: 'Переносится',
    validated: 'Проверяется',
    conditional: 'Условное',
    optional: 'Необязательное',
  },
};

function sourceLinks(sources) {
  return (sources || [])
    .slice(0, 30)
    .map((source) => {
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'https:') return '';
        return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.path || url.hostname)}</a>`;
      } catch (_e) {
        return '';
      }
    })
    .filter(Boolean)
    .join(' · ');
}

export function mountInspection(root, ctx, { onContextChange = () => {} } = {}) {
  let context = {};
  let routeResult = null;
  let senderResult = null;
  let dialogController = null;
  const lang = () =>
    ['en', 'uk', 'ru'].includes(document.documentElement.lang)
      ? document.documentElement.lang
      : 'en';
  const words = () => WORDS[lang()];
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/modules/inspector/inspection.css';
  document.head.appendChild(css);
  ctx.addCleanup(() => css.remove());

  function summary() {
    const output = root.querySelector('#inspectionContextSummary');
    if (!output) return;
    const selected = context.declaredRoute || context.declaredSender;
    output.hidden = !selected;
    const w = words();
    const parts = [];
    if (context.declaredRoute && routeResult)
      parts.push(
        `${w[routeResult.status === 'known' ? 'known' : 'unknown']} · ${context.declaredRoute.adapterId}`,
      );
    if (context.declaredSender && senderResult)
      parts.push(`${w.comparison}: ${comparisonStatus(senderResult)}`);
    output.textContent = !selected ? '' : parts.length ? parts.join(' · ') : w.pending;
  }

  function comparisonStatus(result) {
    const status = result?.comparison?.status;
    return status === 'match' || status === 'mismatch' ? words()[status] : words().unknownState;
  }

  function renderRoute(output) {
    const w = words();
    const senderCopy =
      context.declaredSender && senderResult
        ? `${w.comparison}: ${comparisonStatus(senderResult)}`
        : '';
    if (!routeResult) {
      output.textContent = [context.declaredRoute ? w.pending : '', senderCopy]
        .filter(Boolean)
        .join(' · ');
      return;
    }
    output.innerHTML =
      `<p>${escapeHtml(w[routeResult.status === 'known' ? 'known' : 'unknown'])}</p>` +
      (senderCopy ? `<p>${escapeHtml(senderCopy)}</p>` : '') +
      (routeResult.profile
        ? `<p><code>${escapeHtml(routeResult.profile.adapterId)} · ${escapeHtml(routeResult.profile.revision)}</code></p>`
        : '') +
      `<ul>${(routeResult.statements || []).map((s) => `<li><code>${escapeHtml(s.field)}</code>: ${escapeHtml(w[s.disposition] || s.disposition)} · ${escapeHtml(w[s.applicability] || w.unknown)}${s.detail ? `<p>${escapeHtml(s.detail)}</p>` : ''}</li>`).join('')}</ul>` +
      (routeResult.profile
        ? `<p>${escapeHtml(w.source)}: ${sourceLinks(routeResult.profile.sources)}</p>`
        : '');
  }

  function refreshResults() {
    summary();
    const output = document.querySelector('#modalRoot #inspectionRouteResult');
    if (output) renderRoute(output);
  }

  function open() {
    dialogController?.abort();
    const controller = new AbortController();
    dialogController = controller;
    const modalRoot = document.getElementById('modalRoot');
    if (!modalRoot) return;
    const w = words();
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="modal-backdrop-close"><div class="modal-card inspection-dialog">
      <h3 class="modal-title">${escapeHtml(w.title)}</h3>
      <label for="inspectionInput">${escapeHtml(w.input)}</label>
      <textarea id="inspectionInput" rows="5" maxlength="200000" spellcheck="false" aria-describedby="inspectionHint"></textarea>
      <p class="inspection-help" id="inspectionHint">${escapeHtml(w.hint)}</p>
      <label class="inspection-toggle"><input type="checkbox" id="inspectionSenderEnabled"> ${escapeHtml(w.sender)}</label>
      <div class="inspection-sender" hidden>
        <label for="inspectionAsi">${escapeHtml(w.asi)}</label><input id="inspectionAsi" maxlength="253" autocomplete="off">
        <label for="inspectionSid">${escapeHtml(w.sid)}</label><input id="inspectionSid" maxlength="256" autocomplete="off">
      </div>
      <button class="btn btn-secondary btn-sm" type="button" id="inspectionRun">${escapeHtml(w.inspect)}</button>
      <div id="inspectionError" role="alert"></div><div id="inspectionResult" aria-live="polite"></div>
      <hr><label for="inspectionRoute">${escapeHtml(w.route)}</label>
      <select id="inspectionRoute" aria-describedby="inspectionRouteHint"><option value="">${escapeHtml(w.none)}</option></select>
      <p class="inspection-help" id="inspectionRouteHint">${escapeHtml(w.routeHint)}</p>
      <p id="inspectionProfilesState" role="status">${escapeHtml(w.loading)}</p>
      <div id="inspectionRouteResult"></div>
      <div class="modal-actions"><button class="btn btn-ghost btn-sm" data-action="modal-close">${escapeHtml(w.close)}</button><button class="btn btn-primary btn-sm" type="button" id="inspectionApply">${escapeHtml(w.apply)}</button></div>
    </div></div>`;
    const dialog = modalRoot.querySelector('.inspection-dialog');
    const q = (selector) => dialog.querySelector(selector);
    const observer = new MutationObserver(() => {
      if (!dialog.isConnected) controller.abort();
    });
    observer.observe(modalRoot, { childList: true });
    controller.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
    const on = (selector, event, fn) =>
      q(selector).addEventListener(event, fn, { signal: controller.signal });
    let runGeneration = 0;
    let runController = null;
    function invalidateInspection() {
      runGeneration++;
      runController?.abort();
      runController = null;
      q('#inspectionRun').disabled = false;
      q('#inspectionResult').textContent = '';
      q('#inspectionError').textContent = '';
    }
    for (const selector of ['#inspectionInput', '#inspectionAsi', '#inspectionSid'])
      on(selector, 'input', invalidateInspection);
    q('#inspectionInput').value = root.querySelector('#bidReq')?.value || '';
    q('#inspectionSenderEnabled').checked = !!context.declaredSender;
    q('.inspection-sender').hidden = !context.declaredSender;
    q('#inspectionAsi').value = context.declaredSender?.asi || '';
    q('#inspectionSid').value = context.declaredSender?.sid || '';
    on('#inspectionSenderEnabled', 'change', () => {
      invalidateInspection();
      q('.inspection-sender').hidden = !q('#inspectionSenderEnabled').checked;
    });
    renderRoute(q('#inspectionRouteResult'));
    let profiles = [];
    let profilesLoaded = false;
    fetch(`/api/inspection/profiles?locale=${lang()}`, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || data.success !== true || !Array.isArray(data.profiles))
          throw new Error('profiles');
        if (controller.signal.aborted) return;
        profiles = data.profiles;
        profiles.forEach((profile, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = `${profile.adapterId} · ${profile.revision.slice(0, 12)}`;
          q('#inspectionRoute').appendChild(option);
          if (
            context.declaredRoute?.adapterId === profile.adapterId &&
            context.declaredRoute?.revision === profile.revision
          )
            option.selected = true;
        });
        profilesLoaded = true;
        q('#inspectionProfilesState').textContent = '';
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          profilesLoaded = false;
          profiles = [];
          const select = q('#inspectionRoute');
          select.replaceChildren(select.options[0]);
          select.disabled = true;
          q('#inspectionProfilesState').textContent = w.profilesFailed;
        }
      });

    function sender() {
      if (!q('#inspectionSenderEnabled').checked) return undefined;
      const asi = q('#inspectionAsi').value.trim();
      const sid = q('#inspectionSid').value.trim();
      if (!asi || !sid) throw new Error(w.invalidSender);
      return { asi, sid, provenance: 'declared' };
    }

    on('#inspectionApply', 'click', () => {
      try {
        const declaredSender = sender();
        const selected = q('#inspectionRoute').value;
        const profile = selected === '' ? null : profiles[Number(selected)];
        // A failed catalog read must not silently erase a previous selection.
        const declaredRoute = !profilesLoaded
          ? context.declaredRoute
          : profile
            ? {
                adapterId: profile.adapterId,
                direction: profile.direction,
                revision: profile.revision,
                provenance: 'declared',
              }
            : undefined;
        const nextContext = {
          ...(declaredSender ? { declaredSender } : {}),
          ...(declaredRoute ? { declaredRoute } : {}),
        };
        const changed = JSON.stringify(nextContext) !== JSON.stringify(context);
        context = nextContext;
        if (changed) {
          routeResult = null;
          senderResult = null;
          onContextChange();
        }
        refreshResults();
        window.closeModal();
      } catch (e) {
        q('#inspectionError').textContent = e.message;
      }
    });

    on('#inspectionRun', 'click', async () => {
      invalidateInspection();
      let declaredSender;
      try {
        declaredSender = sender();
      } catch (e) {
        q('#inspectionError').textContent = e.message;
        return;
      }
      const text = q('#inspectionInput').value.trim();
      if (!text) {
        q('#inspectionError').textContent = w.empty;
        return;
      }
      let input = text;
      if (text.startsWith('{')) {
        try {
          input = JSON.parse(text);
        } catch (_e) {
          /* Core reports malformed text. */
        }
      }
      q('#inspectionRun').disabled = true;
      q('#inspectionResult').textContent = w.loading;
      const generation = runGeneration;
      const requestController = new AbortController();
      runController = requestController;
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener('abort', abortRequest, { once: true });
      const isCurrent = () =>
        !controller.signal.aborted &&
        !requestController.signal.aborted &&
        generation === runGeneration;
      try {
        const r = await fetch('/api/inspection/schain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, declaredSender, locale: lang() }),
          signal: requestController.signal,
        });
        const data = await r.json();
        if (!r.ok || data.success !== true || !data.inspection) throw new Error('inspection');
        if (!isCurrent()) return;
        const result = data.inspection;
        q('#inspectionResult').innerHTML =
          `<p><strong>${escapeHtml(result.status === 'unknown' ? w.unknownState : w[result.status] || w.unknownState)}</strong></p>` +
          `<p>${escapeHtml(w.inputKind)}: ${escapeHtml(w[result.kind] || w.unknownState)}</p>` +
          (result.copies.length
            ? result.copies
                .map(
                  (copy) =>
                    `<p><code>${escapeHtml(copy.path)}</code> · ${escapeHtml(w.count)}: ${escapeHtml(String(copy.nodeCount))}</p>`,
                )
                .join('')
            : `<p>${escapeHtml(w.noChain)}</p>`) +
          `<p>${escapeHtml(w.comparison)}: ${escapeHtml(result.comparison.status === 'unknown' ? w.unknownState : w[result.comparison.status] || w.unknownState)}</p>` +
          (result.findings.length
            ? `<ul>${result.findings.map((f) => `<li><code>${escapeHtml(f.path || '')}</code> ${escapeHtml(f.msg || f.id)}</li>`).join('')}</ul>`
            : `<p>${escapeHtml(w.noFindings)}</p>`) +
          `<p>${escapeHtml(w.source)}: ${sourceLinks(result.sources)}</p>`;
      } catch (_e) {
        if (isCurrent()) {
          q('#inspectionResult').textContent = '';
          q('#inspectionError').textContent = w.failed;
        }
      } finally {
        controller.signal.removeEventListener('abort', abortRequest);
        if (isCurrent()) q('#inspectionRun').disabled = false;
      }
    });
  }

  root.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="inspect-schain"]')) {
        const menu = event.target.closest('.kt-tools-menu');
        if (menu) menu.open = false;
        open();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'input',
    (event) => {
      if (event.target.matches('#bidReq, #bidRes')) {
        routeResult = null;
        senderResult = null;
        refreshResults();
      }
    },
    { signal: ctx.signal },
  );
  ctx.addCleanup(() => {
    dialogController?.abort();
    if (document.querySelector('#modalRoot .inspection-dialog')) window.closeModal();
  });
  return {
    getContext: () => JSON.parse(JSON.stringify(context)),
    setResult: (inspection) => {
      routeResult = inspection?.route || null;
      senderResult = inspection?.schain || null;
      refreshResults();
    },
    clear: () => {
      routeResult = null;
      senderResult = null;
      refreshResults();
    },
  };
}
