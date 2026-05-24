// Uniform loading skeleton — shimmer placeholders shown while a screen
// fetches data. Replaces the ad-hoc `<div class="empty-state">Loading…
// </div>` strings each screen used.
//
// Usage:
//   import { skeleton } from '../components/LoadingSkeleton.js';
//   root.innerHTML = skeleton({ rows: 5, variant: 'list' });
//
// variant:
//   'list'  — stacked rows with a leading dot (default)
//   'card'  — stacked cards
//   'table' — header bar + striped rows

/** Returns an HTML string of shimmer placeholders. */
export function skeleton({ rows = 3, variant = 'list' } = {}) {
  const r = Number(rows);
  const n = Number.isFinite(r) ? Math.max(1, Math.min(20, Math.trunc(r))) : 3;
  const bars = [];
  for (let i = 0; i < n; i++) {
    if (variant === 'card') {
      bars.push('<div class="skel skel-card"></div>');
    } else if (variant === 'table') {
      bars.push('<div class="skel skel-row"></div>');
    } else {
      bars.push(
        '<div class="skel-line"><span class="skel skel-dot"></span>' +
        '<span class="skel skel-bar"></span></div>'
      );
    }
  }
  const head = variant === 'table' ? '<div class="skel skel-thead"></div>' : '';
  return `<div class="skel-wrap" aria-busy="true" aria-label="Loading">${head}${bars.join('')}</div>`;
}
