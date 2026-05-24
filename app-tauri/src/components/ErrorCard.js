// Uniform error card — shown when a screen's data fetch fails.
// Replaces the ad-hoc `<div class="empty-big"><h3>Couldn't load…` markup
// each screen hand-rolled.
//
// Usage:
//   import { errorCard } from '../components/ErrorCard.js';
//   root.innerHTML = errorCard({
//     message: e?.message || String(e),
//     retry: { id: 'err-retry', label: 'Try again' },
//   });
//   if retry: root.querySelector('#err-retry').onclick = () => reload();
//
// `title` and `message` are escaped here. The retry button is rendered
// with the given id so the caller can wire its onclick.

import { esc } from '../api.js';

/** Returns an HTML string for a uniform error display. */
export function errorCard({ title = 'Something went wrong', message = '', retry = null } = {}) {
  const retryBtn = retry
    ? `<button class="btn btn--primary error-card__retry" id="${esc(retry.id || 'error-retry')}">` +
      `<i data-lucide="rotate-cw"></i>${esc(retry.label || 'Try again')}</button>`
    : '';
  return `
    <div class="error-card" role="alert">
      <div class="error-card__icon"><i data-lucide="alert-triangle"></i></div>
      <div class="error-card__title">${esc(title)}</div>
      ${message ? `<div class="error-card__message">${esc(message)}</div>` : ''}
      ${retryBtn}
    </div>
  `;
}
