/* ============================================================
   modules/migrate/index.js — the Migration tab (OpenRTB 2.5 → 2.6).

   Lists what the shared advisor (/core/migrate.js, mirrored verbatim
   from packages/core/migrate/) proposes for the BidRequest in the
   editor, and — only when the user clicks Apply — rewrites the editor
   with the selected operations.

   THREE THINGS THIS FILE IS CAREFUL ABOUT
   ---------------------------------------
   1. NOTHING IS APPLIED IMPLICITLY. The advisor exposes no apply API on
      purpose; the applier lives here, behind an explicit click, and
      every application stores the previous editor text verbatim so Undo
      restores it byte-for-byte. Applying reformats the JSON — that is
      stated in the UI before the click, and Undo is the way back.

   2. PROPOSALS ARE ATOMIC, OPERATIONS ARE NOT. The advisor emits a
      promotion as two operations: an `add` at the 2.6 path and a
      `remove` at the legacy path. Offering those as two independent
      checkboxes would let someone tick the `remove` alone and silently
      DELETE a consent string. So the tab pairs them back into one
      proposal and applies them together. An unpaired `remove` is a real
      and safe case — it means the 2.6 field already holds the same
      value — and is labelled as such rather than hidden.

   3. `review` IS NOT PRE-SELECTED. `certain` and `likely` start ticked;
      `review` starts unticked and is visually distinct, because that
      confidence level exists precisely for proposals the advisor cannot
      justify on its own (an ambiguous category taxonomy, say).

   Exposed: window.OrtbtoolsMigrateTab (mount + a pure __test surface).
   ============================================================ */
(function () {
  'use strict';

  const MAX_VALUE_PREVIEW = 120;

  /** Ticked by default. `review` is deliberately absent. */
  const DEFAULT_SELECTED = { certain: true, likely: true, review: false };

  /**
   * Segments that must never be written through. The advisor's paths are built
   * from a frozen rule table, so none of these can occur today — but this is
   * the one place in the app that writes an attacker-supplied structure back
   * into an object, and `obj['__proto__'] = v` pollutes the prototype.
   */
  const FORBIDDEN_SEGMENTS = ['__proto__', 'constructor', 'prototype'];

  function tt(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : '[' + key + ']';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Compact one-line rendering of a JSON value, truncated for the list. */
  function preview(value) {
    if (value === undefined) return '—';
    let text;
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value);
    } catch (_e) {
      text = String(value);
    }
    if (text === undefined) text = 'undefined';
    return text.length > MAX_VALUE_PREVIEW ? text.slice(0, MAX_VALUE_PREVIEW) + '…' : text;
  }

  function compareText(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  // ── JSON Pointer (RFC 6901) ──────────────────────────────────────

  /** @returns {string[]|null} null when the pointer is not a valid RFC 6901 path. */
  function parsePointer(pointer) {
    if (pointer === '') return [];
    if (typeof pointer !== 'string' || pointer.charAt(0) !== '/') return null;
    return pointer
      .slice(1)
      .split('/')
      .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  /** '/regs/ext/gdpr' → '/regs/ext'; a root-level pointer → ''. */
  function parentPointer(pointer) {
    const cut = pointer.lastIndexOf('/');
    return cut <= 0 ? '' : pointer.slice(0, cut);
  }

  /** Walk to the container that owns the final segment. Never creates one. */
  function resolveParent(doc, segments) {
    let node = doc;
    for (let i = 0; i < segments.length - 1; i++) {
      if (node === null || typeof node !== 'object') return null;
      if (Array.isArray(node)) {
        const index = Number(segments[i]);
        if (!Number.isInteger(index) || index < 0 || index >= node.length) return null;
        node = node[index];
      } else {
        if (!Object.prototype.hasOwnProperty.call(node, segments[i])) return null;
        node = node[segments[i]];
      }
    }
    return node !== null && typeof node === 'object' ? node : null;
  }

  /**
   * Apply operations to a parsed document, in place. `add` runs before
   * `remove` so a promotion can never lose the value it is promoting even if
   * the two ever landed in the same container.
   *
   * Anything that cannot be applied is REPORTED, not silently dropped — a
   * migration tool that quietly skips half its work is worse than one that
   * refuses.
   */
  function applyOperations(doc, operations) {
    const applied = [];
    const skipped = [];
    const ordered = operations
      .slice()
      .sort((left, right) => (left.op === right.op ? 0 : left.op === 'add' ? -1 : 1));

    for (const operation of ordered) {
      const segments = parsePointer(operation.path);
      if (!segments || !segments.length) {
        skipped.push({ operation: operation, reason: 'bad_path' });
        continue;
      }
      if (segments.some((seg) => FORBIDDEN_SEGMENTS.indexOf(seg) !== -1)) {
        skipped.push({ operation: operation, reason: 'unsafe_path' });
        continue;
      }
      const parent = resolveParent(doc, segments);
      if (!parent) {
        skipped.push({ operation: operation, reason: 'missing_parent' });
        continue;
      }
      if (Array.isArray(parent)) {
        // No rule targets an array element; refusing beats leaving a hole.
        skipped.push({ operation: operation, reason: 'array_parent' });
        continue;
      }
      const key = segments[segments.length - 1];
      if (operation.op === 'add') {
        parent[key] = operation.after;
        applied.push(operation);
      } else if (Object.prototype.hasOwnProperty.call(parent, key)) {
        delete parent[key];
        applied.push(operation);
      } else {
        skipped.push({ operation: operation, reason: 'already_absent' });
      }
    }
    return { applied: applied, skipped: skipped };
  }

  // ── Grouping operations back into proposals ──────────────────────

  function makeProposal(operations) {
    let add = null;
    let remove = null;
    for (const operation of operations) {
      if (operation.op === 'add') add = operation;
      else if (operation.op === 'remove') remove = operation;
    }
    const lead = add || remove;
    return {
      key: lead.rule + '@' + (add ? add.path : '') + '|' + (remove ? remove.path : ''),
      rule: lead.rule,
      spec: lead.spec,
      confidence: lead.confidence,
      rationale: lead.rationale,
      // move: legacy field promoted to its 2.6 home.
      // add:  a new 2.6 field with no legacy source (cattax).
      // drop: the 2.6 field already holds the value; only the legacy copy goes.
      kind: add && remove ? 'move' : add ? 'add' : 'drop',
      fromPath: remove ? remove.path : null,
      toPath: add ? add.path : null,
      value: add ? add.after : remove.before,
      operations: operations,
      sortPath: lead.path,
    };
  }

  /**
   * Re-pair the advisor's flat operation list into atomic proposals.
   *
   * An `add` A pairs with a `remove` R when they share a rule id AND R sits
   * underneath A's parent — which is exactly how the advisor constructs a
   * promotion (`/imp/1/rwdd` ← `/imp/1/video/ext/rewarded`, `/regs/gdpr` ←
   * `/regs/ext/gdpr`). That containment test is what keeps imp 1's `add` from
   * being paired with imp 0's `remove` when only one of the two impressions
   * needs the promotion. Longest parent wins, so nested rules pair tightest.
   */
  function groupProposals(operations) {
    const byRule = new Map();
    for (const operation of operations) {
      if (!byRule.has(operation.rule)) byRule.set(operation.rule, []);
      byRule.get(operation.rule).push(operation);
    }

    const proposals = [];
    for (const list of byRule.values()) {
      const adds = list.filter((o) => o.op === 'add');
      const removes = list.filter((o) => o.op === 'remove');
      const paired = new Set();

      for (const removal of removes) {
        let bestIndex = -1;
        let bestLength = -1;
        for (let i = 0; i < adds.length; i++) {
          if (paired.has(i)) continue;
          const parent = parentPointer(adds[i].path);
          // A root-level `add` has no parent to contain anything, so it never
          // pairs — otherwise every removal would "match" it.
          if (!parent) continue;
          if (removal.path.slice(0, parent.length + 1) !== parent + '/') continue;
          if (parent.length > bestLength) {
            bestLength = parent.length;
            bestIndex = i;
          }
        }
        if (bestIndex >= 0) {
          paired.add(bestIndex);
          proposals.push(makeProposal([adds[bestIndex], removal]));
        } else {
          proposals.push(makeProposal([removal]));
        }
      }
      for (let i = 0; i < adds.length; i++) {
        if (!paired.has(i)) proposals.push(makeProposal([adds[i]]));
      }
    }

    proposals.sort(
      (left, right) =>
        compareText(left.sortPath, right.sortPath) || compareText(left.rule, right.rule),
    );
    return proposals;
  }

  // ── State ────────────────────────────────────────────────────────

  /** key → ticked. Absent means "use the confidence default". */
  const choice = new Map();
  /** Proposals currently on screen. */
  let proposals = [];
  /** Editor text captured immediately before the last Apply. Undo restores it. */
  let undoText = null;
  /** Outcome of the last Apply, rendered above the list. */
  let lastOutcome = null;

  function isSelected(proposal) {
    return choice.has(proposal.key)
      ? choice.get(proposal.key)
      : DEFAULT_SELECTED[proposal.confidence] === true;
  }

  function selectedCount() {
    return proposals.filter(isSelected).length;
  }

  function requestEl() {
    return document.getElementById('bidReq');
  }

  // ── Advice ───────────────────────────────────────────────────────

  /**
   * Read the editor and ask the advisor. Every failure mode gets its own
   * state: an empty editor, invalid JSON and "this is not a BidRequest" are
   * three different things, and collapsing them into "nothing to migrate"
   * would read as a clean bill of health for a payload never examined.
   */
  function advise() {
    const engine = window.OrtbtoolsMigrate;
    if (!engine) return { state: 'error', message: tt('migrate.failed', { error: 'engine' }) };

    const el = requestEl();
    const text = el ? el.value || '' : '';
    if (!text.trim()) return { state: 'empty' };

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      return { state: 'invalid', message: e.message || String(e) };
    }
    if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.imp)) {
      return { state: 'not_request' };
    }

    try {
      return { state: 'ok', proposals: groupProposals(engine.adviseMigration25To26(payload)) };
    } catch (e) {
      return { state: 'error', message: e.message || String(e) };
    }
  }

  // ── Rendering ────────────────────────────────────────────────────

  function specLink(url) {
    // The rule table is frozen and its URLs are constants, but this is the one
    // attribute that leaves the page — verify rather than assume.
    if (typeof url !== 'string' || url.indexOf('https://') !== 0) return '';
    return (
      `<a class="mig-spec" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">` +
      `${escapeHtml(tt('migrate.spec'))} ↗</a>`
    );
  }

  function changeHtml(proposal) {
    // The "=" is not decoration: without it "→ /user/consent CONSENT-STRING"
    // reads as two paths rather than a path and the value that lands there.
    const value = `<span class="mig-value">= ${escapeHtml(preview(proposal.value))}</span>`;
    if (proposal.kind === 'move') {
      return (
        `<code class="mig-from">${escapeHtml(proposal.fromPath)}</code>` +
        `<span class="mig-arrow">→</span>` +
        `<code class="mig-to">${escapeHtml(proposal.toPath)}</code>` +
        value
      );
    }
    if (proposal.kind === 'add') {
      return `<code class="mig-to">${escapeHtml(proposal.toPath)}</code>${value}`;
    }
    return (
      `<code class="mig-from">${escapeHtml(proposal.fromPath)}</code>` +
      value +
      `<span class="mig-note">${escapeHtml(tt('migrate.kind.drop_note'))}</span>`
    );
  }

  function proposalHtml(proposal) {
    const ticked = isSelected(proposal);
    return (
      `<div class="mig-item mig-${escapeHtml(proposal.confidence)}">` +
      `<label class="mig-pick">` +
      `<input type="checkbox" data-key="${escapeHtml(proposal.key)}"${ticked ? ' checked' : ''}` +
      ` aria-label="${escapeHtml(tt('migrate.kind.' + proposal.kind))} ${escapeHtml(proposal.rule)}">` +
      `</label>` +
      `<div class="mig-body">` +
      `<div class="mig-head">` +
      `<span class="mig-conf mig-conf-${escapeHtml(proposal.confidence)}">${escapeHtml(
        tt('migrate.confidence.' + proposal.confidence),
      )}</span>` +
      `<span class="mig-kind">${escapeHtml(tt('migrate.kind.' + proposal.kind))}</span>` +
      `<code class="mig-rule">${escapeHtml(proposal.rule)}</code>` +
      specLink(proposal.spec) +
      `</div>` +
      `<div class="mig-change">${changeHtml(proposal)}</div>` +
      `<div class="mig-why">${escapeHtml(proposal.rationale)}</div>` +
      `</div></div>`
    );
  }

  function outcomeHtml() {
    if (!lastOutcome) return '';
    // Counted in PROPOSALS, the unit the user actually ticked. Reporting the
    // 12 underlying operations behind 6 ticked boxes would just raise a
    // question the number cannot answer.
    const parts = [
      tt('migrate.applied', { count: lastOutcome.applied }),
      lastOutcome.partial ? tt('migrate.partial', { count: lastOutcome.partial }) : '',
      lastOutcome.failed ? tt('migrate.unapplied', { count: lastOutcome.failed }) : '',
      lastOutcome.stale ? tt('migrate.stale', { count: lastOutcome.stale }) : '',
    ].filter(Boolean);
    return (
      `<div class="mig-outcome" role="status">` +
      `<span>${escapeHtml(parts.join(' · '))}</span>` +
      `<button type="button" class="btn btn-secondary btn-sm" id="migrateUndo">${escapeHtml(tt('migrate.undo'))}</button>` +
      `</div>`
    );
  }

  function barHtml() {
    const count = selectedCount();
    return (
      `<div class="mig-bar">` +
      `<button type="button" class="btn btn-primary btn-sm" id="migrateApply"${count ? '' : ' disabled'}>` +
      `${escapeHtml(tt('migrate.apply', { count: count }))}</button>` +
      `<button type="button" class="btn btn-secondary btn-sm" data-action="mig-all">${escapeHtml(tt('migrate.select_all'))}</button>` +
      `<button type="button" class="btn btn-ghost btn-sm" data-action="mig-none">${escapeHtml(tt('migrate.select_none'))}</button>` +
      `<button type="button" class="btn btn-ghost btn-sm" data-action="mig-refresh">${escapeHtml(tt('migrate.refresh'))}</button>` +
      `</div>` +
      `<div class="mig-hint">${escapeHtml(tt('migrate.apply_hint'))}</div>`
    );
  }

  function bodyHtml(advice) {
    if (advice.state === 'empty') {
      return `<div class="empty-hint">${escapeHtml(tt('migrate.empty'))}</div>`;
    }
    if (advice.state === 'invalid') {
      return `<div class="empty-hint">${escapeHtml(
        tt('migrate.invalid', { error: advice.message }),
      )}</div>`;
    }
    if (advice.state === 'not_request') {
      return `<div class="empty-hint">${escapeHtml(tt('migrate.not_request'))}</div>`;
    }
    if (advice.state === 'error') {
      return `<div class="empty-hint">${escapeHtml(
        tt('migrate.failed', { error: advice.message }),
      )}</div>`;
    }
    if (!proposals.length) {
      return (
        outcomeHtml() +
        `<div class="mig-clean">${escapeHtml(tt('migrate.none'))}</div>` +
        `<div class="mig-scope">${escapeHtml(tt('migrate.scope'))}</div>`
      );
    }
    return (
      outcomeHtml() +
      barHtml() +
      `<div class="mig-list" id="migrateList">${proposals.map(proposalHtml).join('')}</div>` +
      `<div class="mig-scope">${escapeHtml(tt('migrate.scope'))}</div>`
    );
  }

  function updateBadge(count) {
    const badge = document.getElementById('migrateBadge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = String(count);
      badge.hidden = false;
    } else {
      badge.textContent = '';
      badge.hidden = true;
    }
  }

  function render() {
    const container = document.getElementById('migrateContainer');
    if (!container) return;
    const advice = advise();
    proposals = advice.state === 'ok' ? advice.proposals : [];
    // Drop choices for proposals that no longer exist, so a stale tick can
    // never be revived by an unrelated payload that happens to reuse a key.
    const live = new Set(proposals.map((p) => p.key));
    for (const key of [...choice.keys()]) if (!live.has(key)) choice.delete(key);

    container.innerHTML = bodyHtml(advice);
    updateBadge(proposals.length);

    if (proposals.length && typeof window.ortbtoolsTrackOnce === 'function') {
      window.ortbtoolsTrackOnce('migrate_use');
    }
  }

  /** Cheap path: recompute only the count the badge and Apply button show. */
  function refreshCounts() {
    const advice = advise();
    updateBadge(advice.state === 'ok' ? advice.proposals.length : 0);
  }

  function updateApplyButton() {
    const button = document.getElementById('migrateApply');
    if (!button) return;
    const count = selectedCount();
    button.textContent = tt('migrate.apply', { count: count });
    button.disabled = count === 0;
  }

  // ── Apply / Undo ─────────────────────────────────────────────────

  /**
   * Recompute advice from the CURRENT editor text and apply only the selected
   * proposals that still appear in it. Re-deriving instead of trusting the
   * rendered list removes staleness as a class of bug: the editor may have
   * changed since the list was drawn.
   */
  function applySelected() {
    const el = requestEl();
    if (!el) return;
    const previous = el.value || '';

    let payload;
    try {
      payload = JSON.parse(previous);
    } catch (_e) {
      render();
      return;
    }

    const engine = window.OrtbtoolsMigrate;
    if (!engine) return;
    const fresh = groupProposals(engine.adviseMigration25To26(payload));
    const freshByKey = new Map(fresh.map((p) => [p.key, p]));

    const wanted = proposals.filter(isSelected);
    const stale = wanted.filter((p) => !freshByKey.has(p.key)).length;
    const live = wanted.filter((p) => freshByKey.has(p.key)).map((p) => freshByKey.get(p.key));

    // Applied one proposal at a time so the outcome can be reported in the
    // unit the user ticked, and so a proposal that only half-lands is visible
    // as such instead of averaging into an operation count.
    let applied = 0;
    let partial = 0;
    let failed = 0;
    let touched = 0;
    for (const proposal of live) {
      const result = applyOperations(payload, proposal.operations);
      touched += result.applied.length;
      if (!result.skipped.length) applied++;
      else if (result.applied.length) partial++;
      else failed++;
    }

    if (!touched) {
      // Nothing changed, so the editor is not rewritten and no undo point is
      // created — an Undo button that restores identical text is a lie.
      lastOutcome = { applied: 0, partial: 0, failed: failed, stale: stale };
      render();
      return;
    }

    undoText = previous;
    el.value = JSON.stringify(payload, null, 2);
    // Same handoff the sample loader uses: the app re-reads the editor on
    // `input`, so downstream state (char count, dirty flag) stays truthful.
    el.dispatchEvent(new Event('input', { bubbles: true }));

    lastOutcome = { applied: applied, partial: partial, failed: failed, stale: stale };
    choice.clear();
    render();

    if (typeof window.ortbtoolsTrack === 'function') window.ortbtoolsTrack('migrate_apply');
  }

  /** Restore the editor to the exact text captured before Apply. */
  function undo() {
    const el = requestEl();
    if (!el || undoText === null) return;
    el.value = undoText;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    undoText = null;
    lastOutcome = null;
    choice.clear();
    render();
  }

  // ── Wiring ───────────────────────────────────────────────────────

  function mount() {
    const container = document.getElementById('migrateContainer');
    if (!container) return;
    render();

    container.addEventListener('change', (e) => {
      const el = /** @type {any} */ (e.target);
      if (!el || el.type !== 'checkbox') return;
      const key = el.getAttribute('data-key');
      if (key == null) return;
      choice.set(key, !!el.checked);
      updateApplyButton();
    });

    container.addEventListener('click', (e) => {
      const target = /** @type {any} */ (e.target);
      const button = target && target.closest ? target.closest('button') : null;
      if (!button) return;
      const action = button.getAttribute('data-action');
      if (button.id === 'migrateApply') {
        e.preventDefault();
        return applySelected();
      }
      if (button.id === 'migrateUndo') {
        e.preventDefault();
        return undo();
      }
      if (action === 'mig-all' || action === 'mig-none') {
        e.preventDefault();
        const value = action === 'mig-all';
        proposals.forEach((p) => choice.set(p.key, value));
        container
          .querySelectorAll('.mig-list input[type="checkbox"]')
          .forEach((box) => /** @type {any} */ (box.checked = value));
        return updateApplyButton();
      }
      if (action === 'mig-refresh') {
        e.preventDefault();
        lastOutcome = null;
        return render();
      }
    });

    // Re-derive whenever the tab is opened: the advice is a function of the
    // editor, and a stale list here would describe a payload that is gone.
    const tabButton = document.querySelector('[data-target="tMigrate"]');
    if (tabButton) {
      tabButton.addEventListener('click', () => {
        lastOutcome = null;
        render();
      });
    }

    // The badge advertises the feature from the Inspector, so it has to follow
    // the editor. Only the count is recomputed here — never the rendered list,
    // which would fight the user mid-review.
    const el = requestEl();
    if (el) {
      let timer = null;
      el.addEventListener('input', () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refreshCounts, 400);
      });
    }
  }

  window.OrtbtoolsMigrateTab = {
    mount: mount,
    // Pure surface: no DOM needed, so the applier and the pairing rule can be
    // pinned by tests that run without a browser.
    __test: {
      parsePointer: parsePointer,
      parentPointer: parentPointer,
      applyOperations: applyOperations,
      groupProposals: groupProposals,
      preview: preview,
      DEFAULT_SELECTED: DEFAULT_SELECTED,
    },
  };

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('kt:inspector-ready', mount, { once: true });
  }
})();
