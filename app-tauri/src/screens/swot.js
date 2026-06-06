// SWOT tab — a strategic 2x2 auto-synthesised from the gap map.
// Strengths/Opportunities derive from unmet painpoints + feature-wishes (the
// gap to win); Weaknesses/Threats from competitors + execution risk. Reads
// research/swot.py via swot_get; "Generate SWOT" runs the LLM synthesis via
// swot_compute, then re-renders the 2x2 grid + strategic note.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Green S · Amber W · Blue O · Red T
const QUADRANTS = [
  { key: 'strengths', label: 'Strengths', color: '#1A7A4F', tint: 'rgba(26,122,79,0.08)', icon: 'shield-check' },
  { key: 'weaknesses', label: 'Weaknesses', color: '#C47A14', tint: 'rgba(196,122,20,0.08)', icon: 'alert-triangle' },
  { key: 'opportunities', label: 'Opportunities', color: '#1F5C99', tint: 'rgba(31,92,153,0.08)', icon: 'target' },
  { key: 'threats', label: 'Threats', color: '#B84747', tint: 'rgba(184,71,71,0.08)', icon: 'swords' },
];

function cellHtml(q, items) {
  const list = Array.isArray(items) ? items : [];
  const body = list.length
    ? list.map((it) => `
        <li style="margin:0 0 8px">
          <div><strong>${esc(it && it.point)}</strong></div>
          ${it && it.why ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${esc(it.why)}</div>` : ''}
        </li>`).join('')
    : '<li class="muted" style="list-style:none;margin:0">—</li>';
  return `
    <div style="border:1px solid var(--border,#e5e1da);border-left:4px solid ${q.color};
                border-radius:8px;background:${q.tint};padding:12px 14px;min-width:0">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;color:${q.color};font-weight:700">
        <i data-lucide="${q.icon}" style="width:16px;height:16px"></i>${esc(q.label)}
      </div>
      <ul style="margin:0;padding-left:18px">${body}</ul>
    </div>`;
}

export async function loadSwot(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'swot';

  const render = (res, { computing = false } = {}) => {
    if (!alive()) return;

    // ── empty / not-computed state ────────────────────────────────────────
    if (!res || !res.computed) {
      const reason = String((res && res.reason) || '');
      const needsEvidence = /evidence/i.test(reason);
      const label = needsEvidence ? 'Build the gap map first' : 'Generate SWOT';
      contentEl.innerHTML = `
        <div class="empty-big">
          <h3>SWOT — strategic 2x2 from your gap map</h3>
          <p>${reason
            ? esc(reason)
            : 'Auto-synthesise Strengths, Weaknesses, Opportunities and Threats from the '
              + 'painpoints, feature-wishes and competitors mined for this topic. '
              + 'Strengths &amp; Opportunities are the gap to win; Weaknesses &amp; Threats '
              + 'are the competition and execution risk.'}</p>
          <button class="btn btn-primary btn-sm icon-btn" id="compute-swot" ${computing ? 'disabled' : ''}>
            <i data-lucide="sparkles"></i> ${computing ? 'Generating… (LLM, ~30–60s)' : esc(label)}
          </button>
        </div>`;
      window.refreshIcons?.();
      wireCompute(res);
      return;
    }

    // ── computed state ────────────────────────────────────────────────────
    const data = res.data || {};
    const note = String(data.strategic_note || '');
    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div><strong>SWOT</strong>
          <span class="muted">· auto-synthesised from the gap map</span></div>
        <div class="muted" style="font-size:12px">
          ${res.updated_at ? `Updated ${esc(res.updated_at)}` : ''}${res.provider ? ` · ${esc(res.provider)}` : ''}
        </div>
        <div style="margin-left:auto">
          <button class="btn btn-primary btn-sm icon-btn" id="compute-swot" ${computing ? 'disabled' : ''}>
            <i data-lucide="refresh-cw"></i> ${computing ? 'Generating… (LLM, ~30–60s)' : 'Regenerate'}
          </button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
        ${QUADRANTS.map((q) => cellHtml(q, data[q.key])).join('')}
      </div>
      ${note ? `
        <div style="margin-top:14px;border:1px solid var(--border,#e5e1da);border-radius:8px;
                    padding:12px 14px;display:flex;gap:9px;align-items:flex-start">
          <i data-lucide="compass" style="width:16px;height:16px;flex:none;margin-top:2px"></i>
          <div>
            <div style="font-weight:700;margin-bottom:2px">Strategic move</div>
            <div>${esc(note)}</div>
          </div>
        </div>` : ''}`;
    window.refreshIcons?.();
    wireCompute(res);
  };

  const wireCompute = (res) => {
    contentEl.querySelector('#compute-swot')?.addEventListener('click', async () => {
      render(res, { computing: true });
      try {
        const fresh = await api.swotCompute(topic);
        if (!alive()) return;
        render(fresh);
      } catch (e) {
        if (!alive()) return;
        render(res); // restore previous state on failure
      }
    });
  };

  contentEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await api.swotGet(topic);
    if (!alive()) return;
    render(res);
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load SWOT</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
