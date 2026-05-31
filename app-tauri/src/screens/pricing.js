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
//
// Design: matches Home/Topics — slash crumbs + topbar-spacer, tabs as
// .pill .active style, .stat-grid for headline values, card-head/body.
import { api, esc } from '../api.js';
import { skelStats, skelRows } from '../lib/skeleton.js';
import { withButtonBusy } from '../lib/busyButton.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function topicFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/pricing\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// ── Van Westendorp ─────────────────────────────────────────────────────
function vwStats(agg) {
  if (!agg || (agg.n || 0) === 0) {
    return `
      <section class="stat-grid">
        <div class="stat-card">
          <div class="stat-head">
            <div class="stat-icon sky"><i data-lucide="dollar-sign"></i></div>
          </div>
          <div class="stat-num">—</div>
          <div class="stat-label">No Van Westendorp responses (need ≥30)</div>
        </div>
      </section>
    `;
  }
  const f = (v) => (v == null) ? '—' : Number(v).toFixed(2);
  return `
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon mint"><i data-lucide="target"></i></div></div>
        <div class="stat-num">${f(agg.opp)}</div>
        <div class="stat-label">OPP — optimal price</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon sky"><i data-lucide="circle-dot"></i></div></div>
        <div class="stat-num">${f(agg.ipp)}</div>
        <div class="stat-label">IPP — indifference</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon lavender"><i data-lucide="arrow-down"></i></div></div>
        <div class="stat-num">${f(agg.pmc)}</div>
        <div class="stat-label">PMC — lower bound (n=${agg.n})</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon peach"><i data-lucide="arrow-up"></i></div></div>
        <div class="stat-num">${f(agg.pme)}</div>
        <div class="stat-label">PME — upper bound</div>
      </div>
    </section>
  `;
}

function vwForm() {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Add Van Westendorp response</h3>
          <p>Ask one respondent all four prices — any currency, used consistently</p>
        </div>
      </div>
      <div class="card-body">
        <div class="vw-form-grid">
          <label>Too expensive (won't buy)<input id="vw-too-exp" type="number" step="0.01" min="0" placeholder="e.g. 99"/></label>
          <label>Expensive but acceptable<input id="vw-exp-acc" type="number" step="0.01" min="0" placeholder="e.g. 49"/></label>
          <label>Bargain (great deal)<input id="vw-bargain" type="number" step="0.01" min="0" placeholder="e.g. 19"/></label>
          <label>Too cheap (suspect quality)<input id="vw-too-cheap" type="number" step="0.01" min="0" placeholder="e.g. 5"/></label>
          <label>Persona<input id="vw-persona" type="text" placeholder="optional segment"/></label>
          <label>Respondent<input id="vw-resp" type="text" placeholder="optional id / email"/></label>
        </div>
        <div style="margin-top:14px">
          <button class="btn btn-primary btn-sm" id="vw-add">Add response</button>
        </div>
      </div>
    </div>
  `;
}

// ── NPS ────────────────────────────────────────────────────────────────
function npsStats(s) {
  if (!s || (s.n || 0) === 0) {
    return `
      <section class="stat-grid">
        <div class="stat-card">
          <div class="stat-head">
            <div class="stat-icon sky"><i data-lucide="thumbs-up"></i></div>
          </div>
          <div class="stat-num">—</div>
          <div class="stat-label">No NPS responses yet</div>
        </div>
      </section>
    `;
  }
  const trendCls =
    s.nps >= 50 ? 'trend-up' :
    s.nps >= 0  ? 'trend-flat' : 'trend-down';
  const trendLabel =
    s.nps >= 50 ? '✓ Excellent' :
    s.nps >= 30 ? 'Healthy' :
    s.nps >= 0  ? 'Below avg' : '⚠ Critical';
  return `
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon mint"><i data-lucide="thumbs-up"></i></div>
          <div class="stat-trend ${trendCls}">${trendLabel}</div>
        </div>
        <div class="stat-num">${s.nps.toFixed(1)}</div>
        <div class="stat-label">NPS (n=${s.n})</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon mint"><i data-lucide="smile"></i></div></div>
        <div class="stat-num">${s.promoters}</div>
        <div class="stat-label">Promoters (9-10)</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon sky"><i data-lucide="meh"></i></div></div>
        <div class="stat-num">${s.passives}</div>
        <div class="stat-label">Passives (7-8)</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon peach"><i data-lucide="frown"></i></div></div>
        <div class="stat-num">${s.detractors}</div>
        <div class="stat-label">Detractors (0-6)</div>
      </div>
    </section>
  `;
}

function npsForm() {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Add NPS response</h3>
          <p>"How likely are you to recommend this to a friend or colleague?" 0–10</p>
        </div>
      </div>
      <div class="card-body">
        <div class="vw-form-grid">
          <label>Score (0–10)<input id="nps-score-in" type="number" min="0" max="10" placeholder="0..10"/></label>
          <label>Persona<input id="nps-persona" type="text"/></label>
          <label>Respondent<input id="nps-resp" type="text"/></label>
          <label>Reason (optional)
            <textarea id="nps-reason" rows="2" placeholder="Why that score?"></textarea>
          </label>
        </div>
        <div style="margin-top:14px">
          <button class="btn btn-primary btn-sm" id="nps-add">Add NPS</button>
        </div>
      </div>
    </div>
  `;
}

// ── MaxDiff ────────────────────────────────────────────────────────────
function maxDiffPanel(rank) {
  if (!rank || (rank.n || 0) === 0) {
    return `
      <div class="card">
        <div class="card-head">
          <div><h3>Feature ranking</h3><p>BW score — appears after ≥4 sets per option</p></div>
        </div>
        <div class="card-body">
          <div class="empty-state" style="padding:24px">No MaxDiff responses yet — collect at least 4 sets per option for stable BW scores.</div>
        </div>
      </div>
    `;
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
    <div class="card">
      <div class="card-head">
        <div><h3>Feature ranking (BW score)</h3><p>n=${rank.n} sets · BW = (best − worst) / appearances</p></div>
      </div>
      <div class="card-body">
        <table class="maxdiff-table">
          <thead><tr><th>#</th><th>Option</th><th>BW</th><th>Best</th><th>Worst</th><th>Seen</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function maxDiffForm() {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Add MaxDiff response</h3>
          <p>Show 4–5 options · respondent picks BEST + WORST · repeat across sets</p>
        </div>
      </div>
      <div class="card-body">
        <label>Set ID (e.g. set-1)<input id="md-setid" type="text" placeholder="set-1"/></label>
        <label style="margin-top:10px">Options shown (one per line, 4–5 ideal)
          <textarea id="md-options" rows="5" placeholder="One option per line"></textarea>
        </label>
        <div class="vw-form-grid" style="margin-top:10px">
          <label>Best<input id="md-best" type="text" placeholder="paste exact option text"/></label>
          <label>Worst<input id="md-worst" type="text" placeholder="paste exact option text"/></label>
          <label>Persona<input id="md-persona" type="text"/></label>
          <label>Respondent<input id="md-resp" type="text"/></label>
        </div>
        <div style="margin-top:14px">
          <button class="btn btn-primary btn-sm" id="md-add">Add MaxDiff</button>
        </div>
      </div>
    </div>
  `;
}

function renderShell(topic, vwAgg, nps, md) {
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/pricing">Pricing &amp; surveys</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>Quantitative surveys</h2>
        <p>Three instruments — Van Westendorp · NPS · MaxDiff</p>
      </div>
      <div class="filter-bar pricing-tabs">
        <button class="pill active" data-pt="vw">Van Westendorp</button>
        <button class="pill" data-pt="nps">NPS</button>
        <button class="pill" data-pt="maxdiff">MaxDiff</button>
      </div>
    </div>

    <div class="pricing-pane" data-pane="vw">
      ${vwStats(vwAgg)}
      ${vwForm()}
    </div>
    <div class="pricing-pane" data-pane="nps" hidden>
      ${npsStats(nps)}
      ${npsForm()}
    </div>
    <div class="pricing-pane" data-pane="maxdiff" hidden>
      ${maxDiffPanel(md)}
      ${maxDiffForm()}
    </div>
  `;
}

async function renderTopicPricing(root, topic) {
  root.innerHTML = `${skelStats(4)}${skelRows(4)}`;
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

  $$('.pricing-tabs .pill', root).forEach(t => t.addEventListener('click', () => {
    const k = t.dataset.pt;
    $$('.pricing-tabs .pill', root).forEach(x => x.classList.toggle('active', x === t));
    $$('.pricing-pane', root).forEach(p => p.hidden = p.dataset.pane !== k);
  }));

  $('#vw-add', root)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
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
  }, { busyLabel: 'Adding…' }));

  $('#nps-add', root)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
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
  }, { busyLabel: 'Adding…' }));

  $('#md-add', root)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
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
  }, { busyLabel: 'Adding…' }));
}

async function renderPicker(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Pricing &amp; surveys</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Van Westendorp · NPS · MaxDiff</span>
    </header>
    <div id="prc-pick-mount">${skelRows(4)}</div>
  `;
  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    $('#prc-pick-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!topics?.length) {
    $('#prc-pick-mount', root).innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Create a topic first — pricing surveys are scoped per topic.</p>
        <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)}</option>`).join('');
  $('#prc-pick-mount', root).innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Pick a topic for pricing surveys</h3>
          <p>Three quantitative instruments share this dataset</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">
          The same dataset feeds the PRD's "Demand validation" section.
        </p>
        <div class="row">
          <select id="prc-topic-pick" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="prc-go">Open →</button>
        </div>
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
