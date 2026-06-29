/* Exact finding → source navigation for the Inspector editors. */
'use strict';

const COPY = {
  en: { previous: 'Previous location', next: 'Next location', close: 'Close highlight' },
  uk: { previous: 'Попередня локація', next: 'Наступна локація', close: 'Закрити підсвічування' },
  ru: { previous: 'Предыдущая локация', next: 'Следующая локация', close: 'Закрыть подсветку' },
};

function button(label, text, action) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'source-overlay__button';
  el.setAttribute('aria-label', label);
  el.title = label;
  el.textContent = text;
  el.dataset.sourceAction = action;
  return el;
}

function parseLocation(el) {
  try {
    return JSON.parse(el.dataset.findingLocation || 'null');
  } catch (_e) {
    return null;
  }
}

function editorFor(side) {
  return document.getElementById(side === 'response' ? 'bidRes' : 'bidReq');
}

const mapCache = new WeakMap();

function sourceMapFor(editor) {
  if (editor.value.length > 2 * 1024 * 1024) return null;
  const cached = mapCache.get(editor);
  if (cached && cached.text === editor.value) return cached.map;
  const map = window.SpyglassSourceMap.buildSourceMap(editor.value);
  mapCache.set(editor, { text: editor.value, map });
  return map;
}

function rangeFor(editor, location) {
  if (!location) return null;
  const text = editor.value;
  if (location.dialect === 'url') {
    const found = window.SpyglassSourceMap.locateUrlParam(text, location.pointer);
    if (!found) return null;
    return location.target === 'key'
      ? [found.keyStart, found.keyEnd]
      : [found.valStart, found.valEnd];
  }
  const map = sourceMapFor(editor);
  if (!map) return null;
  if (!map.ok) return null;
  const entry = map.resolve(location.pointer);
  if (!entry) return null;
  if (location.target === 'key' && entry.keyStart != null) {
    return [entry.keyStart, entry.keyEnd];
  }
  return [entry.valueStart, entry.valueEnd];
}

export function setupSourceLocator(root, signal, lang) {
  const labels = COPY[lang] || COPY.en;
  let state = null;

  function teardown() {
    if (!state) return;
    if (state.editor) state.editor.classList.remove('has-source-overlay');
    if (state.overlay) state.overlay.remove();
    state = null;
  }

  function paint(index) {
    const locations = state.locations;
    const location = locations[index];
    const editor = editorFor(location.side);
    if (!editor) return teardown();
    const range = rangeFor(editor, location);
    if (!range) return teardown();

    teardown();
    const overlay = document.createElement('div');
    overlay.className = 'source-overlay';
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-live', 'polite');

    const code = document.createElement('pre');
    code.className = 'source-overlay__code';
    code.appendChild(document.createTextNode(editor.value.slice(0, range[0])));
    const mark = document.createElement('mark');
    mark.className = 'source-overlay__mark';
    mark.appendChild(document.createTextNode(editor.value.slice(range[0], range[1])));
    code.appendChild(mark);
    code.appendChild(document.createTextNode(editor.value.slice(range[1])));

    const nav = document.createElement('div');
    nav.className = 'source-overlay__nav';
    nav.appendChild(button(labels.previous, '←', 'previous'));
    const count = document.createElement('span');
    count.className = 'source-overlay__count';
    count.textContent = index + 1 + ' / ' + locations.length;
    nav.appendChild(count);
    nav.appendChild(button(labels.next, '→', 'next'));
    nav.appendChild(button(labels.close, '×', 'close'));
    overlay.appendChild(code);
    overlay.appendChild(nav);

    editor.parentElement.appendChild(overlay);
    editor.classList.add('has-source-overlay');
    state = { editor, overlay, locations, index };

    code.scrollTop = editor.scrollTop;
    code.scrollLeft = editor.scrollLeft;
    requestAnimationFrame(() => mark.scrollIntoView({ block: 'center', inline: 'nearest' }));
    editor.focus();
    editor.setSelectionRange(range[0], range[1]);
  }

  function open(location) {
    const locations = [location.primary]
      .concat(location.related || [])
      .filter(Boolean)
      .map((item) => Object.assign({ dialect: location.dialect }, item));
    if (!locations.length) return;
    state = { locations, index: 0, editor: editorFor(locations[0].side), overlay: null };
    paint(0);
  }

  root.addEventListener(
    'click',
    (event) => {
      const sourceButton = event.target.closest('[data-finding-location]');
      if (sourceButton) {
        event.preventDefault();
        const location = parseLocation(sourceButton);
        if (location) open(location);
        return;
      }
      const action = event.target.closest('[data-source-action]');
      if (!action || !state) return;
      if (action.dataset.sourceAction === 'close') return teardown();
      const delta = action.dataset.sourceAction === 'previous' ? -1 : 1;
      const next = (state.index + delta + state.locations.length) % state.locations.length;
      paint(next);
    },
    { signal },
  );

  root.addEventListener(
    'input',
    (event) => {
      mapCache.delete(event.target);
      if (state && event.target === state.editor) teardown();
    },
    { signal },
  );

  window.addEventListener(
    'spyglass:analysis-rendered',
    () => {
      for (const id of ['bidReq', 'bidRes']) {
        const editor = document.getElementById(id);
        if (editor && editor.value.length <= 1024 * 1024) sourceMapFor(editor);
      }
    },
    { signal },
  );

  root.addEventListener(
    'keydown',
    (event) => {
      if (!state) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        teardown();
      } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        paint((state.index + delta + state.locations.length) % state.locations.length);
      }
    },
    { signal },
  );

  signal.addEventListener('abort', teardown, { once: true });
  return { teardown };
}
