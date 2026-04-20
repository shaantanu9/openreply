// Lucide-icon bootstrap.
//
// Usage in templates:
//   <i data-lucide="key"></i>
//   <i data-lucide="refresh-cw" width="14" height="14"></i>
//
// After any dynamic innerHTML update that introduces new <i data-lucide> tags,
// call refreshIcons() — this replaces each placeholder with an inline <svg>.

import { createIcons, icons } from 'lucide';

const DEFAULTS = { width: 16, height: 16, 'stroke-width': 2 };

// Small debounce so back-to-back renders only scan the DOM once.
let pending = null;
export function refreshIcons() {
  if (pending) return pending;
  pending = Promise.resolve().then(() => {
    pending = null;
    try {
      createIcons({ icons, attrs: DEFAULTS });
    } catch (e) {
      console.warn('[icons] createIcons failed:', e);
    }
  });
  return pending;
}

// Also expose on window so ad-hoc modals (opened outside a route render)
// can trigger a refresh without re-importing.
if (typeof window !== 'undefined') {
  window.refreshIcons = refreshIcons;
}

/** Set innerHTML AND refresh lucide icons in one call.
 *
 * Use this EVERYWHERE an innerHTML string contains `<i data-lucide="…">`.
 * Replaces the brittle pattern `el.innerHTML = html; window.refreshIcons?.()`,
 * which is easy to forget (silent bug: bare <i> placeholder instead of SVG).
 *
 * Safe even when the html doesn't contain lucide tags — refreshIcons is a
 * no-op in that case. Debounced, so calling it 50× in a tight loop still
 * only scans the DOM once.
 *
 * Canonical pattern (per docs/superpowers/specs/2026-04-19-app-ui-guidelines.md):
 *     setHTMLWithIcons(contentEl, renderMyScreen(data));
 */
export function setHTMLWithIcons(el, html) {
  if (!el) return;
  el.innerHTML = html;
  refreshIcons();
}
if (typeof window !== 'undefined') {
  window.setHTMLWithIcons = setHTMLWithIcons;
}
