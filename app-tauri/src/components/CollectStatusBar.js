// Sticky status bar pinned above the main content area. Visible whenever
// a collect is running OR there are queued collects waiting. Lets the
// user see at a glance:
//   - which topic is currently fetching
//   - how long it's been running
//   - any queued topics (with cancel-x next to each)
//   - cancel-running button
//   - click-to-open the running collect's log
//
// Mounted once at startup by main.js. Refreshes every 2s while visible
// and on every collect-related Tauri event so the UI never lies about
// what's happening.

import { api, esc } from '../api.js';
import { listen } from '@tauri-apps/api/event';
// JS-side snapshot of every collect the user kicked off this session.
// Most reliable when the Rust topic map is momentarily empty (between
// insert and the next IPC) or got wiped by a HMR restart.
import { getCollectSnapshot } from '../screens/collect.js';

const HOST_ID = 'collect-status-bar';
let _refreshTimer = null;
let _unlisten = [];

function fmtElapsed(secs) {
  const s = Math.max(0, secs | 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

async function readState() {
  // Three parallel calls — running map + queue list + low-level slot
  // status. We need the slot status separately because the topic map
  // gets wiped when the Rust binary restarts (dev HMR), but the spawned
  // Python sidecar's process handle is what actually holds the
  // single-flight slot. Without checking the slot we'd incorrectly say
  // "no collect" when one is in fact running.
  const [active, queue, statusOk] = await Promise.all([
    api.activeCollects().catch(() => ({})),
    api.listCollectQueue().catch(() => []),
    api.collectStatus().catch(() => false),
  ]);
  return {
    active: active || {},
    queue: queue || [],
    statusOk: !!statusOk,
  };
}

function render(host, state) {
  // Merge sources: Rust topic map → JS in-process snapshot → orphan slot.
  const activeKeys = Object.keys(state.active);
  const snapshot = getCollectSnapshot();
  const snapRunning = snapshot.find((s) => s.status === 'running');

  let runningTopic = null;
  let startedAt = 0;
  if (activeKeys.length > 0) {
    runningTopic = activeKeys[0];
    startedAt = Number(state.active[runningTopic] || 0);
  } else if (snapRunning) {
    runningTopic = snapRunning.topic;
    startedAt = Math.floor((snapRunning.started_ms || 0) / 1000);
  }

  // Hide ONLY when truly nothing is happening: no map entry, no JS
  // snapshot, no queue, no slot held.
  if (!runningTopic && state.queue.length === 0 && !state.statusOk) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.hidden = false;

  const now = Math.floor(Date.now() / 1000);
  const orphanRunning = state.statusOk && !runningTopic;
  const elapsed = startedAt ? now - startedAt : 0;

  const queueChips = state.queue.map((q, i) => `
    <span class="csb-queue-chip" title="Queued — cancel">
      <span class="csb-q-pos">${i + 1}</span>
      <span class="csb-q-topic">${esc(q.topic)}</span>
      <button class="csb-q-x" data-cancel-queue="${esc(q.topic)}" aria-label="Remove from queue">×</button>
    </span>`).join('');

  host.innerHTML = `
    <div class="csb-running">
      <span class="csb-dot" aria-hidden></span>
      <span class="csb-label">Collecting</span>
      ${orphanRunning
        ? `<span class="csb-topic csb-topic--orphan">(topic name lost — sidecar still alive)</span>`
        : `<a class="csb-topic" href="#/collect/${encodeURIComponent(runningTopic || '')}">${esc(runningTopic || '(none)')}</a>`}
      ${runningTopic ? `<span class="csb-elapsed">${fmtElapsed(elapsed)}</span>` : ''}
      ${runningTopic || orphanRunning ? '<button class="csb-cancel" data-cancel-running>Cancel</button>' : ''}
    </div>
    ${state.queue.length ? `
      <div class="csb-queue">
        <span class="csb-queue-label">+ ${state.queue.length} queued:</span>
        ${queueChips}
      </div>` : ''}
    <a class="csb-manage" href="#/collects">Manage all →</a>
  `;
}

async function refresh() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  try {
    const state = await readState();
    render(host, state);
    // Mirror the count to the sidebar nav badge (Active collects → "1+2").
    const badge = document.getElementById('nav-collects-count');
    if (badge) {
      const running = Object.keys(state.active).length;
      const queued = state.queue.length;
      if (running === 0 && queued === 0) badge.textContent = '—';
      else if (queued === 0) badge.textContent = String(running);
      else badge.textContent = `${running}+${queued}`;
    }
  } catch (e) {
    console.warn('[collect-status-bar] refresh failed:', e);
  }
}

function bindClicks(host) {
  host.addEventListener('click', async (e) => {
    const cancelRunning = e.target.closest('[data-cancel-running]');
    const cancelQueue = e.target.closest('[data-cancel-queue]');
    if (cancelRunning) {
      e.preventDefault();
      try { await api.cancelCollect(); } catch {}
      refresh();
      return;
    }
    if (cancelQueue) {
      e.preventDefault();
      e.stopPropagation();
      const t = cancelQueue.getAttribute('data-cancel-queue');
      try { await api.cancelQueuedCollect(t); } catch {}
      refresh();
    }
  });
}

export async function mountCollectStatusBar() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  bindClicks(host);

  // Refresh on every collect-related event.
  for (const evt of [
    'collect:done',
    'collect:queue:enqueued',
    'collect:queue:dequeued',
    'collect:queue:cancelled',
  ]) {
    try {
      const off = await listen(evt, () => refresh());
      _unlisten.push(off);
    } catch {}
  }

  // Throttled refresh on `collect:progress` — fires the moment the
  // first stdout line arrives from the sidecar, which is also the
  // moment we know the collect is genuinely live. Without this hook
  // the bar can lag by up to 2s after a collect starts (until the
  // next tick). 800ms throttle keeps render cost flat even on
  // chatty sources like aggressive multi-source sweeps.
  let lastProgressRefresh = 0;
  try {
    const off = await listen('collect:progress', () => {
      const now = Date.now();
      if (now - lastProgressRefresh > 800) {
        lastProgressRefresh = now;
        refresh();
      }
    });
    _unlisten.push(off);
  } catch {}

  // Plus a 2s tick so the elapsed counter increments.
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(refresh, 2000);

  // Also refresh whenever the route changes — landing on a new screen
  // should immediately reflect the current state without waiting for
  // the next tick.
  window.addEventListener('hashchange', () => refresh());

  refresh();
}

export function unmountCollectStatusBar() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  for (const off of _unlisten) { try { off(); } catch {} }
  _unlisten = [];
}
