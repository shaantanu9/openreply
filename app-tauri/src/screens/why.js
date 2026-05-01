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

const $ = (sel, root = document) => root.querySelector(sel);

function slugFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/why\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function renderSectionList(rows) {
  if (!rows || !rows.length) return '<li class="muted">No explanations available.</li>';
  return rows.map(r =>
    `<li><a href="#/why/${esc(r.slug)}"><b>${esc(r.title)}</b><span class="muted"> — ${esc(r.purpose || '')}</span></a></li>`
  ).join('');
}

function renderCitations(items) {
  if (!items || !items.length) return '';
  return `
    <h3>Citations</h3>
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

function renderExplanation(e) {
  return `
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
  `;
}

function renderIndex(rows) {
  return `
    <header class="topbar">
      <div class="crumbs"><strong>Why & Science</strong> · explainers for every screen</div>
    </header>
    <div class="why-wrap">
      <section class="why-intro card">
        <h2>Why every screen is here</h2>
        <p class="muted why-tagline">A short, plain-English page for every screen — what it's for, what science it draws from, and how it touches your data. Click any title to read.</p>
      </section>
      <section class="why-section card">
        <ul class="why-index">${renderSectionList(rows)}</ul>
      </section>
    </div>
  `;
}

export async function renderWhy(root) {
  const myGen = root.dataset.routeGen;
  const stillHere = () => root.dataset.routeGen === myGen;

  const slug = slugFromHash();

  if (!slug) {
    root.innerHTML = `<div class="empty-state">Loading explanations…</div>`;
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
    return;
  }

  root.innerHTML = `<div class="empty-state">Loading…</div>`;
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
