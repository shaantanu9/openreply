// Sean Ellis Product-Market Fit Survey (Ellis 2010).
//
// Single core question: "How would you feel if you could no longer use
// this product?" Threshold: ≥40% answering "very disappointed" = PMF.
//
// Routes:
//   #/pmf            → topic picker
//   #/pmf/<topic>    → response list + score panel + add-response form
//                      (also segments by persona — Vohra/Superhuman 2019).
//
// Design language matches Home/Topics: crumbs + topbar-spacer in topbar,
// .stat-grid for the headline score, .two-col for list+form, .card-head
// + .card-body for every panel, btn-primary/btn-ghost/btn-bordered for
// every button.
import { api, esc } from '../api.js';
import { confirmModal } from '../lib/confirmModal.js';
import { skelStats, skelRows } from '../lib/skeleton.js';
import { withButtonBusy } from '../lib/busyButton.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function topicFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/pmf\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const DISAPPOINT_LABEL = {
  very_disappointed:     'Very disappointed',
  somewhat_disappointed: 'Somewhat disappointed',
  not_disappointed:      'Not disappointed',
  dont_use:              "I no longer use it",
};

function scoreStats(score) {
  if (!score || (score.n_total || 0) === 0) {
    return `
      <section class="stat-grid">
        <div class="stat-card">
          <div class="stat-head">
            <div class="stat-icon mint"><i data-lucide="bar-chart-3"></i></div>
          </div>
          <div class="stat-num">—</div>
          <div class="stat-label">No PMF responses yet (need ≥40)</div>
        </div>
      </section>
    `;
  }
  const pct = score.pct_very_disappointed || 0;
  const counts = score.counts || {};
  const trendCls = score.threshold_met ? 'trend-up' : 'trend-down';
  const trendLabel = score.threshold_met ? '✓ ≥40%' : '⚠ <40%';
  const total = score.n_total || 0;
  // n_scored = denominator for the 40% calc — total minus "don't use" (Ellis
  // measures only users who experienced the core value). Surfacing it keeps
  // the percentage honest: "don't use" responses are excluded, not counted.
  const scored = score.n_scored != null ? score.n_scored : total;
  const veryN = counts.very_disappointed || 0;
  const dontUse = counts.dont_use || 0;
  return `
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon mint"><i data-lucide="heart"></i></div>
          <div class="stat-trend ${trendCls}">${trendLabel}</div>
        </div>
        <div class="stat-num">${pct.toFixed(1)}%</div>
        <div class="stat-label">"very disappointed" (${veryN} of ${scored} scored)</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon sky"><i data-lucide="users"></i></div>
        </div>
        <div class="stat-num">${total}</div>
        <div class="stat-label">Total responses · ${scored} scored${dontUse ? ` · ${dontUse} no longer use` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon lavender"><i data-lucide="trending-down"></i></div>
        </div>
        <div class="stat-num">${counts.somewhat_disappointed || 0}</div>
        <div class="stat-label">Somewhat disappointed</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon peach"><i data-lucide="x-circle"></i></div>
        </div>
        <div class="stat-num">${counts.not_disappointed || 0}</div>
        <div class="stat-label">Not disappointed</div>
      </div>
    </section>
  `;
}

function personaPanel(score) {
  if (!score || !(score.personas || []).length) return '';
  const rows = (score.personas || []).slice(0, 8).map(p => {
    const c = p.counts || {};
    const breakdown = `very=${c.very_disappointed || 0}, somewhat=${c.somewhat_disappointed || 0}, `
      + `not=${c.not_disappointed || 0}, don't use=${c.dont_use || 0}`;
    const pct = Number(p.pct_very_disappointed || 0);
    return `
    <div class="pmf-persona-row" title="${esc(breakdown)}">
      <strong>${esc(p.persona)}</strong>
      <span class="pmf-persona-pct">${pct.toFixed(1)}%</span>
      <span class="muted">n=${p.n} scored</span>
      ${p.threshold_met ? '<span class="pmf-met">✓</span>' : '<span class="pmf-unmet">×</span>'}
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>By persona</h3>
          <p>Vohra/Superhuman 2019 — over-serve the high-PMF segment</p>
        </div>
      </div>
      <div class="card-body" style="padding:14px 20px">${rows}</div>
    </div>
  `;
}

function responseRow(r) {
  return `
    <li class="pmf-row" data-rid="${esc(r.id)}">
      <div class="pmf-row-head">
        <span class="pmf-bucket pmf-${esc(r.disappointment)}">${esc(DISAPPOINT_LABEL[r.disappointment] || r.disappointment)}</span>
        <span class="muted">${esc(r.persona || 'no persona')}</span>
        ${r.respondent ? `<span class="muted">· ${esc(r.respondent)}</span>` : ''}
        <span class="muted">${esc((r.responded_at || '').slice(0, 10))}</span>
      </div>
      ${r.must_have_alternative ? `<div><b>Alternative:</b> ${esc(r.must_have_alternative)}</div>` : ''}
      ${r.main_benefit          ? `<div><b>Main benefit:</b> ${esc(r.main_benefit)}</div>` : ''}
      ${r.ideal_user            ? `<div><b>Ideal user:</b> ${esc(r.ideal_user)}</div>` : ''}
      ${r.improvement           ? `<div><b>Improvement:</b> ${esc(r.improvement)}</div>` : ''}
      <div class="pmf-actions"><button class="btn btn-ghost btn-xs btn-bordered pmf-delete" data-rid="${esc(r.id)}">Delete</button></div>
    </li>
  `;
}

function renderShell(topic, responses, score) {
  const list = (responses || []).map(responseRow).join('') ||
    `<div class="empty-state" style="padding:28px">No responses yet — add the first one with the form on the right.</div>`;
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/pmf">PMF Survey</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <span class="pill">${(responses || []).length} responses</span>
    </header>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <div>
          <h3>The core question</h3>
          <p>Sean Ellis 2010 — gold-standard 1-question PMF measurement</p>
        </div>
      </div>
      <div class="card-body">
        <blockquote style="border-left:3px solid var(--ink-3);padding:8px 14px;margin:0;font-size:14px;font-style:italic;color:var(--ink-2);background:var(--surface-2);border-radius:0 6px 6px 0">
          "How would you feel if you could no longer use <em>this product</em>?"
        </blockquote>
        <p class="muted" style="font-size:12px;margin-top:10px;line-height:1.55">
          Threshold: <b>≥40% answering "very disappointed"</b> means
          you have product-market fit. Aim for ≥40 respondents who
          experienced the core value.
        </p>
      </div>
    </div>

    ${scoreStats(score)}

    <section class="two-col">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Responses</h3>
            <p>${(responses || []).length} on file · sortable below</p>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <ul class="pmf-rows" style="padding:14px 20px">${list}</ul>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Add a response</h3><p>Captures one survey reply</p></div>
        </div>
        <div class="card-body pmf-form">
          <label>How would they feel?
            <select id="pmf-disappoint">
              <option value="very_disappointed">Very disappointed</option>
              <option value="somewhat_disappointed">Somewhat disappointed</option>
              <option value="not_disappointed">Not disappointed</option>
              <option value="dont_use">I no longer use it</option>
            </select>
          </label>
          <label>Persona / segment
            <input id="pmf-persona" type="text" placeholder="e.g. solo founder, agency PM"/>
          </label>
          <label>Respondent (optional)
            <input id="pmf-respondent" type="text" placeholder="email / handle / id"/>
          </label>
          <label>Alternative they'd use
            <input id="pmf-alt" type="text" placeholder="What would they switch to?"/>
          </label>
          <label>Main benefit
            <input id="pmf-benefit" type="text" placeholder="What's the main thing the product gives them?"/>
          </label>
          <label>Ideal user
            <input id="pmf-ideal" type="text" placeholder="Who do they think benefits most?"/>
          </label>
          <label>Improvement
            <textarea id="pmf-improve" rows="2" placeholder="How can we improve for them?"></textarea>
          </label>
          <div style="margin-top:12px">
            <button class="btn btn-primary btn-sm" id="pmf-add">Add response</button>
          </div>
        </div>
      </div>
    </section>

    ${personaPanel(score)}
  `;
}

async function renderTopicPmf(root, topic) {
  root.innerHTML = `${skelStats(4)}${skelRows(5)}`;
  const reload = () => renderTopicPmf(root, topic);
  let listResp, scoreResp;
  try {
    [listResp, scoreResp] = await Promise.all([
      api.pmfList(topic), api.pmfScore(topic),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load PMF</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }

  root.innerHTML = renderShell(topic, listResp?.responses || [], scoreResp);
  window.refreshIcons?.();

  $('#pmf-add', root)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
    const payload = {
      disappointment:        $('#pmf-disappoint', root).value,
      persona:               $('#pmf-persona', root).value.trim(),
      respondent:            $('#pmf-respondent', root).value.trim(),
      must_have_alternative: $('#pmf-alt', root).value.trim(),
      main_benefit:          $('#pmf-benefit', root).value.trim(),
      ideal_user:            $('#pmf-ideal', root).value.trim(),
      improvement:           $('#pmf-improve', root).value.trim(),
    };
    try {
      const r = await api.pmfAdd(topic, payload);
      if (r?.ok === false) throw new Error(r.error);
      await reload();
    } catch (e) {
      alert(`Add failed: ${e?.message || e}`);
    }
  }, { busyLabel: 'Adding…' }));

  $$('.pmf-delete', root).forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmModal('Delete this response?'))) return;
    try {
      await api.pmfDelete(b.dataset.rid);
      await reload();
    } catch (e) {
      alert(`Delete failed: ${e?.message || e}`);
    }
  }));
}

async function renderPicker(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>PMF Survey</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Sean Ellis, 2010</span>
    </header>
    <div id="pmf-pick-mount">${skelRows(4)}</div>
  `;
  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    $('#pmf-pick-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!topics?.length) {
    $('#pmf-pick-mount', root).innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Create a topic first — PMF responses are scoped per topic.</p>
        <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)}</option>`).join('');
  $('#pmf-pick-mount', root).innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Run the Sean Ellis PMF Survey</h3>
          <p>≥40% answering "very disappointed" = product-market fit</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin-bottom:14px">
          Ask users who experienced the core value: how disappointed would they be
          if they could no longer use it? Aim for ≥40 respondents.
        </p>
        <div class="row">
          <select id="pmf-topic-pick" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="pmf-go">Open →</button>
        </div>
      </div>
    </div>
  `;
  $('#pmf-go', root)?.addEventListener('click', () => {
    const t = $('#pmf-topic-pick', root).value;
    if (t) location.hash = `#/pmf/${encodeURIComponent(t)}`;
  });
}

export async function renderPmf(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicPmf(root, topic);
  return renderPicker(root);
}
