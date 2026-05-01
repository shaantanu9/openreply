// Modal shown when start_collect returns { blocked: true, blocked_by }.
// Used by both screens/collect.js (when navigating into a topic) and
// screens/collects.js (the central control center) so the busy
// experience is identical wherever a new collect is initiated.
//
// Returns a Promise<'queue' | 'cancel-and-start' | 'open-running' | 'dismiss'>
// — caller decides what to do with the choice.

import { esc } from '../api.js';

export function showCollectBusyModal({ newTopic, runningTopic, elapsedStr }) {
  return new Promise((resolve) => {
    document.querySelectorAll('.collect-busy-modal').forEach((n) => n.remove());

    const modal = document.createElement('div');
    modal.className = 'collect-busy-modal';
    modal.innerHTML = `
      <div class="cbm-card">
        <div class="cbm-eyebrow">A collect is already running</div>
        <h2 class="cbm-title">Choose what to do with “${esc(newTopic)}”</h2>
        <p class="cbm-body">
          Currently collecting <b>“${esc(runningTopic)}”</b>
          <span class="cbm-meta">· ${esc(elapsedStr)} elapsed</span>.
          We run one collect at a time so the local database stays consistent.
        </p>
        <div class="cbm-actions">
          <button data-action="queue" class="cbm-btn cbm-btn--primary">
            <div class="cbm-btn-title">Queue “${esc(newTopic)}” after the running one</div>
            <div class="cbm-btn-sub">Auto-starts as soon as “${esc(runningTopic)}” finishes. Recommended.</div>
          </button>
          <button data-action="cancel-and-start" class="cbm-btn">
            <div class="cbm-btn-title">Stop “${esc(runningTopic)}” and start this one now</div>
            <div class="cbm-btn-sub">Partial results from the running collect are kept.</div>
          </button>
          <button data-action="open-running" class="cbm-btn cbm-btn--ghost">
            Open the running collect's log →
          </button>
          <button data-action="dismiss" class="cbm-dismiss">
            Dismiss (decide later)
          </button>
        </div>
      </div>
    `;
    function close(answer) {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    }
    function onKey(e) { if (e.key === 'Escape') close('dismiss'); }
    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (btn) { close(btn.dataset.action); return; }
      if (e.target === modal) close('dismiss');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(modal);
  });
}
