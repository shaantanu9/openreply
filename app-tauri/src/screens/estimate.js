// PERT Estimation + Cost Model screen — per product.
//
// Three-Point PERT (US Navy, 1958; McConnell, 2006):
//   E  = (O + 4M + P) / 6
//   SD = (P − O) / 6
//
// Plus McConnell's 1.5–2× overhead multiplier and 15–20% contingency,
// LTV/CAC ratio (Skok), and 2–3 tier price proposals.
//
// Route: #/estimate/<productId>
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ROLES = ['eng', 'design', 'qa', 'pm'];
const TIERS = ['mvp', 'standard', 'full'];

function productIdFromHash() {
  const m = (location.hash || '').match(/^#\/estimate\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function fmtMoney(amount, units = 'USD') {
  const n = Number(amount || 0);
  if (!n) return '—';
  return `${units} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function taskRow(t) {
  return `
    <tr data-task-id="${esc(t.id)}">
      <td><input class="pert-label" type="text" value="${esc(t.label || '')}" placeholder="Task name"/></td>
      <td>
        <select class="pert-role">
          ${ROLES.map(r => `<option value="${r}" ${t.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td><input class="pert-o"   type="number" min="0" step="0.5" value="${t.optimistic ?? 0}"/></td>
      <td><input class="pert-m"   type="number" min="0" step="0.5" value="${t.most_likely ?? 0}"/></td>
      <td><input class="pert-p"   type="number" min="0" step="0.5" value="${t.pessimistic ?? 0}"/></td>
      <td class="pert-e">${(t.expected ?? 0).toFixed(2)}</td>
      <td class="pert-sd">${(t.stddev ?? 0).toFixed(2)}</td>
      <td>
        <select class="pert-tier">
          ${TIERS.map(x => `<option value="${x}" ${t.tier === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
      </td>
      <td><button class="btn-mini pert-delete">×</button></td>
    </tr>
  `;
}

function rollupSummary(r) {
  if (!r || (r.n || 0) === 0) {
    return `<div class="muted">No tasks yet — add a few rows to see totals.</div>`;
  }
  const byRole = Object.entries(r.by_role || {}).map(([k, v]) =>
    `<span class="estimate-role-pill">${esc(k)}: ${v}d</span>`,
  ).join('') || '';
  return `
    <div class="estimate-rollup-grid">
      <div><div class="muted">Raw expected</div><div class="estimate-num">${r.expected_days_raw} d</div></div>
      <div><div class="muted">× ${r.multiplier}× overhead</div><div class="estimate-num">${r.expected_days_with_overhead} d</div></div>
      <div><div class="muted">+ ${r.contingency_pct}% contingency</div><div class="estimate-num estimate-final">${r.expected_days_with_contingency} d</div></div>
      <div><div class="muted">σ (stddev)</div><div class="estimate-num">±${r.stddev_days} d</div></div>
    </div>
    <div class="estimate-by-role">${byRole}</div>
  `;
}

function tierRow(t, idx) {
  return `
    <div class="cost-tier-row" data-tier-idx="${idx}">
      <input class="ct-name"     type="text"  placeholder="MVP / Standard / Full" value="${esc(t.name || '')}"/>
      <input class="ct-scope"    type="text"  placeholder="Short scope description" value="${esc(t.scope || '')}"/>
      <input class="ct-weeks-lo" type="number" min="0" step="1" placeholder="weeks (lo)" value="${t.weeks_lo ?? 0}"/>
      <input class="ct-weeks-hi" type="number" min="0" step="1" placeholder="weeks (hi)" value="${t.weeks_hi ?? 0}"/>
      <input class="ct-price-lo" type="number" min="0" step="100" placeholder="$ (lo)" value="${t.price_lo ?? 0}"/>
      <input class="ct-price-hi" type="number" min="0" step="100" placeholder="$ (hi)" value="${t.price_hi ?? 0}"/>
      <input class="ct-excludes" type="text" placeholder="explicitly excluded" value="${esc(t.excludes || '')}"/>
      <button class="btn-mini ct-delete" data-tier-idx="${idx}">×</button>
    </div>
  `;
}

function renderShell(productId, product, tasks, rollup, cost) {
  const taskRows = (tasks || []).map(taskRow).join('') ||
    `<tr><td colspan="9" class="muted" style="padding:14px">No tasks yet.</td></tr>`;
  const tierRows = (cost?.tiers || []).map(tierRow).join('');
  const ratio = (cost?.ltv && cost?.cac) ? (cost.ltv / cost.cac) : 0;
  const ratioVerdict = ratio >= 3
    ? '<span class="pmf-met">✅ healthy</span>'
    : (cost?.ltv && cost?.cac) ? '<span class="pmf-unmet">⚠ unhealthy</span>' : '';

  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/products">Products</a> ›
        <a href="#/product/${esc(encodeURIComponent(productId))}">${esc(product?.name || productId)}</a> ›
        <strong>Estimation & cost</strong>
      </div>
      <div class="topbar-actions">
        <button class="btn primary icon-btn" id="estimate-export">
          <i data-lucide="file-text"></i> Export PRD
        </button>
      </div>
    </header>

    <div class="estimate-wrap">
      <section class="card">
        <h2>Three-Point PERT Estimation</h2>
        <p class="muted" style="font-size:12px;line-height:1.55">
          E = (O + 4M + P) / 6 · SD = (P − O) / 6 — US Navy, 1958.
          Multiply raw coding by 1.5–2× for total effort (meetings, reviews,
          QA, deploy, bugs); add 15–20% contingency for unknown unknowns.
        </p>
        <div class="estimate-controls">
          <label>Multiplier
            <input id="pert-multiplier" type="number" min="1" max="3" step="0.05" value="${rollup?.multiplier ?? 1.75}"/>
          </label>
          <label>Contingency %
            <input id="pert-contingency" type="number" min="0" max="50" step="0.5" value="${rollup?.contingency_pct ?? 17.5}"/>
          </label>
          <button class="btn icon-btn" id="pert-recompute">
            <i data-lucide="refresh-cw"></i> Recompute
          </button>
        </div>
        <div class="estimate-rollup">${rollupSummary(rollup)}</div>
      </section>

      <section class="card">
        <h3>Tasks</h3>
        <table class="pert-table">
          <thead>
            <tr>
              <th>Label</th><th>Role</th>
              <th>O</th><th>M</th><th>P</th>
              <th>E</th><th>SD</th>
              <th>Tier</th><th></th>
            </tr>
          </thead>
          <tbody id="pert-tbody">${taskRows}</tbody>
        </table>
        <div class="pert-add-row">
          <input id="pert-new-label" type="text" placeholder="Task label" />
          <select id="pert-new-role">${ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
          <input id="pert-new-o" type="number" min="0" step="0.5" placeholder="O (days)"/>
          <input id="pert-new-m" type="number" min="0" step="0.5" placeholder="M (days)"/>
          <input id="pert-new-p" type="number" min="0" step="0.5" placeholder="P (days)"/>
          <select id="pert-new-tier">${TIERS.map(x => `<option value="${x}">${x}</option>`).join('')}</select>
          <button class="btn primary" id="pert-add">+ Add task</button>
        </div>
      </section>

      <section class="card">
        <h2>Cost model & pricing tiers</h2>
        <p class="muted" style="font-size:12px;line-height:1.55">
          Blank/Dorf 2012; David Skok SaaS Metrics 2.0.
          LTV must exceed 3× CAC for a sustainable business.
        </p>
        <div class="cost-grid">
          <label>Currency
            <input id="cost-currency" type="text" value="${esc(cost?.currency || 'USD')}" maxlength="6"/>
          </label>
          <label>Blended hourly rate
            <input id="cost-rate" type="number" min="0" step="5" value="${cost?.blended_rate || 0}"/>
          </label>
          <label>Infrastructure / month
            <input id="cost-infra" type="number" min="0" step="50" value="${cost?.infra_monthly || 0}"/>
          </label>
          <label>Maintenance % / yr (15–20% std.)
            <input id="cost-maint" type="number" min="0" max="100" step="0.5" value="${cost?.maintenance_pct ?? 18}"/>
          </label>
          <label>Lifetime value (LTV)
            <input id="cost-ltv" type="number" min="0" step="50" value="${cost?.ltv || 0}"/>
          </label>
          <label>Customer acquisition cost (CAC)
            <input id="cost-cac" type="number" min="0" step="10" value="${cost?.cac || 0}"/>
          </label>
        </div>
        <div class="cost-ratio">
          <strong>LTV / CAC = ${ratio ? ratio.toFixed(2) : '—'}×</strong> ${ratioVerdict}
        </div>

        <h3 style="margin-top:18px">Tier proposals</h3>
        <div class="cost-tier-list" id="cost-tiers">${tierRows}</div>
        <button class="btn-mini" id="cost-add-tier">+ add tier</button>

        <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn primary" id="cost-save">Save cost model</button>
        </div>
      </section>
    </div>
  `;
}

async function recomputeAndRender(root, productId) {
  const product = await api.productGet(productId, true).catch(() => ({}));
  const [tasksResp, rollupResp, costResp] = await Promise.all([
    api.pertList(productId).catch(() => ({ tasks: [] })),
    api.pertRollup(productId).catch(() => ({})),
    api.costModelGet(productId).catch(() => ({})),
  ]);
  return { product, tasks: tasksResp?.tasks || [], rollup: rollupResp, cost: costResp };
}

export async function renderEstimate(root, { params }) {
  const id = decodeURIComponent(params?.[0] || '');
  if (!id) {
    root.innerHTML = `<div class="empty-big"><h3>No product ID</h3></div>`;
    return;
  }
  root.innerHTML = `<div class="empty-state">Loading estimation…</div>`;
  const reload = async () => {
    const { product, tasks, rollup, cost } = await recomputeAndRender(root, id);
    root.innerHTML = renderShell(id, product?.product || product, tasks, rollup, cost);
    window.refreshIcons?.();
    wire();
  };

  const wire = () => {
    // Multiplier / contingency recompute
    $('#pert-recompute', root)?.addEventListener('click', async () => {
      const mult = parseFloat($('#pert-multiplier', root).value || '1.75');
      const cont = parseFloat($('#pert-contingency', root).value || '17.5');
      const r = await api.pertRollup(id, { multiplier: mult, contingency_pct: cont });
      const mount = $('.estimate-rollup', root);
      if (mount) mount.innerHTML = rollupSummary(r);
    });

    // Add task
    $('#pert-add', root)?.addEventListener('click', async () => {
      const label = $('#pert-new-label', root).value.trim();
      if (!label) { alert('Label required.'); return; }
      const fields = {
        optimistic:   parseFloat($('#pert-new-o', root).value || '0'),
        most_likely:  parseFloat($('#pert-new-m', root).value || '0'),
        pessimistic:  parseFloat($('#pert-new-p', root).value || '0'),
        role:         $('#pert-new-role', root).value,
        tier:         $('#pert-new-tier', root).value,
      };
      try {
        await api.pertAdd(id, label, fields);
        await reload();
      } catch (e) { alert(`Add failed: ${e?.message || e}`); }
    });

    // Inline task editing — debounced save on change
    $$('.pert-table tbody tr', root).forEach(tr => {
      const tid = tr.dataset.taskId;
      tr.querySelectorAll('input, select').forEach(inp => {
        if (inp.classList.contains('pert-delete')) return;
        inp.addEventListener('change', async () => {
          const fields = {
            label:       tr.querySelector('.pert-label')?.value || '',
            role:        tr.querySelector('.pert-role')?.value || 'eng',
            optimistic:  parseFloat(tr.querySelector('.pert-o')?.value || '0'),
            most_likely: parseFloat(tr.querySelector('.pert-m')?.value || '0'),
            pessimistic: parseFloat(tr.querySelector('.pert-p')?.value || '0'),
            tier:        tr.querySelector('.pert-tier')?.value || 'mvp',
          };
          try {
            const r = await api.pertUpdate(tid, fields);
            const t = r?.task;
            if (t) {
              tr.querySelector('.pert-e').textContent = (t.expected ?? 0).toFixed(2);
              tr.querySelector('.pert-sd').textContent = (t.stddev ?? 0).toFixed(2);
              const mult = parseFloat($('#pert-multiplier', root).value || '1.75');
              const cont = parseFloat($('#pert-contingency', root).value || '17.5');
              const ru = await api.pertRollup(id, { multiplier: mult, contingency_pct: cont });
              const mount = $('.estimate-rollup', root);
              if (mount) mount.innerHTML = rollupSummary(ru);
            }
          } catch (e) {
            console.warn('pert update failed', e);
          }
        });
      });
      tr.querySelector('.pert-delete')?.addEventListener('click', async () => {
        if (!confirm('Delete this task?')) return;
        try {
          await api.pertDelete(tid);
          await reload();
        } catch (e) { alert(`Delete failed: ${e?.message || e}`); }
      });
    });

    // Cost model + tiers
    const buildPayload = () => {
      const tiers = $$('.cost-tier-row', root).map(row => ({
        name:     row.querySelector('.ct-name')?.value || '',
        scope:    row.querySelector('.ct-scope')?.value || '',
        weeks_lo: parseFloat(row.querySelector('.ct-weeks-lo')?.value || '0'),
        weeks_hi: parseFloat(row.querySelector('.ct-weeks-hi')?.value || '0'),
        price_lo: parseFloat(row.querySelector('.ct-price-lo')?.value || '0'),
        price_hi: parseFloat(row.querySelector('.ct-price-hi')?.value || '0'),
        excludes: row.querySelector('.ct-excludes')?.value || '',
      }));
      return {
        currency:        $('#cost-currency', root).value || 'USD',
        blended_rate:    parseFloat($('#cost-rate', root).value || '0'),
        infra_monthly:   parseFloat($('#cost-infra', root).value || '0'),
        maintenance_pct: parseFloat($('#cost-maint', root).value || '0'),
        ltv:             parseFloat($('#cost-ltv', root).value || '0'),
        cac:             parseFloat($('#cost-cac', root).value || '0'),
        tiers,
      };
    };

    $('#cost-add-tier', root)?.addEventListener('click', () => {
      const list = $('#cost-tiers', root);
      const idx = $$('.cost-tier-row', list).length;
      const wrap = document.createElement('div');
      wrap.innerHTML = tierRow({}, idx);
      list.appendChild(wrap.firstElementChild);
      window.refreshIcons?.();
      // Wire delete on the new row
      list.querySelectorAll('.ct-delete').forEach(b => {
        b.onclick = () => b.closest('.cost-tier-row')?.remove();
      });
    });
    $$('.ct-delete', root).forEach(b => {
      b.onclick = () => b.closest('.cost-tier-row')?.remove();
    });

    $('#cost-save', root)?.addEventListener('click', async () => {
      const payload = buildPayload();
      const btn = $('#cost-save', root);
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api.costModelSet(id, payload);
        btn.textContent = '✓ Saved';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save cost model'; }, 1500);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save cost model';
        alert(`Save failed: ${e?.message || e}`);
      }
    });

    $('#estimate-export', root)?.addEventListener('click', () => {
      location.hash = `#/prd/${encodeURIComponent(id)}`;
    });
  };

  await reload();
}
