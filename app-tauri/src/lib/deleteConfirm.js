// Type-to-confirm destructive action modal.
//
// Used for Delete Topic today; designed to be reusable for any other
// irreversible action that warrants friction (Delete Product, Clear Data,
// Reset DB, etc.).
//
// Contract: user must type the EXACT match string (case-sensitive by
// default; set caseInsensitive=true for permissive match) before the
// destructive action button enables. Escape or backdrop click aborts.
//
// Usage:
//   import { confirmDestructiveAction } from '../lib/deleteConfirm.js';
//   const ok = await confirmDestructiveAction({
//     title: `Delete topic "${topic}"?`,
//     body: 'This removes the graph + tags. Underlying posts are kept.',
//     matchText: topic,          // user must type this exactly
//     confirmLabel: 'Delete topic',
//     confirmDanger: true,
//     hint: `type the topic name to confirm`,
//   });
//   if (!ok) return;
//   await api.deleteTopic(topic);

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Show a type-to-confirm modal. Resolves to `true` on confirm, `false` on abort.
 *
 * @param {Object}  opts
 * @param {string}  opts.title              Modal title (HTML-escaped)
 * @param {string} [opts.body]              Optional body copy
 * @param {string}  opts.matchText          String the user must type to confirm
 * @param {string} [opts.confirmLabel]      Button label (default "Delete")
 * @param {boolean}[opts.confirmDanger]     Use danger button style (default true)
 * @param {boolean}[opts.caseInsensitive]   Match case-insensitively (default false)
 * @param {string} [opts.hint]              Placeholder / helper text
 * @returns {Promise<boolean>}
 */
export function confirmDestructiveAction({
  title,
  body = '',
  matchText,
  confirmLabel = 'Delete',
  confirmDanger = true,
  caseInsensitive = false,
  hint = '',
}) {
  return new Promise((resolve) => {
    if (!matchText) { resolve(true); return; }  // nothing to type = no-op safe

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop delete-confirm-backdrop';
    backdrop.hidden = false;
    backdrop.innerHTML = `
      <div class="modal delete-confirm-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <h3 class="dc-title">
          <i data-lucide="alert-triangle"></i> ${escapeHtml(title)}
        </h3>
        ${body ? `<p class="modal-sub dc-body">${escapeHtml(body)}</p>` : ''}
        <p class="dc-instruction">
          Type exactly: <code class="dc-match-text">"${escapeHtml(matchText)}"</code>
        </p>
        <input type="text" class="dc-input" autocomplete="off" spellcheck="false"
               placeholder="${escapeHtml(hint || `Type "${matchText}"`)}" />
        <div class="dc-feedback"></div>
        <div class="modal-actions dc-actions">
          <button type="button" class="btn btn-ghost btn-bordered dc-cancel">Cancel</button>
          <button type="button" class="btn ${confirmDanger ? 'btn-danger' : 'btn-primary'} dc-confirm" disabled>
            ${escapeHtml(confirmLabel)}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    window.refreshIcons?.();

    const input = backdrop.querySelector('.dc-input');
    const confirmBtn = backdrop.querySelector('.dc-confirm');
    const cancelBtn = backdrop.querySelector('.dc-cancel');
    const feedback = backdrop.querySelector('.dc-feedback');
    const returnFocusTo = document.activeElement;

    const matches = (v) => caseInsensitive
      ? v.trim().toLowerCase() === matchText.toLowerCase()
      : v.trim() === matchText;

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (returnFocusTo?.focus) { try { returnFocusTo.focus(); } catch {} }
      resolve(result);
    };

    input.addEventListener('input', () => {
      const ok = matches(input.value);
      confirmBtn.disabled = !ok;
      if (!input.value) {
        feedback.textContent = '';
      } else if (ok) {
        feedback.textContent = '✓ matches — action unlocked';
        feedback.style.color = '#2E7D5B';
      } else {
        feedback.textContent = 'Does not match yet';
        feedback.style.color = 'var(--ink-3)';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && matches(input.value)) {
        e.preventDefault();
        close(true);
      }
    });

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    };
    document.addEventListener('keydown', onKey);

    setTimeout(() => input.focus(), 30);
  });
}
