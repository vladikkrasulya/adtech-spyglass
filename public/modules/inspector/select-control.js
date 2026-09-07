/* Inspector-only select presentation. Native options and values remain the
   application contract; this component owns keyboard/popup state and teardown. */
export function enhanceSelectControls(root, ctx) {
  const controller = new AbortController();
  const signal = controller.signal;
  const controls = [];
  let current = null;
  let disposed = false;

  for (const select of root.querySelectorAll('select:not([multiple])')) {
    if (!select.id || select.classList.contains('inspector-select-source')) continue;
    const wrapper = document.createElement('span');
    wrapper.className = 'inspector-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = select.id + 'Control';
    button.className = select.className + ' inspector-select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'inspector-select-value';
    const caret = document.createElement('span');
    caret.className = 'inspector-select-caret';
    caret.setAttribute('aria-hidden', 'true');
    button.append(label, caret);
    const list = document.createElement('div');
    list.id = select.id + 'Options';
    list.className = 'inspector-select-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    button.setAttribute('aria-controls', list.id);
    const originalTabIndex = select.getAttribute('tabindex');
    const originalAriaHidden = select.getAttribute('aria-hidden');
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add('inspector-select-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    document.body.append(list);
    let active = -1;
    let activeOption = null;
    let open = false;
    let search = '';
    let searchAt = 0;
    let options = [];

    const disabled = (option) => option.disabled || option.closest('optgroup')?.disabled;
    const enabledIndices = () =>
      Array.from(select.options).flatMap((o, i) =>
        disabled(o) || o.hidden || o.closest('optgroup')?.hidden ? [] : [i],
      );
    function position() {
      if (!open) return;
      const box = button.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        close(false);
        return;
      }
      const margin = 8;
      const below = innerHeight - box.bottom - margin - 4;
      const above = box.top - margin - 4;
      const upwards = below < Math.min(list.scrollHeight, 180) && above > below;
      const available = Math.max(0, upwards ? above : below);
      list.style.maxHeight = Math.min(320, available) + 'px';
      list.style.width = Math.min(Math.max(box.width, 200), innerWidth - margin * 2) + 'px';
      list.style.left =
        Math.max(margin, Math.min(box.left, innerWidth - list.offsetWidth - margin)) + 'px';
      list.style.top = (upwards ? box.top - list.offsetHeight - 4 : box.bottom + 4) + 'px';
    }
    function paintActive(scroll = true) {
      activeOption = select.options[active] || null;
      options.forEach((el, i) => {
        el.setAttribute('aria-selected', String(i === (open ? active : select.selectedIndex)));
        el.classList.toggle('is-active', open && i === active);
      });
      if (open && options[active]) {
        button.setAttribute('aria-activedescendant', options[active].id);
        if (scroll) {
          const option = options[active];
          if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
          else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
            list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
        }
      } else button.removeAttribute('aria-activedescendant');
    }
    function refresh() {
      const name =
        select.getAttribute('aria-label') ||
        Array.from(select.labels || [])
          .map((el) =>
            [...el.childNodes]
              .filter((node) => node !== wrapper)
              .map((node) => node.textContent)
              .join(' ')
              .trim(),
          )
          .join(' ');
      if (select.hasAttribute('aria-labelledby'))
        button.setAttribute('aria-labelledby', select.getAttribute('aria-labelledby'));
      else button.setAttribute('aria-label', name || select.title || select.id);
      list.setAttribute('aria-label', name || select.title || select.id);
      button.title = select.title;
      button.disabled = select.disabled;
      button.setAttribute('aria-disabled', String(select.disabled));
      wrapper.hidden = select.hidden;
      label.textContent = select.selectedOptions[0]?.label || '';
      const enabled = enabledIndices();
      if (!open) active = select.selectedIndex;
      else {
        active = Array.from(select.options).indexOf(activeOption);
        if (!enabled.includes(active))
          active = enabled.includes(select.selectedIndex)
            ? select.selectedIndex
            : (enabled[0] ?? -1);
      }
      list.replaceChildren();
      options = Array.from(select.options, (option, i) => {
        const row = document.createElement('div');
        row.id = list.id + '-' + i;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-disabled', String(!!disabled(option)));
        row.hidden = option.hidden || !!option.closest('optgroup')?.hidden;
        row.dataset.index = String(i);
        row.textContent = option.label;
        list.append(row);
        return row;
      });
      if (select.disabled || select.hidden) close(false);
      position();
      paintActive();
    }
    function close(commit, focus = false) {
      if (!open) return;
      const chosen = active;
      open = false;
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.removeAttribute('aria-activedescendant');
      if (current === control) current = null;
      search = '';
      if (
        commit &&
        !select.disabled &&
        enabledIndices().includes(chosen) &&
        chosen !== select.selectedIndex
      ) {
        select.selectedIndex = chosen;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      refresh();
      if (focus) button.focus({ preventScroll: true });
    }
    function show() {
      if (select.disabled || select.hidden || disposed) return;
      if (current && current !== control) current.close(false);
      refresh();
      open = true;
      current = control;
      const enabled = enabledIndices();
      active = enabled.includes(select.selectedIndex) ? select.selectedIndex : (enabled[0] ?? -1);
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      position();
      paintActive();
    }
    const control = {
      refresh,
      close,
      position,
      button,
      list,
      destroy() {
        observer.disconnect();
        list.remove();
        select.classList.remove('inspector-select-source');
        if (originalTabIndex === null) select.removeAttribute('tabindex');
        else select.setAttribute('tabindex', originalTabIndex);
        if (originalAriaHidden === null) select.removeAttribute('aria-hidden');
        else select.setAttribute('aria-hidden', originalAriaHidden);
        wrapper.before(select);
        wrapper.remove();
      },
    };
    controls.push(control);
    const observer = new MutationObserver(refresh);
    observer.observe(select, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'hidden',
        'label',
        'value',
        'selected',
        'aria-label',
        'aria-labelledby',
        'title',
      ],
    });
    select.addEventListener('change', refresh, { signal });
    select.addEventListener('input', refresh, { signal });
    // A label still names its native source; forward its default focus target.
    select.addEventListener('focus', () => button.focus(), { signal });
    button.addEventListener('click', () => (open ? close(false) : show()), { signal });
    button.addEventListener('blur', () => close(true), { signal });
    button.addEventListener(
      'keydown',
      (event) => {
        if (event.isComposing || event.ctrlKey || event.metaKey) return;
        const key = event.key;
        if (key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close(false);
          return;
        }
        if (key === 'Tab') {
          close(true);
          return;
        }
        if (event.altKey && key === 'ArrowDown') {
          event.preventDefault();
          if (!open) show();
          return;
        }
        if (event.altKey && key === 'ArrowUp' && open) {
          event.preventDefault();
          close(true);
          return;
        }
        if (open && (key === 'PageUp' || key === 'PageDown')) {
          event.preventDefault();
          const enabled = enabledIndices();
          const next = enabled.indexOf(active) + (key === 'PageUp' ? -10 : 10);
          active = enabled[Math.max(0, Math.min(next, enabled.length - 1))] ?? -1;
          paintActive();
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
          event.preventDefault();
          const wasOpen = open;
          if (!open) show();
          const enabled = enabledIndices();
          const at = enabled.indexOf(active);
          if (key === 'Home') active = enabled[0] ?? -1;
          else if (key === 'End') active = enabled.at(-1) ?? -1;
          else if (!wasOpen && key === 'ArrowUp') active = enabled[0] ?? -1;
          else if (wasOpen && (key === 'Enter' || key === ' ')) close(true);
          else if (wasOpen && key === 'ArrowDown')
            active = enabled[Math.min(at + 1, enabled.length - 1)] ?? -1;
          else if (wasOpen && key === 'ArrowUp') active = enabled[Math.max(0, at - 1)] ?? -1;
          paintActive();
          return;
        }
        if (key.length === 1 && !event.altKey) {
          event.preventDefault();
          if (!open) show();
          const now = Date.now();
          const previous = now - searchAt > 700 ? '' : search;
          search = previous + key;
          searchAt = now;
          const repeated =
            previous.length > 0 &&
            [...search].every((c) => c.toLocaleLowerCase() === key.toLocaleLowerCase());
          const term = (repeated ? key : search).toLocaleLowerCase();
          const enabled = enabledIndices();
          const start = repeated ? enabled.indexOf(active) + 1 : 0;
          const ordered = [...enabled.slice(start), ...enabled.slice(0, start)];
          const match = ordered.find((i) =>
            select.options[i].label.toLocaleLowerCase().startsWith(term),
          );
          if (match !== undefined) active = match;
          paintActive();
        }
      },
      { signal },
    );
    list.addEventListener('pointerdown', (event) => event.preventDefault(), { signal });
    list.addEventListener(
      'click',
      (event) => {
        const row = event.target.closest('[role="option"]');
        if (!row || !list.contains(row)) return;
        const index = Number(row.dataset.index);
        if (!enabledIndices().includes(index)) return;
        active = index;
        close(true, true);
      },
      { signal },
    );
    refresh();
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (current && !current.button.contains(event.target) && !current.list.contains(event.target))
        current.close(false);
    },
    { signal },
  );
  window.addEventListener('resize', () => current?.position(), { signal });
  document.addEventListener('scroll', () => current?.position(), { signal, capture: true });
  const refresh = () => {
    if (!disposed) controls.forEach((control) => control.refresh());
  };
  root.addEventListener('change', () => queueMicrotask(refresh), { signal });
  function destroy() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    current = null;
    controls.forEach((control) => control.destroy());
  }
  ctx.addCleanup(destroy);
  ctx.signal.addEventListener('abort', destroy, { once: true });
  return { refresh, destroy };
}
