// Pricing & quantitative survey hub.
//
// Three instruments share this screen, gated by a tab strip:
//   1. Van Westendorp PSM (1976) — 4-question price sensitivity
//   2. Net Promoter Score (Reichheld 2003) — 0..10 recommend question
//   3. MaxDiff (Louviere 1990s) — best/worst feature ranking
//
// Routes:
//   #/pricing            → topic picker
//   #/pricing/<topic>    → tabbed instruments + add forms + summaries
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function topicFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/pricing\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// ── Van Westendorp ─────────────────────────────────────────────────────
function vwPanel(agg) {
  if (!agg || (agg.n || 0) === 0) {
    return `<div class="card muted">No Van Westendorp responses yet — add at least 30 for stable curves.</div>`;
  }
  const f = (v) => (v == null) ? '—' : Number(v).toFixed(2);
  return `
    <div class="vw-summary card">
      <div class="vw-grid">
        <div><div class="vw-label">OPP — optimal price</div><div class="vw-val">${f(agg.opp)}</div></div>
        <div><div class="vw-label">IPP — indifference</div><div class="vw-val">${f(agg.ipp)}</div></div>
        <div><div class="vw-label">PMC — lower bound</div><div class="vw-val">${f(agg.pmc)}</div></div>
        <div><div class="vw-label">PME — upper bound</div><div class="vw-val">${f(agg.pme)}</div></div>
      </div>
      <p class="muted" style="font-size:11px">
        Van Westendorp 1976 — OPP minimises price resistance; PMC..PME is
        the acceptable range. n=${agg.n}.
      </p>
    </div>
  `;
}

function vwForm() {
  return `
    <section class="card">
      <h3>Add Van Westendorp response</h3>
      <p class="muted" style="font-size:12px">Ask one respondent all four prices. Use any currency consistently.</p>
      <div class="vw-form-grid">
        <label>Too expensive (won't buy)<input id="vw-too-exp" type="number" step="0.01" min="0" placeholder="e.g. 99"/></label>
        <label>Expensive but acceptable<input id="vw-exp-acc" type="number" step="0.01" min="0" placeholder="e.g. 49"/></label>
        <label>Bargain (great deal)<input id="vw-bargain" type="number" step="0.01" min="0" placeholder="e.g. 19"/></label>
        <label>Too cheap (suspect quality)<input id="vw-too-cheap" type="number" step="0.01" min="0" placeholder="e.g. 5"/></label>
        <label>Persona<input id="vw-persona" type="text" placeholder="optional segment"/></label>
        <label>Respondent<input id="vw-resp" type="text" placeholder="optional id / email"/></label>
      </div>
      <button class="btn primary" id="vw-add">Add response</button>
    </section>
  `;
}

// ── NPS ────────────────────────────────────────────────────────────────
function npsPanel(s) {
  if (!s || (s.n || 0) === 0) {
    return `<div class="card muted">No NPS responses yet.</div>`;
  }
  const tone =
    s.nps >= 50 ? 'pmf-met' :
    s.nps >= 0  ? '' : 'pmf-unmet';
  return `
    <div class="nps-summary card">
      <div class="nps-headline">
        <div class="nps-score ${tone}">${s.nps.toFixed(1)}</div>
        <div>
          <div>Net Promoter Score (n=${s.n})</div>
          <div class="muted" style="font-size:11px">SaaS avg ~30–40; ≥50 excellent; ≥70 world-class.</div>
        </div>
      </div>
      <div class="nps-counts">
        <span class="nps-c nps-promoter">Promoters ${s.promoters}</span>
        <span class="nps-c nps-passive">Passives ${s.passives}</span>
        <span class="nps-c nps-detractor">Detractors ${s.detractors}</span>
      </div>
    </div>
  `;
}

function npsForm() {
  return `
    <section class="card">
      <h3>Add NPS response</h3>
      <p class="muted" style="font-size:12px">"How likely are you to recommend this to a friend or colleague?" 0..10.</p>
      <div class="vw-form-grid">
        <label>Score (0–10)<input id="nps-score-in" type="number" min="0" max="10" placeholder="0..10"/></label>
        <label>Persona<input id="nps-persona" type="text"/></label>
        <label>Respondent<input id="nps-resp" type="text"/></label>
        <label>Reason (optional)
          <textarea id="nps-reason" rows="2" placeholder="Why that score?"></textarea>
        </label>
      </div>
      <button class="btn primary" id="nps-add">Add NPS</button>
    </section>
  `;
}

// ── MaxDiff ────────────────────────────────────────────────────────────
function maxDiffPanel(rank) {
  if (!rank || (rank.n || 0) === 0) {
    return `<div class="card muted">No MaxDiff responses yet — collect at least 4 sets per option for stable BW scores.</div>`;
  }
  const rows = (rank.ranking || []).map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(r.option)}</td>
      <td>${r.bw_score >= 0 ? '+' : ''}${r.bw_score.toFixed(2)}</td>
      <td>${r.best}</td>
      <td>${r.worst}</td>
      <td>${r.n_seen}</td>
    </tr>
  `).join('');
  return `
    <div class="maxdiff-summary card">
      <h3>Feature ranking (BW score)</h3>
      <table class="maxdiff-table">
        <thead><tr><th>#</th><th>Option</th><th>BW</th><th>Best</th><th>Worst</th><th>Seen</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted" style="font-size:11px">n=${rank.n} sets. BW = (best − worst) / appearances. ±1 range.</p>
    </div>
  `;
}

function maxDiffForm() {
  return `
    <section class="card">
      <h3>Add MaxDiff response</h3>
      <p class="muted" style="font-size:12px">
        Show the respondent a small set (4–5 options). They pick BEST and WORST.
        Repeat across sets so each option appears multiple times.
      </p>
      <label>Set ID (e.g. set-1)<input id="md-setid" type="text" placeholder="set-1"/></label>
      <label>Options shown (one per line, 4–5 ideal)
        <textarea id="md-options" rows="5" placeholder="One option per line"></textarea>
      </label>
      <div class="vw-form-grid">
        <label>Best<input id="md-best" type="text" placeholder="paste exact option text"/></label>
        <label>Worst<input id="md-worst" type="text" placeholder="paste exact option text"/></label>
        <label>Persona<input id="md-persona" type="text"/></label>
        <label>Respondent<input id="md-resp" type="text"/></label>
      </div>
      <button class="btn primary" id="md-add">Add MaxDiff</button>
    </section>
  `;
}

function renderShell(topic, vwAgg, nps, md) {
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/pricing">Pricing & surveys</a> ›
        <strong>${esc(topic)}</strong>
      </div>
    </header>
    <div class="pricing-wrap">
      <div class="pricing-tabs">
        <button class="pricing-tab is-active" data-pt="vw">Van Westendorp</button>
        <button class="pricing-tab" data-pt="nps">NPS</button>
        <button class="pricing-tab" data-pt="maxdiff">MaxDiff</button>
      </div>

      <div class="pricing-pane" data-pane="vw">
        ${vwPanel(vwAgg)}
        ${vwForm()}
      </div>
      <div class="pricing-pane" data-pane="nps" hidden>
        ${npsPanel(nps)}
        ${npsForm()}
      </div>
      <div class="pricing-pane" data-pane="maxdiff" hidden>
        ${maxDiffPanel(md)}
        ${maxDiffForm()}
      </div>
    </div>
  `;
}

async function renderTopicPricing(root, topic) {
  root.innerHTML = `<div class="empty-state">Loading pricing data…</div>`;
  const reload = () => renderTopicPricing(root, topic);

  let vwAgg = {}, nps = {}, md = {};
  try {
    [vwAgg, nps, md] = await Promise.all([
      api.vwAggregate(topic),
      api.npsScore(topic),
      api.maxdiffRanking(topic),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load pricing data</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }

  root.innerHTML = renderShell(topic, vwAgg, nps, md);
  window.refreshIcons?.();

  // Tab switching
  $$('.pricing-tab', root).forEach(t => t.addEventListener('click', () => {
    const k = t.dataset.pt;
    $$('.pricing-tab', root).forEach(x => x.classList.toggle('is-active', x === t));
    $$('.pricing-pane', root).forEach(p => p.hidden = p.dataset.pane !== k);
  }));

  // VW
  $('#vw-add', root)?.addEventListener('click', async () => {
    const payload = {
      too_expensive:           parseFloat($('#vw-too-exp', root).value || '0'),
      expensive_but_acceptable: parseFloat($('#vw-exp-acc', root).value || '0'),
      bargain:                 parseFloat($('#vw-bargain', root).value || '0'),
      too_cheap:               parseFloat($('#vw-too-cheap', root).value || '0'),
      persona:                 $('#vw-persona', root).value.trim(),
      respondent:              $('#vw-resp', root).value.trim(),
    };
    if (!payload.too_expensive || !payload.too_cheap) {
      alert('At minimum, enter too_expensive and too_cheap.');
      return;
    }
    try {
      await api.vwAdd(topic, payload);
      await reload();
    } catch (e) { alert(`Add failed: ${e?.message || e}`); }
  });

  // NPS
  $('#nps-add', root)?.addEventListener('click', async () => {
    const payload = {
      score:      parseInt($('#nps-score-in', root).value || '0', 10),
      persona:    $('#nps-persona', root).value.trim(),
      respondent: $('#nps-resp', root).value.trim(),
      reason:     $('#nps-reason', root).value.trim(),
    };
    try {
      await api.npsAdd(topic, payload);
      await reload();
    } catch (e) { alert(`Add failed: ${e?.message || e}`); }
  });

  // MaxDiff
  $('#md-add', root)?.addEventListener('click', async () => {
    const opts = ($('#md-options', root).value || '')
      .split(/\n/).map(s => s.trim()).filter(Boolean);
    const payload = {
      set_id: $('#md-setid', root).value.trim() || `set-${Date.now()}`,
      best:   $('#md-best', root).value.trim(),
      worst:  $('#md-worst', root).value.trim(),
      options: opts,
      persona: $('#md-persona', root).value.trim(),
      respondent: $('#md-resp', root).value.trim(),
    };
    if (!payload.best || !payload.worst || !opts.length) {
      alert('Need options + best + worst.');
      return;
    }
    try {
      await api.maxdiffAdd(topic, payload);
      await reload();
    } catch (e) { alert(`Add failed: ${e?.message || e}`); }
  });
}

async function renderPicker(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><strong>Pricing & surveys</strong> · Van Westendorp · NPS · MaxDiff</div>
    </header>
    <div class="pricing-wrap"><div id="prc-pick-mount"><div class="empty-state">loading…</div></div></div>
  `;
  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    $('#prc-pick-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!topics?.length) {
    $('#prc-pick-mount', root).innerHTML = `<div class="empty-big"><h3>No topics yet</h3><a class="btn primary" href="#/topics">Open Topics</a></div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)}</option>`).join('');
  $('#prc-pick-mount', root).innerHTML = `
    <div class="pricing-picker card">
      <h2>Pick a topic for pricing surveys</h2>
      <p class="muted" style="font-size:13px;line-height:1.6;max-width:680px">
        Three quantitative instruments share this screen — the same dataset
        feeds the PRD's "Demand validation" section.
      </p>
      <div class="row" style="gap:8px;margin-top:14px;align-items:center">
        <select id="prc-topic-pick">${opts}</select>
        <button class="btn primary" id="prc-go">Open →</button>
      </div>
    </div>
  `;
  $('#prc-go', root)?.addEventListener('click', () => {
    const t = $('#prc-topic-pick', root).value;
    if (t) location.hash = `#/pricing/${encodeURIComponent(t)}`;
  });
}

export async function renderPricing(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicPricing(root, topic);
  return renderPicker(root);
}
