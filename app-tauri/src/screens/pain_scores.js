// Pain scores — a 0-100 ranked board of a topic's gaps (painpoints).
//
// Each gap is scored frequency × intensity × recency (server-side, cached).
// Reached via #/pain-scores/<topic>. Build (re)computes via the painpoint
// extractor (LLM); default reads the cached scores. Sort, filter, export CSV.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Score → colour band: red (urgent) ≥70, amber 40-69, grey <40.
const band = (n) => (n >= 70 ? '#B84747' : n >= 40 ? '#C08A2D' : '#7A8290');

// Velocity → arrow + colour. `new` and `rising` are green, `falling` red.
const trendChip = (r) => {
  const d = r.direction;
  if (!d || d === 'unknown') return '<span class="muted" style="font-size:11px">—</span>';
  const map = {
    new: ['NEW', '▲', '#3E8E5A'], rising: ['▲', '▲', '#3E8E5A'],
    falling: ['▼', '▼', '#B84747'], flat: ['flat', '', '#7A8290'],
  };
  const [label, , color] = map[d] || ['', '', '#7A8290'];
  const pct = (r.velocity_pct === null || r.velocity_pct === undefined)
    ? (d === 'new' ? '' : '') : ` ${r.velocity_pct > 0 ? '+' : ''}${r.velocity_pct}%`;
  return `<span style="color:${color};font-weight:600;font-size:11.5px">${d === 'new' ? 'NEW' : (d === 'flat' ? 'flat' : (d === 'rising' ? '▲' : '▼') + pct)}</span>`;
};

export async function renderPainScores(main, topicRaw) {
  const topic = decodeURIComponent(topicRaw || '');
  let sortKey = 'pain_score';
  let sortDir = -1;
  let filter = '';
  let rows = [];

  main.innerHTML = `
    <div class="screen" style="max-width:1100px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="ps-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="flame" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Pain scores</h2>
        <span class="muted" style="font-size:12.5px">${esc(topic)}</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 12px">
        Every gap ranked 0-100 by how much it hurts — frequency × intensity × recency. Build what scores highest first.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <input id="ps-filter" type="search" placeholder="Filter gaps…" style="flex:1 1 240px;min-width:0;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px" />
        <button class="btn btn-primary btn-sm" id="ps-build" type="button"><i data-lucide="sparkles"></i> Build / refresh</button>
        <button class="btn btn-sm btn-bordered" id="ps-csv" type="button"><i data-lucide="download"></i> Export CSV</button>
      </div>
      <div id="ps-status" class="muted" style="font-size:12px;margin-bottom:8px"></div>
      <div id="ps-table-slot"><div class="muted" style="font-size:12.5px">Loading…</div></div>
    </div>`;
  window.refreshIcons?.();

  const slot = main.querySelector('#ps-table-slot');
  const statusEl = main.querySelector('#ps-status');
  main.querySelector('#ps-back')?.addEventListener('click', () => history.back());

  const renderTable = () => {
    let view = rows;
    if (filter) {
      const f = filter.toLowerCase();
      view = rows.filter(r => (r.title + ' ' + (r.evidence || '')).toLowerCase().includes(f));
    }
    view = [...view].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const na = typeof av === 'number', nb = typeof bv === 'number';
      if (na && nb) return (av - bv) * sortDir;
      return String(av ?? '').toLowerCase() < String(bv ?? '').toLowerCase() ? -sortDir : sortDir;
    });
    if (!rows.length) {
      slot.innerHTML = `<div class="empty-big" style="padding:24px;text-align:center">
        <h3>No scores yet</h3>
        <p class="muted" style="font-size:13px">Click <b>Build / refresh</b> to score this topic's gaps by frequency, intensity and recency.</p></div>`;
      return;
    }
    const arrow = (k) => sortKey === k ? (sortDir === -1 ? ' ▼' : ' ▲') : '';
    const th = (k, label, align = 'left') => `<th data-sort="${k}" style="text-align:${align};padding:7px 9px;border-bottom:2px solid var(--line);cursor:pointer;white-space:nowrap;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">${esc(label)}${arrow(k)}</th>`;
    slot.innerHTML = `
      <div style="overflow:auto;border:1px solid var(--line);border-radius:10px">
      <table style="border-collapse:collapse;width:100%;font-size:12.5px">
        <thead><tr>
          <th style="padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;width:32px">#</th>
          ${th('pain_score', 'Pain', 'right')}
          ${th('title', 'Gap')}
          ${th('frequency', 'Freq', 'right')}
          ${th('severity', 'Severity')}
          <th style="text-align:left;padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">Trend</th>
          ${th('recency', 'Recency', 'right')}
        </tr></thead>
        <tbody>
          ${view.map((r, i) => `<tr style="border-bottom:1px solid var(--line)">
            <td style="padding:7px 9px;color:var(--muted);font-size:11.5px">${i + 1}</td>
            <td style="padding:7px 9px;text-align:right;vertical-align:top">
              <span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:3px 8px;border-radius:999px;background:${band(r.pain_score)}1a;color:${band(r.pain_score)};font-weight:700;font-size:12.5px">${esc(r.pain_score)}</span>
            </td>
            <td style="padding:7px 9px;vertical-align:top;min-width:220px;max-width:420px">
              <div style="font-weight:600">${esc((r.title || 'Untitled').slice(0, 120))}</div>
              ${r.evidence ? `<div class="muted" style="font-size:11px;margin-top:2px;font-style:italic">“${esc(String(r.evidence).slice(0, 140))}”</div>` : ''}
            </td>
            <td style="padding:7px 9px;text-align:right;vertical-align:top">${esc(r.frequency)}</td>
            <td style="padding:7px 9px;vertical-align:top;text-transform:capitalize">${esc(r.severity || '')}</td>
            <td style="padding:7px 9px;vertical-align:top">${trendChip(r)}</td>
            <td style="padding:7px 9px;text-align:right;vertical-align:top">${esc(Math.round((r.recency || 0) * 100))}%</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">${view.length} of ${rows.length} gaps${filter ? ' (filtered)' : ''}</div>`;
    slot.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = (k === 'title' || k === 'severity') ? 1 : -1; }
        renderTable();
      });
    });
  };

  const load = async () => {
    try {
      const r = await api.gapPainScores(topic);
      rows = (r && r.rows) || [];
    } catch (e) {
      slot.innerHTML = `<div class="muted" style="font-size:12.5px;color:#B84747">${esc(e?.message || e)}</div>`;
      return;
    }
    // Merge trend velocity (best-effort — don't block the board if it fails).
    try {
      const v = await api.gapVelocity(topic, {});
      const byId = {};
      (v?.rows || []).forEach(x => { byId[x.gap_id] = x; });
      rows = rows.map(r => ({ ...r, ...(byId[r.gap_id] ? { direction: byId[r.gap_id].direction, velocity_pct: byId[r.gap_id].velocity_pct } : {}) }));
    } catch { /* velocity is optional */ }
    renderTable();
    window.refreshIcons?.();
  };

  main.querySelector('#ps-filter')?.addEventListener('input', (e) => { filter = e.target.value; renderTable(); });

  main.querySelector('#ps-build')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> scoring…';
    statusEl.textContent = 'Extracting and scoring painpoints (LLM)… this can take a minute.';
    window.refreshIcons?.();
    try {
      const r = await api.gapPainScoresBuild(topic, {});
      statusEl.textContent = r?.ok
        ? `Done — scored ${r.scored} gaps (top ${r.top_score}).`
        : `Build failed: ${r?.error || 'unknown'}`;
      await load();
    } catch (err) {
      statusEl.textContent = `Build failed: ${err?.message || err}`;
    } finally {
      btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.();
    }
  });

  main.querySelector('#ps-csv')?.addEventListener('click', async () => {
    try {
      const r = await api.gapPainScores(topic);
      if (!r?.rows?.length) { statusEl.textContent = 'Nothing to export yet — build the scores first.'; return; }
      const header = 'rank,title,pain_score,frequency,severity,intensity,recency';
      const lines = r.rows.map((x, i) => [i + 1, `"${String(x.title || '').replace(/"/g, '""')}"`,
        x.pain_score, x.frequency, x.severity, x.intensity, x.recency].join(','));
      await navigator.clipboard?.writeText([header, ...lines].join('\n')).catch(() => {});
      statusEl.textContent = `CSV copied to clipboard (${r.rows.length} gaps).`;
    } catch (e) {
      statusEl.textContent = `Export failed: ${e?.message || e}`;
    }
  });

  await load();
}
