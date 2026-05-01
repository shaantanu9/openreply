// Sean Ellis Product-Market Fit Survey (Ellis 2010).
//
// Single core question: "How would you feel if you could no longer use
// this product?" Threshold: ≥40% answering "very disappointed" = PMF.
//
// Routes:
//   #/pmf            → topic picker
//   #/pmf/<topic>    → response list + score panel + add-response form
//                      (also segments by persona — Vohra/Superhuman 2019).
import { api, esc } from '../api.js';

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

function bucketChip(b, n) {
  return `<span class="pmf-chip pmf-${b}">${esc(DISAPPOINT_LABEL[b] || b)}: ${n}</span>`;
}

function scorePanel(score) {
  if (!score || (score.n_total || 0) === 0) {
    return `<div class="pmf-score-card card muted">No PMF responses yet — collect at least 40 for a statistically meaningful read.</div>`;
  }
  const pct = score.pct_very_disappointed || 0;
  const verdict = score.threshold_met
    ? `<span class="pmf-verdict pmf-met">✅ PMF threshold met (≥40%)</span>`
    : `<span class="pmf-verdict pmf-unmet">⚠ Below 40% threshold</span>`;
  const bar = `<div class="pmf-bar"><div class="pmf-bar-fill" style="width:${Math.min(100, pct)}%"></div><div class="pmf-bar-mark" style="left:40%"></div></div>`;
  const counts = score.counts || {};
  const personas = (score.personas || []).slice(0, 8).map(p => `
    <div class="pmf-persona-row">
      <strong>${esc(p.persona)}</strong>
      <span class="pmf-persona-pct">${p.pct_very_disappointed.toFixed(1)}%</span>
      <span class="muted">n=${p.n}</span>
      ${p.threshold_met ? '<span class="pmf-met">✓</span>' : '<span class="pmf-unmet">×</span>'}
    </div>
  `).join('') || '<div class="muted" style="font-size:12px">No persona segmentation yet.</div>';
  return `
    <section class="pmf-score-card card">
      <h3>Sean Ellis PMF Score</h3>
      <div class="pmf-headline">
        <div class="pmf-pct">${pct.toFixed(1)}%</div>
        <div>
          <div>very disappointed if they could no longer use it</div>
          ${verdict}
        </div>
      </div>
      ${bar}
      <div class="pmf-counts">
        ${bucketChip('very_disappointed',     counts.very_disappointed     || 0)}
        ${bucketChip('somewhat_disappointed', counts.somewhat_disappointed || 0)}
        ${bucketChip('not_disappointed',      counts.not_disappointed      || 0)}
        ${bucketChip('dont_use',              counts.dont_use              || 0)}
      </div>
      <p class="muted" style="font-size:11px;margin-top:8px">
        Vohra/Superhuman (2019): segment by persona to find the high-PMF
        sub-audience and over-serve them.
      </p>
      <h4 style="margin-top:14px">By persona</h4>
      <div class="pmf-persona-grid">${personas}</div>
    </section>
  `;
}

function responseRow(r) {
  return `
    <li class="pmf-row" data-rid="${esc(r.id)}">
      <div class="pmf-row-head">
        <span class="pmf-bucket pmf-${esc(r.disappointment)}">${esc(DISAPPOINT_LABEL[r.disappointment] || r.disappointment)}</span>
        <span class="muted">${esc(r.persona || 'no persona')}</span>
        <span class="muted">${esc((r.responded_at || '').slice(0, 10))}</span>
      </div>
      ${r.must_have_alternative ? `<div><b>Alternative:</b> ${esc(r.must_have_alternative)}</div>` : ''}
      ${r.main_benefit          ? `<div><b>Main benefit:</b> ${esc(r.main_benefit)}</div>` : ''}
      ${r.ideal_user            ? `<div><b>Ideal user:</b> ${esc(r.ideal_user)}</div>` : ''}
      ${r.improvement           ? `<div><b>Improvement:</b> ${esc(r.improvement)}</div>` : ''}
      <div class="pmf-actions"><button class="btn-mini pmf-delete" data-rid="${esc(r.id)}">delete</button></div>
    </li>
  `;
}

function renderShell(topic, responses, score) {
  const list = (responses || []).map(responseRow).join('') ||
    `<div class="empty-big" style="padding:18px"><p>No responses yet — add the first one with the form on the right.</p></div>`;
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/pmf">PMF survey</a> ›
        <strong>${esc(topic)}</strong>
        <span class="muted" style="font-size:11px;margin-left:8px">${(responses || []).length} responses</span>
      </div>
    </header>

    <div class="pmf-wrap">
      <section class="pmf-q card">
        <h3>The core question</h3>
        <blockquote>"How would you feel if you could no longer use <em>this product</em>?"</blockquote>
        <p class="muted" style="font-size:12px">
          Ellis (2010) — the gold-standard 1-question PMF measurement.
          Threshold: <b>≥40% answering "very disappointed"</b> means
          you have product-market fit. Aim for ≥40 respondents who
          experienced the core value.
        </p>
      </section>

      ${scorePanel(score)}

      <div class="pmf-grid">
        <section class="pmf-list card">
          <h3>Responses</h3>
          <ul class="pmf-rows">${list}</ul>
        </section>

        <section class="pmf-form card">
          <h3>Add a response</h3>
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
          <button class="btn primary" id="pmf-add">Add response</button>
        </section>
      </div>
    </div>
  `;
}

async function renderTopicPmf(root, topic) {
  root.innerHTML = `<div class="empty-state">Loading PMF data…</div>`;
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

  $('#pmf-add', root)?.addEventListener('click', async () => {
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
  });

  $$('.pmf-delete', root).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this response?')) return;
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
      <div class="crumbs"><strong>PMF Survey</strong> · Sean Ellis, 2010</div>
    </header>
    <div class="pmf-wrap"><div id="pmf-pick-mount"><div class="empty-state">loading…</div></div></div>
  `;
  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    $('#pmf-pick-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!topics?.length) {
    $('#pmf-pick-mount', root).innerHTML = `
      <div class="empty-big"><h3>No topics yet</h3>
      <a class="btn primary" href="#/topics">Open Topics</a></div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)}</option>`).join('');
  $('#pmf-pick-mount', root).innerHTML = `
    <div class="pmf-picker card">
      <h2>Run the Sean Ellis PMF survey</h2>
      <p class="muted" style="font-size:13px;line-height:1.6;max-width:680px">
        Ask users who experienced the core value: how disappointed would they be
        if they could no longer use it? <b>≥40% answering "very disappointed"</b>
        signals product-market fit.
      </p>
      <div class="row" style="gap:8px;margin-top:14px;align-items:center">
        <select id="pmf-topic-pick">${opts}</select>
        <button class="btn primary" id="pmf-go">Open →</button>
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
