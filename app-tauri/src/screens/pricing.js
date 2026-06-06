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

// ── Response history (shared across the three instruments) ──────────────
// Each instrument has an "add response" form but, until now, no way to see
// or remove the responses already collected. surveyList(topic,'',kind) and
// surveyDelete(id) already exist in api.js — wire them up so the dataset is
// inspectable and editable, not write-only.
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Render the per-instrument summary cell from the response's parsed `data`.
function responseSummary(kind, data) {
  const d = data || {};
  if (kind === 'vw') {
    const part = (label, v) => v != null ? `${label} ${Number(v).toFixed(2)}` : null;
    return [
      part('cheap', d.too_cheap),
      part('bargain', d.bargain),
      part('acc', d.expensive_but_acceptable),
      part('exp', d.too_expensive),
    ].filter(Boolean).join(' · ') || '—';
  }
  if (kind === 'nps') {
    const score = d.score != null ? d.score : '—';
    const reason = d.reason ? ` — ${esc(d.reason)}` : '';
    return `<strong>${score}/10</strong>${reason}`;
  }
  if (kind === 'maxdiff') {
    const best = d.best ? `▲ ${esc(d.best)}` : '';
    const worst = d.worst ? `▼ ${esc(d.worst)}` : '';
    const set = d.set_id ? `<span class="muted">[${esc(d.set_id)}]</span> ` : '';
    return `${set}${best}${best && worst ? ' · ' : ''}${worst}` || '—';
  }
  return '—';
}

// Mount a collapsible "recent responses" table into `mountEl`. `reload` is the
// caller's re-render so deletes refresh the aggregate stats too.
async function mountResponses(mountEl, topic, kind, reload) {
  if (!mountEl) return;
  mountEl.innerHTML = `<div class="empty-state" style="padding:16px">Loading responses…</div>`;
  let rows = [];
  try {
    rows = await api.surveyList(topic, '', kind);
  } catch (e) {
    mountEl.innerHTML = `<div class="empty-state" style="padding:16px">Couldn't load responses — ${esc(e?.message || e)}</div>`;
    return;
  }
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) {
    mountEl.innerHTML = `<div class="empty-state" style="padding:16px">No responses recorded yet — add one above and it'll appear here.</div>`;
    return;
  }
  const body = rows.map(r => `
    <tr>
      <td class="muted" style="white-space:nowrap">${fmtWhen(r.responded_at || r.created_at)}</td>
      <td>${responseSummary(kind, r.data)}</td>
      <td class="muted">${r.persona ? esc(r.persona) : '—'}</td>
      <td class="muted">${r.respondent ? esc(r.respondent) : '—'}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm prc-del" data-id="${esc(r.id)}" title="Delete this response">
          <i data-lucide="trash-2"></i>
        </button>
      </td>
    </tr>
  `).join('');
  mountEl.innerHTML = `
    <table class="data-table" style="width:100%">
      <thead><tr><th>When</th><th>Response</th><th>Persona</th><th>Respondent</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
  window.refreshIcons?.();
  $$('.prc-del', mountEl).forEach(b => b.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
    const id = b.dataset.id;
    if (!id) return;
    if (!confirm('Delete this response? This cannot be undone.')) return;
    try {
      await api.surveyDelete(id);
      await reload();
    } catch (err) { alert(`Delete failed: ${err?.message || err}`); }
  }, { busyLabel: '' })));
}

function responsesCard(kind) {
  return `
    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div>
          <h3>Recent responses</h3>
          <p>Every recorded response for this instrument — delete any to re-aggregate</p>
        </div>
      </div>
      <div class="card-body">
        <div data-responses="${kind}"></div>
      </div>
    </div>
  `;
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
  const acceptable = (agg.pmc != null && agg.pme != null)
    ? `${f(agg.pmc)} – ${f(agg.pme)}` : '—';
  // The Python aggregate also returns per-question medians + sample counts —
  // surface them so the user can sanity-check the four price curves the
  // OPP/IPP/PMC/PME were derived from.
  const med = agg.median || {};
  const samp = agg.samples || {};
  const QLABELS = {
    too_cheap: 'Too cheap',
    bargain: 'Bargain',
    expensive_but_acceptable: 'Expensive (acceptable)',
    too_expensive: 'Too expensive',
  };
  const medRows = Object.keys(QLABELS).map(k => `
    <tr>
      <td>${esc(QLABELS[k])}</td>
      <td style="text-align:right">${med[k] != null ? Number(med[k]).toFixed(2) : '—'}</td>
      <td style="text-align:right" class="muted">${samp[k] != null ? samp[k] : 0}</td>
    </tr>
  `).join('');
  const lowSample = (agg.n || 0) < 30
    ? `<p class="muted" style="font-size:12.5px;margin:0 0 12px">⚠ Only ${agg.n} response(s) — Van Westendorp wants ≥30 for stable price points. Treat the values below as directional.</p>`
    : '';
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
    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div>
          <h3>Acceptable price range</h3>
          <p>PMC → PME · median response per price question</p>
        </div>
        <strong style="font-size:18px">${acceptable}</strong>
      </div>
      <div class="card-body">
        ${lowSample}
        <table class="data-table" style="width:100%">
          <thead><tr><th>Price question</th><th style="text-align:right">Median</th><th style="text-align:right">Responses</th></tr></thead>
          <tbody>${medRows}</tbody>
        </table>
      </div>
    </div>
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
      ${responsesCard('vw')}
    </div>
    <div class="pricing-pane" data-pane="nps" hidden>
      ${npsStats(nps)}
      ${npsForm()}
      ${responsesCard('nps')}
    </div>
    <div class="pricing-pane" data-pane="maxdiff" hidden>
      ${maxDiffPanel(md)}
      ${maxDiffForm()}
      ${responsesCard('maxdiff')}
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

  // Populate each instrument's response-history table (async, non-blocking —
  // the stats/forms are already painted). Deletes call `reload` which
  // re-renders the whole screen, so aggregates stay in sync.
  mountResponses($('[data-responses="vw"]', root), topic, 'vw', reload);
  mountResponses($('[data-responses="nps"]', root), topic, 'nps', reload);
  mountResponses($('[data-responses="maxdiff"]', root), topic, 'maxdiff', reload);

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
