// Provenance & Audit panel.
// Shows quality-gate entries (checks_ledger) and artifact lineage (lineage)
// for the currently selected topic. Read-only.

import { api, esc } from '../api.js';
import { skelRows } from '../lib/skeleton.js';

// Render a plain object array as an HTML table.
function renderTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<p class="muted" style="padding:8px 0">No rows.</p>';
  }
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows.map((r) =>
    `<tr>${cols.map((c) => {
      const v = r[c];
      const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      return `<td>${esc(s.length > 200 ? s.slice(0, 200) + '…' : s)}</td>`;
    }).join('')}</tr>`
  ).join('');
  return `
    <div class="prov-table-wrap">
      <table class="prov-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export async function renderProvenance(root, topic) {
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Provenance &amp; Audit</strong>${topic ? ` / ${esc(topic)}` : ''}</div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>Provenance &amp; Audit</h2>
        <p>Quality-gate log and artifact lineage${topic ? ` for <b>${esc(topic)}</b>` : ' — select a topic to filter'}.</p>
      </div>
    </div>

    <div style="padding:0 20px 32px">
      <div class="prov-section-head">Recent runs</div>
      <div id="prov-runs">${skelRows(4)}</div>

      <div class="prov-section-head" style="margin-top:24px">Quality gates (checks_ledger)</div>
      <div id="prov-checks">${skelRows(4)}</div>

      <div class="prov-section-head" style="margin-top:24px">Artifact lineage (lineage)</div>
      <div id="prov-lineage">${skelRows(4)}</div>
    </div>
  `;

  if (!topic) {
    root.querySelector('#prov-runs').innerHTML =
      '<p class="muted" style="padding:8px 0">No topic selected. Open a topic first, then navigate here.</p>';
    root.querySelector('#prov-checks').innerHTML = '';
    root.querySelector('#prov-lineage').innerHTML = '';
    return;
  }

  // Fetch runs, checks and lineage in parallel.
  let runs = [];
  let checks = [];
  let lineage = [];
  try {
    [runs, checks, lineage] = await Promise.all([
      api.runQuery(
        `SELECT run_id, max(topic) AS topic, count(*) AS n_checks, sum(passed) AS n_passed, max(ts) AS last_ts FROM checks_ledger WHERE run_id IS NOT NULL AND run_id != '' GROUP BY run_id ORDER BY last_ts DESC LIMIT 50`,
        topic,
      ),
      api.runQuery(
        `SELECT * FROM checks_ledger WHERE topic = '${topic.replace(/'/g, "''")}' ORDER BY id DESC LIMIT 200`,
      ),
      api.runQuery(
        `SELECT * FROM lineage WHERE topic = '${topic.replace(/'/g, "''")}' ORDER BY id DESC LIMIT 200`,
      ),
    ]);
  } catch (e) {
    if (!alive()) return;
    root.querySelector('#prov-runs').innerHTML =
      `<p class="muted">Error loading provenance: ${esc(e?.message || String(e))}</p>`;
    root.querySelector('#prov-checks').innerHTML = '';
    root.querySelector('#prov-lineage').innerHTML = '';
    return;
  }

  if (!alive()) return;

  // Render runs table with abbreviated run_id (first 8 chars).
  const runsDisplay = runs.map((r) => ({
    run_id: r.run_id ? String(r.run_id).slice(0, 8) : '',
    topic: r.topic,
    checks: `${r.n_passed}/${r.n_checks}`,
    last_ts: r.last_ts,
  }));
  root.querySelector('#prov-runs').innerHTML = renderTable(runsDisplay);
  root.querySelector('#prov-checks').innerHTML = renderTable(checks);
  root.querySelector('#prov-lineage').innerHTML = renderTable(lineage);
}
