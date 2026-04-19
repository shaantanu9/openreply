// Full fetches log — paginated, filterable. The home dashboard only shows
// the last 12 rows; this page exposes everything.
import { api, esc, timeAgo } from '../api.js';

const PAGE_SIZE = 50;
let state = {
  page: 0,
  kind: '',
  topic: '',
  errorsOnly: false,
  rows: [],
  totalCount: 0,
  loading: false,
};

let refreshTimer = null;

export async function renderActivity(root) {
  state = { ...state, page: 0 };

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Activity</strong></div>
      <div class="topbar-spacer"></div>
      <span class="pill" id="activity-live-pill" hidden>● live</span>
    </header>

    <div class="section-head">
      <div><h2>Pipeline activity</h2><p id="activity-sub">All fetches + ingests + enrichment runs</p></div>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-activity-refresh"><i data-lucide="rotate-cw"></i> Refresh</button>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head"><div><h3>Last 30 days</h3><p>Daily pipeline volume</p></div></div>
      <div class="card-body" id="activity-spark" style="padding:14px 20px 20px">
        <div class="empty-state">loading…</div>
      </div>
    </div>

    <div class="activity-filters">
      <label>
        <span>Kind</span>
        <select id="f-kind">
          <option value="">All</option>
          <option value="posts">Reddit posts</option>
          <option value="historical">Pullpush archive</option>
          <option value="source:">Any non-reddit source</option>
          <option value="source:hackernews">HackerNews</option>
          <option value="source:appstore">App Store</option>
          <option value="source:playstore">Play Store</option>
          <option value="source:arxiv">arXiv</option>
          <option value="source:scholar">Google Scholar</option>
          <option value="source:github">GitHub</option>
          <option value="source:news">News</option>
          <option value="source:wikipedia">Wikipedia</option>
          <option value="source:pytrends">Google Trends</option>
          <option value="search">Search</option>
          <option value="local_file">Local ingest</option>
        </select>
      </label>
      <label>
        <span>Topic</span>
        <select id="f-topic"><option value="">All</option></select>
      </label>
      <label class="activity-check">
        <input type="checkbox" id="f-errors" />
        <span>Errors only</span>
      </label>
    </div>

    <div class="activity-table-wrap" id="activity-table">
      <div class="empty-state">loading…</div>
    </div>

    <div class="pager" id="activity-pager"></div>
  `;

  // Populate topic filter.
  try {
    const topics = await api.listTopics();
    if (Array.isArray(topics) && topics.length) {
      const sel = root.querySelector('#f-topic');
      topics.forEach(t => {
        const o = document.createElement('option');
        o.value = t.topic; o.textContent = t.topic;
        sel.appendChild(o);
      });
    }
  } catch {}

  const refresh = () => {
    loadPage(root);
    loadSpark(root);
    checkLive(root);
  };

  root.querySelector('#btn-activity-refresh').onclick = refresh;
  root.querySelector('#f-kind').onchange   = e => { state.kind = e.target.value;   state.page = 0; loadPage(root); };
  root.querySelector('#f-topic').onchange  = e => { state.topic = e.target.value;  state.page = 0; loadPage(root); };
  root.querySelector('#f-errors').onchange = e => { state.errorsOnly = e.target.checked; state.page = 0; loadPage(root); };

  // Live poll: if a collect is running (ended_at IS NULL), refresh every 4s.
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    try {
      const rows = await api.runQuery(
        `SELECT 1 FROM fetches WHERE ended_at IS NULL LIMIT 1`
      );
      const pill = root.querySelector('#activity-live-pill');
      if (Array.isArray(rows) && rows.length) {
        if (pill) pill.hidden = false;
        loadPage(root); loadSpark(root);
      } else {
        if (pill) pill.hidden = true;
      }
    } catch {}
  }, 4000);

  // Also refresh immediately when the DB-mtime poller detects an external
  // write — covers the case where the user ran `reddit-cli` manually or an
  // MCP server client wrote while we're on this page.
  const dbChangedListener = () => {
    if (document.visibilityState !== 'visible') return;
    loadPage(root); loadSpark(root); checkLive(root);
  };
  window.addEventListener('gapmap:db-changed', dbChangedListener);

  window.addEventListener('hashchange', function once() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    window.removeEventListener('gapmap:db-changed', dbChangedListener);
    window.removeEventListener('hashchange', once);
  });

  await refresh();
}

async function loadSpark(root) {
  const el = root.querySelector('#activity-spark');
  if (!el) return;
  try {
    const rows = await api.runQuery(
      `SELECT substr(started_at,1,10) AS day, count(*) AS n, \
              sum(CASE WHEN error IS NOT NULL AND error <> '' THEN 1 ELSE 0 END) AS errs \
       FROM fetches WHERE substr(started_at,1,10) >= date('now','-29 days') \
       GROUP BY substr(started_at,1,10) ORDER BY day ASC`
    );
    const map = {}; (rows || []).forEach(r => { map[r.day] = r; });
    const today = new Date();
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ day: key, n: map[key]?.n || 0, errs: map[key]?.errs || 0 });
    }
    const max = Math.max(1, ...days.map(d => d.n));
    const total = days.reduce((a, d) => a + d.n, 0);
    el.innerHTML = `
      <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:8px">
        <b style="color:var(--ink-1);font-size:13px">${total}</b> fetches · last 30 days
      </div>
      <div class="spark-bars">
        ${days.map(d => {
          const pct = Math.max(4, Math.round((d.n / max) * 100));
          const hasErr = d.errs > 0;
          return `<div class="spark-bar ${hasErr ? 'err' : ''}"
                       style="height:${pct}%"
                       title="${esc(d.day)}: ${d.n} fetches${hasErr ? ` · ${d.errs} errors` : ''}"></div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
  }
}

async function checkLive(root) {
  try {
    const rows = await api.runQuery(`SELECT 1 FROM fetches WHERE ended_at IS NULL LIMIT 1`);
    const pill = root.querySelector('#activity-live-pill');
    if (pill) pill.hidden = !(Array.isArray(rows) && rows.length);
  } catch {}
}

async function loadPage(root) {
  state.loading = true;
  const tbl = root.querySelector('#activity-table');
  tbl.innerHTML = `<div class="empty-state">loading…</div>`;

  const wheres = [];
  if (state.kind) {
    if (state.kind.endsWith(':')) {
      // "source:" → any source adapter
      wheres.push(`kind LIKE '${state.kind.replace("'", "''")}%'`);
    } else {
      wheres.push(`kind='${state.kind.replace("'", "''")}'`);
    }
  }
  if (state.topic) {
    wheres.push(`params_json LIKE '%"topic":"${state.topic.replace("'", "''").replace('"', '\\"')}"%'`);
  }
  if (state.errorsOnly) wheres.push(`error IS NOT NULL AND error <> ''`);
  const where = wheres.length ? ` WHERE ${wheres.join(' AND ')}` : '';

  const countSql = `SELECT count(*) AS n FROM fetches${where}`;
  const listSql  = `SELECT kind, params_json, started_at, ended_at, rows, error \
                    FROM fetches${where} \
                    ORDER BY started_at DESC \
                    LIMIT ${PAGE_SIZE} OFFSET ${state.page * PAGE_SIZE}`;

  try {
    const [countRes, rowsRes] = await Promise.all([
      api.runQuery(countSql),
      api.runQuery(listSql),
    ]);
    state.totalCount = Array.isArray(countRes) && countRes[0] ? (countRes[0].n || 0) : 0;
    state.rows = Array.isArray(rowsRes) ? rowsRes : [];
    renderTable(root);
  } catch (e) {
    tbl.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
  }
  state.loading = false;
}

function renderTable(root) {
  const tbl = root.querySelector('#activity-table');
  if (!state.rows.length) {
    tbl.innerHTML = `<div class="empty-big"><h3>No matches</h3><p>Try adjusting filters, or start a topic from the dashboard.</p></div>`;
    root.querySelector('#activity-pager').innerHTML = '';
    return;
  }
  tbl.innerHTML = `
    <table class="activity-table">
      <thead>
        <tr>
          <th>Kind</th>
          <th>Params</th>
          <th>Started</th>
          <th>Duration</th>
          <th style="text-align:right">Rows</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${state.rows.map(r => activityRow(r)).join('')}
      </tbody>
    </table>
  `;

  const from = state.page * PAGE_SIZE + 1;
  const to = Math.min((state.page + 1) * PAGE_SIZE, state.totalCount);
  root.querySelector('#activity-sub').textContent =
    `Showing ${from}–${to} of ${state.totalCount}${filterSummary() ? ` · ${filterSummary()}` : ''}`;

  // Pager
  const pages = Math.ceil(state.totalCount / PAGE_SIZE);
  const pager = root.querySelector('#activity-pager');
  if (pages <= 1) { pager.innerHTML = ''; return; }
  pager.innerHTML = `
    <button class="btn btn-ghost" style="border:1px solid var(--line);padding:8px 14px;font-size:12px" ${state.page === 0 ? 'disabled' : ''}>← Previous</button>
    <span style="color:var(--ink-3);font-size:12px">Page ${state.page + 1} of ${pages}</span>
    <button class="btn btn-ghost" style="border:1px solid var(--line);padding:8px 14px;font-size:12px" ${state.page >= pages - 1 ? 'disabled' : ''}>Next →</button>
  `;
  const [prev, _mid, next] = pager.querySelectorAll('button, span');
  prev.onclick = () => { state.page = Math.max(0, state.page - 1); loadPage(root); };
  next.onclick = () => { state.page = Math.min(pages - 1, state.page + 1); loadPage(root); };
}

function filterSummary() {
  const parts = [];
  if (state.kind) parts.push(`kind=${state.kind}`);
  if (state.topic) parts.push(`topic=${state.topic}`);
  if (state.errorsOnly) parts.push(`errors only`);
  return parts.join(' · ');
}

function activityRow(r) {
  const { kind, params_json, started_at, ended_at, rows, error } = r;
  let params = {};
  try { params = JSON.parse(params_json || '{}'); } catch {}
  const paramSummary = Object.entries(params)
    .slice(0, 3)
    .map(([k, v]) => `${esc(k)}=${esc(String(v).slice(0, 40))}`)
    .join(' · ') || '—';
  const running = !ended_at && !error;
  const dur = (() => {
    try {
      if (!started_at) return '—';
      if (running) {
        const s = new Date(started_at).getTime();
        if (!isFinite(s)) return '—';
        const secs = Math.max(0, Math.floor((Date.now() - s) / 1000));
        if (secs < 60) return `${secs}s…`;
        if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s…`;
        return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m…`;
      }
      if (!ended_at) return '—';
      const s = new Date(started_at).getTime();
      const e = new Date(ended_at).getTime();
      if (!isFinite(s) || !isFinite(e) || e < s) return '—';
      const secs = Math.floor((e - s) / 1000);
      if (secs < 60) return `${secs}s`;
      if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
      return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
    } catch { return '—'; }
  })();
  const statusPill = error
    ? `<span class="pill" style="background:var(--rose-soft);color:#B84747">✗ error</span>`
    : running
      ? `<span class="pill pill-running"><span class="pulse-dot sm"></span> running</span>`
      : `<span class="pill active">✓ ok</span>`;
  return `
    <tr>
      <td><span class="cell-kind">${esc(kind)}</span></td>
      <td><span class="cell-params">${paramSummary}</span></td>
      <td>${esc(timeAgo(started_at))}</td>
      <td>${esc(dur)}</td>
      <td style="text-align:right">${rows || 0}</td>
      <td>${statusPill}${error ? `<div class="cell-err">${esc(String(error).slice(0, 80))}</div>` : ''}</td>
    </tr>
  `;
}
