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
  return `
    <a class="product-tile" data-product-id="${esc(p.id)}">
      <div class="product-tile-head">
        <h4>${esc(p.name)}</h4>
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
    <div id="pd-signals"></div>
    <div class="pd-sections-grid">
      <div id="pd-mirror"></div>
      <div id="pd-lens"></div>
    </div>
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
    document.getElementById('pd-signals').innerHTML = renderSignalsSection(data.signals || []);
    document.getElementById('pd-mirror').innerHTML = renderMirrorSection(data.mirror || {});
    document.getElementById('pd-lens').innerHTML = renderLensSection(data.lens || {}, data.competitors || []);
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
