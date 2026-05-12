// Modal shown when start_collect returns { blocked: true, blocked_by }.
// Used by both screens/collect.js (when navigating into a topic) and
// screens/collects.js (the central control center) so the busy
// experience is identical wherever a new collect is initiated.
//
// Returns a Promise<'queue' | 'cancel-and-start' | 'open-running' |
//                   'unstick' | 'dismiss'>
// — caller decides what to do with the choice.
//
// Two visual modes:
//   - default (a real collect is running): Queue / Stop-and-start /
//     Open-running-log / Dismiss.
//   - isOrphan=true (the single-flight slot is held but no live topic
//     can be identified — sidecar crashed without firing collect:done):
//     Unstick / Dismiss. We deliberately hide Queue and Stop-and-start
//     because there's nothing real to wait on or terminate; both would
//     trap the user further.

import { esc } from '../api.js';

export function showCollectBusyModal({
  newTopic,
  runningTopic,
  elapsedStr,
  isOrphan = false,
}) {
  return new Promise((resolve) => {
    document.querySelectorAll('.collect-busy-modal').forEach((n) => n.remove());

    const modal = document.createElement('div');
    modal.className = 'collect-busy-modal';
    if (isOrphan) {
      modal.innerHTML = `
        <div class="cbm-card">
          <div class="cbm-eyebrow cbm-eyebrow--warn">Stale collect lock detected</div>
          <h2 class="cbm-title">Couldn't start “${esc(newTopic)}”</h2>
          <p class="cbm-body">
            The single-flight slot is held but no live collect can be
            identified — usually because a previous collect crashed or
            the app was reloaded mid-flight. There's nothing real to
            wait on or stop.
          </p>
          <div class="cbm-actions">
            <button data-action="unstick" class="cbm-btn cbm-btn--primary">
              <div class="cbm-btn-title">Unstick &amp; start “${esc(newTopic)}”</div>
              <div class="cbm-btn-sub">Clears the dead lock and runs your collect immediately.</div>
            </button>
            <button data-action="dismiss" class="cbm-dismiss">
              Dismiss (decide later)
            </button>
          </div>
        </div>
      `;
    } else {
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
    }
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
