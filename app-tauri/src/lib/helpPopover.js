// Inline help popover for the per-page "eye" icon (why.js whyButtonHTML).
//
// Before: clicking the eye navigated away to the full /why/<slug> page.
// After: clicking opens a small popover anchored to the icon with the page's
// purpose, a "Show me around" button (if a mini-tour exists for the screen),
// and links to the full explainer + the Help center — without leaving the
// screen. Falls back to plain navigation if anything fails.
//
// Install once at boot: initHelpPopover() (called from main.js).

import { api, esc } from '../api.js';
import { hasMiniTour, startMiniTour } from './tours.js';

let _openEl = null;

function _close() {
  if (_openEl) { _openEl.remove(); _openEl = null; }
  document.removeEventListener('keydown', _onKey, true);
  document.removeEventListener('click', _onOutside, true);
}
function _onKey(e) { if (e.key === 'Escape') _close(); }
function _onOutside(e) {
  if (_openEl && !_openEl.contains(e.target) && !e.target.closest('.why-eye-btn')) _close();
}

function _slugFromBtn(btn) {
  const href = btn.getAttribute('href') || '';
  const m = href.match(/#\/why\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function _open(btn, slug) {
  _close();
  const pop = document.createElement('div');
  pop.className = 'help-pop card';
  pop.innerHTML = `<h4>Loading…</h4>`;
  document.body.appendChild(pop);
  _openEl = pop;

  // Position under the icon, right-edge aligned to the icon's right edge.
  const r = btn.getBoundingClientRect();
  const top = r.bottom + window.scrollY + 8;
  pop.style.top = `${top}px`;
  // left after we know width
  requestAnimationFrame(() => {
    const w = pop.offsetWidth || 300;
    let left = r.right + window.scrollX - w;
    if (left < 8) left = 8;
    pop.style.left = `${left}px`;
  });

  let exp = null;
  try { exp = await api.pageExplanationGet(slug); } catch { /* ignore */ }
  if (_openEl !== pop) return; // closed while loading

  const title = esc(exp?.title || 'About this page');
  // Lead with the plain-English one-liner; fall back to purpose, then a default.
  const simple = esc(exp?.simple || exp?.purpose || 'What this screen does, in plain words.');
  const steps = Array.isArray(exp?.do) ? exp.do : [];
  const stepsHtml = steps.length
    ? `<div class="help-pop-do"><b>What to do here</b><ol>${
        steps.map((s) => `<li>${esc(s)}</li>`).join('')
      }</ol></div>`
    : '';
  const tourBtn = hasMiniTour(slug)
    ? `<button class="btn btn-primary btn-sm" id="help-pop-tour"><i data-lucide="compass"></i> Show me around</button>`
    : '';
  pop.innerHTML = `
    <h4>${title}</h4>
    <p>${simple}</p>
    ${stepsHtml}
    <div class="help-pop-actions">
      ${tourBtn}
      <a class="btn btn-ghost btn-bordered btn-sm" href="#/why/${encodeURIComponent(slug)}"><i data-lucide="book-open"></i> More detail</a>
      <a class="btn btn-ghost btn-bordered btn-sm" href="#/help"><i data-lucide="life-buoy"></i> Help center</a>
    </div>
  `;
  if (window.lucide?.createIcons) { try { window.lucide.createIcons(); } catch { /* ignore */ } }

  pop.querySelector('#help-pop-tour')?.addEventListener('click', () => {
    _close();
    startMiniTour(slug);
  });
  // Links close the popover (navigation handles the rest).
  pop.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => _close()));

  document.addEventListener('keydown', _onKey, true);
  // Defer outside-click binding so the opening click doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', _onOutside, true), 0);
}

export function initHelpPopover() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.why-eye-btn');
    if (!btn) return;
    const slug = _slugFromBtn(btn);
    if (!slug) return;           // unknown slug → let the link navigate normally
    e.preventDefault();
    if (_openEl) { _close(); return; }  // toggle
    _open(btn, slug);
  });
}
