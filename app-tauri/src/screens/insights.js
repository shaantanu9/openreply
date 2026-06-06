// Insights tab — Phase-1 market report view.
// Renders the full structured insight JSON from `research insights`:
//   - executive summary (narrative)
//   - opportunity quadrant (2×2 SVG: pain vs competitor coverage)
//   - ranked findings (scored, cited, with best-quote pull-outs)
//   - competitor list (features / weaknesses / pricing signal)
//
// Spec: docs/specs/2026-04-20-insight-engine.md
import { api, esc } from '../api.js';
import { isAutoRunEnabled } from '../lib/tabPipelines.js';
import { hasLlmConfigured } from '../lib/llmStatus.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';
import { postLink } from '../lib/postLink.js';
import { renderAnalyzingState } from '../lib/analyzingLoader.js';
import { skelDetail } from '../lib/skeleton.js';
import { withButtonBusy } from '../lib/busyButton.js';

const $ = (sel, root = document) => root.querySelector(sel);

// Domain stages for the one-shot insight synthesis (single long-context
// LLM call): pack the full corpus, score opportunities (Ulwick), build the
// Minto pyramid + hypothesis cards + competitor landscape.
// Per-topic in-flight guard so opening the Insights tab, switching away, and
// returning (or a db-changed re-run) doesn't double-fire the blocking synthesis
// call. On re-entry we re-show the alive loader continuing from the real elapsed
// (shared loader runKey) instead of kicking a second run. Shared across the
// fast (runSynth) and chunked (runChunkedSynth) paths — only one runs per tab.
const _insightsRunning = new Set();  // topic
const insightsRunKey = (topic) => `insights:${topic}`;

const INSIGHT_STAGES = [
  'Packing your full corpus into one call…',
  'Clustering painpoints, wishes & workarounds…',
  'Scoring opportunities (importance × satisfaction)…',
  'Mapping the competitor landscape…',
  'Drafting falsifiable hypothesis cards…',
  'Assembling the Minto-structured brief…',
];

// Chunked map-reduce path — many small calls for low-credit providers, then
// a deterministic merge. Longer than the fast path.
const INSIGHT_CHUNKED_STAGES = [
  'Splitting the corpus into small chunks…',
  'Synthesizing each chunk in parallel…',
  'Deduplicating findings across chunks…',
  'Merging into one opportunity-scored list…',
  'Building competitor landscape & quadrant…',
  'Assembling the final brief…',
];

// Ulwick opportunity score is 0-20 scale (importance + max(imp-sat, 0)).
// Thresholds match the methodology doc: >15 extreme, 10-15 clear, <10 overserved.
function scoreClass(score) {
  if (score >= 15) return 'score-high';
  if (score >= 10) return 'score-mid';
  return 'score-low';
}

// Triangulation strength → colored chip per Denzin 1978 (doc Phase 2).
// Data comes from the LLM (string) or we derive from source_breakdown count.
function triangulationChip(strength) {
  const map = {
    strong:   { cls: 'strong',   icon: '🟢', label: 'strong triangulation' },
    moderate: { cls: 'moderate', icon: '🟡', label: 'moderate triangulation' },
    narrow:   { cls: 'narrow',   icon: '🔴', label: 'narrow — single source' },
  };
  const cfg = map[strength];
  if (!cfg) return '';
  return `<span class="insight-chip triang-${cfg.cls}" title="${esc(cfg.label)}">${cfg.icon} ${esc(strength)}</span>`;
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
  // Per-source tint comes from .insight-src-badge[data-source="…"] in
  // style.css — keyed off the attribute below, no inline color here.
  return entries.map(([src, n]) =>
    `<span class="insight-src-badge" data-source="${esc(src)}"><b>${n}</b> ${esc(src)}</span>`
  ).join('');
}

function renderSuggestedTactics(f) {
  let tactics = [];
  if (Array.isArray(f?.suggested_tactics)) {
    tactics = f.suggested_tactics;
  } else if (typeof f?.suggested_tactics_json === 'string' && f.suggested_tactics_json.trim()) {
    try { tactics = JSON.parse(f.suggested_tactics_json); } catch { tactics = []; }
  }
  if (!Array.isArray(tactics) || tactics.length === 0) return '';
  const items = tactics.slice(0, 2).map((t) => `
    <button
      class="insight-tactic-chip"
      data-tactic="${encodeURIComponent(JSON.stringify(t))}"
      title="Open tactic detail">
      💡 ${esc(t.name || t.slug || 'Tactic')}
    </button>
  `).join('');
  return `
    <details class="insight-tactics">
      <summary>💡 Suggested tactics</summary>
      <div class="insight-tactic-list">${items}</div>
    </details>
  `;
}

function renderFindingCard(f) {
  const op = f.opportunity_score || 0;
  const imp = f.importance ?? f.pain_weight ?? 0;
  const sat = f.satisfaction ?? 0;
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
  // Phase-10 research link chip — clickable, opens modal with linked papers.
  // Renders only when the linker has run and found matches for this finding.
  const linkedPapers = f._linked_papers_count || 0;
  const researchChip = linkedPapers > 0
    ? `<span class="insight-chip research-link" data-research-title="${esc(f.title || '')}" title="Click to see academic papers linked to this finding (Phase-10 linker)">📚 ${linkedPapers} research</span>`
    : '';
  // Counter-evidence chip — biggest credibility feature from the methodology
  // doc. Click → modal with the disconfirming quotes (handled in wireCards).
  const disconfirmIds = f.disconfirming_evidence || [];
  const counterChip = disconfirmIds.length > 0
    ? `<span class="insight-chip counter-evidence" data-disconfirm="${esc(disconfirmIds.join(','))}" data-title="${esc(f.title || '')}" title="Click to see posts that disagree — counter-evidence strengthens analysis">⚖ ${disconfirmIds.length} disagree</span>`
    : '';
  // Bayesian credible interval on evidence prevalence (from _normalize_scores)
  const ci = f.evidence_prevalence_ci;
  const ciChip = ci
    ? `<span class="insight-chip ci-chip" title="Beta-binomial ${Math.round(ci.confidence * 100)}% credible interval — honest statistical range, not raw N">📊 ${ci.lower_pct}%–${ci.upper_pct}% of corpus</span>`
    : '';
  const triangChip = triangulationChip(f.triangulation_strength);

  // AG-C T2.4 — 👎 feedback button. Verdict + optional note flow back
  // into the next synthesize prompt as a negative-examples block so the
  // LLM stops re-surfacing things the user already rejected.
  const feedbackBtn = `
    <button
      class="insight-feedback-btn"
      data-fb-title="${esc(f.title || '')}"
      data-fb-kind="${esc(f.kind || 'painpoint')}"
      title="Flag this finding as wrong / off-topic / spam. Feeds the next synthesis."
      aria-label="Flag finding">
      <span aria-hidden="true">👎</span>
    </button>
  `;
  return `
    <div class="insight-card ${cls}" data-finding="${esc(f.title || '')}">
      <div class="insight-head">
        <div class="insight-head-left">
          <span class="insight-kind">${kindEmoji}</span>
          <h3>${esc(f.title || '(untitled)')}</h3>
        </div>
        <div class="insight-head-right">
          ${feedbackBtn}
          <div class="insight-score ${cls}" title="Ulwick Opportunity = importance + max(importance − satisfaction, 0). >15 extreme, 10–15 clear, <10 overserved.">
            <b>${op.toFixed(1)}</b>
            <span>opportunity</span>
          </div>
        </div>
      </div>

      <div class="insight-meta">
        <span title="Ulwick importance 1-10 — inferred from language intensity, frequency, WTP signals">🔥 imp <b>${imp.toFixed(1)}</b></span>
        <span title="Ulwick satisfaction with current solutions 1-10 — inferred from sentiment toward existing tools">🛋 sat <b>${sat.toFixed(1)}</b></span>
        <span title="0 = greenfield, 1 = saturated competitor landscape">🏭 cov <b>${cc.toFixed(2)}</b></span>
        ${triangChip}
        ${classification}
        ${academic}
        ${ciChip}
        ${counterChip}
        ${researchChip}
        ${renderCitationChips(f.evidence_post_ids)}
      </div>

      <p class="insight-narrative">${esc(f.narrative || '')}</p>

      ${renderSuggestedTactics(f)}

      ${quote}

      <div class="insight-sources">${renderSourceBadges(f.source_breakdown)}</div>
    </div>
  `;
}

function showTacticModal(tactic) {
  const t = tactic && typeof tactic === 'object' ? tactic : {};
  const examples = Array.isArray(t.examples) ? t.examples : [];
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.hidden = false;
  backdrop.innerHTML = `
    <div class="modal" style="max-width:640px;max-height:80vh;overflow:auto">
      <h3 style="margin-top:0">💡 ${esc(t.name || t.slug || 'Suggested tactic')}</h3>
      <p class="muted">${esc(t.framework || 'custom')}</p>
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      ${t.when_to_use ? `<p><b>When to use:</b> ${esc(t.when_to_use)}</p>` : ''}
      ${examples.length ? `
        <div style="margin-top:10px">
          <b>Example snippets</b>
          <ul style="margin-top:8px">
            ${examples.slice(0, 3).map((ex) => `<li>${esc(ex?.snippet || '')}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <div class="modal-actions" style="justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost btn-bordered" id="tactic-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#tactic-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
}

// ─── Minto pyramid header ─────────────────────────────────────────────
// Phase-2 addition. This IS the answer the user came for — rendered as
// the first thing they see on the Insights tab. Minto's rule: reader
// should be able to stop after sentence one and have the decision-prompt.
function renderMinto(report) {
  const gt = (report.governing_thought || '').trim();
  const args = (report.key_arguments || []).slice(0, 3);
  if (!gt && args.length === 0) return '';
  const argHtml = args.map((a, i) => {
    const claim = esc(a.claim || '');
    const ev = renderCitationChips(a.evidence_post_ids);
    return `
      <div class="minto-arg">
        <div class="minto-arg-num">${i + 1}</div>
        <div class="minto-arg-body">
          <p class="minto-arg-claim">${claim}</p>
          <div class="minto-arg-ev">${ev}</div>
        </div>
      </div>
    `;
  }).join('');
  return `
    <section class="minto-pyramid">
      <div class="minto-gt">
        <div class="minto-gt-label">The answer</div>
        <p class="minto-gt-text">${esc(gt || '(no governing thought — synthesis returned empty top)')}</p>
      </div>
      ${args.length ? `<div class="minto-args">${argHtml}</div>` : ''}
    </section>
  `;
}

// ─── Hypothesis card (Popper-validated) ───────────────────────────────
function renderHypothesisCard(h, idx) {
  const falsifiers = (h.falsifiers || []).map(f => `<li>${esc(f)}</li>`).join('');
  const budget = h.budget_usd != null ? `$${Number(h.budget_usd).toLocaleString()}` : '—';
  const days = h.time_box_days != null ? `${h.time_box_days} days` : '—';
  return `
    <details class="hyp-card" ${idx === 0 ? 'open' : ''}>
      <summary>
        <span class="hyp-num">H${idx + 1}</span>
        <span class="hyp-title">${esc(h.finding_title || h.experiences || '(untitled hypothesis)')}</span>
        <span class="hyp-test-chip">${esc(days)} · ${esc(budget)}</span>
      </summary>
      <div class="hyp-body">
        <div class="hyp-row"><b>WE BELIEVE</b><span>${esc(h.we_believe || '')}</span></div>
        <div class="hyp-row"><b>EXPERIENCES</b><span>${esc(h.experiences || '')}</span></div>
        ${h.because ? `<div class="hyp-row"><b>BECAUSE</b><span>${esc(h.because)}</span></div>` : ''}
        <div class="hyp-row"><b>AND WOULD</b><span>${esc(h.and_would || '')}</span></div>
        <div class="hyp-row"><b>FOR</b><span>${esc(h.for || '')}</span></div>
        <div class="hyp-divider"></div>
        <div class="hyp-falsify">
          <b>We'll know we're wrong if:</b>
          <ul>${falsifiers || '<li class="muted">(missing — card was rejected by Popper validator)</li>'}</ul>
        </div>
        ${h.cheapest_test ? `
          <div class="hyp-test">
            <b>Cheapest test:</b> ${esc(h.cheapest_test)}
            <span class="hyp-test-meta">Time box ${esc(days)} · Budget ${esc(budget)}</span>
          </div>
        ` : ''}
        <div class="hyp-save-row">
          <button class="btn btn-primary btn-sm hyp-save-btn" data-hyp-idx="${idx}">
            <i data-lucide="target"></i> Save as bet
          </button>
          <span class="muted hyp-save-hint">Track this in the Bets tab — update state as you run the test</span>
        </div>
      </div>
    </details>
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
  // y = importance (0 bottom → 10 top, Ulwick scale). Top-left = greenfield
  // (high importance, low coverage). Dot colors reflect Ulwick opportunity
  // score (0-20 scale after Phase-2 rescoring).
  const W = 520, H = 340, PAD = 44;
  const plot = (f) => {
    const imp = f.importance ?? f.pain_weight ?? 0;
    const x = PAD + (f.competitor_coverage || 0) * (W - 2 * PAD);
    const y = H - PAD - (imp / 10) * (H - 2 * PAD);
    const cls = scoreClass(f.opportunity_score || 0);
    return `
      <g class="quad-dot ${cls}" transform="translate(${x},${y})">
        <circle r="7" />
        <title>${esc(f.title)} — opp ${f.opportunity_score?.toFixed(1)}/20, imp ${imp.toFixed(1)}, cov ${f.competitor_coverage?.toFixed(2)}</title>
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
  // Phase 6 — if the backend tells us why (e.g. no-posts or no-LLM-key), surface
  // that verbatim so the empty state is actionable, not generic.
  const isKeyIssue = (reason || '').toLowerCase().includes('key') || (reason || '').toLowerCase().includes('llm');
  const isPostIssue = (reason || '').toLowerCase().includes('no post') || (reason || '').toLowerCase().includes('corpus');
  return `
    <div class="empty-big">
      <h3>No insight report yet</h3>
      <p>${esc(reason || 'Run a one-shot synthesis across your full corpus to get a Minto-structured brief (governing thought + 3 key arguments + hypothesis cards + opportunity quadrant).')}</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary icon-btn" id="btn-insights-run"><i data-lucide="sparkles"></i> ${isPostIssue ? 'Collect posts first' : 'Generate insights'}</button>
        ${isKeyIssue ? `<button class="btn btn-ghost btn-bordered icon-btn" onclick="location.hash='#/settings'"><i data-lucide="key-round"></i> Open Settings</button>` : ''}
      </div>
      <p class="muted" style="font-size:var(--fs-13);margin-top:10px">Works with any LLM provider (Anthropic, OpenAI, OpenRouter, Ollama …). Takes 30–90 s on a full topic corpus.</p>
    </div>
  `;
}

function renderError(err, errCode = null, provider = null) {
  // Explicit CTA paths for known error classes. Generic retry is the
  // fallback — but if we know exactly what went wrong, send the user to
  // the fix with one click instead of making them diagnose from the
  // error text.
  let extraBtn = '';
  let chunkedBtn = '';
  if (errCode === 'credits_exhausted' || errCode === 'context_overflow') {
    extraBtn = `
      <button class="btn btn-ghost btn-bordered icon-btn" onclick="location.hash='#/settings'">
        <i data-lucide="key-round"></i> Switch provider in Settings
      </button>`;
    // Chunked mode is THE fix for credit/context errors — send many small
    // requests instead of one big one. Promote it to the primary action.
    chunkedBtn = `
      <button class="btn btn-primary icon-btn" id="btn-insights-chunked" title="Split the corpus into small chunks and synthesize each separately. Works even with low credits.">
        <i data-lucide="layers"></i> Try Deep scan (chunked)
      </button>`;
  } else if (errCode === 'invalid_key') {
    extraBtn = `
      <button class="btn btn-primary icon-btn" onclick="location.hash='#/settings'">
        <i data-lucide="key-round"></i> Re-enter API key
      </button>`;
  }
  const providerPill = provider
    ? `<span class="muted" style="font-size:var(--fs-11)">provider: <code>${esc(provider)}</code></span>`
    : '';
  return `
    <div class="empty-big">
      <h3>Couldn't generate insights</h3>
      <p>${esc(err || 'unknown error')}</p>
      ${providerPill}
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap">
        ${chunkedBtn}
        <button class="btn btn-ghost btn-bordered icon-btn" id="btn-insights-run">
          <i data-lucide="refresh-cw"></i> Retry
        </button>
        ${extraBtn}
      </div>
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

  const hypotheses = report.hypotheses || [];
  const dropped = report._dropped_hypotheses || [];

  return `
    <div class="insights-tab insights-with-sidebar">
      <div class="insights-main">
      <div class="insights-toolbar">
        <div class="insights-meta">
          ${cachedBadge}
          <span class="muted">${meta.total_posts_considered || '—'} posts · ${(meta.sources_represented || []).length} sources</span>
          ${generatedAt ? `<span class="muted">· generated ${esc(new Date(generatedAt).toLocaleString())}</span>` : ''}
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-insights-chat-toggle" title="Toggle chat sidebar (⌘/)"><i data-lucide="message-circle-question"></i> Ask</button>
        <div class="export-dropdown-wrap">
          <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-insights-export"><i data-lucide="download"></i> Export</button>
          <div class="export-dropdown-menu" id="export-dropdown-menu" hidden>
            <button class="export-dropdown-item" data-format="markdown">
              <b><i data-lucide="file-text"></i> Full brief (markdown)</b>
              <span>Minto-structured — paste into Notion / Linear / Docs</span>
            </button>
            <button class="export-dropdown-item" data-format="hypotheses">
              <b><i data-lucide="target"></i> Hypothesis cards</b>
              <span>Each bet as its own markdown block</span>
            </button>
            <button class="export-dropdown-item" data-format="slack">
              <b><i data-lucide="message-square"></i> Slack summary</b>
              <span>5-line DM-friendly version</span>
            </button>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-insights-regen"><i data-lucide="refresh-cw"></i> Regenerate</button>
      </div>

      ${renderMinto(report)}

      ${report.executive_summary ? `
        <details class="insight-exec-fold">
          <summary>Full executive summary</summary>
          <div class="insight-exec-body">${esc(report.executive_summary).split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>
        </details>
      ` : ''}

      ${renderQuadrant(report)}

      ${hypotheses.length ? `
        <div class="insights-hypotheses">
          <h2>Hypothesis cards <span class="muted">(${hypotheses.length} · Popper-validated)</span></h2>
          <p class="muted hyp-intro">Each card is a falsifiable bet with a 2-week cheapest test. If you can't name how you'd be wrong, it isn't a hypothesis.</p>
          ${hypotheses.map(renderHypothesisCard).join('')}
          ${dropped.length ? `
            <details class="hyp-dropped">
              <summary>${dropped.length} hypothesis card(s) dropped by Popper validator</summary>
              <ul>${dropped.map(d => `<li><b>${esc(d.hypothesis?.finding_title || d.hypothesis?.experiences || 'unnamed')}</b> — ${esc((d.errors || []).join('; '))}</li>`).join('')}</ul>
            </details>
          ` : ''}
        </div>
      ` : ''}

      <div class="insights-findings">
        <h2>Top opportunities <span class="muted">(${findings.length})</span></h2>
        <!-- AG-E saved views mount -->
        <div class="saved-views-bar" id="ag-e-saved-views-bar" data-topic="${esc(topic || '')}"
          style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 10px">
          <label style="font-size:var(--fs-13);color:var(--ink-3)">Saved view:</label>
          <select id="ag-e-saved-views-select" class="select-sm" style="min-width:180px">
            <option value="">All findings</option>
          </select>
          <button class="btn btn-ghost btn-sm btn-bordered" id="ag-e-saved-views-save"
            title="Save the current filter as a view">Save current…</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="ag-e-saved-views-clear"
            title="Show every finding" hidden>Clear filter</button>
          <span id="ag-e-saved-views-status" style="font-size:var(--fs-11);color:var(--ink-3)"></span>
        </div>
        <!-- /AG-E saved views mount -->
        ${findings.length ? findings.map(renderFindingCard).join('') : '<p class="muted">No findings extracted.</p>'}
        ${(report._relevance_dropped_findings && report._relevance_dropped_findings.length) ? `
          <!-- T1.6: dropped-findings fold. Surfaces which findings the relevance gate dropped + why. -->
          <details class="dropped-findings-fold" style="margin-top:14px;padding:10px 14px;background:var(--surface-2,#FAF4EA);border-radius:8px">
            <summary style="cursor:pointer;font-size:var(--fs-13);color:var(--ink-2)">
              ⚖ ${report._relevance_dropped_count} off-topic finding${report._relevance_dropped_count === 1 ? '' : 's'} dropped by relevance gate
              (threshold ${report._relevance_threshold?.toFixed?.(2) ?? '—'})
            </summary>
            <ul style="margin:8px 0 0;padding-left:20px;font-size:var(--fs-13)">
              ${report._relevance_dropped_findings.map(f => `
                <li style="margin:4px 0">
                  <b>${esc(f.title || '(untitled)')}</b>
                  <span class="muted">— ${esc(f._dropped_reason || `score ${(f._relevance_score ?? 0).toFixed(2)}`)}</span>
                </li>`).join('')}
            </ul>
            <p class="muted" style="font-size:var(--fs-11);margin:8px 0 0">
              Tune: <code>GAPMAP_FINDING_RELEVANCE_THRESHOLD</code> env (0 disables the gate).
            </p>
          </details>
        ` : ''}
      </div>

      ${competitors.length ? `
        <div class="insights-competitors">
          <h2>Competitor landscape <span class="muted">(${competitors.length})</span></h2>
          ${competitors.map(renderCompetitor).join('')}
        </div>
      ` : ''}

      <!-- Consensus (deliberation tiers). Collapsible; runs api.deliberate on open. -->
      <details class="insights-consensus" id="consensus-section">
        <summary class="insights-consensus-summary">
          <i data-lucide="scale"></i> Consensus
          <span class="muted">— 5-persona debate + audience clusters tier each finding</span>
        </summary>
        <div class="insights-consensus-body-wrap" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-consensus-run"
            title="Cross-check each finding against the persona debate and audience clusters.">
            <i data-lucide="refresh-cw"></i> Run consensus check
          </button>
          <div id="consensus-body" style="margin-top:12px">
            <p class="muted" style="font-size:var(--fs-13)">Open this section (or click “Run consensus check”) to tier each finding as Confirmed / Contested / Emerging / Single-source.</p>
          </div>
        </div>
      </details>

      <!-- Phase-9 feature × competitor matrix. Populated async by loadCompetitorMatrix() -->
      <div id="competitor-matrix-slot"></div>
      </div><!-- /.insights-main -->

      <!-- Phase-8 chat sidebar. Collapsible via #btn-insights-chat-toggle. -->
      <aside class="insights-chat-aside" id="insights-chat-aside" hidden>
        <div class="ica-head">
          <h3><i data-lucide="message-circle-question"></i> Ask</h3>
          <button class="btn btn-ghost btn-sm" id="ica-close" title="Close (⌘/)"><i data-lucide="x"></i></button>
        </div>
        <div class="ica-prompt-chips">
          <button class="ica-prompt-chip" data-q="What are the top 3 risks of the top opportunity?">Top 3 risks</button>
          <button class="ica-prompt-chip" data-q="Who's the incumbent I'd compete against?">Main incumbent?</button>
          <button class="ica-prompt-chip" data-q="What's the smallest experiment to validate the top hypothesis?">Cheapest test?</button>
          <button class="ica-prompt-chip" data-q="Is this market bigger in US or EU?">US vs EU?</button>
        </div>
        <div class="ica-history" id="ica-history"></div>
        <div class="ica-input-row">
          <textarea id="ica-input" placeholder="Ask a follow-up…" rows="2"></textarea>
          <button class="btn btn-primary btn-sm icon-btn" id="ica-send"><i data-lucide="send"></i></button>
        </div>
      </aside>
    </div>
  `;
}

// ─── Consensus (deliberation tiers) ──────────────────────────────────
// Cross-checks each synthesized finding against the 5-persona debate +
// audience clusters and groups it into a consensus TIER. Backed by
// api.deliberate (deliberate.py). Default pass is heuristic (noLlm:true)
// so it needs no LLM key; a "Deeper check" button re-runs with the LLM.
//
// Result shape (deliberate.py):
//   { tiers: { confirmed:[item], probable:[…], minority:[…], discarded:[…] },
//     counts, personas_used, provider, generated_at }
//   each item carries .consensus = { tier, score 0..1, votes:{confirm,…},
//   rationales:{confirm:[{by,why}], dispute:[{by,why}]} } plus title/kind.
const CONSENSUS_TIER_META = {
  confirmed:     { cls: 'confirmed', label: 'Confirmed' },
  contested:     { cls: 'contested', label: 'Contested' },
  probable:      { cls: 'confirmed', label: 'Probable' },
  emerging:      { cls: 'emerging',  label: 'Emerging' },
  minority:      { cls: 'emerging',  label: 'Minority' },
  single_source: { cls: 'muted',     label: 'Single source' },
  discarded:     { cls: 'muted',     label: 'Discarded' },
};
// Color per tier class — inline so this section needs no new CSS file.
const CONSENSUS_TIER_COLOR = {
  confirmed: '#1F9D55',  // green
  contested: '#D9822B',  // amber/red
  emerging:  '#2B6CB0',  // blue
  muted:     '#8A8478',  // muted
};
const _kindEmoji = (k) => ({ painpoint: '🔥', feature_wish: '💡', workaround: '🛠' }[k] || '•');

function _consensusTierMeta(tierKey) {
  const meta = CONSENSUS_TIER_META[tierKey];
  if (meta) return meta;
  // Unknown tier key — render it readably with a muted chip rather than dropping it.
  const label = String(tierKey || 'other').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { cls: 'muted', label };
}

// Flatten the {confirm:[{by,why}], dispute:[{by,why}]} rationales object —
// OR a plain string rationale — into an escaped, readable line.
function _consensusRationaleHtml(consensus) {
  const r = consensus && consensus.rationales;
  if (typeof consensus?.rationale === 'string' && consensus.rationale.trim()) {
    return `<p class="consensus-rationale">${esc(consensus.rationale.trim())}</p>`;
  }
  if (!r || typeof r !== 'object') return '';
  const lines = [];
  (Array.isArray(r.confirm) ? r.confirm : []).slice(0, 3).forEach((x) => {
    const why = (x && x.why) || '';
    if (why) lines.push(`<li><span class="consensus-vote-by confirm">${esc((x && x.by) || 'persona')}</span> ${esc(why)}</li>`);
  });
  (Array.isArray(r.dispute) ? r.dispute : []).slice(0, 3).forEach((x) => {
    const why = (x && x.why) || '';
    if (why) lines.push(`<li><span class="consensus-vote-by dispute">${esc((x && x.by) || 'persona')}</span> ${esc(why)}</li>`);
  });
  if (!lines.length) return '';
  return `<ul class="consensus-rationale-list">${lines.join('')}</ul>`;
}

function renderConsensusItem(item) {
  const c = (item && item.consensus) || {};
  const score = typeof c.score === 'number' ? c.score : 0;
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const votes = c.votes || {};
  const confirm = Number(votes.confirm || 0);
  const dispute = Number(votes.dispute || 0);
  const aud = Number(votes.audience_endorsements || 0);
  const totalVotes = confirm + dispute + Number(votes.abstain || 0);
  const meta = _consensusTierMeta(c.tier);
  const barColor = CONSENSUS_TIER_COLOR[meta.cls] || CONSENSUS_TIER_COLOR.muted;
  const voteBits = [];
  if (totalVotes > 0) voteBits.push(`${confirm}✓ / ${dispute}✗ / ${totalVotes} votes`);
  else voteBits.push('heuristic');
  if (aud > 0) voteBits.push(`${aud} audience`);
  return `
    <div class="consensus-item">
      <div class="consensus-item-head">
        <span class="consensus-item-kind">${_kindEmoji(item && item.kind)}</span>
        <span class="consensus-item-title">${esc((item && item.title) || '(untitled)')}</span>
        <span class="consensus-item-score" title="Composite consensus score 0–1">score ${score.toFixed(2)}</span>
      </div>
      <div class="consensus-score-bar" title="${pct}% consensus" aria-hidden="true"
        style="height:6px;border-radius:4px;background:rgba(0,0,0,0.08);overflow:hidden;margin:4px 0">
        <div style="width:${pct}%;height:100%;background:${barColor}"></div>
      </div>
      <div class="consensus-item-meta muted" style="font-size:var(--fs-11)">${esc(voteBits.join(' · '))}</div>
      ${_consensusRationaleHtml(c)}
    </div>
  `;
}

function renderConsensusTierGroup(tierKey, items) {
  const meta = _consensusTierMeta(tierKey);
  const color = CONSENSUS_TIER_COLOR[meta.cls] || CONSENSUS_TIER_COLOR.muted;
  const list = (Array.isArray(items) ? items : []);
  return `
    <div class="consensus-tier-group" data-tier="${esc(tierKey)}">
      <div class="consensus-tier-head">
        <span class="insight-chip consensus-tier-chip"
          style="background:${color}1A;color:${color};border:1px solid ${color}55">
          ${esc(meta.label)}
        </span>
        <span class="muted consensus-tier-count">${list.length} finding${list.length === 1 ? '' : 's'}</span>
      </div>
      ${list.length
        ? list.map(renderConsensusItem).join('')
        : '<p class="muted" style="margin:4px 0 0;font-size:var(--fs-13)">None in this tier.</p>'}
    </div>
  `;
}

function renderConsensusResult(result) {
  if (!result || !result.ok) {
    return `<p class="muted">${esc((result && result.error) || 'Consensus check returned no result.')}</p>`;
  }
  const tiers = (result.tiers && typeof result.tiers === 'object') ? result.tiers : {};
  // Stable, meaningful ordering when present; then any extra/unknown keys.
  const ORDER = ['confirmed', 'probable', 'contested', 'emerging', 'minority', 'single_source', 'discarded'];
  const keys = Object.keys(tiers);
  keys.sort((a, b) => {
    const ia = ORDER.indexOf(a); const ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const groups = keys
    .filter((k) => Array.isArray(tiers[k]))
    .map((k) => renderConsensusTierGroup(k, tiers[k]))
    .join('');
  const total = keys.reduce((n, k) => n + (Array.isArray(tiers[k]) ? tiers[k].length : 0), 0);
  if (!total) {
    return `<p class="muted">No findings to deliberate yet. Generate insights first, then run the consensus check.</p>`;
  }
  const provider = result.provider
    ? `<span class="muted" style="font-size:var(--fs-11)">provider: <code>${esc(result.provider)}</code></span>`
    : '<span class="muted" style="font-size:var(--fs-11)">heuristic pass (no LLM)</span>';
  const personas = Array.isArray(result.personas_used) && result.personas_used.length
    ? `<span class="muted" style="font-size:var(--fs-11)">· ${esc(result.personas_used.length)} persona(s)</span>`
    : '';
  return `
    <div class="consensus-result">
      <div class="consensus-result-meta" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        ${provider}
        ${personas}
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-consensus-deep"
          title="Re-run the 5-persona debate with the LLM for a deeper, citation-grounded consensus.">
          <i data-lucide="brain"></i> Deeper check (LLM)
        </button>
      </div>
      ${groups}
    </div>
  `;
}

async function runConsensusCheck(contentEl, topic, { noLlm = true } = {}) {
  // Sub-tab liveness guard — same gate the matrix loader uses.
  const alive = () => contentEl.dataset.tab === 'insights' && contentEl.isConnected;
  const body = contentEl.querySelector('#consensus-body');
  if (!body) return;
  body.innerHTML = `
    <div class="consensus-loading muted" style="display:flex;align-items:center;gap:8px;padding:8px 0">
      <i data-lucide="loader-2" class="spin"></i>
      <span>${noLlm ? 'Running heuristic consensus check…' : 'Running LLM deliberation (5 personas)…'}</span>
    </div>`;
  window.refreshIcons?.();
  let result;
  try {
    result = await api.deliberate(topic, { noLlm });
  } catch (e) {
    if (!alive()) return;
    body.innerHTML = `
      <p class="muted">Consensus check failed: ${esc(e?.message || String(e))}</p>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-consensus-retry">
        <i data-lucide="refresh-cw"></i> Retry
      </button>`;
    body.querySelector('#btn-consensus-retry')?.addEventListener('click', () => runConsensusCheck(contentEl, topic, { noLlm: true }));
    window.refreshIcons?.();
    return;
  }
  if (!alive()) return;
  body.innerHTML = renderConsensusResult(result);
  body.querySelector('#btn-consensus-deep')?.addEventListener('click', (e) => {
    e.preventDefault();
    runConsensusCheck(contentEl, topic, { noLlm: false });
  });
  window.refreshIcons?.();
}

function wireConsensusSection(contentEl, topic) {
  const section = contentEl.querySelector('#consensus-section');
  if (!section) return;
  const runBtn = contentEl.querySelector('#btn-consensus-run');
  runBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    runConsensusCheck(contentEl, topic, { noLlm: true });
  });
  // Lazy auto-run on first open of the collapsible, so we don't fire the
  // deliberation call until the user actually expands the section.
  let autoRan = false;
  section.addEventListener('toggle', () => {
    if (section.open && !autoRan) {
      autoRan = true;
      runConsensusCheck(contentEl, topic, { noLlm: true });
    }
  });
}

// ─── Phase 9 — Competitor matrix (feature × competitor table) ─────────
function renderCompetitorMatrix(data) {
  const competitors = data.competitors || [];
  const features = data.features || [];
  const matrix = data.matrix || {};
  const gaps = data.gap_features || [];
  if (!competitors.length || !features.length) return '';

  const cellIcon = (status) => {
    if (status === 'has')      return '<span class="matrix-cell has">✓</span>';
    if (status === 'missing')  return '<span class="matrix-cell missing">✗ missing</span>';
    if (status === 'weakness') return '<span class="matrix-cell weakness">⚠ weak</span>';
    return '<span class="matrix-cell unknown">—</span>';
  };

  const rows = features.map(feat => {
    const cells = competitors.map(c => {
      const status = matrix[feat]?.[c.name] || 'unknown';
      return `<td>${cellIcon(status)}</td>`;
    }).join('');
    return `
      <tr>
        <td class="matrix-feature-col">${esc(feat)}</td>
        ${cells}
      </tr>
    `;
  }).join('');

  const headCells = competitors.map(c => `<th>${esc(c.name)}</th>`).join('');

  const gapBox = gaps.length ? `
    <div class="matrix-gap-features">
      <b>Gap features</b> (no competitor has these): ${gaps.map(esc).join(' · ')}
    </div>
  ` : '';

  return `
    <section class="competitor-matrix">
      <h2>Competitor matrix <span class="muted">(${features.length} features × ${competitors.length} competitors)</span></h2>
      <p class="muted">✓ has · ✗ missing · ⚠ weakness · — unknown. Gaps = greenfield features no one covers.</p>
      ${gapBox}
      <div class="matrix-scroll">
        <table class="matrix-table">
          <thead>
            <tr><th class="matrix-feature-col">Feature</th>${headCells}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

async function loadCompetitorMatrix(contentEl, topic) {
  // Sub-tab liveness guard — this loader runs inside topic.js's tab system,
  // so the active-screen signal is `contentEl.dataset.tab` (the same gate the
  // `set()` helper uses), NOT routeGen (which lives on #main-content, not on
  // this #tab-content element). A slow matrix fetch must not paint into a tab
  // the user has since switched away from.
  const alive = () => contentEl.dataset.tab === 'insights' && contentEl.isConnected;
  const slot = contentEl.querySelector('#competitor-matrix-slot');
  if (!slot) return;
  let data;
  try {
    data = await api.competitorMatrix(topic);
  } catch { if (!alive()) return; slot.innerHTML = ''; return; }
  if (!alive()) return;
  if (!data || !data.ok || !(data.features || []).length) { slot.innerHTML = ''; return; }
  slot.innerHTML = renderCompetitorMatrix(data);
  window.refreshIcons?.();
}

// Counter-evidence modal — click "⚖ N disagree" chip, see the actual
// disconfirming posts in a dialog. Queries the posts table by the
// stored post_ids. Biggest credibility feature per methodology doc §6.2.
async function showCounterEvidenceModal(topic, findingTitle, postIds) {
  const { api } = await import('../api.js');
  let rows = [];
  try {
    // runQuery has injection-safe `:ids` param support via the --param
    // flag on the CLI; we inline-join because post IDs are non-user-facing
    // (come from the LLM's synthesis output).
    const placeholders = postIds.map((_, i) => `:p${i}`).join(',');
    const params = {};
    postIds.forEach((id, i) => { params[`p${i}`] = id; });
    rows = await api.runQuery(
      `SELECT id, title, substr(selftext, 1, 400) AS excerpt, author,
              coalesce(source_type,'reddit') AS source, permalink, url
       FROM posts WHERE id IN (${placeholders}) LIMIT 20`,
      topic, params,
    );
  } catch (e) {
    rows = [];
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.hidden = false;
  backdrop.innerHTML = `
    <div class="modal" style="max-width:640px;max-height:80vh;overflow:auto">
      <h3 style="margin-top:0">⚖ Counter-evidence</h3>
      <p class="muted">${esc(rows.length)} post(s) that disagree with <b>${esc(findingTitle)}</b> or defend the status quo. Important for avoiding confirmation bias.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
        ${rows.length === 0 ? `<p class="muted">(No matching posts found — IDs may have been pruned from the corpus.)</p>` :
          rows.map(r => `
            <div class="counter-evidence-post">
              <div class="cep-head">
                <span class="posts-source">${esc(r.source)}</span>
                <span class="muted">u/${esc(r.author || 'anon')}</span>
              </div>
              <a href="${esc(postLink(r) || '#')}" target="_blank" rel="noopener" class="cep-title">${esc(r.title || '(untitled)')}</a>
              ${r.excerpt ? `<p class="cep-excerpt">${esc(r.excerpt)}${r.excerpt.length >= 400 ? '…' : ''}</p>` : ''}
            </div>
          `).join('')}
      </div>
      <div class="modal-actions" style="justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost btn-bordered" id="cep-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#cep-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  window.refreshIcons?.();
}

export async function loadInsights(contentEl, topic) {
  // Gated writes — drop any render that would land after a tab switch.
  const set = (html) => { if (contentEl.dataset.tab === 'insights') contentEl.innerHTML = html; };

  // ─── Phase 0: instant paint from localStorage SWR cache ──────────────
  // Without this, every topic Home open paid 800-1500 ms of sidecar cold
  // start before showing anything. The cache survives full app restart so
  // the second time the user opens the same topic (whether in this session
  // or after closing the app), the report renders in <10 ms while the
  // fresh fetch happens in the background. Only paint when we have a real
  // report — the empty-state should ALWAYS reflect the live answer, not
  // a memoised "no data" placeholder.
  const CACHE_KEY = `insights.${topic}`;
  const cachedSnap = readScreenCache(CACHE_KEY);
  let paintedFromCache = false;
  if (cachedSnap && cachedSnap.ok && (cachedSnap.findings || cachedSnap.executive_summary)) {
    set(renderFull(cachedSnap, contentEl, topic));
    if (contentEl.dataset.tab === 'insights') {
      contentEl.dataset.cached = '1';
      wireCards(contentEl, topic, cachedSnap);
      $('#btn-insights-regen', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
      window.refreshIcons?.();
    }
    paintedFromCache = true;
  } else {
    set(skelDetail({ paras: 6 }));
  }

  // ─── Phase 1: background refresh (cached server-side, ~500-1500 ms) ──
  let cached;
  try {
    cached = await api.synthesizeInsights(topic, true);
  } catch (e) {
    if (contentEl.dataset.tab !== 'insights') return;
    // Keep the cached paint if we have one — better than blanking on a
    // transient error. Otherwise fall through to the error card.
    if (paintedFromCache) return;
    set(renderError(e?.message || String(e)));
    wireRunButton(contentEl, topic);
    return;
  }
  if (contentEl.dataset.tab !== 'insights') return;

  // If we got a real report, render it.
  if (cached && cached.ok && (cached.findings || cached.executive_summary)) {
    writeScreenCache(CACHE_KEY, cached);
    await annotateWithResearchLinks(cached, topic);
    set(renderFull(cached, contentEl, topic));
    if (contentEl.dataset.tab !== 'insights') return;
    contentEl.dataset.cached = '';
    wireCards(contentEl, topic, cached);
    $('#btn-insights-regen', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
    window.refreshIcons?.();
    return;
  }

  // No cache (or error). If we already painted a stale cache, leave it
  // alone — the user gets old-but-valid data instead of a flash of empty.
  if (paintedFromCache) return;

  // A synthesis is already in flight (kicked on an earlier tab open). Re-show
  // the alive loader continuing from the REAL elapsed via runKey, and do NOT
  // start a second run — the in-flight run repaints when it lands.
  if (_insightsRunning.has(topic)) {
    renderAnalyzingState(contentEl, {
      headline: 'Generating insights', stages: INSIGHT_STAGES,
      medianRuntimeSec: 45, etaText: 'typically 30–90 seconds', skeletonCount: 3,
      runKey: insightsRunKey(topic),
    });
    return;
  }

  set(renderEmpty(cached?.error));
  wireRunButton(contentEl, topic);
  window.refreshIcons?.();
  if (isAutoRunEnabled() && await hasLlmConfigured()) {
    // Trip the same handler the CTA button wires up. Guarded by tab check.
    if (contentEl.dataset.tab === 'insights') runSynth(contentEl, topic);
  }
}

async function runSynth(contentEl, topic) {
  if (_insightsRunning.has(topic)) return;  // already running — don't double-fire
  _insightsRunning.add(topic);
  try {
  const set = (html) => { if (contentEl.dataset.tab === 'insights') contentEl.innerHTML = html; };
  // Full-bleed alive loader while the blocking synthesis call runs. We snap
  // it to complete just before painting the report, and stop() (no snap)
  // before any error/empty render.
  const stop = renderAnalyzingState(contentEl, {
    headline: 'Generating insights', stages: INSIGHT_STAGES,
    medianRuntimeSec: 45, etaText: 'typically 30–90 seconds', skeletonCount: 3,
    runKey: insightsRunKey(topic),
  });
  // Use monitor_run_topic instead of raw synthesize — same synthesis call,
  // but wrapped in the Phase-4 delta recorder. Every regenerate now
  // writes a topic_runs row, which populates the Dashboard weekly card.
  let runResult;
  try {
    runResult = await api.monitorRunTopic(topic, true);  // skip_collect=true for speed
  } catch (e) {
    stop();
    if (contentEl.dataset.tab !== 'insights') return;
    set(renderError(e?.message || String(e)));
    wireRunButton(contentEl, topic);
    window.refreshIcons?.();
    return;
  }
  if (contentEl.dataset.tab !== 'insights') { stop(); return; }
  if (!runResult || !runResult.ok) {
    stop();
    set(renderError(
      runResult?.error || 'Synthesis returned no report.',
      runResult?.error_code,
      runResult?.provider,
    ));
    wireRunButton(contentEl, topic);
    window.refreshIcons?.();
    return;
  }
  stop({ snapToComplete: true });
  if (contentEl.dataset.tab !== 'insights') return;
  const report = runResult.report;
  // Phase-10 — fire-and-forget link refresh. Runs the palace linker in the
  // background so next insights load shows research chips. Failure here is
  // silent (palace may not be available in user's env).
  api.linkResearch(topic, 3).catch(() => {});
  await annotateWithResearchLinks(report, topic);
  set(renderFull(report, contentEl, topic));
  wireCards(contentEl, topic, report);
  $('#btn-insights-regen', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
  // Flash a small delta summary if any changes — reinforces the "weekly ritual"
  const d = runResult.delta || {};
  const changed = (d.findings_added || []).length + (d.findings_removed || []).length + (d.score_changes || []).length;
  if (!d.is_first_run && changed > 0) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.innerHTML = `✨ ${changed} change${changed === 1 ? '' : 's'} this run — see <a href="#/">Dashboard</a> for the delta digest.`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
  window.refreshIcons?.();
  } finally {
    _insightsRunning.delete(topic);
  }
}

function wireRunButton(contentEl, topic) {
  $('#btn-insights-run', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
  $('#btn-insights-chunked', contentEl)?.addEventListener('click', () => runChunkedSynth(contentEl, topic));
}

// Map-reduce chunked synth. Used when the single-call path hits 402/credit
// or context-overflow errors, or when the user explicitly wants a deeper
// scan. Each chunk is a small LLM call (default 800 output tokens, ~600
// input tokens of corpus) so low-credit providers can still produce
// findings. Deterministic merge on the Python side dedupes across chunks.
async function runChunkedSynth(contentEl, topic) {
  if (_insightsRunning.has(topic)) return;  // already running — don't double-fire
  _insightsRunning.add(topic);
  try {
  const set = (html) => { if (contentEl.dataset.tab === 'insights') contentEl.innerHTML = html; };
  // Alive loader for the chunked map-reduce path. Same cleanup contract as
  // runSynth — snap on success, stop() before any error/empty render.
  const stop = renderAnalyzingState(contentEl, {
    headline: 'Deep scan (chunked mode)', stages: INSIGHT_CHUNKED_STAGES,
    medianRuntimeSec: 60, etaText: 'longer than the fast path — works on low-credit providers', skeletonCount: 3,
    runKey: insightsRunKey(topic),
  });
  let report;
  try {
    report = await api.synthesizeInsightsChunked(topic, {
      chunkSize: 40,
      maxWorkers: null,       // auto per provider
      maxTokensPerChunk: 800,
    });
  } catch (e) {
    stop();
    if (contentEl.dataset.tab !== 'insights') return;
    set(renderError(e?.message || String(e)));
    wireRunButton(contentEl, topic);
    window.refreshIcons?.();
    return;
  }
  if (contentEl.dataset.tab !== 'insights') { stop(); return; }
  if (!report || !report.ok) {
    stop();
    set(renderError(
      report?.error || 'Chunked synth returned no report.',
      report?.error_code,
      report?.provider,
    ));
    wireRunButton(contentEl, topic);
    window.refreshIcons?.();
    return;
  }
  stop({ snapToComplete: true });
  if (contentEl.dataset.tab !== 'insights') return;
  api.linkResearch(topic, 3).catch(() => {});
  await annotateWithResearchLinks(report, topic);
  set(renderFull(report, contentEl, topic));
  wireCards(contentEl, topic, report);
  $('#btn-insights-regen', contentEl)?.addEventListener('click', () => runSynth(contentEl, topic));
  window.refreshIcons?.();
  } finally {
    _insightsRunning.delete(topic);
  }
}

// ─── Phase 8 — Chat sidebar on Insights tab ──────────────────────────
// Collapsible right-hand panel; reuses the same chat streaming events as
// the Chat tab so both UIs stay in sync if the user opens them together.
// State is persisted per-topic in localStorage so users return to their
// Q&A history the next time they open the topic.
function wireChatSidebar(contentEl, topic) {
  const aside = contentEl.querySelector('#insights-chat-aside');
  const toggleBtn = contentEl.querySelector('#btn-insights-chat-toggle');
  const closeBtn = aside?.querySelector('#ica-close');
  const input = aside?.querySelector('#ica-input');
  const sendBtn = aside?.querySelector('#ica-send');
  const historyEl = aside?.querySelector('#ica-history');
  const chips = aside?.querySelectorAll('.ica-prompt-chip');
  if (!aside || !toggleBtn || !input || !sendBtn || !historyEl) return;

  const STORAGE_KEY = `gapmap.insights.chat.${topic}`;
  const VISIBLE_KEY = `gapmap.insights.chat.visible.${topic}`;
  let history = [];
  try { history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch {}

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40))); } catch {}
  }
  function render() {
    historyEl.innerHTML = history.map(m => `
      <div class="ica-msg ica-${m.role}">
        <div class="ica-msg-role">${m.role === 'user' ? 'You' : 'Gap Map'}</div>
        <div class="ica-msg-text">${esc(m.text || '')}</div>
      </div>
    `).join('');
    historyEl.scrollTop = historyEl.scrollHeight;
  }
  function show(visible) {
    aside.hidden = !visible;
    contentEl.querySelector('.insights-tab')?.classList.toggle('chat-open', !!visible);
    localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0');
    if (visible) input.focus();
  }

  // Restore visibility preference
  if (localStorage.getItem(VISIBLE_KEY) === '1') show(true);
  render();

  toggleBtn.addEventListener('click', () => show(aside.hidden));
  closeBtn?.addEventListener('click', () => show(false));

  let stream = { active: false, unlistenProgress: null, unlistenDone: null };

  async function send(question) {
    if (!question || stream.active) return;
    history.push({ role: 'user', text: question });
    history.push({ role: 'assistant', text: '' });
    persist();
    render();
    sendBtn.disabled = true;
    stream.active = true;
    try {
      stream.unlistenProgress = await api.onChatProgress(line => {
        let ev; try { ev = JSON.parse(line); } catch { return; }
        const last = history[history.length - 1];
        if (!last || last.role !== 'assistant') return;
        if (ev.event === 'token' || ev.event === 'text') {
          last.text += ev.text || ev.token || '';
          render();
        } else if (ev.event === 'error') {
          last.text = `✗ ${ev.error || 'chat error'}`;
          render();
        } else if (ev.event === 'tool_call') {
          last.text += `\n\n🛠 using tool: ${ev.tool || ev.name || '?'}`;
          render();
        }
      });
      stream.unlistenDone = await api.onChatDone(() => {
        try { stream.unlistenProgress?.(); } catch {}
        try { stream.unlistenDone?.(); } catch {}
        stream.unlistenProgress = null;
        stream.unlistenDone = null;
        stream.active = false;
        sendBtn.disabled = false;
        persist();
      });
      // agent=true so tool-use is available (run_query, sample_posts, etc.)
      await api.startChat(topic, question, 'agent', true);
    } catch (err) {
      const last = history[history.length - 1];
      if (last && last.role === 'assistant') last.text = `✗ ${err?.message || err}`;
      try { stream.unlistenProgress?.(); } catch {}
      try { stream.unlistenDone?.(); } catch {}
      stream.active = false;
      sendBtn.disabled = false;
      render();
    }
  }

  sendBtn.addEventListener('click', () => {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    send(q);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });
  chips?.forEach(c => c.addEventListener('click', () => send(c.dataset.q)));

  // Keyboard shortcut: ⌘/ toggles the sidebar (Phase 11.5).
  const kbd = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      show(aside.hidden);
    }
  };
  document.addEventListener('keydown', kbd);
  // Clean up listener when tab changes — contentEl dataset.tab flips.
  const observer = new MutationObserver(() => {
    if (contentEl.dataset.tab !== 'insights') {
      document.removeEventListener('keydown', kbd);
      observer.disconnect();
    }
  });
  observer.observe(contentEl, { attributes: true, attributeFilter: ['data-tab'] });

  window.refreshIcons?.();
}

// ─── Phase 10 — Research link annotation + modal ─────────────────────
// Fetches per-finding paper counts ONCE and decorates findings in-place
// so the chip appears during the main render pass.
async function annotateWithResearchLinks(report, topic) {
  let summary = {};
  try {
    summary = await api.researchLinks(topic, null) || {};
  } catch { return; }
  if (!summary || typeof summary !== 'object') return;
  // Case-insensitive lookup — linker stores titles lowercased
  const lower = {};
  for (const [k, v] of Object.entries(summary)) lower[k.toLowerCase()] = v;
  (report.findings || []).forEach(f => {
    const key = (f.title || '').toLowerCase();
    if (lower[key]) f._linked_papers_count = lower[key];
  });
}

async function showResearchLinksModal(topic, findingTitle) {
  let rows = [];
  try {
    rows = await api.researchLinks(topic, findingTitle);
  } catch { rows = []; }
  if (!Array.isArray(rows)) rows = [];

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.hidden = false;
  backdrop.innerHTML = `
    <div class="modal" style="max-width:680px;max-height:80vh;overflow:auto">
      <h3 style="margin-top:0">📚 Research linked to this finding</h3>
      <p class="muted">Academic papers in your corpus that semantically match <b>${esc(findingTitle)}</b> (Phase-10 palace linker).</p>
      <div class="research-links-list">
        ${rows.length === 0
          ? `<p class="muted">No linked papers yet. Run <code>research link-research --topic "${esc(topic)}"</code> or collect academic sources (arxiv/openalex/pubmed).</p>`
          : rows.map(r => {
              const sim = r.similarity != null ? (Math.round(r.similarity * 100) + '%') : '';
              const href = postLink(r) || '#';
              return `
                <div class="research-link-row">
                  <a href="${esc(href)}" target="_blank" rel="noopener" class="rlr-title">${esc(r.title || '(untitled paper)')}</a>
                  <div class="rlr-meta">
                    <span class="rlr-sim">sim ${sim}</span>
                    <span>${esc(r.source_type || 'unknown')}</span>
                    ${r.author ? `<span>${esc(r.author)}</span>` : ''}
                  </div>
                  ${r.excerpt ? `<p class="cep-excerpt" style="margin-top:6px;font-size:var(--fs-13);color:var(--ink-2)">${esc(r.excerpt)}${r.excerpt.length >= 300 ? '…' : ''}</p>` : ''}
                </div>
              `;
            }).join('')}
      </div>
      <div class="modal-actions" style="justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost btn-bordered" id="rlm-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#rlm-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  window.refreshIcons?.();
}

function wireCards(contentEl, topic, report) {
  // Phase-9 — load competitor matrix asynchronously (doesn't block main render).
  loadCompetitorMatrix(contentEl, topic);

  // Phase-8 — chat sidebar wiring.
  wireChatSidebar(contentEl, topic);

  // Consensus (deliberation tiers) — collapsible; lazy-runs api.deliberate.
  wireConsensusSection(contentEl, topic);

  // Phase-7 — Export dropdown. Click toggles menu; item copies to clipboard.
  const exportBtn = contentEl.querySelector('#btn-insights-export');
  const exportMenu = contentEl.querySelector('#export-dropdown-menu');
  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.hidden = !exportMenu.hidden;
      if (!exportMenu.hidden) window.refreshIcons?.();
    });
    document.addEventListener('click', (e) => {
      if (!exportMenu.contains(e.target) && e.target !== exportBtn) exportMenu.hidden = true;
    });
    exportMenu.querySelectorAll('.export-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const format = item.dataset.format;
        withButtonBusy(item, async () => {
          const md = await api.exportBrief(topic, format);
          await navigator.clipboard.writeText(md || '');
          exportMenu.hidden = true;
          const toast = document.createElement('div');
          toast.className = 'toast toast-success';
          toast.innerHTML = `📋 ${format} brief copied to clipboard (${(md || '').length.toLocaleString()} chars)`;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3500);
        }, { busyLabel: 'Exporting…' }).catch((err) => {
          exportMenu.hidden = true;
          const toast = document.createElement('div');
          toast.className = 'toast toast-error';
          toast.innerHTML = `Export failed: ${esc(err?.message || String(err))}`;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 4000);
        });
      });
    });
  }

  // Phase-10 — research-link chip opens a modal listing academic papers
  // matched to this finding via the palace-based linker.
  contentEl.querySelectorAll('.insight-chip.research-link').forEach(el => {
    el.addEventListener('click', () => {
      const title = el.dataset.researchTitle || '(unnamed finding)';
      showResearchLinksModal(topic, title);
    });
  });

  // Citation chips → drill into Posts tab with the evidence post_ids.
  contentEl.querySelectorAll('.insight-cite-chip').forEach(el => {
    el.addEventListener('click', () => {
      const ids = (el.dataset.ev || '').split(',').filter(Boolean);
      if (!ids.length) return;
      console.info('[insights] evidence post_ids:', ids);
    });
  });

  // Suggested tactic chips → detail modal with description/examples.
  contentEl.querySelectorAll('.insight-tactic-chip').forEach(el => {
    el.addEventListener('click', () => {
      const raw = (el.dataset.tactic || '').trim();
      if (!raw) return;
      try {
        const tactic = JSON.parse(decodeURIComponent(raw));
        showTacticModal(tactic);
      } catch {}
    });
  });

  // Counter-evidence chips → modal with the disconfirming posts.
  contentEl.querySelectorAll('.counter-evidence').forEach(el => {
    el.addEventListener('click', () => {
      const ids = (el.dataset.disconfirm || '').split(',').filter(Boolean);
      const title = el.dataset.title || '(unnamed finding)';
      if (ids.length) showCounterEvidenceModal(topic, title, ids);
    });
  });

  // Phase-3 "Save as bet" — promote a hypothesis card to a tracked bet.
  // Freezes the card at save time; Bets tab picks it up immediately.
  const hypotheses = (report && report.hypotheses) || [];
  contentEl.querySelectorAll('.hyp-save-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.dataset.hypIdx);
      const card = hypotheses[idx];
      if (!card) return;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader"></i> Saving…';
      window.refreshIcons?.();
      try {
        const { saveBetFromCard } = await import('./bets.js');
        await saveBetFromCard(topic, card);
        btn.innerHTML = '<i data-lucide="check"></i> Saved';
        window.refreshIcons?.();
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="target"></i> Save as bet';
          window.refreshIcons?.();
        }, 2500);
      } catch {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="target"></i> Save as bet';
        window.refreshIcons?.();
      }
    });
  });

  // ── AG-C T2.4 — Finding feedback 👎 wiring. Prompt user for verdict
  // + optional note, persist via api.feedbackRecord, disable button on
  // success so double-click doesn't double-record. Uses `prompt()` for
  // verdict (keeps implementation minimal — a polished modal can land
  // later without changing the backend contract).
  contentEl.querySelectorAll('.insight-feedback-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const title = btn.dataset.fbTitle || '';
      const kind = btn.dataset.fbKind || 'painpoint';
      if (!title) return;
      const verdictRaw = window.prompt(
        'Why is this finding wrong?\n\n' +
        'Enter one of:\n' +
        '  wrong      — the claim is incorrect\n' +
        '  off_topic  — not relevant to this topic\n' +
        '  spam       — low-signal / marketing noise',
        'wrong',
      );
      if (verdictRaw == null) return;  // user cancelled
      const verdict = verdictRaw.trim().toLowerCase();
      if (!['wrong', 'off_topic', 'spam'].includes(verdict)) {
        alert('Verdict must be one of: wrong, off_topic, spam');
        return;
      }
      const note = window.prompt(
        'Optional note (leave blank to skip). This is stored with the feedback.',
        '',
      ) || '';
      btn.disabled = true;
      btn.title = 'Saving feedback…';
      try {
        await api.feedbackRecord(topic, title, kind, verdict, note.trim());
        btn.innerHTML = '<span aria-hidden="true">✓</span>';
        btn.title = `Flagged as ${verdict}. Will be excluded from the next synthesize.`;
        btn.classList.add('insight-feedback-btn-done');
      } catch (err) {
        btn.disabled = false;
        btn.title = 'Click to flag this finding';
        alert(`Failed to record feedback: ${err?.message || err}`);
      }
    });
  });
}
