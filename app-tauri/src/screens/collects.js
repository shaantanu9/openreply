// Control center for every collect happening in the app.
//
// Shows in one window:
//   - INLINE "Start a collect" form. Type a topic, hit Start. If
//     something else is already running, the same busy modal that the
//     dedicated collect screen uses pops up here too — choose Queue,
//     Stop-and-start, or Dismiss.
//   - "What & why" explainer card so the user knows exactly what's
//     being pulled and what it's for.
//   - Running pane with a big STOP button + last 5 log lines.
//   - Queue pane with REMOVE buttons.
//   - This-session history with RE-RUN + Open log buttons.
//
// All controls converge on the same Tauri commands. No screen-jumping.

import { api, esc } from '../api.js';
import { skelRows } from '../lib/skeleton.js';
import { listen } from '@tauri-apps/api/event';
import { getCollectSnapshot, markCollectCancelled } from './collect.js';
import { showCollectBusyModal } from '../components/CollectBusyModal.js';

const REFRESH_MS = 1500;

function fmtElapsedSecs(secs) {
  const s = Math.max(0, secs | 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function fmtRelative(msAgo) {
  const s = Math.floor(msAgo / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Colors live in style.css (.cm-badge--<status>) — centralized in the GUI
// tokenization pass instead of inline hex here. Same palette, no visual change.
const STATUS_LABELS = {
  running: 'running', queued: 'queued', done: 'done',
  failed: 'failed', cancelled: 'cancelled', idle: 'idle',
};
function statusBadge(status) {
  const key = STATUS_LABELS[status] ? status : 'idle';
  return `<span class="cm-badge cm-badge--${key}">${STATUS_LABELS[key]}</span>`;
}

function tailLinesHtml(tail) {
  if (!tail?.length) {
    return '<div class="cm-empty-tail">No log lines yet — collect just started.</div>';
  }
  return `<pre class="cm-tail">${tail.map((l) => esc(l.text || '')).join('\n')}</pre>`;
}

// Kick off a collect from the inline form. Handles the busy-modal
// branch when something else is already running. Surfaces every error
// inline (no thrown promises that hit the console).
async function initiateCollect(topic, { aggressive = true, ifBusy = 'error', sources = null, skipReddit = false } = {}) {
  if (!topic || !topic.trim()) {
    return { ok: false, error: 'Topic is empty' };
  }
  topic = topic.trim();
  try {
    const r = await api.startCollect(topic, aggressive, sources, skipReddit, ifBusy);
    if (r?.blocked && r?.blocked_by) {
      // Recover topic name from JS-side snapshot if Rust map lost it
      // (orphan case after a dev binary restart). Same for elapsed.
      let runningTopic = r.blocked_by.topic;
      let elapsedSecs = Number(r.blocked_by.elapsed_secs) || 0;
      const looksUnknown = !runningTopic
        || /\(unknown/i.test(runningTopic)
        || elapsedSecs > 60 * 60 * 24 * 30;  // > 30 days = bogus
      let isOrphan = false;
      if (looksUnknown) {
        const snap = getCollectSnapshot().find((s) => s.status === 'running');
        if (snap) {
          runningTopic = snap.topic;
          elapsedSecs = snap.started_ms
            ? Math.floor((Date.now() - snap.started_ms) / 1000) : 0;
        } else {
          // Slot held but no live collect anywhere — orphan lock from a
          // previous crash / HMR. Surface the Unstick affordance instead
          // of Queue / Stop-and-start, both of which trap the user.
          runningTopic = '(name not available — orphan sidecar)';
          elapsedSecs = 0;
          isOrphan = true;
        }
      }
      const elapsedStr = elapsedSecs > 0 ? fmtElapsedSecs(elapsedSecs) : 'unknown';
      const choice = await showCollectBusyModal({
        newTopic: topic,
        runningTopic,
        elapsedStr,
        isOrphan,
      });
      if (choice === 'unstick') {
        try {
          await api.clearOrphanCollectLock();
        } catch (_) {
          // Even if the IPC call fails, we still try the start — the
          // sweeper will get to it eventually and the user sees a real
          // error from start_collect rather than a swallowed unstick.
        }
        return initiateCollect(topic, { aggressive, ifBusy: 'error', sources, skipReddit });
      }
      if (choice === 'queue') {
        return initiateCollect(topic, { aggressive, ifBusy: 'queue', sources, skipReddit });
      }
      if (choice === 'cancel-and-start') {
        return initiateCollect(topic, { aggressive, ifBusy: 'cancel_and_start', sources, skipReddit });
      }
      if (choice === 'open-running') {
        window.location.hash = `#/collect/${encodeURIComponent(runningTopic)}`;
        return { ok: true, opened: runningTopic };
      }
      return { ok: false, dismissed: true };
    }
    if (r?.queued) {
      return { ok: true, queued: true, position: r.position };
    }
    if (r?.started || r?.ok) {
      // Navigate the user into the live log.
      window.location.hash = `#/collect/${encodeURIComponent(topic)}`;
      return { ok: true, started: true };
    }
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function renderCollects(root) {
  const myRouteGen = root.dataset.routeGen;
  const stillHere = () => root.dataset.routeGen === myRouteGen && root.isConnected;

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a>
        / <strong>Active collects</strong>
      </div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="cm-grid">

      <!-- Inline start form. Replaces the "go to /find first" round-trip. -->
      <section class="cm-pane cm-pane--start">
        <h3 class="cm-pane-title">Start a collect</h3>
        <form id="cm-start-form" class="cm-start-form" autocomplete="off">
          <input
            id="cm-start-topic"
            class="cm-start-input"
            type="text"
            placeholder="Topic to research — e.g. note-taking apps"
            spellcheck="false"
            required
          />
          <label class="cm-start-toggle" title="Aggressive: 17-source full sweep (adds GDELT news + web search). Off: 9-source quick mode.">
            <input id="cm-start-aggressive" type="checkbox" checked />
            <span>Full 17-source sweep</span>
          </label>
          <button type="submit" class="btn btn-primary cm-start-btn">Start collect →</button>
        </form>
        <div id="cm-start-feedback" class="cm-start-feedback"></div>
        <details class="cm-explainer">
          <summary>What does a collect actually do?</summary>
          <div class="cm-explainer-body">
            <p><b>Goal:</b> turn raw user voice from across the internet into a structured
              "gap map" — painpoints, feature wishes, competitor mentions, and DIY
              workarounds — for the topic you typed.</p>
            <p><b>Sources we sweep</b> (in parallel):</p>
            <ul>
              <li><b>Reddit</b> — top relevant subreddits (we discover them based on the topic).</li>
              <li><b>Hacker News, Dev.to, Stack Overflow, GitHub</b> — developer signal.</li>
              <li><b>App Store, Play Store, Trustpilot, Product Hunt</b> — consumer reviews + launches.</li>
              <li><b>arXiv, OpenAlex, PubMed, Google Scholar</b> — academic backing.</li>
              <li><b>Google News + RSS bundles</b> — recent industry moves.</li>
            </ul>
            <p><b>Where it goes:</b> all into your local SQLite DB. Nothing is uploaded
              anywhere unless you explicitly export. The sidecar runs entirely on
              your machine.</p>
          </div>
        </details>
      </section>

      <section class="cm-pane cm-pane--running" id="cm-pane-running">
        <h3 class="cm-pane-title">Running</h3>
        ${skelRows(1)}
      </section>

      <section class="cm-pane cm-pane--queue" id="cm-pane-queue">
        <h3 class="cm-pane-title">Queue</h3>
        ${skelRows(2)}
      </section>

      <section class="cm-pane cm-pane--recent" id="cm-pane-recent">
        <h3 class="cm-pane-title">This session</h3>
        ${skelRows(3)}
      </section>
    </div>
  `;

  const paneRunning = root.querySelector('#cm-pane-running');
  const paneQueue   = root.querySelector('#cm-pane-queue');
  const paneRecent  = root.querySelector('#cm-pane-recent');
  const startForm   = root.querySelector('#cm-start-form');
  const startInput  = root.querySelector('#cm-start-topic');
  const startToggle = root.querySelector('#cm-start-aggressive');
  const startBtn    = root.querySelector('.cm-start-btn');
  const feedback    = root.querySelector('#cm-start-feedback');

  // Inline start handler — same flow as the dedicated collect screen,
  // but the user never has to leave this page if they decide to queue.
  startForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = (startInput.value || '').trim();
    if (!topic) {
      feedback.textContent = 'Type a topic first.';
      feedback.className = 'cm-start-feedback cm-feedback--err';
      return;
    }
    startBtn.disabled = true;
    feedback.textContent = 'Working…';
    feedback.className = 'cm-start-feedback cm-feedback--info';
    const r = await initiateCollect(topic, {
      aggressive: !!startToggle.checked,
    });
    startBtn.disabled = false;
    if (r.ok && r.queued) {
      feedback.textContent = `Queued — position ${r.position}.`;
      feedback.className = 'cm-start-feedback cm-feedback--ok';
      startInput.value = '';
    } else if (r.ok && r.started) {
      // initiateCollect already navigated; keep feedback visible
      feedback.textContent = 'Started — opening log…';
      feedback.className = 'cm-start-feedback cm-feedback--ok';
    } else if (r.dismissed) {
      feedback.textContent = 'Cancelled — start it later from here.';
      feedback.className = 'cm-start-feedback';
    } else if (r.error) {
      feedback.textContent = `Failed: ${r.error}`;
      feedback.className = 'cm-start-feedback cm-feedback--err';
    } else {
      feedback.textContent = 'Done.';
      feedback.className = 'cm-start-feedback';
    }
    refresh();
  });

  // Click delegation for every per-row button.
  root.querySelector('.cm-grid').addEventListener('click', async (e) => {
    const cancelRunning = e.target.closest('[data-cancel-running]');
    const cancelQueue   = e.target.closest('[data-cancel-queue]');
    const openLog       = e.target.closest('[data-open-log]');
    const reCollect     = e.target.closest('[data-recollect]');

    if (cancelRunning) {
      e.preventDefault();
      // Capture which topic is the currently-displayed running one BEFORE
      // we kill it so we can flip its snapshot status synchronously.
      // Without this, refresh() picks up the stale 'running' entry and the
      // pane keeps rendering the just-stopped collect until the next
      // collect:done event arrives.
      let runningTopic = null;
      try {
        const active = (await api.activeCollects()) || {};
        runningTopic = Object.keys(active)[0] || null;
        if (!runningTopic) {
          const snap = getCollectSnapshot().find((s) => s.status === 'running');
          runningTopic = snap?.topic || null;
        }
      } catch {}
      try { await api.cancelCollect(); } catch {}
      if (runningTopic) markCollectCancelled(runningTopic);
      else markCollectCancelled(null);  // sweep any lingering 'running' entries
      refresh();
      return;
    }
    if (cancelQueue) {
      e.preventDefault();
      const t = cancelQueue.getAttribute('data-cancel-queue');
      try { await api.cancelQueuedCollect(t); } catch {}
      refresh();
      return;
    }
    if (openLog) {
      e.preventDefault();
      const t = openLog.getAttribute('data-open-log');
      window.location.hash = `#/collect/${encodeURIComponent(t)}`;
      return;
    }
    if (reCollect) {
      e.preventDefault();
      const t = reCollect.getAttribute('data-recollect');
      // Re-run goes through the same conflict-aware flow.
      await initiateCollect(t, { aggressive: true });
      refresh();
    }
  });

  async function refresh() {
    if (!stillHere()) return;
    let active = {}, queue = [], statusOk = false;
    try { active = (await api.activeCollects()) || {}; } catch {}
    try { queue  = (await api.listCollectQueue()) || []; } catch {}
    try { statusOk = !!(await api.collectStatus()); } catch {}
    const snapshot = getCollectSnapshot();
    const snapRunning = snapshot.find((s) => s.status === 'running');

    // Merge: prefer Rust map → fall back to JS snapshot → orphan slot.
    // BUT: if the Rust map says topic X is active and OUR snapshot
    // says X was cancelled (user just clicked Stop), trust the
    // snapshot. Rust takes a moment to actually kill the sidecar and
    // clear its map; without this guard the pane keeps showing the
    // just-stopped topic until the next collect:done event arrives.
    const activeTopics = Object.keys(active);
    let runningTopic = null;
    let startedAt = 0;
    if (activeTopics.length > 0) {
      const candidate = activeTopics[0];
      const snapForCandidate = snapshot.find((s) => s.topic === candidate);
      if (snapForCandidate && snapForCandidate.status === 'cancelled') {
        // Stale Rust entry — see if the snapshot has a different live one.
        const snapAlive = snapshot.find((s) => s.status === 'running');
        if (snapAlive) {
          runningTopic = snapAlive.topic;
          startedAt = Math.floor((snapAlive.started_ms || 0) / 1000);
        }
      } else {
        runningTopic = candidate;
        startedAt = Number(active[candidate] || 0);
      }
    } else if (snapRunning) {
      runningTopic = snapRunning.topic;
      startedAt = Math.floor((snapRunning.started_ms || 0) / 1000);
    }
    const elapsedSecs = startedAt ? Math.floor(Date.now() / 1000) - startedAt : 0;
    const orphanRunning = statusOk && !runningTopic;

    // ── Running pane ────────────────────────────────────────────────────
    if (!runningTopic && !orphanRunning) {
      paneRunning.innerHTML = `
        <h3 class="cm-pane-title">Running</h3>
        <div class="cm-empty-state">
          <p><b>Nothing is fetching right now.</b></p>
          <p class="cm-empty-hint">Use the form above to start a new collect — or
            re-run a recent topic from <i>This session</i> below.</p>
        </div>
      `;
    } else if (orphanRunning) {
      paneRunning.innerHTML = `
        <h3 class="cm-pane-title">Running ${statusBadge('running')}</h3>
        <div class="cm-row cm-row--running">
          <div class="cm-row-head">
            <span class="cm-dot"></span>
            <span class="cm-topic">(topic name lost)</span>
          </div>
          <div class="cm-row-meta">
            A collect sidecar is alive but its topic name is no longer tracked
            (most likely the dev binary restarted while it was running). Stop
            still works — it kills the Python sidecar via its OS handle.
          </div>
          <div class="cm-row-actions">
            <button class="btn btn-sm btn-danger" data-cancel-running>
              ■ Stop running collect
            </button>
          </div>
        </div>
      `;
    } else {
      const snap = snapshot.find((s) => s.topic === runningTopic);
      paneRunning.innerHTML = `
        <h3 class="cm-pane-title">Running ${statusBadge('running')}</h3>
        <div class="cm-row cm-row--running">
          <div class="cm-row-head">
            <span class="cm-dot"></span>
            <span class="cm-topic">${esc(runningTopic)}</span>
            <span class="cm-elapsed">${fmtElapsedSecs(elapsedSecs)}</span>
          </div>
          <div class="cm-row-meta">
            Pulling Reddit + 15 external sources for this topic.
            ${snap ? `${snap.line_count.toLocaleString()} log lines so far.` : 'Just started.'}
          </div>
          ${snap ? tailLinesHtml(snap.tail) : ''}
          <div class="cm-row-actions">
            <button class="btn btn-sm" data-open-log="${esc(runningTopic)}">
              Open full log →
            </button>
            <button class="btn btn-sm btn-danger" data-cancel-running>
              ■ Stop this collect
            </button>
          </div>
        </div>
      `;
    }

    // ── Queue pane ──────────────────────────────────────────────────────
    if (!queue.length) {
      paneQueue.innerHTML = `
        <h3 class="cm-pane-title">Queue</h3>
        <div class="cm-empty-state cm-empty-state--soft">
          Nothing waiting. Topics you start while another is running can be queued —
          they'll auto-fire as soon as the running one finishes.
        </div>
      `;
    } else {
      paneQueue.innerHTML = `
        <h3 class="cm-pane-title">Queue ${statusBadge('queued')} <span class="cm-count">${queue.length}</span></h3>
        <ol class="cm-list">
          ${queue.map((q, i) => {
            const ago = q.queued_at ? fmtRelative(Date.now() - q.queued_at * 1000) : '';
            return `
              <li class="cm-row cm-row--queued">
                <span class="cm-q-pos">${i + 1}</span>
                <span class="cm-topic">${esc(q.topic)}</span>
                <span class="cm-row-meta">queued ${esc(ago)} · waiting for slot</span>
                <div class="cm-row-actions">
                  <button class="btn btn-sm btn-ghost" data-cancel-queue="${esc(q.topic)}">
                    × Remove from queue
                  </button>
                </div>
              </li>`;
          }).join('')}
        </ol>
      `;
    }

    // ── Recent / session-history pane ───────────────────────────────────
    const finished = snapshot.filter((s) =>
      s.status !== 'running' && s.topic !== runningTopic && !queue.find((q) => q.topic === s.topic),
    );
    if (!finished.length) {
      paneRecent.innerHTML = `
        <h3 class="cm-pane-title">This session</h3>
        <div class="cm-empty-state cm-empty-state--soft">
          Topics you've collected this session will show here. From here you can
          open the log again or run a fresh sweep on the same topic.
        </div>
      `;
    } else {
      paneRecent.innerHTML = `
        <h3 class="cm-pane-title">This session <span class="cm-count">${finished.length}</span></h3>
        <ul class="cm-list">
          ${finished.map((s) => {
            const ago = s.started_ms ? fmtRelative(Date.now() - s.started_ms) : '';
            return `
              <li class="cm-row cm-row--finished">
                <span class="cm-topic">${esc(s.topic)}</span>
                ${statusBadge(s.status)}
                <span class="cm-row-meta">${esc(ago)} · ${s.line_count.toLocaleString()} lines</span>
                <div class="cm-row-actions">
                  <button class="btn btn-sm" data-open-log="${esc(s.topic)}">Open log</button>
                  <button class="btn btn-sm btn-primary" data-recollect="${esc(s.topic)}">↻ Run again</button>
                </div>
              </li>`;
          }).join('')}
        </ul>
      `;
    }
  }

  refresh();
  const tick = setInterval(() => refresh().catch(() => {}), REFRESH_MS);

  const unlisteners = [];
  for (const evt of [
    'collect:done', 'collect:progress',
    'collect:queue:enqueued', 'collect:queue:dequeued', 'collect:queue:cancelled',
    // Sweeper or start_collect just reaped a stale lock — re-render so the
    // (topic name lost) row clears immediately instead of after the next
    // 1.5s polling tick.
    'collect:orphan:reaped',
  ]) {
    try { unlisteners.push(await listen(evt, () => refresh())); } catch {}
  }

  // Focus the start input after a tiny delay so it's the first thing
  // the user can type into when they land here.
  setTimeout(() => { try { startInput.focus(); } catch {} }, 50);

  const cleanup = () => {
    clearInterval(tick);
    for (const off of unlisteners) { try { off(); } catch {} }
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
