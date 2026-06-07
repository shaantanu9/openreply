// Literature-review matrix — the classic PhD comparison grid for a topic.
//
// Rows = papers; columns = method · dataset · sample · findings · limitations ·
// metric (LLM-extracted, cached server-side). Reached via #/lit-matrix/<topic>.
// Filter by text, sort by any column, build missing rows, export CSV.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const FIELDS = ['method', 'dataset', 'sample', 'findings', 'limitations', 'metric'];

export async function renderLitMatrix(main, { params } = {}) {
  const topic = decodeURIComponent((params && params[0]) || '');
  let sortKey = 'title';
  let sortDir = 1;
  let filter = '';
  let rows = [];

  main.innerHTML = `
    <div class="screen" style="max-width:1280px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="lm-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="table" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Literature matrix</h2>
        <span class="muted" style="font-size:12.5px">${esc(topic)}</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 12px">
        One structured row per paper — method, data, sample, findings, limitations, metric. Build extracts from each paper's full text.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <input id="lm-filter" type="search" placeholder="Filter rows…" style="flex:1 1 240px;min-width:0;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px" />
        <button class="btn btn-primary btn-sm" id="lm-build" type="button"><i data-lucide="sparkles"></i> Build / refresh</button>
        <button class="btn btn-sm btn-bordered" id="lm-csv" type="button"><i data-lucide="download"></i> Export CSV</button>
      </div>
      <div id="lm-status" class="muted" style="font-size:12px;margin-bottom:8px"></div>
      <div id="lm-table-slot"><div class="muted" style="font-size:12.5px">Loading…</div></div>
    </div>`;
  window.refreshIcons?.();

  const slot = main.querySelector('#lm-table-slot');
  const statusEl = main.querySelector('#lm-status');
  main.querySelector('#lm-back')?.addEventListener('click', () => history.back());

  const renderTable = () => {
    let view = rows;
    if (filter) {
      const f = filter.toLowerCase();
      view = rows.filter(r => (r.title + ' ' + FIELDS.map(k => r[k] || '').join(' ')).toLowerCase().includes(f));
    }
    view = [...view].sort((a, b) => {
      const av = String(a[sortKey] ?? '').toLowerCase();
      const bv = String(b[sortKey] ?? '').toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
    if (!rows.length) {
      slot.innerHTML = `<div class="empty-big" style="padding:24px;text-align:center">
        <h3>No matrix yet</h3>
        <p class="muted" style="font-size:13px">Click <b>Build / refresh</b> to extract a comparison row from each paper's full text.</p></div>`;
      return;
    }
    const arrow = (k) => sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    const th = (k, label) => `<th data-sort="${k}" style="text-align:left;padding:7px 9px;border-bottom:2px solid var(--line);cursor:pointer;white-space:nowrap;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">${esc(label)}${arrow(k)}</th>`;
    slot.innerHTML = `
      <div style="overflow:auto;border:1px solid var(--line);border-radius:10px">
      <table style="border-collapse:collapse;width:100%;font-size:12.5px">
        <thead><tr>
          ${th('title', 'Paper')}
          ${FIELDS.map(f => th(f, f)).join('')}
        </tr></thead>
        <tbody>
          ${view.map(r => `<tr style="border-bottom:1px solid var(--line)">
            <td style="padding:7px 9px;vertical-align:top;min-width:180px;max-width:240px">
              <a href="#/reader/${encodeURIComponent(r.post_id)}" style="text-decoration:none;color:var(--accent,#5B8DB8);font-weight:600">${esc((r.title || 'Untitled').slice(0, 90))}</a>
              ${r.content_tier === 'abstract' || r.content_tier === 'title_only' ? '<div class="muted" style="font-size:10.5px;margin-top:2px">abstract only</div>' : ''}
            </td>
            ${FIELDS.map(f => `<td style="padding:7px 9px;vertical-align:top;min-width:130px;max-width:220px">${esc(r[f] || '')}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">${view.length} of ${rows.length} papers${filter ? ' (filtered)' : ''}</div>`;
    slot.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
        renderTable();
      });
    });
  };

  const load = async () => {
    try {
      const r = await api.litMatrixGet(topic);
      rows = (r && r.rows) || [];
    } catch (e) {
      slot.innerHTML = `<div class="muted" style="font-size:12.5px;color:#B84747">${esc(e?.message || e)}</div>`;
      return;
    }
    renderTable();
    window.refreshIcons?.();
  };

  main.querySelector('#lm-filter')?.addEventListener('input', (e) => { filter = e.target.value; renderTable(); });

  main.querySelector('#lm-build')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> building…';
    statusEl.textContent = 'Extracting matrix rows from papers (LLM)… building the next batch (up to 25).';
    window.refreshIcons?.();
    try {
      // Bounded per click so a big topic doesn't fire hundreds of LLM calls;
      // the backend is progressive (only papers without a row), so clicking
      // again builds the next batch.
      const r = await api.litMatrixBuild(topic, { limit: 25 });
      if (r?.ok) {
        const rem = r.remaining ?? 0;
        statusEl.textContent = `Built ${r.built} new${r.errored ? `, ${r.errored} skipped` : ''}.`
          + (rem > 0 ? ` ${rem} more papers remain — click Build again to continue.` : ' Matrix complete for this project.');
      } else {
        statusEl.textContent = `Build failed: ${r?.reason || r?.error || 'unknown'}`;
      }
      await load();
    } catch (err) {
      statusEl.textContent = `Build failed: ${err?.message || err}`;
    } finally {
      btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.();
    }
  });

  main.querySelector('#lm-csv')?.addEventListener('click', async () => {
    try {
      const r = await api.litMatrixExport(topic);
      if (!r?.csv) { statusEl.textContent = 'Nothing to export yet — build the matrix first.'; return; }
      await navigator.clipboard?.writeText(r.csv).catch(() => {});
      statusEl.textContent = `CSV copied to clipboard (${r.count} papers).`;
    } catch (e) {
      statusEl.textContent = `Export failed: ${e?.message || e}`;
    }
  });

  await load();
}
