// Tactics tab — maps each of the topic's painpoints to persuasion tactics.
// For every painpoint mined into the gap map, the tactic library matches the
// best-fit persuasion / messaging tactics (token-overlap + Chroma semantic
// search). Pure read: reads research/tactic_library.py::tactics_for_topic via
// tactics_get. Build the gap map (painpoints) first; this surface ranks how to
// *talk about* each gap, not which gap to pursue (see Prioritize for that).
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function fmtScore(t) {
  const v = t && t.score;
  if (v == null || v === '') return '<span class="muted">—</span>';
  const n = Number(v);
  return Number.isFinite(n) ? `<strong>${esc(n.toFixed(2))}</strong>` : esc(String(v));
}

function sourceOf(t) {
  // Surface whichever provenance field is present.
  const src = (t && (t.framework || t.match_method || t.source)) || '';
  return src ? `<span class="muted">${esc(String(src))}</span>` : '<span class="muted">—</span>';
}

function tacticRow(t) {
  const name = (t && (t.name || t.title || t.slug)) || '';
  const desc = (t && (t.description || t.when_to_use)) || '';
  return `<tr>
      <td><strong>${esc(name)}</strong></td>
      <td class="muted">${desc ? esc(desc) : '—'}</td>
      <td style="text-align:right">${fmtScore(t)}</td>
      <td style="text-align:center">${sourceOf(t)}</td>
    </tr>`;
}

function painpointSection(pp) {
  const tactics = (pp && pp.tactics) || [];
  if (!tactics.length) return '';
  return `
    <section style="margin-bottom:22px">
      <h3 style="margin:0 0 8px">${esc(pp.painpoint || '')}</h3>
      <table class="data-table" style="width:100%">
        <thead><tr>
          <th>Tactic</th><th>Description</th>
          <th style="text-align:right">Score</th>
          <th style="text-align:center">Source</th>
        </tr></thead>
        <tbody>${tactics.map(tacticRow).join('')}</tbody>
      </table>
    </section>`;
}

export async function loadTactics(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'tactics';

  const render = (data) => {
    if (!alive()) return;
    const painpoints = ((data && data.painpoints) || []).filter(
      (pp) => pp && (pp.tactics || []).length,
    );
    const librarySize = (data && data.library_size) || 0;
    const tacticCount = (data && data.tactic_count) || 0;

    if (!painpoints.length) {
      contentEl.innerHTML = `<div class="empty-big">
        <h3>No tactics to match yet</h3>
        <p>Tactics map each <b>painpoint</b> in your gap map to the best-fit
        persuasion / messaging tactic. Build the gap map first so there are
        painpoints to match against, then return here.</p>
        <button class="btn btn-primary btn-sm" id="go-solutions">Go to Solutions →</button>
      </div>`;
      contentEl.querySelector('#go-solutions')?.addEventListener('click', () => {
        document.querySelector('.tab[data-tab="solutions"]')?.click();
      });
      return;
    }

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div><strong>Tactics by painpoint</strong>
          <span class="muted">· ${painpoints.length} painpoint${painpoints.length === 1 ? '' : 's'}
          · ${tacticCount} tactic${tacticCount === 1 ? '' : 's'} matched
          · library of ${librarySize}</span></div>
      </div>
      <p class="muted" style="font-size:12.5px;margin:0 0 14px">
        Each painpoint is matched against the tactic library (token-overlap +
        semantic search). Use these to shape how you <b>message</b> the gap —
        see <b>Prioritize</b> for which gap to pursue.
      </p>
      ${painpoints.map(painpointSection).join('')}`;
    window.refreshIcons?.();
  };

  contentEl.innerHTML = '<div class="empty-state">Loading tactics…</div>';
  try {
    render(await api.tacticsGet(topic));
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load tactics</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
