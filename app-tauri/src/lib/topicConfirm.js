// Topic correction toast + confirmation modal helpers.
//
// Exposed:
//   showCorrectionToast({ original, canonical, onUndo }) — auto-dismiss after 10s
//   showTopicConfirmModal({ original, canonical, variants, onPick, onKeepAsIs })

export function showCorrectionToast({ original, canonical, onUndo }) {
  const existing = document.querySelector('.correction-toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'correction-toast';
  el.innerHTML = `
    <span>Corrected <b>${escapeHtml(original)}</b> → <b>${escapeHtml(canonical)}</b></span>
    <span class="c-link" data-action="undo">Undo</span>
    <span class="c-dismiss" data-action="dismiss" title="Dismiss">✕</span>`;
  document.body.appendChild(el);

  const dismiss = () => { el.remove(); };
  const undo = () => {
    dismiss();
    if (typeof onUndo === 'function') onUndo();
  };
  el.querySelector('[data-action=undo]').onclick = undo;
  el.querySelector('[data-action=dismiss]').onclick = dismiss;
  setTimeout(dismiss, 10_000);
}

export function showTopicConfirmModal({
  original, canonical, variants = [], onPick, onKeepAsIs,
}) {
  const existing = document.querySelector('.topic-confirm-backdrop');
  if (existing) existing.remove();

  const options = [canonical, ...variants].filter(
    (v, i, arr) => v && arr.indexOf(v) === i
  );

  const backdrop = document.createElement('div');
  backdrop.className = 'topic-confirm-backdrop';
  backdrop.innerHTML = `
    <div class="topic-confirm-modal" role="dialog" aria-modal="true">
      <h3>Did you mean…?</h3>
      <p>The topic <b>${escapeHtml(original)}</b> didn't have a clear match. Pick one, or keep as-is.</p>
      <div class="variants">
        ${options.map((v, i) => `<button data-pick="${i}">${escapeHtml(v)}</button>`).join('')}
      </div>
      <button class="keep-asis" data-keep="1">Keep "${escapeHtml(original)}" as-is</button>
    </div>`;
  document.body.appendChild(backdrop);

  backdrop.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute('data-pick'));
      backdrop.remove();
      if (typeof onPick === 'function') onPick(options[idx]);
    };
  });
  backdrop.querySelector('[data-keep]').onclick = () => {
    backdrop.remove();
    if (typeof onKeepAsIs === 'function') onKeepAsIs();
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
