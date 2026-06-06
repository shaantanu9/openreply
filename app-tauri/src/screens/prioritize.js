// Prioritize tab — the "which gap do I pursue?" decision surface.
// Ranks the topic's interventions (candidate solutions) by RICE
// (Reach·Impact·Confidence ÷ Effort), tagged Kano + MoSCoW, joined to the
// painpoint each addresses. Reads research/prioritize.py via prioritize_get;
// "Score all" runs RICE (deterministic) + Kano + MoSCoW (LLM) via
// prioritize_score, then re-renders the freshly-ranked table.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const KANO_COLOR = {
  basic: '#8A8178', performance: '#1F5C99', delighter: '#1A7A4F',
  indifferent: '#B0A89E', reverse: '#B84747',
};
const MOSCOW_COLOR = {
  must: '#B84747', should: '#C47A14', could: '#1F5C99',
  wont: '#8A8178', "won't": '#8A8178',
};

function chip(text, color) {
  if (!text) return '<span class="muted">—</span>';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;`
    + `font-size:11px;font-weight:600;color:#fff;background:${color || '#8A8178'}">`
    + `${esc(text)}</span>`;
}

function rowHtml(o, i) {
  const rice = o.rice_score == null
    ? '<span class="muted">unscored</span>'
    : `<strong>${esc(String(o.rice_score))}</strong>`;
  const rice_components = [o.reach, o.impact, o.confidence, o.effort]
    .map((v) => (v == null ? '—' : v)).join(' · ');
  return `<tr>
      <td style="text-align:right;color:var(--muted)">${i + 1}</td>
      <td><strong>${esc(o.label || '')}</strong></td>
      <td class="muted">${o.painpoint ? esc(o.painpoint) : '—'}</td>
      <td style="text-align:right">${rice}</td>
      <td style="text-align:center" class="muted" title="Reach · Impact · Confidence · Effort">${rice_components}</td>
      <td>${chip(o.kano, KANO_COLOR[String(o.kano || '').toLowerCase()])}</td>
      <td>${chip(o.moscow, MOSCOW_COLOR[String(o.moscow || '').toLowerCase()])}</td>
    </tr>`;
}

export async function loadPrioritize(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'prioritize';

  const render = (data, { scoring = false } = {}) => {
    if (!alive()) return;
    const ops = (data && data.opportunities) || [];
    const total = (data && data.total) || 0;
    const scored = (data && data.scored) || 0;

    if (!total) {
      contentEl.innerHTML = `<div class="empty-big">
        <h3>No opportunities to rank yet</h3>
        <p>Prioritization ranks the <b>solutions</b> generated for this topic.
        Build them first in the <b>Solutions</b> tab, then return here to rank
        them by RICE / Kano / MoSCoW.</p>
        <button class="btn btn-primary btn-sm" id="go-solutions">Go to Solutions →</button>
      </div>`;
      contentEl.querySelector('#go-solutions')?.addEventListener('click', () => {
        document.querySelector('.tab[data-tab="solutions"]')?.click();
      });
      return;
    }

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div><strong>Ranked opportunities</strong>
          <span class="muted">· ${scored}/${total} scored · sorted by RICE</span></div>
        <div style="margin-left:auto">
          <button class="btn btn-primary btn-sm icon-btn" id="score-all" ${scoring ? 'disabled' : ''}>
            <i data-lucide="sparkles"></i> ${scoring ? 'Scoring… (LLM, ~30–60s)' : (scored ? 'Rescore all' : 'Score all')}
          </button>
        </div>
      </div>
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">
        <b>RICE</b> = Reach·Impact·Confidence ÷ Effort · <b>Kano</b> = basic/performance/delighter ·
        <b>MoSCoW</b> = must/should/could/won't. "Score all" runs RICE (instant) + Kano + MoSCoW (LLM).
      </p>
      <table class="data-table" style="width:100%">
        <thead><tr>
          <th style="text-align:right">#</th><th>Opportunity</th><th>Painpoint</th>
          <th style="text-align:right">RICE</th>
          <th style="text-align:center" title="Reach · Impact · Confidence · Effort">R·I·C·E</th>
          <th>Kano</th><th>MoSCoW</th>
        </tr></thead>
        <tbody>${ops.map(rowHtml).join('')}</tbody>
      </table>`;
    window.refreshIcons?.();

    contentEl.querySelector('#score-all')?.addEventListener('click', async () => {
      render(data, { scoring: true });
      try {
        const fresh = await api.prioritizeScore(topic);
        render(fresh);
      } catch (e) {
        render(data); // restore on failure (e.g. no LLM key — RICE still ranks)
      }
    });
  };

  contentEl.innerHTML = '<div class="empty-state">Loading opportunities…</div>';
  try {
    render(await api.prioritizeGet(topic));
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load opportunities</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
