// Market tab — TAM/SAM/SOM market sizing + market-value anchoring.
// Renders the LLM's evidence-grounded market estimate: three nested cards
// (TAM ⊃ SAM ⊃ SOM, each a big number + basis), the key assumptions, a
// comparables table, the market-value note, and a calibrated confidence chip.
// Reads research/market_sizing.py via market_sizing_get; "Generate" /
// "Regenerate" runs the LLM synthesis via market_sizing_compute.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const CONFIDENCE_COLOR = {
  low: '#B84747', medium: '#C47A14', high: '#1A7A4F',
};

function chip(text, color) {
  if (!text) return '<span class="muted">—</span>';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;`
    + `font-size:11px;font-weight:600;color:#fff;background:${color || '#8A8178'}">`
    + `${esc(text)}</span>`;
}

function tierLabel(tier) {
  const t = tier || {};
  if (t.label) return esc(t.label);
  if (t.value_usd == null) return '<span class="muted">n/a</span>';
  return `$${esc(String(t.value_usd))}`;
}

// Three concentric cards: TAM is the widest (outermost), SOM the tightest.
function tierCard(name, tier, { bg, accent, indent }) {
  const t = tier || {};
  const basis = t.basis
    ? `<div class="muted" style="font-size:12.5px;line-height:1.45;margin-top:6px">${esc(t.basis)}</div>`
    : '';
  return `<div style="margin-left:${indent}px;background:${bg};border:1px solid ${accent};`
    + `border-radius:12px;padding:14px 16px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700;letter-spacing:.04em;color:${accent}">${esc(name)}</span>
        <span style="font-size:26px;font-weight:800;line-height:1.1">${tierLabel(t)}</span>
      </div>
      ${basis}
    </div>`;
}

function comparablesTable(comps) {
  if (!comps || !comps.length) {
    return '<p class="muted" style="font-size:12.5px">No comparables provided.</p>';
  }
  const rows = comps.map((c) => `<tr>
      <td><strong>${esc(c.name || '')}</strong></td>
      <td class="muted">${c.signal ? esc(c.signal) : '—'}</td>
    </tr>`).join('');
  return `<table class="data-table" style="width:100%">
      <thead><tr><th>Comparable</th><th>Signal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function assumptionsList(items) {
  if (!items || !items.length) {
    return '<p class="muted" style="font-size:12.5px">No assumptions recorded.</p>';
  }
  return `<ul style="margin:6px 0 0;padding-left:18px;line-height:1.55">`
    + items.map((a) => `<li>${esc(a)}</li>`).join('')
    + `</ul>`;
}

export async function loadMarket(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'market';

  const wireCompute = (btnId, restore) => {
    const btn = contentEl.querySelector(`#${btnId}`);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader"></i> Generating… (LLM, ~30–60s)';
      window.refreshIcons?.();
      try {
        const fresh = await api.marketCompute(topic);
        if (!alive()) return;
        render(fresh);
      } catch (e) {
        if (!alive()) return;
        render(restore); // restore previous state on failure
      }
    });
  };

  const renderEmpty = (res) => {
    const r = res || {};
    const needsEvidence = String(r.reason || '').toLowerCase().includes('evidence');
    const heading = needsEvidence ? 'Build the gap map first' : 'No market estimate yet';
    const body = needsEvidence
      ? `<p>Market sizing is grounded in this topic's evidence. Collect posts and
         build the graph for this topic first, then return here to generate a
         TAM / SAM / SOM estimate.</p>`
      : `<p>Generate an evidence-grounded market estimate — a top-down + bottom-up
         <b>TAM ⊃ SAM ⊃ SOM</b> with assumptions, comparables, and a market-value
         note.</p>${r.reason ? `<p class="muted">${esc(r.reason)}</p>` : ''}`;
    const btnLabel = needsEvidence ? 'Build the gap map first' : 'Generate Market';
    contentEl.innerHTML = `<div class="empty-big">
        <h3>${esc(heading)}</h3>
        ${body}
        <button class="btn btn-primary btn-sm icon-btn" id="compute-market">
          <i data-lucide="trending-up"></i> ${esc(btnLabel)}
        </button>
      </div>`;
    window.refreshIcons?.();
    wireCompute('compute-market', res);
  };

  const renderData = (res) => {
    const d = (res && res.data) || {};
    const conf = String(d.confidence || '').toLowerCase();
    const cagr = d.cagr_pct == null
      ? ''
      : `<span class="muted"> · CAGR ${esc(String(d.cagr_pct))}%</span>`;

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div><strong>Market sizing</strong>
          <span class="muted">· ${esc(d.method || 'top-down + bottom-up')} · ${esc(d.currency || 'USD')}</span>${cagr}
          <span class="muted"> · Updated ${esc(res.updated_at || '')}${res.provider ? ' · ' + esc(res.provider) : ''}</span>
        </div>
        <div style="margin-left:auto">
          <button class="btn btn-primary btn-sm icon-btn" id="compute-market">
            <i data-lucide="refresh-cw"></i> Regenerate
          </button>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px">
        ${tierCard('TAM · Total addressable', d.tam, { bg: '#F2EEE8', accent: '#1F5C99', indent: 0 })}
        ${tierCard('SAM · Serviceable', d.sam, { bg: '#F5F1EB', accent: '#C47A14', indent: 28 })}
        ${tierCard('SOM · Obtainable (3yr)', d.som, { bg: '#F7F4EF', accent: '#1A7A4F', indent: 56 })}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start">
        <div>
          <div style="font-weight:600;margin-bottom:2px">Assumptions</div>
          ${assumptionsList(d.assumptions)}
        </div>
        <div>
          <div style="font-weight:600;margin-bottom:6px">Comparables</div>
          ${comparablesTable(d.comparables)}
        </div>
      </div>

      <div style="margin-top:18px">
        <div style="font-weight:600;margin-bottom:4px">Market value</div>
        <p class="muted" style="font-size:13px;line-height:1.55;margin:0">
          ${d.market_value_note ? esc(d.market_value_note) : '—'}
        </p>
      </div>

      <div style="margin-top:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:600">Confidence:</span>
        ${chip(d.confidence || '', CONFIDENCE_COLOR[conf])}
        ${d.confidence_reason ? `<span class="muted" style="font-size:12.5px">${esc(d.confidence_reason)}</span>` : ''}
      </div>`;
    window.refreshIcons?.();
    wireCompute('compute-market', res);
  };

  const render = (res) => {
    if (!alive()) return;
    if (!res || res.computed === false) {
      renderEmpty(res);
    } else {
      renderData(res);
    }
  };

  contentEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await api.marketGet(topic);
    if (!alive()) return;
    render(res);
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load market sizing</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
