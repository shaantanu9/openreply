// ── AG-D: compare view ──
// Topic comparison screen — renders two synthesis reports side-by-side
// with Minto headers, top-5 findings, and shared / unique finding sets.
//
// Route: #/compare/<topicA>/<topicB>
//
// Finding intersection is computed client-side via a loose title match
// (strip punctuation, casefold, collapse whitespace). Anything in both
// corpora lands in the "shared" card; the remainders land in per-topic
// "unique" cards. Rendering duplicates (not imports) the Minto + findings
// markup from insights.js so the comparison view stays self-contained and
// future tweaks to insights.js don't break this screen.

import { api, esc } from '../api.js';

// ── Normalisers for the client-side intersection ─────────────────────
// Drop punctuation + non-word chars, collapse whitespace, casefold.
// Good enough for noisy LLM titles ("User onboarding drop-off" vs
// "User onboarding drop off" → same bucket).
function looseKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Score → opportunity colour class (mirrors insights.js) ───────────
function scoreClass(score) {
  if (score >= 15) return 'score-high';
  if (score >= 10) return 'score-mid';
  return 'score-low';
}

// ── Minto pyramid header (duplicated from insights.js) ───────────────
function renderMinto(report) {
  const gt = (report?.governing_thought || '').trim();
  const args = (report?.key_arguments || []).slice(0, 3);
  if (!gt && args.length === 0) {
    return `<section class="minto-pyramid"><div class="minto-gt"><div class="minto-gt-label">The answer</div><p class="minto-gt-text muted">(no governing thought yet)</p></div></section>`;
  }
  const argHtml = args.map((a, i) => `
    <div class="minto-arg">
      <div class="minto-arg-num">${i + 1}</div>
      <div class="minto-arg-body">
        <p class="minto-arg-claim">${esc(a.claim || '')}</p>
      </div>
    </div>
  `).join('');
  return `
    <section class="minto-pyramid">
      <div class="minto-gt">
        <div class="minto-gt-label">The answer</div>
        <p class="minto-gt-text">${esc(gt || '(no governing thought)')}</p>
      </div>
      ${args.length ? `<div class="minto-args">${argHtml}</div>` : ''}
    </section>
  `;
}

// ── Finding mini-card (compact version for comparison cols) ──────────
function renderFindingMini(f) {
  const op = f?.opportunity_score || 0;
  const cls = scoreClass(op);
  const kindEmoji = { painpoint: '🔥', feature_wish: '💡', workaround: '🛠' }[f?.kind] || '•';
  const imp = f?.importance ?? f?.pain_weight ?? 0;
  const sat = f?.satisfaction ?? 0;
  return `
    <div class="insight-card ${cls}" style="margin-bottom:10px">
      <div class="insight-head">
        <div class="insight-head-left">
          <span class="insight-kind">${kindEmoji}</span>
          <h3 style="font-size:14px">${esc(f?.title || '(untitled)')}</h3>
        </div>
        <div class="insight-score ${cls}">
          <b>${op.toFixed(1)}</b><span>opp</span>
        </div>
      </div>
      <div class="insight-meta">
        <span>🔥 imp <b>${imp.toFixed(1)}</b></span>
        <span>🛋 sat <b>${sat.toFixed(1)}</b></span>
      </div>
      ${f?.narrative ? `<p class="insight-narrative">${esc(f.narrative)}</p>` : ''}
    </div>
  `;
}

// ── Per-column header card ───────────────────────────────────────────
function renderColumn(topic, report, error) {
  if (error) {
    return `
      <div class="compare-col">
        <h2 style="margin-top:0">${esc(topic)}</h2>
        <div class="empty-state">
          <p>Couldn't load insights: ${esc(error)}</p>
        </div>
      </div>
    `;
  }
  if (!report || !report.ok) {
    return `
      <div class="compare-col">
        <h2 style="margin-top:0">${esc(topic)}</h2>
        <div class="empty-state">
          <p class="muted">No cached insight report for <b>${esc(topic)}</b>. Open the topic and click "Generate insights" first.</p>
          <a class="btn btn-ghost btn-sm btn-bordered" href="#/topic/${encodeURIComponent(topic)}">Open topic</a>
        </div>
      </div>
    `;
  }
  const findings = (report.findings || []).slice().sort(
    (a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0)
  ).slice(0, 5);
  return `
    <div class="compare-col">
      <h2 style="margin-top:0">
        <a href="#/topic/${encodeURIComponent(topic)}" style="text-decoration:none;color:inherit">${esc(topic)}</a>
      </h2>
      ${renderMinto(report)}
      <h3 style="margin:14px 0 8px;font-size:14px">Top ${findings.length} opportunities</h3>
      ${findings.length ? findings.map(renderFindingMini).join('') : '<p class="muted">No findings extracted.</p>'}
    </div>
  `;
}

// ── Shared / unique breakdown ────────────────────────────────────────
function computeOverlap(reportA, reportB) {
  const findingsA = (reportA?.findings || []);
  const findingsB = (reportB?.findings || []);
  const mapA = new Map();
  const mapB = new Map();
  findingsA.forEach(f => { const k = looseKey(f.title); if (k) mapA.set(k, f); });
  findingsB.forEach(f => { const k = looseKey(f.title); if (k) mapB.set(k, f); });

  const shared = [];
  const uniqueA = [];
  const uniqueB = [];
  for (const [k, fA] of mapA) {
    if (mapB.has(k)) shared.push({ key: k, a: fA, b: mapB.get(k) });
    else uniqueA.push(fA);
  }
  for (const [k, fB] of mapB) {
    if (!mapA.has(k)) uniqueB.push(fB);
  }
  // Sort each list by best opportunity score.
  const byOpp = (x, y) => (y.opportunity_score || 0) - (x.opportunity_score || 0);
  shared.sort((x, y) => (
    Math.max(y.a.opportunity_score || 0, y.b.opportunity_score || 0)
    - Math.max(x.a.opportunity_score || 0, x.b.opportunity_score || 0)
  ));
  uniqueA.sort(byOpp);
  uniqueB.sort(byOpp);
  return { shared, uniqueA, uniqueB };
}

function renderSharedCard(shared, topicA, topicB) {
  if (!shared.length) {
    return `
      <section class="compare-shared">
        <h2 style="margin-top:0">Shared findings</h2>
        <p class="muted">No overlapping findings between <b>${esc(topicA)}</b> and <b>${esc(topicB)}</b> (by loose title match).</p>
      </section>
    `;
  }
  const rows = shared.map(s => {
    const a = s.a, b = s.b;
    return `
      <div class="insight-card" style="margin-bottom:10px">
        <h3 style="margin:0 0 8px;font-size:14px">${esc(a.title || b.title || '(untitled)')}</h3>
        <div class="insight-meta">
          <span><b>${esc(topicA)}</b> opp ${(a.opportunity_score || 0).toFixed(1)}</span>
          <span><b>${esc(topicB)}</b> opp ${(b.opportunity_score || 0).toFixed(1)}</span>
        </div>
      </div>
    `;
  }).join('');
  return `
    <section class="compare-shared">
      <h2 style="margin-top:0">Shared findings <span class="muted">(${shared.length})</span></h2>
      <p class="muted">Findings that surface in both topics — strong triangulation signal.</p>
      ${rows}
    </section>
  `;
}

function renderUniqueCard(label, findings) {
  return `
    <section class="compare-unique">
      <h2 style="margin-top:0">Unique to ${esc(label)} <span class="muted">(${findings.length})</span></h2>
      ${findings.length ? findings.slice(0, 10).map(renderFindingMini).join('') : '<p class="muted">Nothing unique — every finding also appears in the other topic.</p>'}
    </section>
  `;
}

// ── Entry point ──────────────────────────────────────────────────────
export async function renderCompare(root, { params }) {
  const topicA = decodeURIComponent(params?.[0] || '');
  const topicB = decodeURIComponent(params?.[1] || '');

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a> /
        <strong>Compare</strong>
      </div>
      <div class="topbar-spacer"></div>
      <a href="#/topic/${encodeURIComponent(topicA)}" class="btn btn-ghost btn-sm btn-bordered">Open ${esc(topicA)}</a>
      <a href="#/topic/${encodeURIComponent(topicB)}" class="btn btn-ghost btn-sm btn-bordered">Open ${esc(topicB)}</a>
    </header>

    <div class="section-head">
      <div>
        <h2>${esc(topicA)} <span class="muted">vs</span> ${esc(topicB)}</h2>
        <p class="muted">Side-by-side synthesis reports — each Minto header, each top-5 opportunities, plus shared and unique findings.</p>
      </div>
    </div>

    <div id="compare-body"><div class="empty-state">Loading both reports…</div></div>
  `;
  window.refreshIcons?.();

  // Fetch both in parallel. `cached=true` means no LLM call — if a topic has
  // never been synthesised we simply surface the "Generate insights" nudge.
  const [resA, resB] = await Promise.allSettled([
    api.synthesizeInsights(topicA, true),
    api.synthesizeInsights(topicB, true),
  ]);
  const reportA = resA.status === 'fulfilled' ? resA.value : null;
  const errA = resA.status === 'rejected' ? (resA.reason?.message || String(resA.reason)) : null;
  const reportB = resB.status === 'fulfilled' ? resB.value : null;
  const errB = resB.status === 'rejected' ? (resB.reason?.message || String(resB.reason)) : null;

  const { shared, uniqueA, uniqueB } = computeOverlap(reportA, reportB);

  const body = root.querySelector('#compare-body');
  body.innerHTML = `
    <div class="compare-grid">
      ${renderColumn(topicA, reportA, errA)}
      ${renderColumn(topicB, reportB, errB)}
    </div>

    ${renderSharedCard(shared, topicA, topicB)}

    <div class="compare-grid">
      ${renderUniqueCard(topicA, uniqueA)}
      ${renderUniqueCard(topicB, uniqueB)}
    </div>
  `;
  window.refreshIcons?.();
}
