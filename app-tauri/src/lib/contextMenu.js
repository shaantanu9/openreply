// OpenReply reusable context menu primitive.
// Renders an absolute-positioned menu that closes on outside click / Escape /
// scroll / resize. Used by the tab strip and nav-link right-click handlers.

let openEl = null;

function drawIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function close() {
  if (!openEl) return;
  openEl.remove(); openEl = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close, true);
}

function onOutside(e) { if (openEl && !openEl.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

/**
 * items: [{ label, icon?, onClick?, separator?, disabled? }]
 */
export function openContextMenu(x, y, items) {
  close();
  const el = document.createElement('div');
  el.className = 'context-menu';
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';
  el.innerHTML = items.map((it, i) => {
    if (it.separator) return '<div class="context-menu-separator"></div>';
    const icon = it.icon ? `<i data-lucide="${it.icon}" class="h-3.5 w-3.5 shrink-0"></i>` : '';
    const dis = it.disabled ? ' disabled' : '';
    return `<div class="context-menu-item${dis}" data-i="${i}">${icon}<span>${it.label}</span></div>`;
  }).join('');
  document.body.appendChild(el);
  openEl = el;

  // Clamp inside viewport
  const r = el.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) el.style.left = (window.innerWidth - r.width - 8) + 'px';
  if (r.bottom > window.innerHeight - 8) el.style.top = (window.innerHeight - r.height - 8) + 'px';

  el.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item || item.classList.contains('disabled')) return;
    const i = parseInt(item.dataset.i, 10);
    const handler = items[i]?.onClick;
    close();
    if (typeof handler === 'function') handler();
  });

  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close, true);
  }, 0);

  drawIcons();
}

export function closeContextMenu() { close(); }
