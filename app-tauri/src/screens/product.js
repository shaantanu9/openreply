// Product Mode — the dual-mode pivot's daily-use surface.
//
// Three routes:
//   #/products             → list of registered products
//   #/product/<id>         → Daily Dashboard (5 sections)
//   #/product/<id>/setup   → registration wizard (shared with "have a product" onboarding branch)
//
// Every surface is silent when empty and populates lively when the user has data.

import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

// Severity badge color — same scale as finding Ulwick score.
function sevClass(sev, conf) {
  const combined = (sev || 0) * (conf || 0);
  if (combined >= 0.5) return 'sig-sev-high';
  if (combined >= 0.3) return 'sig-sev-mid';
  return 'sig-sev-low';
}

function signalEmoji(type) {
  return {
    competitor_release: '🚀',
    chronic_emergence: '⚠',
    your_product_regression: '🔻',
    unmet_need_intensifying: '📈',
    competitor_vulnerability: '🎯',
    mention_spike: '🔊',
  }[type] || '•';
}

// ══════════════════════════════════════════════════════════════════════
// #/products — list screen
// ══════════════════════════════════════════════════════════════════════
export async function renderProductsList(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Products</div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-primary icon-btn" id="btn-new-product">
        <i data-lucide="plus"></i> Register a product
      </button>
    </header>
    <div id="product-list-slot"><div class="empty-state" style="padding:30px">Loading…</div></div>
  `;
  document.getElementById('btn-new-product').onclick = () => {
    location.hash = '#/product/new/setup';
  };
  window.refreshIcons?.();

  const slot = document.getElementById('product-list-slot');
  let resp;
  try {
    resp = await api.productList(true);
  } catch (e) {
    slot.innerHTML = `<div class="empty-big"><h3>Couldn't load products</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  const products = resp?.products || [];
  if (products.length === 0) {
    slot.innerHTML = renderProductsEmpty();
    document.getElementById('btn-register')?.addEventListener('click', () => {
      location.hash = '#/product/new/setup';
    });
    document.getElementById('btn-convert-topic')?.addEventListener('click', async () => {
      await showConvertTopicPicker();
    });
    window.refreshIcons?.();
    return;
  }

  slot.innerHTML = `
    <section class="products-grid">
      ${products.map(p => productTile(p)).join('')}
    </section>
  `;
  slot.querySelectorAll('.product-tile').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.productId;
      if (id) location.hash = `#/product/${encodeURIComponent(id)}`;
    });
  });
  window.refreshIcons?.();
}

function renderProductsEmpty() {
  return `
    <div class="empty-big">
      <h3>No products registered</h3>
      <p>Product Mode turns Gap Map into a daily-use tool: you pick a product, add its competitors, and every morning you see what's changed — typed signals, competitor moves, emerging category painpoints.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary icon-btn" id="btn-register"><i data-lucide="plus"></i> Register a product</button>
        <button class="btn btn-ghost btn-bordered icon-btn" id="btn-convert-topic"><i data-lucide="arrow-right-circle"></i> Convert an existing topic</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:12px">
        Topic Mode (one-shot research) stays unchanged — Product Mode is the always-on surface on top of it.
      </p>
    </div>
  `;
}

function productTile(p) {
  const openCount = p.open_signal_count || 0;
  const lastSwept = p.last_swept_at ? new Date(p.last_swept_at).toLocaleDateString() : 'never';
  const gate = (p.gate_status || '').toLowerCase();
  const gateLabels = { go: 'Go', kill: 'Kill', hold: 'Hold', recycle: 'Recycle' };
  const gatePill = gate && gateLabels[gate]
    ? `<span class="pd-gate-current pd-gate-${gate}" style="font-size:10px">${gateLabels[gate]}</span>`
    : '';
  return `
    <a class="product-tile" data-product-id="${esc(p.id)}">
      <div class="product-tile-head">
        <h4>${esc(p.name)}</h4>
        ${gatePill}
        ${openCount > 0 ? `<span class="product-open-pill">${openCount} open</span>` : ''}
      </div>
      ${p.one_liner ? `<p class="product-oneliner">${esc(p.one_liner)}</p>` : ''}
      <div class="product-meta muted">
        <span>${p.competitor_count || 0} competitors</span>
        <span>·</span>
        <span>Last sweep: ${esc(lastSwept)}</span>
      </div>
    </a>
  `;
}

// ══════════════════════════════════════════════════════════════════════
// #/product/<id>/setup — registration wizard
// ══════════════════════════════════════════════════════════════════════
export async function renderProductSetup(root, { params }) {
  const slug = params?.[0] || 'new';
  const isNew = slug === 'new';

  // Pre-fetch topics so we can offer "link to existing topic" option
  let topics = [];
  try { topics = await api.listTopics(); } catch { topics = []; }

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/products">Products</a> · <strong>${isNew ? 'Register' : 'Edit'}</strong>
      </div>
    </header>

    <section class="hero" style="grid-template-columns:1fr;max-width:760px">
      <div>
        <div class="hero-eyebrow">Product registration</div>
        <h1 style="font-size:30px">What are we monitoring?</h1>
        <p>Gap Map will continuously collect posts, reviews, and news around your product and its competitors, then surface typed signals every day.</p>
      </div>
    </section>

    <section class="settings-profile-fields" style="max-width:760px;margin-top:18px">
      <label style="grid-column:1 / -1">
        <span>Product name</span>
        <input type="text" id="ps-name" placeholder="e.g. MindWave Pro" autofocus />
      </label>
      <label style="grid-column:1 / -1">
        <span>One-line description</span>
        <input type="text" id="ps-oneliner" placeholder="e.g. Binaural meditation app for focus &amp; sleep" />
      </label>
      <label>
        <span>Category</span>
        <input type="text" id="ps-category" placeholder="e.g. meditation apps" />
      </label>
      <label>
        <span>Linked topic</span>
        <select id="ps-topic">
          <option value="">(use product name as topic)</option>
          ${topics.map(t => `<option value="${esc(t.topic || t.name || '')}">${esc(t.topic || t.name || '')}</option>`).join('')}
        </select>
      </label>
    </section>

    <section style="margin-top:20px;max-width:760px">
      <div class="section-head"><div><h2 style="font-size:16px">Competitors</h2><p>Start with 3–10. You can add more later.</p></div></div>
      <div id="ps-competitors" class="ps-competitor-list"></div>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="ps-add-competitor">
        <i data-lucide="plus"></i> Add competitor
      </button>
    </section>

    <div style="display:flex;gap:10px;margin-top:24px;justify-content:flex-end;max-width:760px">
      <a class="btn btn-ghost btn-bordered" href="#/products">Cancel</a>
      <button class="btn btn-primary icon-btn" id="ps-save">
        <i data-lucide="check"></i> Register &amp; run initial sweep
      </button>
    </div>

    <p class="muted" style="max-width:760px;margin-top:14px;font-size:12px">
      💡 No competitors yet? Click <b>Cancel</b>, run a Topic Mode collection first, then use
      <b>Convert topic</b> from the Products list — competitors are auto-extracted from the graph.
    </p>
  `;

  // Competitor row template
  const compList = document.getElementById('ps-competitors');
  function addCompRow(preset = {}) {
    const row = document.createElement('div');
    row.className = 'ps-competitor-row';
    row.innerHTML = `
      <input type="text" class="ps-c-name" placeholder="Competitor name" value="${esc(preset.name || '')}" />
      <input type="text" class="ps-c-website" placeholder="Website URL (optional)" value="${esc(preset.website || '')}" />
      <button class="btn btn-ghost btn-sm ps-c-remove" title="Remove"><i data-lucide="x"></i></button>
    `;
    compList.appendChild(row);
    row.querySelector('.ps-c-remove').onclick = () => row.remove();
    window.refreshIcons?.();
  }
  addCompRow(); addCompRow(); addCompRow();

  document.getElementById('ps-add-competitor').onclick = () => addCompRow();

  document.getElementById('ps-save').onclick = async () => {
    const btn = document.getElementById('ps-save');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Registering…';
    window.refreshIcons?.();

    const payload = {
      name: document.getElementById('ps-name').value.trim(),
      oneLiner: document.getElementById('ps-oneliner').value.trim(),
      category: document.getElementById('ps-category').value.trim(),
      topic: document.getElementById('ps-topic').value,
      monitoringCadence: 'daily',
      competitors: Array.from(compList.querySelectorAll('.ps-competitor-row'))
        .map(row => {
          const name = row.querySelector('.ps-c-name').value.trim();
          const website = row.querySelector('.ps-c-website').value.trim();
          if (!name) return null;
          return { name, urls: website ? { website } : {}, category: '' };
        })
        .filter(Boolean),
    };

    if (!payload.name) {
      alert('Name is required.');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check"></i> Register &amp; run initial sweep';
      window.refreshIcons?.();
      return;
    }

    try {
      const created = await api.productCreate(payload);
      if (!created?.ok) {
        throw new Error(created?.error || 'registration failed');
      }
      const pid = created.product?.id;
      if (!pid) throw new Error('no product id returned');
      // Fire initial sweep in background (skip-collect because topic may be fresh)
      api.productSweep(pid, 'initial', true).catch(() => {});
      location.hash = `#/product/${encodeURIComponent(pid)}`;
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check"></i> Register &amp; run initial sweep';
      window.refreshIcons?.();
      alert(`Couldn't register: ${e?.message || e}`);
    }
  };

  window.refreshIcons?.();
}

async function showConvertTopicPicker() {
  let topics = [];
  try { topics = await api.listTopics(); } catch {}
  if (!topics.length) {
    alert('No existing topics to convert. Run a Topic Mode collection first.');
    return;
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.hidden = false;
  backdrop.innerHTML = `
    <div class="modal" style="max-width:520px">
      <h3 style="margin-top:0">Convert topic → product</h3>
      <p class="muted">Seeds a Product with the topic's name + auto-extracted competitors (from the graph).</p>
      <label style="margin-top:14px;display:block">
        <span>Topic</span>
        <select id="ctp-topic" style="width:100%;margin-top:6px">
          ${topics.map(t => {
            const v = t.topic || t.name || '';
            return `<option value="${esc(v)}">${esc(v)}</option>`;
          }).join('')}
        </select>
      </label>
      <label style="margin-top:10px;display:block">
        <span>Product name (optional override)</span>
        <input type="text" id="ctp-name" style="width:100%;margin-top:6px" placeholder="leave blank to use topic name" />
      </label>
      <div class="modal-actions" style="justify-content:flex-end;margin-top:18px;gap:8px">
        <button class="btn btn-ghost btn-bordered" id="ctp-cancel">Cancel</button>
        <button class="btn btn-primary" id="ctp-convert">Convert</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#ctp-cancel').onclick = close;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#ctp-convert').onclick = async () => {
    const topic = backdrop.querySelector('#ctp-topic').value;
    const name = backdrop.querySelector('#ctp-name').value.trim() || null;
    const btn = backdrop.querySelector('#ctp-convert');
    btn.disabled = true;
    btn.textContent = 'Converting…';
    try {
      const out = await api.productConvertTopic(topic, name);
      if (!out?.ok) throw new Error(out?.error || 'convert failed');
      close();
      location.hash = `#/product/${encodeURIComponent(out.product.id)}`;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Convert';
      alert(`Couldn't convert: ${e?.message || e}`);
    }
  };
}

// ══════════════════════════════════════════════════════════════════════
// Cagan's Four Risks (Inspired, 2017) + Blue Ocean Value Curve
// (Kim & Mauborgne, 2005). Both are independent product-level state
// stored on the products row; we fetch them async so the main dashboard
// data path stays untouched.
// ══════════════════════════════════════════════════════════════════════

const RISK_QUESTIONS = {
  value:       'Will customers actually choose to buy and use it?',
  usability:   'Can users figure out how to use it?',
  feasibility: 'Can we build it with available tech, time, and budget?',
  viability:   'Does the business support it (sales, support, legal, finance)?',
};
const RISK_ORDER = ['value', 'usability', 'feasibility', 'viability'];
const RISK_PILLS = [
  { key: 'pass',    label: '✓ Pass' },
  { key: 'unknown', label: '? Unknown' },
  { key: 'fail',    label: '✗ Fail' },
];

function renderFourRisksPanel(risks) {
  const cards = RISK_ORDER.map(k => {
    const r = risks[k] || { status: 'unknown', notes: '' };
    const pills = RISK_PILLS.map(p => `
      <button class="risk-pill ${r.status === p.key ? 'is-on' : ''}"
              data-pill="${p.key}" data-risk="${k}">${p.label}</button>
    `).join('');
    return `
      <div class="risk-card" data-status="${esc(r.status)}" data-risk="${k}">
        <div class="risk-name">${k}</div>
        <div class="risk-question">${esc(RISK_QUESTIONS[k])}</div>
        <div class="risk-controls">${pills}</div>
        <textarea class="risk-notes" data-risk-notes="${k}"
                  placeholder="Notes / evidence (optional)"
                  rows="2">${esc(r.notes || '')}</textarea>
      </div>
    `;
  }).join('');
  return `
    <section class="four-risks-panel card">
      <div class="four-risks-head">
        <h4>Cagan's Four Risks</h4>
        <span class="muted" style="font-size:11px">Inspired (2017) · clear these BEFORE the Stage-Gate verdict</span>
      </div>
      <div class="four-risks-grid">${cards}</div>
    </section>
  `;
}

async function renderFourRisksAsync(productId) {
  const mount = document.getElementById('pd-four-risks');
  if (!mount) return;
  mount.innerHTML = '<div class="card muted" style="padding:10px 14px;font-size:11.5px">Loading four-risks…</div>';
  let result;
  try {
    result = await api.fourRisksGet(productId);
  } catch (e) {
    mount.innerHTML = `<div class="card muted" style="padding:10px 14px;font-size:11.5px">Four-risks unavailable: ${esc(e?.message || e)}</div>`;
    return;
  }
  if (!result?.ok) {
    mount.innerHTML = `<div class="card muted" style="padding:10px 14px;font-size:11.5px">${esc(result?.error || 'Four-risks unavailable')}</div>`;
    return;
  }
  mount.innerHTML = renderFourRisksPanel(result.risks || {});

  // Wire pills + notes blur
  mount.querySelectorAll('.risk-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const risk = btn.dataset.risk;
      const status = btn.dataset.pill;
      const notesEl = mount.querySelector(`textarea[data-risk-notes="${risk}"]`);
      const notes = (notesEl?.value || '').trim();
      btn.disabled = true;
      try {
        await api.fourRisksSet(productId, risk, status, notes);
        await renderFourRisksAsync(productId);
      } catch (e) {
        btn.disabled = false;
        alert(`Couldn't update ${risk}: ${e?.message || e}`);
      }
    });
  });
  mount.querySelectorAll('textarea.risk-notes').forEach(ta => {
    ta.addEventListener('blur', async () => {
      const risk = ta.dataset.riskNotes;
      const card = ta.closest('.risk-card');
      const status = card?.dataset.status || 'unknown';
      try {
        await api.fourRisksSet(productId, risk, status, ta.value || '');
      } catch (e) {
        console.warn('risk notes save failed', e);
      }
    });
  });
}

// ── Value Curve ──────────────────────────────────────────────────────────
const COMPETITOR_PALETTE = [
  '#1d4ed8', '#be123c', '#047857', '#b45309', '#6d28d9', '#0891b2',
  '#c2410c', '#15803d',
];

function renderValueCurveSvg(curve) {
  const factors = curve.factors || [];
  const series = [
    { name: 'Self', scores: curve.self || [], color: '#0f172a', stroke: 3 },
    ...((curve.competitors || []).map((c, i) => ({
      name: c.name,
      scores: c.scores || [],
      color: COMPETITOR_PALETTE[i % COMPETITOR_PALETTE.length],
      stroke: 2,
    }))),
  ];
  if (!factors.length) return '<p class="muted">Add factors below to plot the curve.</p>';

  const W = Math.max(560, factors.length * 90);
  const H = 280;
  const padL = 40, padR = 24, padT = 24, padB = 56;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xAt = i => padL + (factors.length === 1 ? innerW / 2 : (innerW * i) / (factors.length - 1));
  const yAt = v => padT + innerH - (innerH * Math.max(0, Math.min(v, 10))) / 10;

  // Y-axis labels (0, 5, 10) + horizontal gridlines.
  let grid = '';
  [0, 5, 10].forEach(g => {
    const y = yAt(g);
    grid += `<line x1="${padL}" y1="${y}" x2="${padL + innerW}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="2 4"/>` +
            `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${g}</text>`;
  });

  // X-axis factor labels (rotated 30°)
  let xLabels = '';
  factors.forEach((f, i) => {
    const x = xAt(i);
    xLabels += `<g transform="translate(${x}, ${padT + innerH + 10}) rotate(20)">` +
               `<text font-size="11" fill="#374151">${esc(f)}</text></g>`;
  });

  // Lines + dots
  let lines = '';
  series.forEach(s => {
    if (!s.scores.length) return;
    const pts = s.scores.slice(0, factors.length).map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
    lines += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.stroke}"/>`;
    s.scores.slice(0, factors.length).forEach((v, i) => {
      lines += `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="3" fill="${s.color}"/>`;
    });
  });

  return `
    <div class="value-curve-svg-wrap">
      <svg class="value-curve-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${grid}
        ${xLabels}
        ${lines}
      </svg>
    </div>
    <div class="value-curve-legend">
      ${series.map(s => `<span><span class="value-curve-legend-dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}
    </div>
  `;
}

function renderValueCurvePanel(curve, competitors) {
  const factors = curve.factors || [];
  const selfScores = curve.self || [];

  // Editor: one row per factor, with the Self slider + a delete button.
  const editorRows = factors.map((f, i) => `
    <div class="vc-row" data-row-idx="${i}">
      <input class="vc-factor-name" type="text" value="${esc(f)}"
             placeholder="Factor name" data-idx="${i}"/>
      <input class="vc-self-slider" type="range" min="0" max="10" step="1"
             value="${Math.round(selfScores[i] ?? 5)}" data-idx="${i}"/>
      <span class="vc-score" data-self-score="${i}">${Math.round(selfScores[i] ?? 5)}</span>
      <button class="btn-mini vc-delete-row" data-idx="${i}" title="Remove factor">×</button>
    </div>
  `).join('');

  const fa = curve.four_actions || {};
  return `
    <section class="value-curve-panel card">
      <div class="value-curve-head">
        <h4>Blue Ocean Value Curve</h4>
        <span class="muted" style="font-size:11px">Kim &amp; Mauborgne (2005) · plot the strategy canvas</span>
      </div>

      ${renderValueCurveSvg(curve)}

      <div class="value-curve-editor" id="vc-editor">
        <div class="muted" style="font-size:11px">
          Edit factors and the Self score. Competitor scores live below.
        </div>
        ${editorRows || '<div class="muted" style="font-size:12px">No factors yet — add one to start the curve.</div>'}
        <div class="vc-add-row">
          <input id="vc-new-factor" type="text" placeholder="New factor (e.g. price, ease of setup, integrations)" />
          <button class="btn-mini" id="vc-add-factor-btn">+ add factor</button>
        </div>
      </div>

      ${competitors.length ? `
        <details>
          <summary style="cursor:pointer;font-size:12.5px;color:var(--ink-2)">Competitor scores (${competitors.length})</summary>
          <div class="value-curve-editor" id="vc-comp-editor" style="margin-top:8px">
            ${competitors.map(c => {
              const existing = (curve.competitors || []).find(x => x.name === c.competitor_name);
              const scores = existing?.scores || [];
              return `
                <div class="vc-comp-block" data-comp-name="${esc(c.competitor_name)}">
                  <strong style="font-size:12.5px">${esc(c.competitor_name)}</strong>
                  ${factors.map((f, i) => `
                    <div class="vc-row">
                      <span class="vc-label">${esc(f)}</span>
                      <input class="vc-comp-slider" type="range" min="0" max="10" step="1"
                             value="${Math.round(scores[i] ?? 5)}"
                             data-comp="${esc(c.competitor_name)}" data-idx="${i}"/>
                      <span class="vc-score" data-comp-score="${esc(c.competitor_name)}-${i}">${Math.round(scores[i] ?? 5)}</span>
                      <span></span>
                    </div>
                  `).join('')}
                </div>
              `;
            }).join('')}
          </div>
        </details>
      ` : ''}

      <div>
        <h5 style="margin:8px 0 6px;font-size:12px;letter-spacing:1px;color:var(--ink-3);font-weight:700">FOUR ACTIONS</h5>
        <div class="value-curve-actions">
          ${['eliminate', 'reduce', 'raise', 'create'].map(k => `
            <div class="va-action" data-action="${k}">
              <label>${k.toUpperCase()}</label>
              <input data-action="${k}" type="text" maxlength="300"
                     value="${esc(fa[k] || '')}"
                     placeholder="${k === 'eliminate' ? 'What can you cut entirely?' :
                                   k === 'reduce' ? 'What can be well below industry standard?' :
                                   k === 'raise' ? 'What can be raised above industry standard?' :
                                   'What can you offer that nobody else does?'}"/>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn primary" id="vc-save">Save value curve</button>
      </div>
    </section>
  `;
}

async function renderValueCurveAsync(productId, competitors) {
  const mount = document.getElementById('pd-value-curve');
  if (!mount) return;
  mount.innerHTML = '<div class="card muted" style="padding:10px 14px;font-size:11.5px">Loading value curve…</div>';
  let result;
  try {
    result = await api.valueCurveGet(productId);
  } catch (e) {
    mount.innerHTML = `<div class="card muted" style="padding:10px 14px;font-size:11.5px">Value curve unavailable: ${esc(e?.message || e)}</div>`;
    return;
  }
  if (!result?.ok) {
    mount.innerHTML = `<div class="card muted" style="padding:10px 14px;font-size:11.5px">${esc(result?.error || 'Value curve unavailable')}</div>`;
    return;
  }
  // Local working copy — edits flush to API only on save.
  const state = {
    factors: [...(result.factors || [])],
    self: [...(result.self || [])],
    competitors: (result.competitors || []).map(c => ({ ...c, scores: [...(c.scores || [])] })),
    four_actions: { ...(result.four_actions || {}) },
  };
  // Always pad self scores to factors length.
  while (state.self.length < state.factors.length) state.self.push(5);

  const repaint = () => {
    mount.innerHTML = renderValueCurvePanel(state, competitors);
    wire();
    window.refreshIcons?.();
  };

  const wire = () => {
    // Self slider live update
    mount.querySelectorAll('.vc-self-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const i = +slider.dataset.idx;
        const v = +slider.value;
        state.self[i] = v;
        const lbl = mount.querySelector(`[data-self-score="${i}"]`);
        if (lbl) lbl.textContent = v;
        // Re-render the SVG so the line moves immediately.
        const wrap = mount.querySelector('.value-curve-svg-wrap');
        if (wrap) wrap.outerHTML = renderValueCurveSvg(state).split('<div class="value-curve-legend">')[0];
      });
    });

    // Factor name updates
    mount.querySelectorAll('.vc-factor-name').forEach(inp => {
      inp.addEventListener('change', () => {
        const i = +inp.dataset.idx;
        state.factors[i] = inp.value.trim();
      });
    });

    // Delete factor
    mount.querySelectorAll('.vc-delete-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.idx;
        state.factors.splice(i, 1);
        state.self.splice(i, 1);
        state.competitors.forEach(c => c.scores.splice(i, 1));
        repaint();
      });
    });

    // Add factor
    document.getElementById('vc-add-factor-btn')?.addEventListener('click', () => {
      const inp = document.getElementById('vc-new-factor');
      const name = (inp?.value || '').trim();
      if (!name) return;
      state.factors.push(name);
      state.self.push(5);
      state.competitors.forEach(c => c.scores.push(5));
      if (inp) inp.value = '';
      repaint();
    });

    // Competitor sliders
    mount.querySelectorAll('.vc-comp-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const name = slider.dataset.comp;
        const i = +slider.dataset.idx;
        let comp = state.competitors.find(c => c.name === name);
        if (!comp) {
          comp = { name, scores: new Array(state.factors.length).fill(5) };
          state.competitors.push(comp);
        }
        while (comp.scores.length < state.factors.length) comp.scores.push(5);
        comp.scores[i] = +slider.value;
        const lbl = mount.querySelector(`[data-comp-score="${name}-${i}"]`);
        if (lbl) lbl.textContent = slider.value;
        const wrap = mount.querySelector('.value-curve-svg-wrap');
        if (wrap) wrap.outerHTML = renderValueCurveSvg(state).split('<div class="value-curve-legend">')[0];
      });
    });

    // Four actions text
    mount.querySelectorAll('.va-action input').forEach(inp => {
      inp.addEventListener('change', () => {
        state.four_actions[inp.dataset.action] = inp.value || '';
      });
    });

    // Save
    document.getElementById('vc-save')?.addEventListener('click', async () => {
      const btn = document.getElementById('vc-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api.valueCurveSet(productId, {
          factors: state.factors,
          self: state.self,
          competitors: state.competitors,
          four_actions: state.four_actions,
        });
        btn.textContent = '✓ Saved';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save value curve'; }, 1500);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save value curve';
        alert(`Couldn't save: ${e?.message || e}`);
      }
    });
  };

  repaint();
}


// ══════════════════════════════════════════════════════════════════════
// #/product/<id> — the Daily Dashboard (5 sections)
// ══════════════════════════════════════════════════════════════════════
export async function renderProductDashboard(root, { params }) {
  const id = decodeURIComponent(params?.[0] || '');
  if (!id) {
    root.innerHTML = `<div class="empty-big"><h3>No product ID</h3></div>`;
    return;
  }

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/products">Products</a> · <strong id="pd-name">${esc(id)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="pd-digest">
        <i data-lucide="clipboard"></i> Copy weekly digest
      </button>
      <button class="btn btn-primary btn-sm icon-btn" id="pd-sweep">
        <i data-lucide="refresh-cw"></i> Run sweep
      </button>
    </header>

    <div id="pd-header"></div>
    <div id="pd-four-risks"></div>
    <div id="pd-gate"></div>
    <div id="pd-signals"></div>
    <div class="pd-sections-grid">
      <div id="pd-mirror"></div>
      <div id="pd-lens"></div>
    </div>
    <div id="pd-value-curve"></div>
    <div id="pd-field"></div>
    <div id="pd-sweeps"></div>
  `;
  window.refreshIcons?.();

  const renderAll = async (cacheAllowed = true) => {
    let data;
    try {
      data = cacheAllowed
        ? await api.productDashboard(id, 7)
        : await api.productDashboard(id, 7);  // same call — invalidate handles refresh
    } catch (e) {
      root.innerHTML = `<div class="empty-big"><h3>Couldn't load product</h3><p>${esc(e?.message || e)}</p></div>`;
      return;
    }
    if (!data?.ok) {
      root.innerHTML = `<div class="empty-big"><h3>${esc(data?.error || 'Product not found')}</h3><a class="btn btn-primary" href="#/products">← Back to products</a></div>`;
      return;
    }
    const product = data.product || {};
    document.getElementById('pd-name').textContent = product.name || id;
    document.getElementById('pd-header').innerHTML = renderHeader(product, data.signals || []);

    // Cagan's Four Risks — fetched in parallel so we don't block the rest
    // of the dashboard. Failures are non-fatal: missing column on an old
    // schema just means the panel stays empty until the next migration.
    renderFourRisksAsync(id);

    document.getElementById('pd-gate').innerHTML = renderGateBar(product);
    wireGateBar(id, renderAll);
    document.getElementById('pd-signals').innerHTML = renderSignalsSection(data.signals || []);
    document.getElementById('pd-mirror').innerHTML = renderMirrorSection(data.mirror || {});
    document.getElementById('pd-lens').innerHTML = renderLensSection(data.lens || {}, data.competitors || []);

    // Blue Ocean Value Curve — also independent of the dashboard payload.
    renderValueCurveAsync(id, data.competitors || []);

    document.getElementById('pd-field').innerHTML = renderFieldSection(data.field || {});
    document.getElementById('pd-sweeps').innerHTML = renderSweepsSection(data.recent_sweeps || []);
    wireSignalActions(id, renderAll);
    window.refreshIcons?.();
  };

  document.getElementById('pd-sweep').onclick = async () => {
    const btn = document.getElementById('pd-sweep');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Sweeping…';
    window.refreshIcons?.();
    try {
      const out = await api.productSweep(id, 'manual', true);
      const n = out?.signals_generated || 0;
      const toast = document.createElement('div');
      toast.className = 'toast toast-success';
      toast.innerHTML = `✨ Sweep complete — ${n} signal${n === 1 ? '' : 's'} generated`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3500);
      await renderAll(false);
    } catch (e) {
      const toast = document.createElement('div');
      toast.className = 'toast toast-error';
      toast.innerHTML = `Sweep failed: ${esc(e?.message || e)}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4500);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="refresh-cw"></i> Run sweep';
      window.refreshIcons?.();
    }
  };

  document.getElementById('pd-digest').onclick = async () => {
    const btn = document.getElementById('pd-digest');
    btn.disabled = true;
    try {
      const out = await api.productDigest(id, 7);
      const md = out?.markdown || out || '';
      await navigator.clipboard.writeText(md);
      const toast = document.createElement('div');
      toast.className = 'toast toast-success';
      toast.innerHTML = `📋 Weekly digest copied (${(md || '').length.toLocaleString()} chars)`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3500);
    } catch (e) {
      alert(`Couldn't build digest: ${e?.message || e}`);
    } finally {
      btn.disabled = false;
    }
  };

  renderAll();
}

// Stage-Gate verdict labels (Cooper, 2017). Persisted on the product row
// itself so every dashboard load sees the latest verdict with no extra
// query. The button below the header lets users update it inline; the
// button row itself emits a custom 'pd-gate-clicked' event that the
// dashboard wires up at render time.
const GATE_LABEL = {
  go: 'Go',
  kill: 'Kill',
  hold: 'Hold',
  recycle: 'Recycle',
};

function renderGateBar(product) {
  const current = (product.gate_status || '').toLowerCase();
  const decidedAt = product.gate_decided_at
    ? new Date(product.gate_decided_at).toLocaleString()
    : '';
  const notes = (product.gate_notes || '').trim();
  const buttons = ['go', 'kill', 'hold', 'recycle'].map(k => `
    <button class="btn btn-sm pd-gate-btn ${current === k ? 'pd-gate-active pd-gate-' + k : ''}"
            data-gate="${k}">
      ${GATE_LABEL[k]}
    </button>
  `).join('');
  const clearBtn = current
    ? `<button class="btn btn-ghost btn-sm pd-gate-btn" data-gate="">Clear</button>`
    : '';
  return `
    <section class="pd-gate-bar card">
      <div class="pd-gate-row">
        <div class="pd-gate-label">
          <strong>Stage-Gate verdict</strong>
          <span class="muted" style="font-size:11px;margin-left:6px">Cooper (2017) · Go / Kill / Hold / Recycle</span>
        </div>
        <div class="pd-gate-buttons">${buttons}${clearBtn}</div>
      </div>
      ${current
        ? `<div class="pd-gate-meta muted" style="font-size:11.5px;margin-top:6px">
             Current: <b class="pd-gate-current pd-gate-${current}">${GATE_LABEL[current] || current}</b>
             ${decidedAt ? ` · decided ${esc(decidedAt)}` : ''}
             ${notes ? `<div class="pd-gate-notes">${esc(notes)}</div>` : ''}
           </div>`
        : `<div class="pd-gate-meta muted" style="font-size:11.5px;margin-top:6px">No verdict yet — set one to lock in your Stage-Gate decision.</div>`
      }
    </section>
  `;
}

function wireGateBar(productId, refreshFn) {
  document.querySelectorAll('.pd-gate-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.gate || '';
      let notes = '';
      if (status) {
        const proposed = window.prompt(
          `Notes for "${GATE_LABEL[status] || status}" verdict (optional):`,
          '',
        );
        if (proposed === null) return;  // user cancelled
        notes = (proposed || '').trim();
      }
      btn.disabled = true;
      try {
        const out = await api.productGateSet(productId, status, notes);
        if (!out?.ok) throw new Error(out?.error || 'gate update failed');
        if (typeof refreshFn === 'function') await refreshFn(false);
      } catch (e) {
        btn.disabled = false;
        alert(`Couldn't update verdict: ${e?.message || e}`);
      }
    });
  });
}

function renderHeader(product, signals) {
  const openCount = signals.filter(s => !s.user_action || s.user_action === '').length;
  const lastSwept = product.last_swept_at
    ? new Date(product.last_swept_at).toLocaleString()
    : 'never';
  return `
    <section class="pd-header card">
      <div style="flex:1">
        <h2 style="margin:0">${esc(product.name || '')}</h2>
        ${product.one_liner ? `<p class="muted" style="margin:4px 0 0">${esc(product.one_liner)}</p>` : ''}
        <div class="pd-meta muted" style="margin-top:8px">
          <span>${esc(product.category || 'no category')}</span>
          <span>·</span>
          <span>Topic: <code>${esc(product.topic || '—')}</code></span>
          <span>·</span>
          <span>Last sweep: ${esc(lastSwept)}</span>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:28px;font-weight:600;line-height:1">${openCount}</div>
        <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px">open signals</div>
      </div>
    </section>
  `;
}

function renderSignalsSection(signals) {
  if (!signals.length) {
    return `
      <section class="pd-section card">
        <h3><i data-lucide="inbox"></i> The Signals</h3>
        <p class="muted">No open signals. Run a sweep to scan the last 24 h.</p>
      </section>
    `;
  }
  const openSignals = signals.filter(s => !s.user_action || s.user_action === '');
  const rows = openSignals.slice(0, 20).map(s => signalCard(s)).join('');
  return `
    <section class="pd-section card">
      <h3><i data-lucide="inbox"></i> The Signals <span class="muted">(${openSignals.length} open)</span></h3>
      <p class="muted" style="font-size:12px">Ranked by severity × confidence. Dismiss / snooze / convert to hypothesis per signal.</p>
      <div class="pd-signal-list">${rows}</div>
    </section>
  `;
}

function signalCard(s) {
  const cls = sevClass(s.severity, s.confidence);
  const emoji = signalEmoji(s.signal_type);
  const type = (s.signal_type || '').replace(/_/g, ' ');
  return `
    <div class="pd-signal ${cls}" data-signal-id="${esc(s.id)}">
      <div class="pd-signal-head">
        <span class="pd-signal-emoji">${emoji}</span>
        <div class="pd-signal-title">
          <b>${esc(s.title || '(untitled)')}</b>
          <div class="muted" style="font-size:11px">${esc(type)}
            ${s.related_competitor ? ` · ${esc(s.related_competitor)}` : ''}
            · sev ${Number(s.severity || 0).toFixed(2)} · conf ${Number(s.confidence || 0).toFixed(2)}</div>
        </div>
      </div>
      ${s.description ? `<p class="pd-signal-desc">${esc(s.description)}</p>` : ''}
      ${s.suggested_action ? `<p class="pd-signal-action"><b>→</b> ${esc(s.suggested_action)}</p>` : ''}
      <div class="pd-signal-verbs">
        <button class="btn btn-ghost btn-xs" data-action="acted"><i data-lucide="check"></i> Acted</button>
        <button class="btn btn-ghost btn-xs" data-action="hypothesis"><i data-lucide="target"></i> Convert to bet</button>
        <button class="btn btn-ghost btn-xs" data-action="snoozed"><i data-lucide="alarm-clock"></i> Snooze 7d</button>
        <button class="btn btn-ghost btn-xs" data-action="dismissed"><i data-lucide="x"></i> Dismiss</button>
      </div>
    </div>
  `;
}

function wireSignalActions(productId, refreshFn) {
  document.querySelectorAll('.pd-signal').forEach(el => {
    const sid = el.dataset.signalId;
    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        el.style.opacity = '0.5';
        try {
          await api.productSignalAction(sid, action, '', 7);
          if (typeof refreshFn === 'function') await refreshFn(false);
        } catch (e) {
          el.style.opacity = '1';
          alert(`Couldn't ${action}: ${e?.message || e}`);
        }
      });
    });
  });
}

function renderMirrorSection(mirror) {
  if (!mirror.ok) {
    return `<section class="pd-section card"><h3><i data-lucide="user-circle"></i> The Mirror</h3><p class="muted">No data yet.</p></section>`;
  }
  const reg = mirror.regressions || [];
  const spikes = mirror.mention_spikes || [];
  return `
    <section class="pd-section card">
      <h3><i data-lucide="user-circle"></i> The Mirror <span class="muted">— you</span></h3>
      ${reg.length
        ? `<p style="margin:4px 0;font-weight:600;color:#C2381B">🔻 ${reg.length} regression signal${reg.length === 1 ? '' : 's'}</p>
          <ul class="pd-compact">${reg.slice(0, 5).map(s => `<li>${esc(s.title)}</li>`).join('')}</ul>`
        : `<p class="muted" style="margin:4px 0">No regression signals this week. Baseline holds.</p>`}
      ${spikes.length
        ? `<p style="margin:8px 0 4px;font-weight:600">🔊 ${spikes.length} mention spike${spikes.length === 1 ? '' : 's'}</p>
          <ul class="pd-compact">${spikes.slice(0, 5).map(s => `<li>${esc(s.title)}</li>`).join('')}</ul>` : ''}
    </section>
  `;
}

function renderLensSection(lens, competitors) {
  if (!lens.ok || !(lens.competitors || []).length) {
    return `
      <section class="pd-section card">
        <h3><i data-lucide="binoculars"></i> The Lens <span class="muted">— competitors</span></h3>
        <p class="muted">${competitors.length === 0 ? 'No competitors tracked yet.' : 'No competitor signals this week.'}</p>
      </section>
    `;
  }
  const rows = lens.competitors.slice(0, 8).map(c => {
    const rel = (c.releases || []).length;
    const vul = (c.vulnerabilities || []).length;
    return `
      <div class="pd-competitor-row">
        <b>${esc(c.name)}</b>
        <span class="muted" style="font-size:11px">
          ${rel ? `🚀 ${rel} release${rel === 1 ? '' : 's'}` : ''}
          ${rel && vul ? ' · ' : ''}
          ${vul ? `🎯 ${vul} weakness${vul === 1 ? '' : 'es'}` : ''}
          ${!rel && !vul ? 'no signals' : ''}
        </span>
      </div>
    `;
  }).join('');
  return `
    <section class="pd-section card">
      <h3><i data-lucide="binoculars"></i> The Lens <span class="muted">— competitors</span></h3>
      ${rows}
    </section>
  `;
}

function renderFieldSection(field) {
  if (!field.ok) {
    return `<section class="pd-section card"><h3><i data-lucide="map"></i> The Field</h3><p class="muted">No data yet.</p></section>`;
  }
  const top = field.top_findings || [];
  const emerging = field.emerging || [];
  const rising = field.rising || [];
  return `
    <section class="pd-section card">
      <h3><i data-lucide="map"></i> The Field <span class="muted">— ${esc(field.category || 'category')}</span></h3>
      ${emerging.length
        ? `<p style="margin:4px 0"><b>⚠ Emerging (${emerging.length})</b></p>
          <ul class="pd-compact">${emerging.slice(0, 3).map(s => `<li>${esc(s.title)}</li>`).join('')}</ul>` : ''}
      ${rising.length
        ? `<p style="margin:4px 0"><b>📈 Rising scores (${rising.length})</b></p>
          <ul class="pd-compact">${rising.slice(0, 3).map(s => `<li>${esc(s.title)}</li>`).join('')}</ul>` : ''}
      ${top.length
        ? `<p style="margin:8px 0 4px"><b>Top ${Math.min(5, top.length)} opportunities in last synthesis</b></p>
          <ul class="pd-compact">${top.slice(0, 5).map(f => `<li><b>${(f.opportunity_score || 0).toFixed(1)}/20</b> — ${esc(f.title || '')}</li>`).join('')}</ul>` : ''}
      ${!emerging.length && !rising.length && !top.length
        ? `<p class="muted">No category signals yet. Run a sweep with <code>--with-collect</code> for fresh data.</p>` : ''}
    </section>
  `;
}

function renderSweepsSection(sweeps) {
  if (!sweeps.length) return '';
  return `
    <section class="pd-section card" style="margin-top:16px">
      <h3><i data-lucide="history"></i> Recent sweeps</h3>
      <table class="pd-sweep-table">
        <thead>
          <tr><th>When</th><th>Trigger</th><th>Signals</th><th>Duration</th><th>Notes</th></tr>
        </thead>
        <tbody>
          ${sweeps.slice(0, 10).map(s => `
            <tr>
              <td>${esc(new Date(s.run_at).toLocaleString())}</td>
              <td>${esc(s.trigger)}</td>
              <td>${s.signals_generated || 0}</td>
              <td>${s.duration_ms ? (s.duration_ms / 1000).toFixed(1) + 's' : '—'}</td>
              <td class="muted" style="font-size:11px">${esc(s.error || s.notes || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `;
}
