// Uniform page shell — the standard outer container + page header.
//
// Every screen wraps its body in pageShell() so page padding, the
// header (title / subtitle / actions), and vertical rhythm are
// identical across all 44 screens. Replaces the ad-hoc `.topbar` /
// `.crumbs` markup each screen used to hand-roll.
//
// Usage:
//   import { pageShell } from '../components/PageShell.js';
//   root.innerHTML = pageShell({
//     title: 'Posts',
//     subtitle: '1,240 collected',
//     actionsHtml: '<button class="btn btn-sm" id="refresh">Refresh</button>',
//     bodyHtml: renderList(rows),
//   });
//   window.refreshIcons?.();
//
// `actionsHtml` and `bodyHtml` are caller-built HTML strings — the
// caller is responsible for escaping their contents. `title` and
// `subtitle` are escaped here.

import { esc } from '../api.js';

/** Standard page header — title (+ optional subtitle) left, actions right. */
export function pageHeader({ title = '', subtitle = '', actionsHtml = '' } = {}) {
  return `
    <header class="page-header">
      <div class="page-header__text">
        <h1 class="page-header__title">${esc(title)}</h1>
        ${subtitle ? `<p class="page-header__subtitle">${esc(subtitle)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="page-header__actions">${actionsHtml}</div>` : ''}
    </header>
  `;
}

/** Full page shell — header + padded body column. Returns an HTML string. */
export function pageShell({ title = '', subtitle = '', actionsHtml = '', bodyHtml = '' } = {}) {
  return `
    <div class="page-shell">
      ${pageHeader({ title, subtitle, actionsHtml })}
      <div class="page-shell__body">${bodyHtml}</div>
    </div>
  `;
}
