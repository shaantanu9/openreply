// Lightweight in-app yes/no confirmation modal.
//
// Why this exists: Tauri routes the global `window.confirm()` to the dialog
// plugin's `confirm` command, which needs the `dialog:allow-confirm` ACL active
// in the *built* binary. In practice that ACL is flaky across builds (stale
// build.rs cache, capability drift), so `await confirm(...)` throws
// "dialog.confirm not allowed" and surfaces as an unhandled promise rejection —
// e.g. the licence Sign-out button did nothing and logged an ACL error. This
// modal is pure DOM + a Promise<boolean>, so it has ZERO Tauri-permission
// dependency and behaves identically in dev and packaged DMG builds.
//
// Usage (drop-in for `await confirm('…')`):
//   import { confirmModal } from '../lib/confirmModal.js';
//   if (!(await confirmModal('Delete this persona?'))) return;
//
// Or with options:
//   const ok = await confirmModal({
//     title: 'Sign out of licence?',
//     body: 'The app will lock until you re-activate. Local data is kept.',
//     confirmLabel: 'Sign out', danger: true,
//   });

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Show a yes/no confirmation. Resolves `true` on confirm, `false` on cancel /
 * Escape / backdrop click.
 *
 * @param {string|Object} opts  A message string, or an options object:
 * @param {string} [opts.title]         Title line (default "Please confirm")
 * @param {string} [opts.body]          Body copy (the message when a string is passed)
 * @param {string} [opts.confirmLabel]  Confirm button label (default "Confirm")
 * @param {string} [opts.cancelLabel]   Cancel button label (default "Cancel")
 * @param {boolean}[opts.danger]        Use the danger button style (default false)
 * @returns {Promise<boolean>}
 */
export function confirmModal(opts = {}) {
  const o = typeof opts === 'string' ? { body: opts } : (opts || {});
  const {
    title = 'Please confirm',
    body = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = o;

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop confirm-modal-backdrop';
    backdrop.hidden = false;
    backdrop.innerHTML = `
      <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <h3 style="margin:0 0 6px;font-size:var(--fs-17)">${escapeHtml(title)}</h3>
        ${body ? `<p class="modal-sub" style="margin:0 0 14px;color:var(--ink-2);font-size:var(--fs-13);line-height:1.6">${escapeHtml(body)}</p>` : ''}
        <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-bordered cm-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} cm-confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    window.refreshIcons?.();

    const confirmBtn = backdrop.querySelector('.cm-confirm');
    const cancelBtn = backdrop.querySelector('.cm-cancel');
    const returnFocusTo = document.activeElement;

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (returnFocusTo?.focus) { try { returnFocusTo.focus(); } catch {} }
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
    document.addEventListener('keydown', onKey);

    setTimeout(() => { try { confirmBtn.focus(); } catch {} }, 30);
  });
}
