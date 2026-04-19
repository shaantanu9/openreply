// Read-only DB console. Pick a table → see count + first 50 rows.
// Or type an ad-hoc SELECT / WITH query and run it.
// The underlying Rust command rejects anything that isn't read-only.

import { api, esc } from '../api.js';

const SAMPLE_LIMIT = 50;

const CURATED_TABLES = [
  { name: 'posts',         desc: 'All fetched posts across sources (reddit, HN, app stores, arXiv, etc.)' },
  { name: 'topic_posts',   desc: 'Per-topic tags that link posts to a research topic' },
  { name: 'graph_nodes',   desc: 'Nodes in the gap map — subs, threads, people, painpoints, features, products' },
  { name: 'graph_edges',   desc: 'Edges between graph nodes (posted_in, authored, evidenced_by, etc.)' },
  { name: 'fetches',       desc: 'Every pipeline invocation with duration, row count, and errors' },
];

const PRESET_QUERIES = [
  { label: 'Top subs across all topics',    sql: `SELECT sub AS subreddit, count(*) AS posts FROM posts WHERE sub IS NOT NULL AND sub <> '' GROUP BY sub ORDER BY posts DESC LIMIT 20` },
  { label: 'Post volume by source',         sql: `SELECT coalesce(source_type,'reddit') AS source, count(*) AS n FROM posts GROUP BY coalesce(source_type,'reddit') ORDER BY n DESC` },
  { label: 'Painpoints with most evidence', sql: `SELECT n.topic, n.label, (SELECT count(*) FROM graph_edges e WHERE e.topic=n.topic AND (e.src=n.id OR e.dst=n.id)) AS evidence FROM graph_nodes n WHERE n.kind='painpoint' ORDER BY evidence DESC LIMIT 20` },
  { label: 'Failed fetches (last 7d)',      sql: `SELECT kind, error, started_at FROM fetches WHERE error IS NOT NULL AND substr(started_at,1,10) >= date('now','-7 days') ORDER BY started_at DESC LIMIT 30` },
  { label: 'Topic volume last 30 days',     sql: `SELECT topic, count(*) AS new_posts FROM topic_posts WHERE substr(added_at,1,10) >= date('now','-29 days') GROUP BY topic ORDER BY new_posts DESC` },
  { label: 'Longest collect runs',          sql: `SELECT kind, params_json, started_at, ended_at, rows FROM fetches WHERE ended_at IS NOT NULL ORDER BY (julianday(ended_at) - julianday(started_at)) DESC LIMIT 15` },
];

let state = {
  activeTable: null,
  lastQuery: '',
  lastRows: [],
};

export async function renderDatabase(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Database</strong></div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div><h2>Database console</h2><p>SQLite browser — read-only. Only SELECT / WITH / PRAGMA / EXPLAIN allowed.</p></div>
    </div>

    <div class="db-grid">
      <aside class="db-tables">
        <h4>Tables</h4>
        <div class="db-table-list" id="db-table-list">
          <div class="empty-state" style="padding:14px">loading…</div>
        </div>
      </aside>

      <section class="db-main">
        <div class="db-tabs">
          <button class="db-tab active" data-mode="browse">Browse table</button>
          <button class="db-tab" data-mode="query">Run SQL</button>
        </div>

        <div class="db-pane" id="db-pane-browse">
          <div class="empty-state">← Pick a table</div>
        </div>

        <div class="db-pane hidden" id="db-pane-query">
          <div class="db-presets">
            <span class="db-presets-label">Presets:</span>
            ${PRESET_QUERIES.map((p, i) => `
              <button class="db-preset-btn" data-idx="${i}">${esc(p.label)}</button>
            `).join('')}
          </div>
          <textarea id="db-sql"
            placeholder="SELECT * FROM graph_nodes WHERE kind='painpoint' LIMIT 50;"
            spellcheck="false"></textarea>
          <div class="db-query-actions">
            <button class="btn btn-primary" id="btn-run-query">Run</button>
            <span class="db-hint">⌘/Ctrl + Enter runs</span>
            <div style="flex:1"></div>
            <span id="db-query-meta" class="db-hint"></span>
            <button class="btn btn-ghost btn-xs btn-bordered icon-btn" id="btn-csv" hidden><i data-lucide="download"></i> CSV</button>
          </div>
          <div class="db-query-result" id="db-query-result">
            <div class="empty-state">Type a query above, or click a preset.</div>
          </div>
        </div>
      </section>
    </div>
  `;

  renderTableList(root);

  // Tab toggle
  root.querySelectorAll('.db-tab').forEach(t => {
    t.addEventListener('click', () => {
      root.querySelectorAll('.db-tab').forEach(x => x.classList.toggle('active', x === t));
      root.querySelector('#db-pane-browse').classList.toggle('hidden', t.dataset.mode !== 'browse');
      root.querySelector('#db-pane-query').classList.toggle('hidden',  t.dataset.mode !== 'query');
    });
  });

  // Wire SQL runner
  const sqlEl = root.querySelector('#db-sql');
  const runBtn = root.querySelector('#btn-run-query');
  const csvBtn = root.querySelector('#btn-csv');
  const runQuery = async () => {
    const sql = sqlEl.value.trim();
    if (!sql) return;
    state.lastQuery = sql;
    const out = root.querySelector('#db-query-result');
    const meta = root.querySelector('#db-query-meta');
    out.innerHTML = `<div class="empty-state">running…</div>`;
    meta.textContent = '';
    csvBtn.hidden = true;
    const t0 = performance.now();
    try {
      const rows = await api.runQuery(sql);
      const ms = Math.round(performance.now() - t0);
      meta.textContent = `${Array.isArray(rows) ? rows.length : 0} rows · ${ms}ms`;
      state.lastRows = Array.isArray(rows) ? rows : [];
      renderResult(out, state.lastRows);
      if (state.lastRows.length) csvBtn.hidden = false;
    } catch (e) {
      // Parse sqlite's "near \"X\": syntax error" format into a friendlier
      // two-line error with the offending token highlighted.
      const raw = String(e?.message || e);
      const nearMatch = raw.match(/near\s+"([^"]+)"/i);
      const restart  = raw.match(/line\s+(\d+)/i);
      const hint = [];
      if (nearMatch) hint.push(`offending token: <code>${esc(nearMatch[1])}</code>`);
      if (restart)   hint.push(`line ${esc(restart[1])}`);
      const hintHtml = hint.length
        ? `<div style="font-size:12px;color:var(--ink-3);margin-top:6px">${hint.join(' · ')}</div>`
        : '';
      // Gentle nudge toward the most common mistake in this read-only console.
      const ro = /only SELECT|forbidden keyword/i.test(raw)
        ? `<div style="font-size:12px;color:var(--ink-3);margin-top:6px">This console is read-only (SELECT / WITH / PRAGMA / EXPLAIN). Mutations are blocked on purpose.</div>`
        : '';
      out.innerHTML = `<div class="db-error">✗ ${esc(raw)}${hintHtml}${ro}</div>`;
    }
  };
  runBtn.onclick = runQuery;
  sqlEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
  });
  // Preset chips
  root.querySelectorAll('.db-preset-btn').forEach(b => {
    b.onclick = () => {
      const p = PRESET_QUERIES[Number(b.dataset.idx)];
      if (!p) return;
      sqlEl.value = p.sql;
      runQuery();
    };
  });
  csvBtn.onclick = () => exportCsv(state.lastRows);
}

async function renderTableList(root) {
  const list = root.querySelector('#db-table-list');

  // Get counts for curated tables in a single query.
  const countSql = CURATED_TABLES
    .map(t => `(SELECT count(*) FROM ${t.name}) AS ${t.name}`)
    .join(', ');
  let counts = {};
  try {
    const res = await api.runQuery(`SELECT ${countSql}`);
    if (Array.isArray(res) && res[0]) counts = res[0];
  } catch {}

  list.innerHTML = CURATED_TABLES.map(t => `
    <button class="db-table-btn" data-table="${esc(t.name)}">
      <div class="db-table-name">${esc(t.name)}</div>
      <div class="db-table-count">${counts[t.name] != null ? counts[t.name].toLocaleString() : '—'} rows</div>
      <div class="db-table-desc">${esc(t.desc)}</div>
    </button>
  `).join('');

  list.querySelectorAll('.db-table-btn').forEach(b => {
    b.onclick = () => {
      list.querySelectorAll('.db-table-btn').forEach(x => x.classList.toggle('active', x === b));
      browseTable(root, b.dataset.table);
    };
  });
}

async function browseTable(root, table) {
  state.activeTable = table;
  root.querySelectorAll('.db-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === 'browse'));
  root.querySelector('#db-pane-browse').classList.remove('hidden');
  root.querySelector('#db-pane-query').classList.add('hidden');

  const pane = root.querySelector('#db-pane-browse');
  pane.innerHTML = `<div class="empty-state">loading ${esc(table)}…</div>`;

  try {
    const [countRes, sampleRes, schemaRes] = await Promise.all([
      api.runQuery(`SELECT count(*) AS n FROM ${table}`),
      api.runQuery(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ${SAMPLE_LIMIT}`),
      api.runQuery(`PRAGMA table_info(${table})`),
    ]);
    const count = Array.isArray(countRes) && countRes[0] ? countRes[0].n : 0;
    const rows  = Array.isArray(sampleRes) ? sampleRes : [];
    const schema = Array.isArray(schemaRes) ? schemaRes : [];

    pane.innerHTML = `
      <div class="db-table-head">
        <div>
          <h3>${esc(table)}</h3>
          <p>${count.toLocaleString()} rows total · showing latest ${rows.length}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" style="border:1px solid var(--line);padding:8px 14px;font-size:12px" id="btn-query-this">Query this table →</button>
        </div>
      </div>
      <details class="db-schema" ${schema.length ? '' : 'hidden'}>
        <summary>Schema (${schema.length} columns)</summary>
        <div class="db-schema-cols">${schema.map(c => `
          <div class="db-schema-col">
            <span class="db-col-name">${esc(c.name)}</span>
            <span class="db-col-type">${esc(c.type || '')}</span>
            ${c.pk ? '<span class="db-col-pk">pk</span>' : ''}
            ${c.notnull ? '<span class="db-col-nn">not null</span>' : ''}
          </div>
        `).join('')}</div>
      </details>
      ${rows.length ? renderRowsTable(rows) : `<div class="empty-state">(empty)</div>`}
    `;

    pane.querySelector('#btn-query-this')?.addEventListener('click', () => {
      root.querySelector('#db-sql').value = `SELECT * FROM ${table} LIMIT 50;`;
      root.querySelectorAll('.db-tab').forEach(x => x.classList.toggle('active', x.dataset.mode === 'query'));
      root.querySelector('#db-pane-browse').classList.add('hidden');
      root.querySelector('#db-pane-query').classList.remove('hidden');
    });
  } catch (e) {
    pane.innerHTML = `<div class="db-error">Error loading ${esc(table)}: ${esc(e?.message || e)}</div>`;
  }
}

function renderResult(out, rows) {
  if (!Array.isArray(rows)) {
    out.innerHTML = `<div class="empty-state">Unexpected non-array response: ${esc(JSON.stringify(rows).slice(0, 200))}</div>`;
    return;
  }
  if (rows.length === 0) { out.innerHTML = `<div class="empty-state">0 rows.</div>`; return; }
  out.innerHTML = renderRowsTable(rows);
}

function renderRowsTable(rows) {
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const html = `
    <div class="db-rows-wrap">
      <table class="db-rows">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr data-row-idx="${i}">${cols.map(c => `<td>${fmtCell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
  // Stash rows so the click handler can find them (re-queried in openRowModal via closure)
  setTimeout(() => {
    document.querySelectorAll('.db-rows tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.dataset.rowIdx);
        if (!isNaN(idx) && rows[idx]) openRowModal(rows[idx]);
      });
    });
  }, 0);
  return html;
}

function fmtCell(v) {
  if (v == null) return '<span class="db-null">NULL</span>';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return esc(s.length > 240 ? s.slice(0, 240) + '…' : s);
}

function openRowModal(row) {
  const modal = document.createElement('div');
  modal.className = 'byok-backdrop';
  const body = Object.entries(row).map(([k, v]) => {
    let val = v == null ? 'NULL' : (typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));
    // Try to pretty-print JSON columns
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      try { val = JSON.stringify(JSON.parse(v), null, 2); } catch {}
    }
    return `
      <div class="row-field">
        <label>${esc(k)}</label>
        <pre class="row-value">${esc(val)}</pre>
      </div>`;
  }).join('');
  modal.innerHTML = `
    <div class="byok-dialog" style="max-width:720px">
      <div class="byok-head">
        <h3>Row detail</h3>
        <button class="byok-close"><i data-lucide="x"></i></button>
      </div>
      <div style="max-height:70vh;overflow-y:auto">${body}</div>
      <div class="byok-foot">
        <button class="btn btn-ghost icon-btn" id="row-copy-json" style="border:1px solid var(--line);padding:7px 12px;font-size:12px"><i data-lucide="copy"></i> Copy JSON</button>
        <div style="flex:1"></div>
        <button class="btn btn-ghost" id="row-close" style="border:1px solid var(--line);padding:7px 12px;font-size:12px">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  window.refreshIcons?.();
  const close = () => { modal.remove(); document.removeEventListener('keydown', escH); };
  modal.querySelector('.byok-close').onclick = close;
  modal.querySelector('#row-close').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#row-copy-json').onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    const b = modal.querySelector('#row-copy-json');
    b.innerHTML = '<i data-lucide="check"></i> copied';
    window.refreshIcons?.();
    setTimeout(() => { b.innerHTML = '<i data-lucide="copy"></i> Copy JSON'; window.refreshIcons?.(); }, 1400);
  };
  function escH(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', escH);
}

function exportCsv(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const escape = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => escape(r[c])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gapmap-query-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
}
