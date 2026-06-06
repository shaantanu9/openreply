// North Star tab — the "what's the ONE metric?" decision surface.
// Proposes the single North-Star metric for the chosen opportunity, the input
// metrics that move it, leading indicators, and the vanity / anti-metrics to
// avoid. Reads research/north_star.py via northStarGet; "Generate" runs the
// LLM synthesis via northStarCompute, then re-renders the fresh artifact.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export async function loadNorthStar(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'northstar';

  const wireCompute = (btnId, restore) => {
    const btn = contentEl.querySelector(`#${btnId}`);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!alive()) return;
      btn.disabled = true;
      btn.textContent = 'Generating… (LLM, ~30–60s)';
      try {
        const fresh = await api.northStarCompute(topic);
        if (!alive()) return;
        render(fresh);
      } catch (e) {
        if (!alive()) return;
        restore();
      }
    });
  };

  const renderEmpty = (res) => {
    const reason = String(res?.reason || '');
    const needsEvidence = /evidence|collect|graph/i.test(reason);
    const heading = needsEvidence
      ? 'Build the gap map first'
      : 'Define your North Star';
    const body = reason
      ? esc(reason)
      : 'Propose the ONE metric that captures the value this product delivers '
        + 'to users — plus the input metrics that move it, early leading '
        + 'indicators, and the vanity metrics to avoid. Grounded in the '
        + 'painpoints surfaced for this topic.';
    const btnLabel = needsEvidence ? 'Build the gap map first' : 'Generate North Star';

    contentEl.innerHTML = `<div class="empty-big">
      <h3>${esc(heading)}</h3>
      <p>${body}</p>
      <button class="btn btn-primary btn-sm" id="compute-northstar">${esc(btnLabel)}</button>
    </div>`;
    wireCompute('compute-northstar', () => render(res));
  };

  const inputMetricsHtml = (metrics) => {
    if (!metrics.length) {
      return '<p class="muted">No input metrics proposed.</p>';
    }
    const rows = metrics.map((m) => `<tr>
        <td><strong>${esc(m?.name || '')}</strong></td>
        <td class="muted">${m?.why ? esc(m.why) : '—'}</td>
      </tr>`).join('');
    return `<table class="data-table" style="width:100%">
      <thead><tr><th>Input metric</th><th>Lever — why it moves the NSM</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  };

  const listHtml = (items, { color } = {}) => {
    if (!items.length) return '<p class="muted">None listed.</p>';
    const style = color
      ? `color:${color}`
      : '';
    const lis = items.map((x) => `<li style="${style}">${esc(x)}</li>`).join('');
    return `<ul style="margin:6px 0 0;padding-left:20px;line-height:1.6">${lis}</ul>`;
  };

  const renderData = (res) => {
    const d = res?.data || {};
    const nsm = d.north_star_metric || '';
    const definition = d.definition || '';
    const why = d.why || '';
    const inputMetrics = Array.isArray(d.input_metrics) ? d.input_metrics : [];
    const leading = Array.isArray(d.leading_indicators) ? d.leading_indicators : [];
    const anti = Array.isArray(d.anti_metrics) ? d.anti_metrics : [];
    const rationale = d.rationale || '';

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div class="muted" style="font-size:12.5px">
          Updated ${esc(res?.updated_at || '')} · ${esc(res?.provider || '')}
        </div>
        <div style="margin-left:auto">
          <button class="btn btn-primary btn-sm icon-btn" id="regen-northstar">
            <i data-lucide="refresh-cw"></i> Regenerate
          </button>
        </div>
      </div>

      <div style="border:1px solid var(--border);border-radius:12px;padding:18px 20px;
                  background:rgba(31,92,153,0.06);margin-bottom:18px">
        <div class="muted" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;
                                  display:flex;align-items:center;gap:6px">
          <i data-lucide="target"></i> North-Star metric
        </div>
        <div style="font-size:22px;font-weight:700;margin:6px 0 10px">
          ${nsm ? esc(nsm) : '<span class="muted">No metric proposed</span>'}
        </div>
        ${definition ? `<p style="margin:0 0 8px"><strong>Definition.</strong> ${esc(definition)}</p>` : ''}
        ${why ? `<p style="margin:0" class="muted"><strong>Why this captures value.</strong> ${esc(why)}</p>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px">
        <section>
          <h3 style="margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:6px">
            <i data-lucide="sliders-horizontal"></i> Input metrics
          </h3>
          <p class="muted" style="margin:0 0 8px;font-size:12.5px">Levers that move the NSM.</p>
          ${inputMetricsHtml(inputMetrics)}
        </section>

        <section>
          <h3 style="margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:6px">
            <i data-lucide="activity"></i> Leading indicators
          </h3>
          <p class="muted" style="margin:0 0 8px;font-size:12.5px">Early signals the NSM will move.</p>
          ${listHtml(leading)}
        </section>

        <section>
          <h3 style="margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:6px;color:#B84747">
            <i data-lucide="ban"></i> Anti-metrics
          </h3>
          <p class="muted" style="margin:0 0 8px;font-size:12.5px">Vanity metrics to NOT optimise.</p>
          ${listHtml(anti, { color: '#B84747' })}
        </section>
      </div>

      ${rationale ? `<div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
        <h3 style="margin:0 0 6px;font-size:15px;display:flex;align-items:center;gap:6px">
          <i data-lucide="link"></i> Rationale
        </h3>
        <p class="muted" style="margin:0">${esc(rationale)}</p>
      </div>` : ''}
    `;
    window.refreshIcons?.();
    wireCompute('regen-northstar', () => render(res));
  };

  const render = (res) => {
    if (!alive()) return;
    if (!res || res.computed === false) {
      renderEmpty(res || {});
      return;
    }
    renderData(res);
  };

  contentEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await api.northStarGet(topic);
    if (!alive()) return;
    render(res);
  } catch (e) {
    if (!alive()) return;
    contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load North Star</h3>`
      + `<p>${esc(e?.message || e)}</p></div>`;
  }
}
