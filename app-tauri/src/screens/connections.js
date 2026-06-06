// Connect the dots — novel cross-paper connections the literature hasn't made.
// Reads research/connections.py via connections_get; "Find connections" runs
// the novelty engine (paper-gaps + shared-but-uncited findings) via
// connections_compute, then re-renders the ranked list. Each card shows the
// connection kind, a novelty bar, why it's new, and the evidence papers.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const KIND_COLOR = {
  understudied_intersection: '#1A7A4F',
  bridge: '#1F5C99',
  contradiction: '#B84747',
  shared_uncited: '#C47A14',
  method_replication: '#8A6FB0',
};

function noveltyBar(score) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100);
  return `<div style="display:flex;align-items:center;gap:8px;min-width:120px">
      <div style="flex:1;height:6px;border-radius:4px;background:var(--surface-2,#eee);overflow:hidden">
        <div style="width:${pct}%;height:100%;background:#1A7A4F"></div></div>
      <span class="muted" style="font-size:11px;white-space:nowrap">${pct}% novel</span>
    </div>`;
}

function chip(text, color) {
  if (!text) return '';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;`
    + `font-size:11px;font-weight:600;color:#fff;background:${color || '#8A8178'}">`
    + `${esc(text)}</span>`;
}

function cardHtml(c) {
  const ev = (c.evidence || []).map((t) =>
    `<li class="muted" style="font-size:12.5px">${esc(t)}</li>`).join('');
  return `<div class="data-card" style="border:1px solid var(--line,#e5e0d8);border-radius:8px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        ${chip(c.kind_label || c.kind, KIND_COLOR[c.kind])}
        <div style="margin-left:auto">${noveltyBar(c.novelty_score)}</div>
      </div>
      <div style="font-weight:600;margin-bottom:4px">${esc(c.title || '')}</div>
      ${c.why_new ? `<p class="muted" style="font-size:13px;margin:4px 0 8px">${esc(c.why_new)}</p>` : ''}
      ${ev ? `<details><summary class="muted" style="font-size:12px;cursor:pointer">${(c.evidence || []).length} evidence paper(s)</summary>
        <ul style="margin:6px 0 0;padding-left:18px">${ev}</ul></details>` : ''}
    </div>`;
}

export async function loadConnections(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'connections';

  const render = (res, { computing = false } = {}) => {
    if (!alive()) return;
    const data = (res && res.data) || {};
    const conns = data.connections || [];

    if (!res || !res.computed) {
      const reason = (res && res.reason) || '';
      contentEl.innerHTML = `<div class="empty-big">
        <h3>Connect the dots</h3>
        <p>Find <b>novel cross-paper connections</b> the literature hasn't made yet —
        understudied intersections, contradictions, and parallel findings that don't
        cite each other.</p>
        ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
        <button class="btn btn-primary btn-sm icon-btn" id="compute-connections" ${computing ? 'disabled' : ''}>
          <i data-lucide="git-merge"></i> ${computing ? 'Finding connections… (LLM, ~30–60s)' : 'Find connections'}
        </button>
      </div>`;
      window.refreshIcons?.();
      contentEl.querySelector('#compute-connections')?.addEventListener('click', wireCompute);
      return;
    }

    const tally = Object.entries(data.by_kind || {})
      .map(([k, n]) => chip(`${k.replace(/_/g, ' ')}: ${n}`, KIND_COLOR[k])).join(' ');

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div><strong>${data.total || conns.length} novel connections</strong>
          <span class="muted">· ranked by novelty</span></div>
        <div style="margin-left:auto">
          <button class="btn btn-secondary btn-sm icon-btn" id="recompute-connections" ${computing ? 'disabled' : ''}>
            <i data-lucide="refresh-cw"></i> ${computing ? 'Working…' : 'Rebuild'}
          </button>
        </div>
      </div>
      ${tally ? `<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap">${tally}</div>` : ''}
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">
        Built from paper-gaps (understudied intersections, contradictions, under-replicated
        methods) + shared-but-uncited findings. Higher % = more unexplored.</p>
      <div>${conns.map(cardHtml).join('')}</div>`;
    window.refreshIcons?.();
    contentEl.querySelector('#recompute-connections')?.addEventListener('click', wireCompute);
  };

  async function wireCompute() {
    const prev = currentRes;
    render(prev || { computed: false }, { computing: true });
    try {
      const fresh = await api.connectionsCompute(topic);
      currentRes = fresh;
      render(fresh);
    } catch (e) {
      render(prev || { computed: false });
    }
  }

  let currentRes = null;
  contentEl.innerHTML = '<div class="empty-state">Loading connections…</div>';
  try {
    currentRes = await api.connectionsGet(topic);
    render(currentRes);
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load connections</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
