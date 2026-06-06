// Value Proposition Canvas tab — Strategyzer customer-profile ↔ value-map fit.
// Two panels side-by-side: the Customer circle (jobs / pains / gains, grounded
// in the topic's real painpoints + complaints) and the Value square (products /
// pain relievers / gain creators), plus a fit note calling out the biggest gap.
// Reads research/value_prop.py via value_prop_get; "Generate" runs the LLM
// synthesis via value_prop_compute, then re-renders.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function listBlock(title, color, icon, items) {
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  const body = arr.length
    ? `<ul style="margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px">`
      + arr.map((it) => `<li>${esc(it)}</li>`).join('') + `</ul>`
    : `<p class="muted" style="margin:6px 0 0;font-size:12.5px">—</p>`;
  return `<div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;color:${color}">
        <i data-lucide="${icon}" style="width:15px;height:15px"></i> ${esc(title)}
      </div>
      ${body}
    </div>`;
}

function panel(title, subtitle, accent, inner) {
  return `<section style="flex:1 1 320px;min-width:280px;border:1px solid var(--border);
      border-radius:12px;padding:16px 18px;background:var(--card,#fff)">
      <div style="border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:12px">
        <div style="font-weight:700;font-size:15px;color:${accent}">${esc(title)}</div>
        <div class="muted" style="font-size:12px">${esc(subtitle)}</div>
      </div>
      ${inner}
    </section>`;
}

export async function loadValueProp(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'valueprop';

  const render = (res, { computing = false } = {}) => {
    if (!alive()) return;

    if (!res || res.computed === false) {
      const needsEvidence = String(res?.reason || '').toLowerCase().includes('evidence');
      const heading = needsEvidence ? 'Build the gap map first' : 'No Value Proposition Canvas yet';
      const blurb = needsEvidence
        ? `The Value Proposition Canvas grounds the customer's jobs and pains in
           this topic's real evidence. Collect posts and build the graph for this
           topic first, then return here.`
        : `Map the <b>Customer Profile</b> (jobs · pains · gains, mined from this
           topic's painpoints &amp; complaints) against the <b>Value Map</b>
           (products · pain relievers · gain creators) and see where the offering
           fits — and the biggest gap left to close.`;
      const btnLabel = needsEvidence ? 'Build the gap map first' : 'Generate Value Prop';
      contentEl.innerHTML = `<div class="empty-big">
        <h3>${esc(heading)}</h3>
        <p>${blurb}</p>
        ${res?.reason ? `<p class="muted" style="font-size:12.5px">${esc(res.reason)}</p>` : ''}
        <button class="btn btn-primary btn-sm icon-btn" id="compute-valueprop" ${computing ? 'disabled' : ''}>
          <i data-lucide="sparkles"></i> ${computing ? 'Generating… (LLM, ~30–60s)' : esc(btnLabel)}
        </button>
      </div>`;
      window.refreshIcons?.();
      wireCompute(res);
      return;
    }

    const d = res.data || {};
    const cust = d.customer || {};
    const vmap = d.value_map || {};

    const customerInner =
      listBlock('Customer jobs', '#1F5C99', 'briefcase', cust.jobs)
      + listBlock('Pains', '#B84747', 'flame', cust.pains)
      + listBlock('Gains', '#1A7A4F', 'sparkle', cust.gains);

    const valueInner =
      listBlock('Products & services', '#1F5C99', 'package', vmap.products)
      + listBlock('Pain relievers', '#B84747', 'shield', vmap.pain_relievers)
      + listBlock('Gain creators', '#1A7A4F', 'trending-up', vmap.gain_creators);

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <strong>Value Proposition Canvas</strong>
          <span class="muted"> · Updated ${esc(res.updated_at || '')} · ${esc(res.provider || '')}</span>
        </div>
        <div style="margin-left:auto">
          <button class="btn btn-primary btn-sm icon-btn" id="compute-valueprop" ${computing ? 'disabled' : ''}>
            <i data-lucide="refresh-cw"></i> ${computing ? 'Generating… (LLM, ~30–60s)' : 'Regenerate'}
          </button>
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch">
        ${panel('Customer Profile', 'Who they are & what they need', '#1F5C99', customerInner)}
        ${panel('Value Map', 'What the offering provides', '#1A7A4F', valueInner)}
      </div>
      ${d.fit_note ? `
        <div style="margin-top:16px;border:1px solid var(--border);border-left:3px solid #C47A14;
            border-radius:10px;padding:12px 16px;background:var(--card,#fff)">
          <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;color:#C47A14">
            <i data-lucide="target" style="width:15px;height:15px"></i> Fit &amp; biggest gap
          </div>
          <p style="margin:6px 0 0;font-size:13px">${esc(d.fit_note)}</p>
        </div>` : ''}`;
    window.refreshIcons?.();
    wireCompute(res);
  };

  const wireCompute = (res) => {
    contentEl.querySelector('#compute-valueprop')?.addEventListener('click', async () => {
      render(res, { computing: true });
      try {
        const fresh = await api.valuePropCompute(topic);
        if (!alive()) return;
        render(fresh);
      } catch (e) {
        if (!alive()) return;
        render(res); // restore prior state on failure (e.g. no LLM key)
      }
    });
  };

  contentEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await api.valuePropGet(topic);
    if (!alive()) return;
    render(res);
  } catch (e) {
    if (!alive()) return;
    contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load the Value Proposition Canvas</h3>`
      + `<p>${esc(e?.message || e)}</p></div>`;
  }
}
