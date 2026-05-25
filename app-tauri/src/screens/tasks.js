// Task Manager — Windows Task Manager analog for Gap Map.
//
// Single-screen view of every queue/job surface in the app: running
// collects, watch streams, MCP jobs, sweeps, the LLM-extraction queue,
// and resource usage (token spend). Polls runtime_snapshot every 2 s
// while visible and pauses when the tab loses focus so a stale tab
// doesn't burn sidecar spawns indefinitely.
//
// Backend: src/reddit_research/runtime/snapshot.py via the
// `runtime_snapshot` Tauri command.

import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

// Polling cadence. The cachedInvoke window in api.js is 1.5 s, so this
// 2 s tick coalesces with it cleanly — at most one sidecar call per tick.
const POLL_MS = 2000;

const KIND_LABEL = {
  collect: 'Collect',
  stream: 'Watch',
  extract: 'Enrichment',
  mcp: 'MCP job',
  sweep: 'Sweep',
};

const KIND_ICON = {
  collect: 'cloud-download',
  stream: 'radio',
  extract: 'cpu',
  mcp: 'plug-zap',
  sweep: 'refresh-cw',
};

const STATUS_LABEL = {
  running: 'Running',
  queued: 'Queued',
  finished: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
};

function fmtBytes(n) {
  if (!n || n < 1) return '—';
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtRelative(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 0) return 'now';
    if (diff < 60_000)    return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600_000)  return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function statusPill(status) {
  return `<span class="tm-pill tm-pill-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function kindChip(kind) {
  return `<span class="tm-kind tm-kind-${esc(kind)}"><i data-lucide="${esc(KIND_ICON[kind] || 'square')}"></i> ${esc(KIND_LABEL[kind] || kind)}</span>`;
}

function progressBar(pct, msg) {
  if (pct == null && !msg) return '';
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return `
    <div class="tm-progress" title="${esc(msg || '')}">
      <div class="tm-progress-track"><div class="tm-progress-fill" style="width:${p}%"></div></div>
      ${pct != null ? `<span class="tm-progress-pct">${p}%</span>` : ''}
      ${msg ? `<span class="tm-progress-msg">${esc(msg)}</span>` : ''}
    </div>
  `;
}

function renderRow(r) {
  const errClass = r.error ? ' tm-row-err' : '';
  const errBlock = r.error
    ? `<div class="tm-row-error" title="${esc(r.error)}">⚠ ${esc(String(r.error).slice(0, 140))}</div>`
    : '';
  const progress = progressBar(r.progress_pct, r.progress_msg);
  const rowsCell = r.rows != null
    ? `<span title="rows">${fmtBytes(r.rows)} rows</span>`
    : '';
  const cancelBtn = r.cancellable && (r.status === 'running' || r.status === 'queued')
    ? `<button class="btn btn-ghost btn-xs tm-cancel" data-id="${esc(r.id)}" title="Cancel"><i data-lucide="x"></i></button>`
    : '';
  return `
    <div class="tm-row${errClass}" data-id="${esc(r.id)}">
      <div class="tm-row-main">
        <div class="tm-row-head">
          ${kindChip(r.kind)}
          ${statusPill(r.status)}
          <span class="tm-title">${esc(r.title || '(untitled)')}</span>
          ${cancelBtn}
        </div>
        ${r.subtitle ? `<div class="tm-subtitle">${esc(r.subtitle)}</div>` : ''}
        ${progress}
        ${errBlock}
      </div>
      <div class="tm-row-stats">
        <div title="Started">${fmtRelative(r.started_at)}</div>
        <div title="Duration">${fmtDuration(r.duration_ms)}</div>
        ${rowsCell}
      </div>
    </div>
  `;
}

function renderSection(title, rows, emptyMsg, idSuffix) {
  const body = rows.length === 0
    ? `<div class="empty-state tm-empty">${esc(emptyMsg)}</div>`
    : rows.map(renderRow).join('');
  return `
    <section class="tm-section" data-section="${esc(idSuffix)}">
      <div class="tm-section-head">
        <h3>${esc(title)}</h3>
        <span class="muted tm-section-count">${rows.length}</span>
      </div>
      <div class="tm-section-body">${body}</div>
    </section>
  `;
}

function renderUsage(usage) {
  const today = usage.today || {};
  const week = usage.last_7_days || {};
  const byProvider = usage.by_provider || [];
  const providerRows = byProvider.length === 0
    ? `<div class="empty-state tm-empty">No LLM usage in the last 7 days.</div>`
    : `<table class="tm-usage-table">
        <thead><tr><th>Provider</th><th>Model</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead>
        <tbody>${byProvider.map(p => `
          <tr>
            <td><b>${esc(p.provider || '?')}</b></td>
            <td><code>${esc(p.model || '?')}</code></td>
            <td>${fmtBytes(p.tokens_in)}</td>
            <td>${fmtBytes(p.tokens_out)}</td>
            <td>${p.est_usd > 0 ? `$${p.est_usd.toFixed(4)}` : '—'}</td>
          </tr>`).join('')}</tbody>
      </table>`;

  return `
    <section class="tm-section tm-section-usage">
      <div class="tm-section-head">
        <h3>Resource usage</h3>
        <span class="muted tm-section-count">today + 7-day rollup</span>
      </div>
      <div class="tm-usage-grid">
        <div class="tm-usage-card">
          <div class="tm-usage-label">Tokens today</div>
          <div class="tm-usage-value">${fmtBytes((today.tokens_in || 0) + (today.tokens_out || 0))}</div>
          <div class="tm-usage-sub muted">${fmtBytes(today.tokens_in)} in · ${fmtBytes(today.tokens_out)} out</div>
        </div>
        <div class="tm-usage-card">
          <div class="tm-usage-label">Tokens last 7 days</div>
          <div class="tm-usage-value">${fmtBytes((week.tokens_in || 0) + (week.tokens_out || 0))}</div>
          <div class="tm-usage-sub muted">${fmtBytes(week.tokens_in)} in · ${fmtBytes(week.tokens_out)} out</div>
        </div>
        <div class="tm-usage-card">
          <div class="tm-usage-label">Cost today</div>
          <div class="tm-usage-value">${(today.est_usd || 0) > 0 ? `$${(today.est_usd).toFixed(4)}` : '—'}</div>
          <div class="tm-usage-sub muted">7-day: ${(week.est_usd || 0) > 0 ? `$${(week.est_usd).toFixed(4)}` : '—'}</div>
        </div>
      </div>
      <div class="tm-usage-table-wrap">${providerRows}</div>
    </section>
  `;
}

function renderHeader(snap) {
  const c = snap.counts || {};
  return `
    <div class="tm-header">
      <div class="tm-header-summary">
        <h2>Task Manager</h2>
        <p class="muted">Every running, queued, and recent operation in one view. Auto-refreshes every 2 s.</p>
      </div>
      <div class="tm-stat-row">
        <div class="tm-stat tm-stat-active"><b>${c.active ?? 0}</b><span>Active</span></div>
        <div class="tm-stat tm-stat-queued"><b>${c.queued ?? 0}</b><span>Queued</span></div>
        <div class="tm-stat tm-stat-pending"><b>${fmtBytes(c.extraction_pending_total ?? 0)}</b><span>Posts pending enrichment</span></div>
        <div class="tm-stat tm-stat-recent"><b>${c.recent ?? 0}</b><span>Recent</span></div>
      </div>
      <div class="tm-toolbar">
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="tm-refresh"><i data-lucide="refresh-cw"></i> Refresh now</button>
        <label class="tm-pause-toggle">
          <input type="checkbox" id="tm-pause" />
          <span>Pause auto-refresh</span>
        </label>
        <span class="muted tm-captured" id="tm-captured">—</span>
      </div>
    </div>
  `;
}

function renderEmpty() {
  return `
    <div class="empty-big">
      <h3>Loading runtime snapshot…</h3>
      <p class="muted">Reading every queue table. This usually takes &lt; 1 s on first call.</p>
    </div>
  `;
}

function paint(root, snap) {
  if (!snap || !snap.ok) {
    root.innerHTML = `
      ${renderTopbar()}
      <div class="empty-big">
        <h3>Couldn't load runtime snapshot</h3>
        <p>${esc(snap?.error || 'Unknown error')}</p>
      </div>
    `;
    window.refreshIcons?.();
    return;
  }

  const headerHtml = renderHeader(snap);

  // Active = running collects/streams/MCP. Queued = pending extraction +
  // queued MCP jobs. Recent = last N finished operations.
  const active = snap.active || [];
  const queued = snap.queued || [];
  const recent = snap.recent || [];

  root.innerHTML = `
    ${renderTopbar()}
    <div class="tm-wrap">
      ${headerHtml}
      ${renderSection('Active now', active, 'Nothing running. Start a collect, sweep, or watch to see live activity here.', 'active')}
      ${renderSection('Queued', queued, 'Nothing in any queue.', 'queued')}
      ${renderUsage(snap.usage || {})}
      ${renderSection('Recent', recent, 'No recent operations.', 'recent')}
    </div>
  `;
  window.refreshIcons?.();

  // Captured-at indicator
  const cap = root.querySelector('#tm-captured');
  if (cap) cap.textContent = `last refresh: ${fmtRelative(snap.captured_at)}`;
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Task Manager</strong></div>
      <div class="topbar-spacer"></div>
    </header>
  `;
}

export async function renderTasks(root) {
  // Capture route generation so polling stops once the user navigates
  // away — without this we'd keep firing sidecar calls every 2 s after
  // a tab switch.
  const myGen = root.dataset.routeGen;
  const stillHere = () => root.dataset.routeGen === myGen;

  let paused = false;
  let pollTimer = null;

  root.innerHTML = renderTopbar() + renderEmpty();
  window.refreshIcons?.();

  const tick = async () => {
    if (!stillHere() || paused) return;
    let snap;
    try {
      snap = await api.runtimeSnapshot(25);
    } catch (e) {
      if (!stillHere()) return;
      console.warn('runtime_snapshot failed:', e);
      // Don't blow the screen away on a single failed poll — keep the
      // last good paint and wait for the next tick.
      return;
    }
    if (!stillHere()) return;
    paint(root, snap);

    // Re-wire after every paint (innerHTML wipes listeners).
    root.querySelector('#tm-refresh')?.addEventListener('click', tick);
    root.querySelector('#tm-pause')?.addEventListener('change', (e) => {
      paused = !!e.target.checked;
      if (!paused) tick();
    });

    // Cancel buttons (only present when row.cancellable). Wired here
    // rather than via document delegation because the IDs are stable
    // for the lifetime of one paint.
    root.querySelectorAll('.tm-cancel').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.id || '';
        // Format: "<kind>:<row-id>". We support cancelling MCP jobs and
        // streams — collects use the existing CollectStatusBar verbs.
        if (id.startsWith('mcp:')) {
          // No mcp_jobs_cancel exposed yet — flag a TODO marker.
          alert('MCP job cancel: not wired to a Tauri command yet. Use the MCP server\'s gapmap_jobs_cancel tool.');
        } else if (id.startsWith('stream:')) {
          alert('Stream cancel: stop it from the Watch screen.');
        } else {
          alert(`Cancel for ${id} — not yet wired.`);
        }
      });
    });
  };

  // Initial paint + start polling. Polling runs even on first cycle so
  // a slow first call doesn't leave the spinner up forever.
  await tick();
  pollTimer = setInterval(tick, POLL_MS);

  // Stop polling when the user navigates away. We watch the route-gen
  // dataset attribute via a MutationObserver — when it changes, the
  // observer fires once and we tear down. Cheaper than a global event
  // bus subscription and self-contained to this screen.
  const observer = new MutationObserver(() => {
    if (!stillHere()) {
      clearInterval(pollTimer);
      observer.disconnect();
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-route-gen'] });
}
