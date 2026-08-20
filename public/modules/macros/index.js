/* ============================================================
   modules/macros/index.js — ortbtools Macro Evaluator (Inert).

   Pure client-side, zero-network utility for extracting macro-bearing
   notice URLs and tracking endpoints across all seatbid[].bid[] items
   and evaluating OpenRTB 2.6 (2.6-202606) §4.4 substitution macros.

   Zero-Network Policy:
   Never performs network requests.
   All operations are pure in-memory string transformations.
   ============================================================ */
(function () {
  'use strict';

  // OpenRTB 2.6-202606 §4.4 Substitution Macros (14 standard macros)
  const IAB_STANDARD_MACROS = new Set([
    'AUCTION_ID',
    'AUCTION_BID_ID',
    'AUCTION_IMP_ID',
    'AUCTION_SEAT_ID',
    'AUCTION_AD_ID',
    'AUCTION_PRICE',
    'AUCTION_CURRENCY',
    'AUCTION_MBR',
    'AUCTION_LOSS',
    'AUCTION_MIN_TO_WIN',
    'AUCTION_MULTIPLIER',
    'AUCTION_IMP_TS',
    'AUCTION_DISCOUNT_PCT',
    'AUCTION_DISCOUNT_CPM',
  ]);

  // Shared mount-scoped overrides state (single source of truth)
  let _macroOverrides = {
    price: '',
    auctionId: '',
    lossCode: '',
    minToWin: '',
    mbr: '',
    multiplier: '',
    impTs: '',
    discountPct: '',
    discountCpm: '',
  };

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function tt(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : key;
  }

  /**
   * Boundary-safe CDATA / XML delimiter cleaner.
   * Only strips exact `<![CDATA[` and `]]>` delimiters; preserves
   * legitimate URL characters including trailing `]` (e.g. `filter[0]=123]`).
   *
   * When the input is a full CDATA-wrapped value like
   *   `<![CDATA[https://x.example/p?filter[0]=123]]]>`
   * the final `]]>` is the CDATA close. The `]` immediately before it
   * belongs to the URL. We strip the leading `<![CDATA[` and trailing
   * `]]>` only, preserving every character between them.
   */
  function cleanRawUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let cleaned = url.trim();
    // Strip leading <![CDATA[ if present
    if (cleaned.startsWith('<![CDATA[')) {
      cleaned = cleaned.slice(9);
    }
    // Strip trailing ]]> if present (exact 3-char CDATA close)
    if (cleaned.endsWith(']]>')) {
      cleaned = cleaned.slice(0, -3);
    }
    return cleaned.trim();
  }

  /**
   * Extracts notice URLs and macro-bearing embedded trackers from an OpenRTB BidResponse.
   */
  function extractBidTrackers(res, req) {
    if (!res || typeof res !== 'object') return [];
    const items = [];

    // IAB Standard source mappings:
    // AUCTION_ID -> BidRequest.id ONLY (never BidResponse.id).
    // If Inspector received only a response (no request), AUCTION_ID
    // must remain empty so the evaluator leaves ${AUCTION_ID} literal.
    const auctionId = (req && req.id) || '';
    // AUCTION_BID_ID -> BidResponse.bidid (NOT bid.id)
    const responseBidId = (res && res.bidid) || '';
    // AUCTION_CURRENCY -> BidResponse.cur (OpenRTB standard default: "USD" if absent)
    const currency = res && typeof res.cur === 'string' && res.cur.trim() ? res.cur.trim() : 'USD';

    const seatbids = Array.isArray(res.seatbid) ? res.seatbid : [];
    seatbids.forEach((sb, sbi) => {
      if (!sb || typeof sb !== 'object') return;
      const seat = sb.seat || '';
      const bids = Array.isArray(sb.bid) ? sb.bid : [];

      bids.forEach((b, bi) => {
        if (!b || typeof b !== 'object') return;
        const bidId = b.id || `seatbid[${sbi}].bid[${bi}]`;
        const impId = b.impid || '';
        const adId = b.adid || '';
        const bidPrice = typeof b.price === 'number' ? String(b.price) : b.price || '';

        const baseContext = {
          auctionId,
          responseBidId,
          bidId,
          impid: impId,
          seat,
          adid: adId,
          currency,
          bidPrice, // Informational bid price (NOT default clearing price)
          price: '', // Simulated clearing price (explicit override required)
          lossCode: '',
          mbr: '',
          minToWin: '',
          multiplier: '',
          impTs: '',
          discountPct: '',
          discountCpm: '',
        };

        // 1. nurl (Win Notice)
        if (typeof b.nurl === 'string' && b.nurl.trim()) {
          items.push({
            bidId,
            impid: impId,
            bidPrice,
            type: 'nurl',
            typeKey: 'macros.type_nurl',
            rawUrl: cleanRawUrl(b.nurl),
            context: { ...baseContext },
          });
        }

        // 2. burl (Billing Notice)
        if (typeof b.burl === 'string' && b.burl.trim()) {
          items.push({
            bidId,
            impid: impId,
            bidPrice,
            type: 'burl',
            typeKey: 'macros.type_burl',
            rawUrl: cleanRawUrl(b.burl),
            context: { ...baseContext },
          });
        }

        // 3. lurl (Loss Notice)
        if (typeof b.lurl === 'string' && b.lurl.trim()) {
          items.push({
            bidId,
            impid: impId,
            bidPrice,
            type: 'lurl',
            typeKey: 'macros.type_lurl',
            rawUrl: cleanRawUrl(b.lurl),
            context: { ...baseContext },
          });
        }

        // 4. adm embedded macro-bearing URLs
        if (typeof b.adm === 'string' && b.adm.trim()) {
          // Create normalizedAdm by strictly removing exact CDATA delimiters
          // leaving inner content and any trailing single brackets intact.
          const normalizedAdm = b.adm.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');

          const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
          let match;
          const seen = new Set();

          while ((match = urlPattern.exec(normalizedAdm)) !== null) {
            const candidateUrl = cleanRawUrl(match[0]);
            if (/\$\{[A-Z0-9_]+(?::[A-Z0-9_]+)?\}/i.test(candidateUrl) && !seen.has(candidateUrl)) {
              seen.add(candidateUrl);
              items.push({
                bidId,
                impid: impId,
                bidPrice,
                type: 'adm',
                typeKey: 'macros.type_adm',
                rawUrl: candidateUrl,
                context: { ...baseContext },
              });
            }
          }
        }
      });
    });

    return items;
  }

  /**
   * Evaluates OpenRTB macros in a raw URL template according to OpenRTB 2.6 §4.4.
   *
   * Rules:
   * - ${AUCTION_PRICE} requires an explicit simulated clearing price.
   *   Without it, it remains literal and is marked as unresolved (reason: simulation_value_required).
   * - ${MACRO:X} syntax: OpenRTB defines syntax but not algorithms.
   *   Unless an explicit encoder is provided via context.encoders[X], it remains literal and unresolved.
   */
  function evaluateMacros(rawUrl, context) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return { evaluatedUrl: '', detectedMacros: [] };
    }

    const ctx = context || {};
    const detectedMacros = [];
    const macroRegex = /\$\{([A-Z0-9_]+)(?::([A-Z0-9_]+))?\}/g;

    const evaluatedUrl = rawUrl.replace(macroRegex, (match, macroName, formatSuffix) => {
      const isStandard = IAB_STANDARD_MACROS.has(macroName);
      let isHandled = false;
      let rawVal = '';

      if (isStandard) {
        switch (macroName) {
          case 'AUCTION_ID':
            // AUCTION_ID requires BidRequest.id. If unknown (e.g. response-only
            // analysis), leave the macro literal so it's visibly unresolved.
            if (ctx.auctionId != null && ctx.auctionId !== '') {
              rawVal = String(ctx.auctionId);
              isHandled = true;
            } else {
              detectedMacros.push({
                name: macroName,
                format: formatSuffix || null,
                isStandard: true,
                value: match,
                isUnresolved: true,
                reason: 'unknown_auction_id',
              });
              return match;
            }
            break;
          case 'AUCTION_BID_ID':
            rawVal =
              ctx.responseBidId != null && ctx.responseBidId !== ''
                ? String(ctx.responseBidId)
                : '';
            isHandled = true;
            break;
          case 'AUCTION_IMP_ID':
            rawVal = ctx.impid != null ? String(ctx.impid) : '';
            isHandled = true;
            break;
          case 'AUCTION_SEAT_ID':
            rawVal = ctx.seat != null ? String(ctx.seat) : '';
            isHandled = true;
            break;
          case 'AUCTION_AD_ID':
            rawVal = ctx.adid != null ? String(ctx.adid) : '';
            isHandled = true;
            break;
          case 'AUCTION_PRICE':
            // AUCTION_PRICE is strictly the clearing price.
            // Requires an explicit simulated clearing price.
            if (ctx.price != null && ctx.price !== '') {
              rawVal = String(ctx.price);
              isHandled = true;
            } else {
              detectedMacros.push({
                name: macroName,
                format: formatSuffix || null,
                isStandard: true,
                value: match,
                isUnresolved: true,
                reason: 'simulation_value_required',
              });
              return match;
            }
            break;
          case 'AUCTION_CURRENCY':
            rawVal = ctx.currency != null && ctx.currency !== '' ? String(ctx.currency) : 'USD';
            isHandled = true;
            break;
          case 'AUCTION_MBR':
            rawVal = ctx.mbr != null ? String(ctx.mbr) : '';
            isHandled = true;
            break;
          case 'AUCTION_LOSS':
            rawVal = ctx.lossCode != null ? String(ctx.lossCode) : '';
            isHandled = true;
            break;
          case 'AUCTION_MIN_TO_WIN':
            rawVal = ctx.minToWin != null ? String(ctx.minToWin) : '';
            isHandled = true;
            break;
          case 'AUCTION_MULTIPLIER':
            rawVal = ctx.multiplier != null ? String(ctx.multiplier) : '';
            isHandled = true;
            break;
          case 'AUCTION_IMP_TS':
            rawVal = ctx.impTs != null ? String(ctx.impTs) : '';
            isHandled = true;
            break;
          case 'AUCTION_DISCOUNT_PCT':
            rawVal = ctx.discountPct != null ? String(ctx.discountPct) : '';
            isHandled = true;
            break;
          case 'AUCTION_DISCOUNT_CPM':
            rawVal = ctx.discountCpm != null ? String(ctx.discountCpm) : '';
            isHandled = true;
            break;
          default:
            isHandled = false;
            break;
        }
      } else if (ctx.custom && ctx.custom[macroName] != null) {
        isHandled = true;
        rawVal = String(ctx.custom[macroName]);
      }

      if (!isHandled) {
        detectedMacros.push({
          name: macroName,
          format: formatSuffix || null,
          isStandard,
          value: match,
          isUnresolved: true,
          reason: 'unhandled_macro',
        });
        return match;
      }

      // If formatSuffix (:X) is present, check explicit custom encoders
      if (formatSuffix) {
        if (ctx.encoders && typeof ctx.encoders[formatSuffix] === 'function') {
          try {
            const encoded = ctx.encoders[formatSuffix](rawVal);
            detectedMacros.push({
              name: macroName,
              format: formatSuffix,
              isStandard,
              value: encoded,
              isUnresolved: false,
            });
            return encoded;
          } catch (_err) {
            detectedMacros.push({
              name: macroName,
              format: formatSuffix,
              isStandard,
              value: match,
              isUnresolved: true,
              reason: 'encoder_error',
            });
            return match;
          }
        }
        // Without an explicit partner encoder, leave literal and unresolved
        detectedMacros.push({
          name: macroName,
          format: formatSuffix,
          isStandard,
          value: match,
          isUnresolved: true,
          reason: 'unsupported_encoder',
        });
        return match;
      }

      detectedMacros.push({
        name: macroName,
        format: null,
        isStandard,
        value: rawVal,
        isUnresolved: false,
      });

      return rawVal;
    });

    return { evaluatedUrl, detectedMacros };
  }

  function mergeMacroContext(context, overrides) {
    const base = context || {};
    const active = overrides || {};
    return {
      ...base,
      price: active.price != null ? active.price : '',
      auctionId:
        active.auctionId != null && active.auctionId !== '' ? active.auctionId : base.auctionId,
      lossCode: active.lossCode != null && active.lossCode !== '' ? active.lossCode : base.lossCode,
      minToWin: active.minToWin != null && active.minToWin !== '' ? active.minToWin : base.minToWin,
      mbr: active.mbr != null && active.mbr !== '' ? active.mbr : base.mbr,
      multiplier:
        active.multiplier != null && active.multiplier !== '' ? active.multiplier : base.multiplier,
      impTs: active.impTs != null && active.impTs !== '' ? active.impTs : base.impTs,
      discountPct:
        active.discountPct != null && active.discountPct !== ''
          ? active.discountPct
          : base.discountPct,
      discountCpm:
        active.discountCpm != null && active.discountCpm !== ''
          ? active.discountCpm
          : base.discountCpm,
    };
  }

  function buildTableRowsHtml(items, overrides) {
    return items
      .map((item) => {
        const mergedContext = mergeMacroContext(item.context, overrides);

        const { evaluatedUrl, detectedMacros } = evaluateMacros(item.rawUrl, mergedContext);

        const badgesHtml = detectedMacros
          .map((m) => {
            let badgeClass = m.isStandard ? 'badge-iab' : 'badge-vendor';
            if (m.isUnresolved) badgeClass += ' badge-unresolved';
            const fmtLabel = m.format ? `:${m.format}` : '';
            const titleMsg = m.isUnresolved
              ? m.reason === 'simulation_value_required'
                ? tt('macros.unresolved_price_hint')
                : tt('macros.unresolved_encoder_hint')
              : m.value;
            return `<span class="macro-badge ${badgeClass}" title="${escapeHtml(titleMsg)}">\${${escapeHtml(m.name)}${escapeHtml(fmtLabel)}}</span>`;
          })
          .join(' ');

        const typeLabel = tt(item.typeKey || 'macros.type_adm');

        return `
          <tr>
            <td style="font-family:var(--font-mono);color:var(--text-muted);">
              <div>${escapeHtml(item.bidId)}</div>
              ${item.impid ? `<div style="font-size:10px;color:var(--text-dim)">imp: ${escapeHtml(item.impid)}</div>` : ''}
              ${item.bidPrice ? `<div style="font-size:10px;color:var(--code-num)">Bid CPM: $${escapeHtml(item.bidPrice)}</div>` : ''}
            </td>
            <td>
              <span class="type-pill type-pill-${escapeHtml(item.type)}">${escapeHtml(typeLabel)}</span>
            </td>
            <td style="font-family:var(--font-mono);word-break:break-all;color:var(--text-dim);font-size:11px;">
              ${escapeHtml(item.rawUrl)}
            </td>
            <td style="font-family:var(--font-mono);word-break:break-all;">
              <div style="color:var(--text);font-size:12px;">${escapeHtml(evaluatedUrl)}</div>
              ${badgesHtml ? `<div style="margin-top:var(--space-1);display:flex;flex-wrap:wrap;gap:4px;">${badgesHtml}</div>` : ''}
            </td>
            <td style="text-align:right;">
              <button class="btn btn-ghost btn-sm btn-copy-macro-url" data-url="${escapeHtml(evaluatedUrl)}" title="${escapeHtml(tt('macros.copy'))}">
                📋 ${escapeHtml(tt('macros.copy'))}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  /**
   * Synchronizes price inputs across the app without infinite recursive events.
   */
  function syncPriceInputs(val) {
    _macroOverrides.price = val != null ? String(val) : '';
    const sp = document.getElementById('simPrice');
    if (sp && sp.value !== _macroOverrides.price) {
      sp.value = _macroOverrides.price;
    }
    const msp = document.getElementById('macroSimPrice');
    if (msp && msp.value !== _macroOverrides.price) {
      msp.value = _macroOverrides.price;
    }
  }

  /**
   * Renders or incrementally updates the interactive macro evaluation table into a container.
   */
  function renderMacroTable(containerEl, items, activeOverrides, onOverridesChange) {
    if (!containerEl) return;
    if (!items || !items.length) {
      containerEl.innerHTML = `
        <div class="empty-hint" style="padding:var(--space-6);text-align:center;color:var(--text-muted)">
          ${escapeHtml(tt('macros.empty'))}
        </div>
      `;
      return;
    }

    if (activeOverrides && typeof activeOverrides === 'object') {
      _macroOverrides = {
        ..._macroOverrides,
        ...activeOverrides,
      };
      if (activeOverrides.price !== undefined) {
        syncPriceInputs(activeOverrides.price);
      }
    }

    // Check if the wrapper structure is already mounted
    const existingWrapper = containerEl.querySelector('.macro-evaluator-wrapper');
    const existingTbody = containerEl.querySelector('#macroTableBody');

    if (existingWrapper && existingTbody) {
      // Incremental update: update only tbody so input focus and caret are preserved
      existingTbody.innerHTML = buildTableRowsHtml(items, _macroOverrides);
      attachCopyListeners(containerEl);
      return;
    }

    // Full mount on first render
    const html = `
      <div class="macro-evaluator-wrapper">
        <div class="macro-sim-toolbar">
          <div class="macro-sim-field">
            <label for="macroSimPrice">${escapeHtml(tt('macros.price_label'))}</label>
            <input id="macroSimPrice" type="text" placeholder="e.g. 2.50" value="${escapeHtml(_macroOverrides.price || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimAuctionId">${escapeHtml(tt('macros.auction_id_label'))}</label>
            <input id="macroSimAuctionId" type="text" placeholder="e.g. auc-123" value="${escapeHtml(_macroOverrides.auctionId || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimLossCode">${escapeHtml(tt('macros.loss_code_label'))}</label>
            <input id="macroSimLossCode" type="text" placeholder="e.g. 1" value="${escapeHtml(_macroOverrides.lossCode || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimMinToWin">${escapeHtml(tt('macros.min_to_win_label'))}</label>
            <input id="macroSimMinToWin" type="text" placeholder="e.g. 2.10" value="${escapeHtml(_macroOverrides.minToWin || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimMbr">${escapeHtml(tt('macros.mbr_label'))}</label>
            <input id="macroSimMbr" type="text" placeholder="e.g. 0.85" value="${escapeHtml(_macroOverrides.mbr || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimMultiplier">${escapeHtml(tt('macros.multiplier_label'))}</label>
            <input id="macroSimMultiplier" type="text" placeholder="e.g. 1.0" value="${escapeHtml(_macroOverrides.multiplier || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimImpTs">${escapeHtml(tt('macros.imp_ts_label'))}</label>
            <input id="macroSimImpTs" type="text" placeholder="e.g. 1712832000" value="${escapeHtml(_macroOverrides.impTs || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimDiscountPct">${escapeHtml(tt('macros.discount_pct_label'))}</label>
            <input id="macroSimDiscountPct" type="text" placeholder="e.g. 10" value="${escapeHtml(_macroOverrides.discountPct || '')}" />
          </div>
          <div class="macro-sim-field">
            <label for="macroSimDiscountCpm">${escapeHtml(tt('macros.discount_cpm_label'))}</label>
            <input id="macroSimDiscountCpm" type="text" placeholder="e.g. 0.25" value="${escapeHtml(_macroOverrides.discountCpm || '')}" />
          </div>
        </div>

        <div class="macro-table-container">
          <table class="macro-table">
            <thead>
              <tr>
                <th style="width:130px;">${escapeHtml(tt('macros.col_bid'))}</th>
                <th style="width:140px;">${escapeHtml(tt('macros.col_type'))}</th>
                <th style="width:35%;">${escapeHtml(tt('macros.col_original'))}</th>
                <th>${escapeHtml(tt('macros.col_evaluated'))}</th>
                <th style="width:70px;text-align:right;"></th>
              </tr>
            </thead>
            <tbody id="macroTableBody">
              ${buildTableRowsHtml(items, _macroOverrides)}
            </tbody>
          </table>
        </div>
      </div>
    `;

    containerEl.innerHTML = html;

    // Attach single listeners to toolbar inputs
    const fieldMap = {
      macroSimPrice: 'price',
      macroSimAuctionId: 'auctionId',
      macroSimLossCode: 'lossCode',
      macroSimMinToWin: 'minToWin',
      macroSimMbr: 'mbr',
      macroSimMultiplier: 'multiplier',
      macroSimImpTs: 'impTs',
      macroSimDiscountPct: 'discountPct',
      macroSimDiscountCpm: 'discountCpm',
    };

    Object.keys(fieldMap).forEach((id) => {
      const inp = containerEl.querySelector('#' + id);
      if (!inp) return;
      const key = fieldMap[id];

      inp.addEventListener('input', () => {
        const val = inp.value || '';
        // Same once-per-session counter as the copy button — simulating a
        // macro substitution is just as much "using the evaluator". The typed
        // value itself is never sent.
        if (typeof window.ortbtoolsTrackOnce === 'function') {
          window.ortbtoolsTrackOnce('macro_use');
        }
        _macroOverrides[key] = val;

        if (key === 'price') {
          syncPriceInputs(val);
        }

        const tbody = containerEl.querySelector('#macroTableBody');
        if (tbody) {
          tbody.innerHTML = buildTableRowsHtml(items, _macroOverrides);
          attachCopyListeners(containerEl);
        }

        if (typeof onOverridesChange === 'function') {
          onOverridesChange({ ..._macroOverrides });
        }
      });
    });

    attachCopyListeners(containerEl);
  }

  function attachCopyListeners(containerEl) {
    containerEl.querySelectorAll('.btn-copy-macro-url').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = btn.getAttribute('data-url');
        if (!url) return;
        // Product telemetry: "this person used the Macro Evaluator", once per
        // tab session. The URL being copied is never sent.
        if (typeof window.ortbtoolsTrackOnce === 'function') {
          window.ortbtoolsTrackOnce('macro_use');
        }
        try {
          await navigator.clipboard.writeText(url);
          if (typeof window.toast === 'function') {
            window.toast(tt('macros.copied'), 'success');
          }
        } catch (_err) {
          window.prompt(tt('macros.copy'), url);
        }
      });
    });
  }

  function resetState() {
    _macroOverrides = {
      price: '',
      auctionId: '',
      lossCode: '',
      minToWin: '',
      mbr: '',
      multiplier: '',
      impTs: '',
      discountPct: '',
      discountCpm: '',
    };
  }

  /**
   * Resolve all macros within a raw adm string using the shared evaluator.
   * Used by both the Macro table and the Creative Preview (setAdPreview)
   * to guarantee a single source of truth for substitution logic.
   *
   * @param {string} adm - Raw creative markup (HTML/VAST/JSON string)
   * @param {object} macroContext - Context from extractBidTrackers or equivalent
   * @returns {string} adm with macros resolved (unresolved macros left literal)
   */
  function resolveAdmMacros(adm, macroContext) {
    if (!adm || typeof adm !== 'string') return adm || '';
    const ctx = macroContext || {};
    const macroRegex = /\$\{([A-Z0-9_]+)(?::([A-Z0-9_]+))?\}/g;
    return adm.replace(macroRegex, (match) => {
      const result = evaluateMacros(match, { ...ctx });
      return result.evaluatedUrl;
    });
  }

  window.OrtbtoolsMacros = {
    extractBidTrackers,
    evaluateMacros,
    renderMacroTable,
    mergeMacroContext,
    resolveAdmMacros,
    syncPriceInputs,
    resetState,
    getOverrides: () => ({ ..._macroOverrides }),
    IAB_STANDARD_MACROS,
  };
})();
