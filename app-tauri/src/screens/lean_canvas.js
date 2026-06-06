// Lean Canvas tab — Ash Maurya's nine-block pre-build strategy canvas.
// Reads research/lean_canvas.py via lean_canvas_get; "Generate" runs the
// evidence-grounded LLM synthesis via lean_canvas_compute, then re-renders the
// canonical Lean Canvas block layout (a responsive grid of titled cards).
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Canonical Lean Canvas blocks, in display order. `type` drives rendering:
// 'list' fields are string arrays; 'text' fields are a single sentence.
const BLOCKS = [
  { key: 'problem', label: 'Problem', icon: 'alert-triangle', type: 'list' },
  { key: 'existing_alternatives', label: 'Existing Alternatives', icon: 'shuffle', type: 'list' },
  { key: 'solution', label: 'Solution', icon: 'wrench', type: 'list' },
  { key: 'unique_value_proposition', label: 'Unique Value Proposition', icon: 'sparkles', type: 'text' },
  { key: 'high_level_concept', label: 'High-Level Concept', icon: 'lightbulb', type: 'text' },
  { key: 'unfair_advantage', label: 'Unfair Advantage', icon: 'shield', type: 'text' },
  { key: 'customer_segments', label: 'Customer Segments', icon: 'users', type: 'list' },
  { key: 'early_adopters', label: 'Early Adopters', icon: 'user-check', type: 'text' },
  { key: 'channels', label: 'Channels', icon: 'route', type: 'list' },
  { key: 'cost_structure', label: 'Cost Structure', icon: 'trending-down', type: 'list' },
  { key: 'revenue_streams', label: 'Revenue Streams', icon: 'trending-up', type: 'list' },
  { key: 'key_metrics', label: 'Key Metrics', icon: 'bar-chart-3', type: 'list' },
];

function blockBody(block, data) {
  const value = data ? data[block.key] : undefined;
  if (block.type === 'list') {
    const items = Array.isArray(value) ? value.filter((v) => v != null && String(v).trim()) : [];
    if (!items.length) return '<p class="muted" style="margin:0">—</p>';
    return '<ul style="margin:0;padding-left:18px;line-height:1.5">'
      + items.map((it) => `<li>${esc(it)}</li>`).join('')
      + '</ul>';
  }
  const text = String(value ?? '').trim();
  return text
    ? `<p style="margin:0;line-height:1.5">${esc(text)}</p>`
    : '<p class="muted" style="margin:0">—</p>';
}

function cardHtml(block, data) {
  return `<div style="border:1px solid var(--border,#E5DFD6);border-radius:10px;`
    + `padding:12px 14px;background:var(--card,#fff);display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:7px;font-weight:600;font-size:13px;color:var(--muted)">
        <i data-lucide="${esc(block.icon)}" style="width:15px;height:15px"></i>
        <span>${esc(block.label)}</span>
      </div>
      <div style="font-size:13.5px">${blockBody(block, data)}</div>
    </div>`;
}

export async function loadLeanCanvas(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'lean';

  const render = (res, { generating = false } = {}) => {
    if (!alive()) return;

    if (!res || res.computed === false) {
      const reason = (res && res.reason) || '';
      const needsEvidence = /evidence|collect|graph/i.test(reason);
      const heading = needsEvidence
        ? 'Build the gap map first'
        : 'No Lean Canvas yet';
      const body = reason
        ? esc(reason)
        : 'Generate a nine-block Lean Canvas synthesised from this topic\'s '
          + 'painpoints, feature wishes and competitors.';
      const btnLabel = needsEvidence ? 'Build the gap map first' : 'Generate Lean Canvas';

      contentEl.innerHTML = `<div class="empty-big">
        <h3>${esc(heading)}</h3>
        <p>${body}</p>
        <button class="btn btn-primary btn-sm icon-btn" id="compute-lean" ${generating ? 'disabled' : ''}>
          <i data-lucide="sparkles"></i> ${generating ? 'Generating… (LLM, ~30–60s)' : esc(btnLabel)}
        </button>
      </div>`;
      window.refreshIcons?.();

      contentEl.querySelector('#compute-lean')?.addEventListener('click', async () => {
        render(res, { generating: true });
        try {
          const fresh = await api.leanCanvasCompute(topic);
          if (!alive()) return;
          render(fresh);
        } catch (e) {
          if (!alive()) return;
          render(res);
        }
      });
      return;
    }

    const data = res.data || {};
    const updated = res.updated_at || '';
    const provider = res.provider || '';

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div><strong>Lean Canvas</strong>
          <span class="muted">· Ash Maurya's nine-block pre-build canvas</span></div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
          ${updated || provider
            ? `<span class="muted" style="font-size:12px">Updated ${esc(updated)}${provider ? ` · ${esc(provider)}` : ''}</span>`
            : ''}
          <button class="btn btn-primary btn-sm icon-btn" id="compute-lean" ${generating ? 'disabled' : ''}>
            <i data-lucide="refresh-cw"></i> ${generating ? 'Generating… (LLM, ~30–60s)' : 'Regenerate'}
          </button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px">
        ${BLOCKS.map((b) => cardHtml(b, data)).join('')}
      </div>`;
    window.refreshIcons?.();

    contentEl.querySelector('#compute-lean')?.addEventListener('click', async () => {
      render(res, { generating: true });
      try {
        const fresh = await api.leanCanvasCompute(topic);
        if (!alive()) return;
        render(fresh);
      } catch (e) {
        if (!alive()) return;
        render(res);
      }
    });
  };

  contentEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await api.leanCanvasGet(topic);
    if (!alive()) return;
    render(res);
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load the Lean Canvas</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
