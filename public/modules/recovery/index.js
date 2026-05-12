/* ============================================================
   modules/recovery/index.js — Recovery-key modal (lazy-loaded
   ES module).

   Shows the freshly-generated recovery key to the user EXACTLY
   ONCE after register (or after an F5-survival re-show). The
   server only stores the *wrap*, never the key bytes themselves
   — losing this modal without saving the key means losing the
   only path back into the library if the password is forgotten.
   That single-show invariant is why close goes through a
   "did you really save it?" confirm gate (Esc + backdrop +
   explicit button all share the same gate).

   Loaded ONLY when:
     - the dispatcher invokes window.showRecoveryKeyModal(key)
       after register (bootstrapNewCrypto chains via the lazy
       stub `case 'show-recovery'`-equivalent inline in
       spyglass.app.js — see _showRecoveryLazy below).
     - the F5-survival path on boot finds a key in
       sessionStorage and re-shows the modal so an accidental
       refresh doesn't lose the key.

   On first call: ~6KB across this file + i18n.js. On
   subsequent calls: cached by the module loader, zero refetch.

   Exposed window APIs:
     - window.showRecoveryKeyModal(key) — open the modal
     - window.closeRecoveryKeyModal()   — confirm-gated close
     - window.copyRecoveryKey()         — clipboard + flash
     - window.isRecoveryKeyModalActive() — for shell's closeModal
       routing decision (Esc / backdrop on OTHER modals)

   Boot-time F5-survival check: the shell reads
   `sessionStorage.getItem('spyglass_recovery_pending_v1')`
   directly (one cheap line, no module load) and only lazy-loads
   this module if a key is pending. The constant + key name are
   intentionally duplicated in the shell so the boot path stays
   eager-side and we don't pay the import cost for the 99.99%
   case where nothing is pending.

   Sensitive-data discipline: the recovery key is held in
   module-scope `_currentRecoveryKey` for the lifetime of the
   modal only. It is mirrored to sessionStorage (per-tab,
   auto-cleared on tab close — same surface as the in-memory
   DEK already kept in sessionStorage) so an accidental F5
   doesn't lose it before the user has saved it. Both copies
   are wiped on confirm-gated close. The key never enters
   localStorage, the DOM dataset, or any URL.
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

// Module-private state. The shell's closeModal() asks
// window.isRecoveryKeyModalActive() (defined below) to decide
// whether to route Esc/backdrop through this module's confirm
// gate. When the module hasn't been imported, the function is
// undefined → falsy → normal close path runs.
let _modalActive = false;
let _currentRecoveryKey = null;

const RECOVERY_PENDING_KEY = 'spyglass_recovery_pending_v1';

function persistPendingRecovery(key) {
  try {
    sessionStorage.setItem(RECOVERY_PENDING_KEY, String(key || ''));
  } catch (_e) {
    /* storage disabled — modal still works in-memory for this session */
  }
}

function clearPendingRecovery() {
  try {
    sessionStorage.removeItem(RECOVERY_PENDING_KEY);
  } catch (_e) {
    /* sessionStorage unavailable — non-fatal */
  }
}

export function showRecoveryKeyModal(recoveryKey) {
  // Defensive null-guard on match() — if recoveryKey is somehow empty
  // (shouldn't happen, but guards against null.join() crash).
  const grouped = (String(recoveryKey || '').match(/.{1,4}/g) || []).join('-');
  _modalActive = true;
  _currentRecoveryKey = recoveryKey;
  // Mirror to sessionStorage so an accidental F5 doesn't lose the key
  // forever. Cleared on explicit "I saved it" acknowledgment.
  persistPendingRecovery(recoveryKey);
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close-recovery">' +
    '<div class="modal-card" style="max-width:520px">' +
    '<div class="modal-title">' +
    t('modal.recovery.title') +
    '</div>' +
    '<div style="font-size:var(--fs-sm);line-height:1.5;margin-bottom:var(--space-3);color:var(--text)">' +
    t('recovery.body') +
    '</div>' +
    '<div style="background:var(--bg-2);padding:var(--space-3);border-radius:var(--r-sm);font-family:var(--font-mono);font-size:14px;letter-spacing:0.05em;text-align:center;margin-bottom:var(--space-3);user-select:all;word-break:break-all">' +
    escapeHtml(grouped) +
    '</div>' +
    '<div class="modal-actions" style="justify-content:space-between">' +
    '<button id="rkCopyBtn" class="btn btn-ghost btn-sm" data-action="copy-recovery">' +
    t('btn.copy') +
    '</button>' +
    '<button class="btn btn-primary btn-sm" data-action="close-recovery">' +
    t('btn.recovery_saved') +
    '</button>' +
    '</div>' +
    '</div></div>';
}

export function closeRecoveryKeyModal() {
  if (!confirm(t('confirm.recovery_save'))) return;
  _modalActive = false;
  _currentRecoveryKey = null;
  clearPendingRecovery();
  // Shell owns the modalRoot DOM + history-merge chaining. Tell it we
  // closed cleanly so it can clear #modalRoot and chain the next modal.
  if (typeof window.__spyglassRecoveryClosed === 'function') {
    window.__spyglassRecoveryClosed();
  } else if (typeof window.closeModal === 'function') {
    // Fallback if shell hook isn't installed (shouldn't happen post-boot).
    window.closeModal();
  }
}

export function copyRecoveryKey() {
  // Key lives only in this module's closure — never in DOM, never on
  // window — so the dispatcher can't accidentally serialize it
  // somewhere. We pull it here on demand.
  if (!_currentRecoveryKey) return;
  const btn = $('rkCopyBtn');
  const flashSuccess = () => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = t('btn.copied');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, 1800);
  };
  navigator.clipboard
    .writeText(_currentRecoveryKey)
    .then(() => {
      flashSuccess();
      toast(t('toast.recovery_key_copied'), 'success');
    })
    .catch(() => toast(t('toast.copy_failed_select'), 'error'));
}

export function isRecoveryKeyModalActive() {
  return _modalActive;
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher's
// `case 'show-recovery'` lazy stub does:
//   await import('/modules/recovery/i18n.js');
//   await import('/modules/recovery/index.js');
//   window.showRecoveryKeyModal(key);
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader; assignments idempotent.
window.showRecoveryKeyModal = showRecoveryKeyModal;
window.closeRecoveryKeyModal = closeRecoveryKeyModal;
window.copyRecoveryKey = copyRecoveryKey;
window.isRecoveryKeyModalActive = isRecoveryKeyModalActive;
