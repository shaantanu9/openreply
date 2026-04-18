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

let state = {
  activeTable: null,
  lastQuery: '',
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
          <textarea id="db-sql"
            placeholder="SELECT * FROM graph_nodes WHERE kind='painpoint' LIMIT 50;"
            spellcheck="false"></textarea>
          <div class="db-query-actions">
            <button class="btn btn-primary" id="btn-run-query">Run</button>
            <span class="db-hint">⌘/Ctrl + Enter runs</span>
            <div style="flex:1"></div>
            <span id="db-query-meta" class="db-hint"></span>
          </div>
          <div class="db-query-result" id="db-query-result">
            <div class="empty-state">Type a query above.</div>
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
  const runQuery = async () => {
    const sql = sqlEl.value.trim();
    if (!sql) return;
    state.lastQuery = sql;
    const out = root.querySelector('#db-query-result');
    const meta = root.querySelector('#db-query-meta');
    out.innerHTML = `<div class="empty-state">running…</div>`;
    meta.textContent = '';
    const t0 = performance.now();
    try {
      const rows = await api.runQuery(sql);
      const ms = Math.round(performance.now() - t0);
      meta.textContent = `${Array.isArray(rows) ? rows.length : 0} rows · ${ms}ms`;
      renderResult(out, rows);
    } catch (e) {
      out.innerHTML = `<div class="db-error">✗ ${esc(e?.message || e)}</div>`;
    }
  };
  runBtn.onclick = runQuery;
  sqlEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
  });
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
  return `
    <div class="db-rows-wrap">
      <table class="db-rows">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${fmtCell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

function fmtCell(v) {
  if (v == null) return '<span class="db-null">NULL</span>';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return esc(s.length > 240 ? s.slice(0, 240) + '…' : s);
}
