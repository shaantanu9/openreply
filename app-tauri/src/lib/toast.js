// Shared toast helper. A single bottom-right stack (`.toast-stack`) is created
// lazily on <body> and reused; each toast is a `.toast` card styled by kind via
// the `.toast-{err,warn,ok,success,info}` left-border rules in style.css.
//
// API: showToast(message, kind = 'info', ms = 5000)
//   kind ∈ { info | success | error | warn }  (aliases: ok → success-ish,
//   err → error, warning → warn). Designed for one-line status messages —
//   screens/topic.js keeps its own richer title+detail variant; this is the
//   lightweight version consumed by mergeModal.js and any other screen that
//   just needs a quick confirmation/error toast.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

// Map the friendly kind names callers use to the styled CSS class + lucide icon.
const KIND = {
  error:   { css: 'toast-err',     icon: 'x-circle' },
  err:     { css: 'toast-err',     icon: 'x-circle' },
  warn:    { css: 'toast-warn',    icon: 'alert-triangle' },
  warning: { css: 'toast-warn',    icon: 'alert-triangle' },
  success: { css: 'toast-success', icon: 'check-circle-2' },
  ok:      { css: 'toast-ok',      icon: 'check-circle-2' },
  info:    { css: 'toast-info',    icon: 'info' },
};

export function showToast(message, kind = 'info', ms = 5000) {
  const { css, icon } = KIND[kind] || KIND.info;
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = `toast ${css}`;
  el.innerHTML = `
    <span class="toast-ic"><i data-lucide="${icon}"></i></span>
    <div class="toast-body">
      <div class="toast-title">${esc(message)}</div>
    </div>
    <button class="toast-close" aria-label="dismiss">×</button>`;
  stack.appendChild(el);
  // Render the lucide placeholder we just injected.
  window.refreshIcons?.();

  const remove = () => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('.toast-close').onclick = remove;
  if (ms) setTimeout(remove, ms);
}
