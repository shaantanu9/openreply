// Insights tab — Phase-1 market report view.
// Renders the full structured insight JSON from `research insights`:
//   - executive summary (narrative)
//   - opportunity quadrant (2×2 SVG: pain vs competitor coverage)
//   - ranked findings (scored, cited, with best-quote pull-outs)
//   - competitor list (features / weaknesses / pricing signal)
//
// Spec: docs/specs/2026-04-20-insight-engine.md
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

function scoreClass(score) {
  if (score >= 7.5) return 'score-high';
  if (score >= 5)   return 'score-mid';
  return 'score-low';
}

function renderCitationChips(evidencePostIds, topic) {
  // Clickable chips that drill into Posts tab filtered to the cited post(s).
  // If 1 chip: opens that single post. If N: shows "N evidence" button.
  if (!evidencePostIds || evidencePostIds.length === 0) return '';
  const n = evidencePostIds.length;
  return `<span class="insight-cite-chip" data-ev="${esc(evidencePostIds.join(','))}" title="Click to view evidence posts">
    <i data-lucide="paperclip"></i> ${n} evidence
  </span>`;
}

function renderSourceBadges(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return '';
  const entries = Object.entries(breakdown).filter(([, n]) => n > 0);
  if (!entries.length) return '';
  entries.sort((a, b) => b[1] - a[1]);
  const SRC = {
    reddit: '#FFE4D4', hn: '#FFECDA', arxiv: '#FBE3E6', openalex: '#EFE7FB',
    pubmed: '#E4F0FA', scholar: '#E1F2EA', appstore: '#F0E8FA', playstore: '#E0F2D9',
    devto: '#E8E8E8', stackoverflow: '#FEE8D6', github: '#E8E8E8', gnews: '#E1EEFC',
  };
  return entries.map(([src, n]) =>
    `<span class="insight-src-badge" data-source="${esc(src)}" style="background:${SRC[src] || '#E8E8E8'}"><b>${n}</b> ${esc(src)}</span>`
  ).join('');
}

function renderFindingCard(f) {
  const op = f.opportunity_score || 0;
  const pw = f.pain_weight || 0;
  const cc = f.competitor_coverage ?? 0.5;
  const cls = scoreClass(op);
  const kindEmoji = { painpoint: '🔥', feature_wish: '💡', workaround: '🛠' }[f.kind] || '•';
  const classification = f.classification && f.classification !== 'UNCLASSIFIED'
    ? `<span class="insight-chip chronic">${esc(f.classification)}</span>` : '';
  const quote = f.best_quote
    ? `<blockquote class="insight-quote">
        "${esc(f.best_quote)}"
        ${f.best_quote_attribution ? `<cite>— ${esc(f.best_quote_attribution.author || 'anon')} · ${esc(f.best_quote_attribution.source || 'unknown')}</cite>` : ''}
      </blockquote>`
    : '';
  const academic = (f.academic_backing || []).length > 0
    ? `<span class="insight-chip academic" title="${(f.academic_backing || []).slice(0,5).map(esc).join(' · ')}">📄 ${f.academic_backing.length} papers</span>`
    : '';
  return `
    <div class="insight-card ${cls}" data-finding="${esc(f.title || '')}">
      <div class="insight-head">
        <div class="insight-head-left">
          <span class="insight-kind">${kindEmoji}</span>
          <h3>${esc(f.title || '(untitled)')}</h3>
        </div>
        <div class="insight-score ${cls}" title="opportunity = pain × (1 - competitor_coverage) × academic bonus">
          <b>${op.toFixed(1)}</b>
          <span>opportunity</span>
        </div>
      </div>

      <div class="insight-meta">
        <span title="severity × frequency × source diversity">🔥 pain <b>${pw.toFixed(1)}</b></span>
        <span title="0 = greenfield, 1 = saturated">🏭 coverage <b>${cc.toFixed(2)}</b></span>
        ${classification}
        ${academic}
        ${renderCitationChips(f.evidence_post_ids)}
      </div>

      <p class="insight-narrative">${esc(f.narrative || '')}</p>

      ${quote}

      <div class="insight-sources">${renderSourceBadges(f.source_breakdown)}</div>
    </div>
  `;
}

function renderCompetitor(c) {
  const feats = (c.features || []).map(f => `<li>${esc(f)}</li>`).join('');
  const weaks = (c.weaknesses || []).map(w => `<li>${esc(w)}</li>`).join('');
  return `
    <div class="competitor-card">
      <div class="competitor-head">
        <h4>${esc(c.name || '(unnamed)')}</h4>
        ${c.pricing_signal ? `<span class="competitor-price">${esc(c.pricing_signal)}</span>` : ''}
      </div>
      <div class="competitor-cols">
        <div>
          <b>Features</b>
          <ul>${feats || '<li class="muted">—</li>'}</ul>
        </div>
        <div>
          <b>Weaknesses</b>
          <ul>${weaks || '<li class="muted">—</li>'}</ul>
        </div>
      </div>
    </div>
  `;
}

function renderQuadrant(report) {
  const findings = report.findings || [];
  if (!findings.length) return '';
  // SVG 2×2 grid. x = competitor_coverage (0 left → 1 right),
  // y = pain_weight (0 bottom → 10 top). Top-left = greenfield.
  const W = 520, H = 340, PAD = 44;
  const plot = (f) => {
    const x = PAD + (f.competitor_coverage || 0) * (W - 2 * PAD);
    const y = H - PAD - ((f.pain_weight || 0) / 10) * (H - 2 * PAD);
    const cls = scoreClass(f.opportunity_score || 0);
    return `
      <g class="quad-dot ${cls}" transform="translate(${x},${y})">
        <circle r="7" />
        <title>${esc(f.title)} — opp ${f.opportunity_score?.toFixed(1)}, pain ${f.pain_weight?.toFixed(1)}, cov ${f.competitor_coverage?.toFixed(2)}</title>
      </g>
    `;
  };
  const dots = findings.map(plot).join('');
  return `
    <div class="insight-quadrant">
      <div class="insight-quadrant-head">
        <b>Opportunity quadrant</b>
        <span class="muted">top-left = high pain, low competition = greenfield</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="quadrant-svg">
        <!-- grid background -->
        <rect x="${PAD}" y="${PAD}" width="${W - 2 * PAD}" height="${H - 2 * PAD}" class="quad-bg" />
        <line x1="${W/2}" y1="${PAD}" x2="${W/2}" y2="${H-PAD}" class="quad-divider" />
        <line x1="${PAD}" y1="${H/2}" x2="${W-PAD}" y2="${H/2}" class="quad-divider" />
        <!-- axis labels -->
        <text x="${PAD}" y="${H-PAD+28}" class="quad-axis">← greenfield</text>
        <text x="${W-PAD}" y="${H-PAD+28}" text-anchor="end" class="quad-axis">saturated →</text>
        <text x="${PAD-6}" y="${PAD-10}" class="quad-axis">high pain</text>
        <text x="${PAD-6}" y="${H-PAD+16}" class="quad-axis">low pain</text>
        <!-- quadrant labels -->
        <text x="${PAD+12}" y="${PAD+20}" class="quad-bucket greenfield">GREENFIELD</text>
        <text x="${W-PAD-12}" y="${PAD+20}" text-anchor="end" class="quad-bucket crowded">CROWDED</text>
        <text x="${PAD+12}" y="${H-PAD-8}" class="quad-bucket niche">NICHE</text>
        <text x="${W-PAD-12}" y="${H-PAD-8}" text-anchor="end" class="quad-bucket mature">MATURE</text>
        ${dots}
      </svg>
    </div>
  `;
}

function renderEmpty(reason) {
  return `
    <div class="empty-big">
      <h3>No insight report yet</h3>
      <p>${esc(reason || 'Click the button below to run a one-shot Claude synthesis across your full corpus.')}</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
        <button class="btn btn-primary icon-btn" id="btn-insights-run"><i data-lucide="sparkles"></i> Generate insights</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">Uses Claude by default. Takes 30–90 s on a full topic corpus.</p>
    </div>
  `;
}

function renderError(err) {
  return `
    <div class="empty-big">
      <h3>Couldn't generate insights</h3>
      <p>${esc(err || 'unknown error')}</p>
      <button class="btn btn-primary icon-btn" id="btn-insights-run"><i data-lucide="refresh-cw"></i> Retry</button>
    </div>
  `;
}

function renderFull(report, contentEl, topic) {
  const findings = (report.findings || []).slice().sort(
    (a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0)
  );
  const competitors = report.competitors || [];
  const meta = report.corpus_coverage || {};
  const generatedAt = report._generated_at || meta.generated_at || '';
  const cachedBadge = report._cached
    ? `<span class="insight-chip cached" title="Cached report. Click Regenerate to re-run the LLM.">cached</span>`
    : '';

  return `
    <div class="insights-tab">
      <div class="insights-toolbar">
        <div class="insights-meta">
          ${cachedBadge}
          <span class="muted">${meta.total_posts_considered || '—'} posts · ${(meta.sources_represented || []).length} sources</span>
          ${generatedAt ? `<span class="muted">· generated ${esc(new Date(generatedAt).toLocaleString())}</span>` : ''}
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-insights-regen"><i data-lucide="refresh-cw"></i> Regenerate</button>
      </div>

      ${report.executive_summary ? `
        <div class="insight-exec">
          <h2>Executive summary</h2>
          <div class="insight-exec-body">${esc(report.executive_summary).split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>
        </div>
      ` : ''}

      ${renderQuadrant(report)}

      <div class="insights-findings">
        <h2>Top opportunities <span class="muted">(${findings.length})</span></h2>
        ${findings.length ? findings.map(renderFindingCard).join('') : '<p class="muted">No findings extracted.</p>'}
      </div>

      ${competitors.length ? `
        <div class="insights-competitors">
          <h2>Competitor landscape <span class="muted">(${competitors.length})</span></h2>
          ${competitors.map(renderCompetitor).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

export async function loadInsights(contentEl, topic) {
  // Gated writes — drop any render that would land after a tab switch.
  const set = (html) => { if (contentEl.dataset.tab === 'insights') contentEl.innerHTML = html; };

  // Phase 1: try cached first (cheap). If empty, show CTA to generate.
  set(`<div class="empty-state" style="padding:40px;text-align:center">
    <div class="map-building-spinner" style="margin:0 auto 10px"></div>
    <div style="color:var(--ink-3);font-size:13px">Loading insights…</div>
  </div>`);

  let cached;
  try {
    cached = await api.synthesizeInsights(topic, true);
  } catch (e) {
    if (contentEl.dataset.tab !== 'insights') return;
    set(renderError(e?.message || String(e)));
    wireRunButton(contentEl, topic);
    return;
  }
  if (contentEl.dataset.tab !== 'insights') return;

  // If we got a real report, render it.
  if (cached && cached.ok && (cached.findings || cached.executive_summary)) {
    set(renderFull(cached, contentEl, topic));
    wireCards(contentEl, topic);
    $('#btn-insights-regen', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
    window.refreshIcons?.();
    return;
  }

  // No cache (or error). Show CTA.
  set(renderEmpty(cached?.error));
  wireRunButton(contentEl, topic);
  window.refreshIcons?.();
}

async function runSynth(contentEl, topic) {
  const set = (html) => { if (contentEl.dataset.tab === 'insights') contentEl.innerHTML = html; };
  set(`
    <div class="empty-state" style="padding:40px;text-align:center">
      <div class="map-building-spinner" style="margin:0 auto 10px"></div>
      <div style="font-weight:600;margin-bottom:4px">Generating insights with Claude…</div>
      <div style="color:var(--ink-3);font-size:13px">Packing your full corpus into one synthesis call. 30–90 s.</div>
    </div>
  `);
  let report;
  try {
    report = await api.synthesizeInsights(topic, false);
  } catch (e) {
    if (contentEl.dataset.tab !== 'insights') return;
    set(renderError(e?.message || String(e)));
    wireRunButton(contentEl, topic);
    window.refreshIcons?.();
    return;
  }
  if (contentEl.dataset.tab !== 'insights') return;
  if (!report || !report.ok) {
    set(renderError(report?.error || report?.reason || 'Synthesis returned no report.'));
    wireRunButton(contentEl, topic);
    window.refreshIcons?.();
    return;
  }
  set(renderFull(report, contentEl, topic));
  wireCards(contentEl, topic);
  $('#btn-insights-regen', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
  window.refreshIcons?.();
}

function wireRunButton(contentEl, topic) {
  $('#btn-insights-run', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
}

function wireCards(contentEl, topic) {
  // Citation chips → drill into Posts tab with the evidence post_ids.
  // We can't filter Posts by post-id directly without a new API; for now
  // we just show the count and log on click so users see we're aware.
  // TODO Phase-2: add setPostsFilter({ postIds: [...] }) for true drill.
  contentEl.querySelectorAll('.insight-cite-chip').forEach(el => {
    el.addEventListener('click', () => {
      const ids = (el.dataset.ev || '').split(',').filter(Boolean);
      if (!ids.length) return;
      // Open the first cited post in a new tab as a minimal affordance.
      // Better UX lands in Phase 2.
      console.info('[insights] evidence post_ids:', ids);
    });
  });
}
