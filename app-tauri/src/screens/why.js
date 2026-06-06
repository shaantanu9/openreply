// Why-this-page explainer screen.
//
// Renders a single page_explanations row as three sections:
//   1. WHY this page exists (purpose)
//   2. WHAT science backs it (frameworks + citations)
//   3. HOW we fetch your data (non-technical, trust-building)
//
// Routed at /why or /why/<slug>. The eye-icon on every page links here.
// If no slug is given, the screen lists every available explainer
// alphabetically so users can browse.

import { api, esc } from '../api.js';
import { skelDetail } from '../lib/skeleton.js';

const $ = (sel, root = document) => root.querySelector(sel);

function slugFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/why\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// Best-effort "edited 3 days ago"-style label from an ISO timestamp. Returns
// '' on anything unparseable so callers can omit the meta line entirely.
function relTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function renderSectionList(rows) {
  return rows.map(r =>
    `<li><a href="#/why/${esc(r.slug)}"><b>${esc(r.title)}</b><span class="muted"> — ${esc(r.purpose || '')}</span></a></li>`
  ).join('');
}

function renderCitations(items) {
  if (!items || !items.length) return '';
  return `
    <p class="why-kicker">Citations</p>
    <ol class="why-cites">
      ${items.map(c => `<li>${esc(c)}</li>`).join('')}
    </ol>
  `;
}

function renderFrameworks(items) {
  if (!items || !items.length) return '';
  return `<div class="why-fw-row">
    ${items.map(f => `<span class="why-fw-chip">${esc(f)}</span>`).join('')}
  </div>`;
}

function renderMeta(e) {
  const bits = [];
  const rel = relTime(e.updated_at);
  if (rel) bits.push(`Updated ${esc(rel)}`);
  if (e.touched_by_user) bits.push('Customised on this machine');
  if (!bits.length) return '';
  return `<p class="muted why-meta" style="margin:10px 0 0;font-size:12px">
    <i data-lucide="clock"></i> ${bits.join(' · ')}
  </p>`;
}

function renderExplanation(e) {
  return `
    <div class="why-page shell">
    <header class="topbar">
      <div class="crumbs">
        <a href="#/why">Why & Science</a> ›
        <strong>${esc(e.title)}</strong>
      </div>
    </header>

    <div class="why-wrap">
      <section class="why-intro card">
        <h2>${esc(e.title)}</h2>
        <p class="muted why-tagline">Why this page exists, what science backs it, and how it touches your data — in plain English. We owe you that much before you trust the output.</p>
        ${renderMeta(e)}
      </section>

      <section class="why-section card">
        <h3><i data-lucide="compass"></i> Why this page exists</h3>
        <p>${esc(e.purpose || '—')}</p>
      </section>

      <section class="why-section card">
        <h3><i data-lucide="flask-conical"></i> The science behind it</h3>
        <p>${esc(e.science || '—')}</p>
        ${renderFrameworks(e.frameworks)}
        ${renderCitations(e.citations)}
      </section>

      <section class="why-section card">
        <h3><i data-lucide="database"></i> How we fetch your data</h3>
        <p>${esc(e.data_source || '—')}</p>
        <div class="why-promise muted">
          <i data-lucide="shield-check"></i>
          <span>Everything you see in Gap Map runs on your machine — your corpus, embeddings, and analyses live in a local SQLite database. The only network calls are the ones you authorise (collects, LLM API calls with your own keys).</span>
        </div>
      </section>

      <section class="why-section card why-back">
        <a class="btn primary" href="#/why">← Browse all page explanations</a>
      </section>
    </div>
    </div>
  `;
}

function renderIndex(rows) {
  // No explanations at all — first run before the Python side seeds the
  // page_explanations table, or a wiped DB. Tell the user how to populate it.
  if (!rows || !rows.length) {
    return `
      <div class="why-page shell">
      <header class="topbar">
        <div class="crumbs"><strong>Why & Science</strong> · explainers for every screen</div>
      </header>
      <div class="why-wrap">
        <div class="empty-big">
          <h3>No explanations yet</h3>
          <p>The "why this page exists" library seeds itself automatically the
          first time you open any screen's eye icon. Open a topic, dashboard, or
          any other screen, click its <b>Why this page</b> button, and the full
          library will appear here.</p>
          <a class="btn primary" href="#/">Go to Dashboard</a>
        </div>
      </div>
      </div>
    `;
  }
  return `
    <div class="why-page shell">
    <header class="topbar">
      <div class="crumbs"><strong>Why & Science</strong> · explainers for every screen</div>
    </header>
    <div class="why-wrap">
      <section class="why-intro card">
        <h2>Why every screen is here</h2>
        <p class="muted why-tagline">A short, plain-English page for every screen — what it's for, what science it draws from, and how it touches your data. Click any title to read.</p>
      </section>
      <section class="why-section card">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div class="why-search" style="position:relative;flex:1;min-width:200px">
            <i data-lucide="search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--ink-3)"></i>
            <input id="why-filter" type="search" placeholder="Filter screens…" autocomplete="off"
              style="width:100%;padding:9px 12px 9px 32px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--ink-1);font-size:14px" />
          </div>
          <span class="muted" id="why-count" style="font-size:13px;white-space:nowrap">${rows.length} screen${rows.length === 1 ? '' : 's'}</span>
        </div>
        <ul class="why-index" id="why-list">${renderSectionList(rows)}</ul>
      </section>
    </div>
    </div>
  `;
}

// Wire the index search box to client-side filter the already-loaded rows.
// No extra api call — the full list is in memory; we just re-render the <ul>.
function wireIndexFilter(root, rows, stillHere) {
  const input = $('#why-filter', root);
  const list = $('#why-list', root);
  const count = $('#why-count', root);
  if (!input || !list) return;

  const apply = () => {
    if (!stillHere()) return;
    const q = input.value.trim().toLowerCase();
    const matched = !q ? rows : rows.filter((r) => {
      const hay = `${r.title || ''} ${r.purpose || ''} ${r.slug || ''}`.toLowerCase();
      return hay.includes(q);
    });
    if (!matched.length) {
      list.innerHTML = `<li class="muted" style="padding:18px 0">No screens match “${esc(input.value.trim())}”.</li>`;
    } else {
      list.innerHTML = renderSectionList(matched);
    }
    if (count) {
      count.textContent = q
        ? `${matched.length} of ${rows.length}`
        : `${rows.length} screen${rows.length === 1 ? '' : 's'}`;
    }
  };

  input.addEventListener('input', apply);
}

export async function renderWhy(root) {
  const myGen = root.dataset.routeGen;
  const stillHere = () => root.dataset.routeGen === myGen;

  const slug = slugFromHash();

  if (!slug) {
    root.innerHTML = skelDetail({ paras: 6 });
    let rows = [];
    try {
      const out = await api.pageExplanationsList();
      rows = out?.explanations || [];
    } catch (e) {
      if (!stillHere()) return;
      root.innerHTML = `<div class="empty-big"><h3>Couldn't load explanations</h3><p>${esc(e?.message || e)}</p></div>`;
      return;
    }
    if (!stillHere()) return;
    root.innerHTML = renderIndex(rows);
    window.refreshIcons?.();
    wireIndexFilter(root, rows, stillHere);
    return;
  }

  root.innerHTML = skelDetail({ paras: 6 });
  let exp;
  try {
    exp = await api.pageExplanationGet(slug);
  } catch (e) {
    if (!stillHere()) return;
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load explanation</h3><p>${esc(e?.message || e)}</p><a class="btn" href="#/why">← Back to all explanations</a></div>`;
    return;
  }
  if (!stillHere()) return;
  if (!exp?.ok) {
    root.innerHTML = `<div class="empty-big"><h3>No explanation for "${esc(slug)}"</h3><a class="btn" href="#/why">← Back to all explanations</a></div>`;
    return;
  }
  root.innerHTML = renderExplanation(exp);
  window.refreshIcons?.();
}

// ── Reusable eye-icon helper ─────────────────────────────────────────────
// Drop into any screen's topbar to surface a "why this page exists" link.
// Usage:
//   import { whyButtonHTML } from './why.js';
//   header.innerHTML += whyButtonHTML('empathy');
//
// The button is a plain <a> so middle-click / cmd-click open in a new
// tab. No event wiring needed.
export function whyButtonHTML(slug, opts = {}) {
  const { label = 'Why this page', size = 'sm' } = opts;
  const sizeCls = size === 'xs' ? 'btn-xs' : size === 'sm' ? 'btn-sm' : '';
  return `
    <a class="btn btn-ghost btn-bordered why-eye-btn ${sizeCls}"
       href="#/why/${encodeURIComponent(slug)}"
       title="Why this page exists, what science backs it, and how we fetch your data">
      <i data-lucide="eye"></i>
      <span class="why-eye-label">${esc(label)}</span>
    </a>
  `;
}
