// Iterate / Autoresearch — full Karpathy loop, in-app, persistent.
//
// Runs are background jobs that write to iterate_runs +
// iterate_iterations and survive page reloads. The UI polls
// iterateStatus(run_id) every 2 s while a run is `running`, then stops.
// Clicking "Apply best" writes the winning config to
// topic_pipeline_config so future synthesize / audience calls inherit
// the improvement automatically.
//
// Routes:
//   #/iterate              → topic picker + recent runs feed
//   #/iterate/<topic>      → topic-scoped runs + new-run launcher
//   #/iterate/run/<run_id> → live run-detail with iteration table
//
// Design: standard Home/Topics primitives (slash crumbs, stat-grid,
// section-head, btn-primary / btn-ghost-bordered).
import { api, esc } from '../api.js';
import { skelRows, skelDetail } from '../lib/skeleton.js';
import { withButtonBusy } from '../lib/busyButton.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function topicFromHash() {
  const m = (location.hash || '').match(/^#\/iterate\/([^/?]+)/);
  if (!m) return '';
  if (m[1] === 'run') return '';      // /iterate/run/... is a different path
  return decodeURIComponent(m[1]);
}

function runIdFromHash() {
  const m = (location.hash || '').match(/^#\/iterate\/run\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const LOOP_INFO = {
  deliberate: {
    label: 'Deliberate',
    sub: 'Re-tier cached findings — 5-persona debate over rounds × LLM-on/off',
    icon: 'gavel',
  },
  audience: {
    label: 'Audience',
    sub: 'Re-cluster authors over min_posts × k-candidates',
    icon: 'users',
  },
};

function statusPill(status) {
  const m = {
    pending:   { cls: 'pill', label: 'pending' },
    running:   { cls: 'pill', label: 'running…' },
    done:      { cls: 'pill',  label: 'done' },
    cancelled: { cls: 'pill', label: 'cancelled' },
    error:     { cls: 'pill', label: 'error' },
  }[status] || { cls: 'pill', label: status || '—' };
  const tone =
    status === 'done'     ? 'background:rgba(4,120,87,0.14);color:#047857' :
    status === 'running'  ? 'background:rgba(29,78,216,0.14);color:#1d4ed8' :
    status === 'error'    ? 'background:rgba(190,18,60,0.14);color:#be123c' :
    status === 'cancelled'? 'background:rgba(100,116,139,0.14);color:#475569' :
    'background:var(--surface-2);color:var(--ink-3)';
  return `<span class="${m.cls}" style="${tone};font-family:'DM Mono',monospace;font-size:11px">${esc(m.label)}</span>`;
}

function fmtCfg(cfg) {
  if (!cfg) return '—';
  return Object.entries(cfg)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(',')}]` : String(v)}`)
    .join(' · ');
}

function fmtDuration(start, end) {
  if (!start) return '—';
  const t0 = Date.parse(start);
  const t1 = end ? Date.parse(end) : Date.now();
  const s = Math.max(0, (t1 - t0) / 1000);
  if (s < 60) return `${s.toFixed(0)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

// ── Run-detail polling ────────────────────────────────────────────────

let _pollHandle = null;
function stopPolling() { if (_pollHandle) { clearInterval(_pollHandle); _pollHandle = null; } }

async function renderRunDetail(root, runId) {
  stopPolling();
  root.innerHTML = skelDetail({ paras: 5 });
  let run;
  try {
    run = await api.iterateStatus(runId);
  } catch (e) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load run</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (run?.ok === false) {
    root.innerHTML = `<div class="empty-big"><h3>${esc(run.error || 'Run not found')}</h3></div>`;
    return;
  }
  const draw = (rec) => paintRunDetail(root, rec);
  draw(run);
  if (run.status === 'running' || run.status === 'pending') {
    _pollHandle = setInterval(async () => {
      try {
        const r = await api.iterateStatus(runId);
        draw(r);
        if (r.status !== 'running' && r.status !== 'pending') stopPolling();
      } catch {}
    }, 2000);
  }
}

function paintRunDetail(root, rec) {
  const li = LOOP_INFO[rec.loop_kind] || { label: rec.loop_kind, sub: '', icon: 'repeat' };
  const iters = rec.iterations || [];
  const best = rec.best_config;
  const bestScore = rec.best_score || 0;
  const progress = rec.grid_size ? Math.min(100, (rec.total_iters / rec.grid_size) * 100) : 0;
  const canApply = rec.status === 'done' && best;
  const canCancel = rec.status === 'pending' || rec.status === 'running';

  // Sparkline: scores over iterations
  const w = 260, h = 50, pad = 4;
  let sparkline = '';
  if (iters.length >= 2) {
    const scores = iters.map(it => Math.max(0, it.score));
    const max = Math.max(0.001, ...scores);
    const stepX = (w - pad * 2) / Math.max(1, iters.length - 1);
    const pts = scores.map((s, i) =>
      `${pad + i * stepX},${h - pad - (s / max) * (h - pad * 2)}`
    ).join(' ');
    sparkline = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block;margin-top:6px">
      <polyline fill="none" stroke="#1d4ed8" stroke-width="1.5" points="${pts}"/>
      ${scores.map((s, i) => `<circle cx="${pad + i * stepX}" cy="${h - pad - (s / max) * (h - pad * 2)}" r="${iters[i].kept ? 3 : 2}" fill="${iters[i].kept ? '#047857' : '#94a3b8'}"/>`).join('')}
    </svg>`;
  }

  const iterRow = (it) => {
    const detail = it.detail || {};
    const detailStr = Object.entries(detail).slice(0, 4).map(([k, v]) =>
      `${k}=${typeof v === 'number' ? Number(v).toFixed(3) : esc(String(v))}`
    ).join(' · ');
    return `
      <tr class="${it.kept ? 'iter-best' : ''}">
        <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-size:11px">${it.iter_idx + 1}</td>
        <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-size:11px">${esc(fmtCfg(it.config))}</td>
        <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-weight:700">${(it.score || 0).toFixed(3)}</td>
        <td style="padding:6px 8px">${it.kept ? '<span class="pill" style="background:rgba(4,120,87,0.14);color:#047857">kept</span>' : '<span class="pill">discarded</span>'}</td>
        <td style="padding:6px 8px;font-size:11px;color:var(--ink-3)">${esc(detailStr)}</td>
      </tr>
    `;
  };

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/iterate">Iterate</a> /
        <a href="#/iterate/${encodeURIComponent(rec.topic)}">${esc(rec.topic)}</a> /
        <strong>${esc(rec.run_id)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      ${canCancel ? `<button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="run-cancel"><i data-lucide="x"></i> Cancel</button>` : ''}
      ${canApply  ? `<button class="btn btn-primary btn-sm icon-btn" id="run-apply"><i data-lucide="check"></i> Apply best config</button>` : ''}
    </header>

    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon mint"><i data-lucide="${li.icon}"></i></div>
          ${statusPill(rec.status)}
        </div>
        <div class="stat-num" style="font-size:18px">${esc(li.label)}</div>
        <div class="stat-label">${esc(li.sub)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon sky"><i data-lucide="trophy"></i></div>
        </div>
        <div class="stat-num">${bestScore ? bestScore.toFixed(3) : '—'}</div>
        <div class="stat-label">Best score${best ? ` · ${esc(fmtCfg(best))}` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon lavender"><i data-lucide="git-branch"></i></div>
        </div>
        <div class="stat-num">${rec.total_iters || 0} / ${rec.grid_size || 0}</div>
        <div class="stat-label">Iterations · ${progress.toFixed(0)}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon peach"><i data-lucide="clock"></i></div>
        </div>
        <div class="stat-num" style="font-size:18px">${esc(fmtDuration(rec.started_at, rec.ended_at))}</div>
        <div class="stat-label">Duration</div>
      </div>
    </section>

    ${sparkline ? `
      <div class="card" style="margin-bottom:14px">
        <div class="card-head">
          <div><h3>Score over iterations</h3><p>Green = kept (new best) · grey = discarded</p></div>
        </div>
        <div class="card-body">${sparkline}</div>
      </div>` : ''}

    <div class="section-head">
      <div><h2>Iterations</h2><p>${iters.length} configs tested</p></div>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead style="background:var(--surface-2)">
            <tr>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">#</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Config</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Score</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Outcome</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Detail</th>
            </tr>
          </thead>
          <tbody>${iters.map(iterRow).join('') || '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--ink-3)">No iterations yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
  window.refreshIcons?.();
  $('#run-cancel', root)?.addEventListener('click', (e) =>
    withButtonBusy(e.currentTarget, async () => {
      await api.iterateCancel(rec.run_id);
      setTimeout(() => renderRunDetail(root, rec.run_id), 500);
    }, { busyLabel: 'Cancelling…' }));
  $('#run-apply', root)?.addEventListener('click', (e) =>
    withButtonBusy(e.currentTarget, async () => {
      const r = await api.iterateApply(rec.run_id);
      if (r?.ok) {
        alert(`Applied. Future ${rec.loop_kind} runs on "${rec.topic}" will use ${fmtCfg(r.config)}`);
      } else {
        alert(`Apply failed: ${r?.error || 'unknown'}`);
      }
    }, { busyLabel: 'Applying…' }));
}

// ── Topic-scoped runs feed ────────────────────────────────────────────

async function renderTopicIterate(root, topic) {
  stopPolling();
  root.innerHTML = skelRows(6);
  let runs, applied;
  try {
    [runs, applied] = await Promise.all([
      api.iterateList(topic, 30),
      api.iterateApplied(topic),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load runs</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }

  const appliedRows = (applied?.configs || []).map(c => `
    <tr>
      <td style="padding:6px 8px"><strong>${esc(c.loop_kind)}</strong></td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-size:11px">${esc(fmtCfg(c.config))}</td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-weight:700">${(c.score || 0).toFixed(3)}</td>
      <td style="padding:6px 8px;color:var(--ink-3);font-size:11px">${esc(c.applied_at || '')}</td>
      <td style="padding:6px 8px"><a href="#/iterate/run/${esc(c.from_run_id)}">${esc((c.from_run_id || '').slice(0, 12))}</a></td>
    </tr>
  `).join('');

  const runRow = (r) => `
    <tr>
      <td style="padding:6px 8px"><a href="#/iterate/run/${esc(r.run_id)}">${esc(r.run_id.slice(0, 16))}</a></td>
      <td style="padding:6px 8px">${esc(LOOP_INFO[r.loop_kind]?.label || r.loop_kind)}</td>
      <td style="padding:6px 8px">${statusPill(r.status)}</td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-weight:700">${(r.best_score || 0).toFixed(3)}</td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace">${r.total_iters || 0}/${r.grid_size || 0}</td>
      <td style="padding:6px 8px;color:var(--ink-3);font-size:11px">${esc(r.started_at || '')}</td>
      <td style="padding:6px 8px;color:var(--ink-3);font-size:11px">${esc(fmtDuration(r.started_at, r.ended_at))}</td>
    </tr>
  `;

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/iterate">Iterate</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="run-audience">
        <i data-lucide="users"></i> Run audience loop
      </button>
      <button class="btn btn-primary btn-sm icon-btn" id="run-deliberate">
        <i data-lucide="gavel"></i> Run deliberate loop
      </button>
    </header>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div><h3>Applied best configs</h3><p>Per-topic overrides used by future synthesize/audience runs</p></div>
      </div>
      <div class="card-body" style="padding:0">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead style="background:var(--surface-2)">
            <tr>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Pipeline</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Config</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Score</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Applied at</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">From run</th>
            </tr>
          </thead>
          <tbody>${appliedRows || '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--ink-3)">No best configs applied yet — run a loop and click "Apply best".</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="section-head">
      <div><h2>Recent runs</h2><p>${(runs?.runs || []).length} on file</p></div>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead style="background:var(--surface-2)">
            <tr>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">ID</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Loop</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Status</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Best</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Progress</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Started</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Duration</th>
            </tr>
          </thead>
          <tbody>${(runs?.runs || []).map(runRow).join('') || '<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--ink-3)">No runs yet — start one above.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
  window.refreshIcons?.();
  const launch = (loopKind) => {
    const btn = $(`#run-${loopKind}`, root);
    return withButtonBusy(btn, async () => {
      try {
        const res = await api.iterateRun(topic, loopKind, {});
        if (res?.run_id) {
          location.hash = `#/iterate/run/${encodeURIComponent(res.run_id)}`;
        } else {
          alert('Run failed to start.');
        }
      } catch (e) {
        alert(`Run error: ${e?.message || e}`);
      }
    }, { busyLabel: 'Starting…' });
  };
  $('#run-deliberate', root)?.addEventListener('click', () => launch('deliberate'));
  $('#run-audience', root)?.addEventListener('click', () => launch('audience'));
}

// ── Picker ────────────────────────────────────────────────────────────

async function renderPicker(root) {
  stopPolling();
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Iterate (Autoresearch)</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Karpathy-style improvement loops · persistent</span>
    </header>
    <div id="iter-pick">${skelRows(6)}</div>
  `;
  let topics = [], runs = [];
  try {
    [topics, runs] = await Promise.all([
      api.listTopics(),
      api.iterateList(null, 12),
    ]);
  } catch (e) {
    $('#iter-pick', root).innerHTML = `<div class="empty-big"><h3>Couldn't load</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  const hasTopics = (topics || []).length > 0;
  const opts = (topics || []).map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  const recent = (runs?.runs || []).slice(0, 8).map(r => `
    <tr>
      <td style="padding:6px 8px"><a href="#/iterate/run/${esc(r.run_id)}">${esc(r.run_id.slice(0, 16))}</a></td>
      <td style="padding:6px 8px"><a href="#/iterate/${encodeURIComponent(r.topic)}">${esc(r.topic)}</a></td>
      <td style="padding:6px 8px">${esc(LOOP_INFO[r.loop_kind]?.label || r.loop_kind)}</td>
      <td style="padding:6px 8px">${statusPill(r.status)}</td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-weight:700">${(r.best_score || 0).toFixed(3)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--ink-3)">No runs across any topic yet.</td></tr>';

  const pickerCard = hasTopics
    ? `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div>
          <h3>Pick a topic to iterate on</h3>
          <p>Each loop sweeps a small grid of safe configs and picks the best</p>
        </div>
      </div>
      <div class="card-body">
        <div class="row">
          <select id="iter-topic" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="iter-go">Open →</button>
        </div>
      </div>
    </div>`
    : `
    <div class="empty-big" style="margin-bottom:14px">
      <h3>Nothing to iterate on yet</h3>
      <p>Autoresearch tunes the synthesize &amp; audience pipelines for an
      existing topic. Collect a topic first, then come back here to run an
      improvement loop and apply the winning config.</p>
      <button class="btn btn-primary btn-sm icon-btn" id="iter-collect">
        <i data-lucide="plus"></i> Start a topic
      </button>
    </div>`;

  $('#iter-pick', root).innerHTML = `
    ${pickerCard}
    <div class="section-head"><div><h2>Recent runs across all topics</h2><p>Latest 8</p></div></div>
    <div class="card">
      <div class="card-body" style="padding:0">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead style="background:var(--surface-2)">
            <tr>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">ID</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Topic</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Loop</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Status</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--ink-3);font-weight:700">Best</th>
            </tr>
          </thead>
          <tbody>${recent}</tbody>
        </table>
      </div>
    </div>
  `;
  window.refreshIcons?.();
  $('#iter-go', root)?.addEventListener('click', () => {
    const t = $('#iter-topic', root)?.value;
    if (t) location.hash = `#/iterate/${encodeURIComponent(t)}`;
  });
  $('#iter-collect', root)?.addEventListener('click', () => {
    if (typeof window.gapmapOpenNewTopic === 'function') window.gapmapOpenNewTopic();
    else location.hash = '#/home';
  });
}

export async function renderIterate(root) {
  const runId = runIdFromHash();
  if (runId) return renderRunDetail(root, runId);
  const topic = topicFromHash();
  if (topic) return renderTopicIterate(root, topic);
  return renderPicker(root);
}
