// Porter's Five Forces tab — structural attractiveness of the market.
// Rates the five competitive forces (rivalry, new entrants, substitutes,
// buyer power, supplier power) on a 1–5 strength scale grounded in the topic's
// painpoints + competitors, then rolls them into an overall attractiveness
// verdict. Reads research/porter.py via porter_get; "Generate Five Forces"
// runs porter_compute (LLM, ~30–60s) and re-renders the freshly-scored cards.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const FORCES = [
  { key: 'competitive_rivalry', label: 'Competitive Rivalry', icon: 'swords' },
  { key: 'threat_new_entrants', label: 'Threat of New Entrants', icon: 'door-open' },
  { key: 'threat_substitutes', label: 'Threat of Substitutes', icon: 'repeat' },
  { key: 'buyer_power', label: 'Buyer Power', icon: 'users' },
  { key: 'supplier_power', label: 'Supplier Power', icon: 'truck' },
];

const LEVEL_COLOR = {
  // Strong force = bad for entrant → red; weak force = good → green.
  low: '#1A7A4F', moderate: '#C47A14', high: '#B84747',
};
const ATTRACT_COLOR = {
  // Attractive market = good → green.
  high: '#1A7A4F', moderate: '#C47A14', low: '#B84747',
};

function chip(text, color) {
  if (!text) return '<span class="muted">—</span>';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;`
    + `font-size:11px;font-weight:600;color:#fff;background:${color || '#8A8178'}">`
    + `${esc(text)}</span>`;
}

function strengthBar(score) {
  const n = Math.max(1, Math.min(5, Number(score) || 0));
  const pct = (n / 5) * 100;
  // 1 = weak (green / favourable), 5 = strong (red / hostile).
  const color = n <= 2 ? '#1A7A4F' : (n === 3 ? '#C47A14' : '#B84747');
  return `<div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:8px;border-radius:5px;background:#E7E1D8;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color}"></div>
      </div>
      <strong style="font-size:13px;min-width:28px;text-align:right">${esc(String(n))}/5</strong>
    </div>`;
}

function forceCard(def, force) {
  const f = force || {};
  const level = String(f.level || '').toLowerCase();
  const ev = Array.isArray(f.evidence) ? f.evidence : [];
  const evHtml = ev.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--muted)">`
      + ev.map((e) => `<li>${esc(e)}</li>`).join('') + `</ul>`
    : '';
  return `<div style="border:1px solid #E7E1D8;border-radius:10px;padding:14px;background:#fff;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:8px">
        <i data-lucide="${esc(def.icon)}" style="width:16px;height:16px"></i>
        <strong style="font-size:13.5px">${esc(def.label)}</strong>
        <span style="margin-left:auto">${chip(level || '—', LEVEL_COLOR[level])}</span>
      </div>
      ${strengthBar(f.score)}
      <p style="margin:0;font-size:12.5px;line-height:1.45">${f.rationale ? esc(f.rationale) : '<span class="muted">No rationale.</span>'}</p>
      ${evHtml}
    </div>`;
}

export async function loadPorter(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'porter';

  const render = (res, { computing = false } = {}) => {
    if (!alive()) return;

    // ── Not computed yet: empty-big state with a compute button ──────────────
    if (!res || res.computed === false) {
      const reason = (res && res.reason) || '';
      const needsEvidence = /evidence|collect posts|build the graph/i.test(reason);
      const heading = needsEvidence
        ? 'Build the gap map first'
        : "Porter's Five Forces";
      const body = needsEvidence
        ? `<p>This framework rates the structural attractiveness of the market
           from real signals — painpoints, complaints and competitors. Collect
           posts and build the graph for <b>${esc(topic)}</b> first, then return
           here to generate the Five Forces.</p>`
        : `<p>Score the five competitive forces — rivalry, new entrants,
           substitutes, buyer power and supplier power — grounded in this
           topic's evidence, then get an overall verdict on whether it's a
           structurally attractive market to enter.</p>
           ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}`;

      contentEl.innerHTML = `<div class="empty-big">
        <h3>${esc(heading)}</h3>
        ${body}
        <button class="btn btn-primary btn-sm icon-btn" id="compute-porter" ${computing ? 'disabled' : ''}>
          <i data-lucide="sparkles"></i> ${computing ? 'Generating… (LLM, ~30–60s)' : 'Generate Five Forces'}
        </button>
      </div>`;
      window.refreshIcons?.();

      contentEl.querySelector('#compute-porter')?.addEventListener('click', async () => {
        render(res, { computing: true });
        try {
          const fresh = await api.porterCompute(topic);
          if (!alive()) return;
          render(fresh);
        } catch (e) {
          if (!alive()) return;
          render(res); // restore on failure (e.g. no LLM key)
        }
      });
      return;
    }

    // ── Computed: render the five force cards + overall verdict ───────────────
    const data = res.data || {};
    const forces = data.forces || {};
    const attract = String(data.overall_attractiveness || '').toLowerCase();

    const cards = FORCES.map((def) => forceCard(def, forces[def.key])).join('');

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div><strong>Porter's Five Forces</strong>
          <span class="muted">· strength 1 = weak/favourable · 5 = strong/hostile</span></div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
          <span class="muted" style="font-size:12px">Updated ${esc(res.updated_at || '')} · ${esc(res.provider || '')}</span>
          <button class="btn btn-primary btn-sm icon-btn" id="compute-porter" ${computing ? 'disabled' : ''}>
            <i data-lucide="refresh-cw"></i> ${computing ? 'Generating… (LLM, ~30–60s)' : 'Regenerate'}
          </button>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #E7E1D8;border-radius:10px;padding:14px;background:#FBF9F5;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px">
          <i data-lucide="target" style="width:18px;height:18px"></i>
          <strong style="font-size:14px">Overall attractiveness</strong>
        </div>
        ${chip(attract || '—', ATTRACT_COLOR[attract])}
        <p style="margin:0;flex:1;min-width:220px;font-size:13px;line-height:1.45">
          ${data.summary ? esc(data.summary) : '<span class="muted">No summary.</span>'}
        </p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
        ${cards}
      </div>`;
    window.refreshIcons?.();

    contentEl.querySelector('#compute-porter')?.addEventListener('click', async () => {
      render(res, { computing: true });
      try {
        const fresh = await api.porterCompute(topic);
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
    const res = await api.porterGet(topic);
    if (!alive()) return;
    render(res);
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load Five Forces</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
