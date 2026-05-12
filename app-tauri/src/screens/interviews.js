// Customer Discovery Interviews — Mom Test (Fitzpatrick, 2013).
//
// Manage 1:1 user interviews. Each row captures: who, persona, summary,
// full notes, JTBD quote, current solution, willingness to pay, and a
// rigour self-rating. Mom Test prompts are surfaced in the new-interview
// form so PMs ask "what's the hardest part about X?" instead of
// "would you use this?"
//
// Routes:
//   #/interviews              → topic picker
//   #/interviews/<topic>      → interview list + summary panel + new form
//
// Design: matches Home/Topics — slash crumbs + topbar-spacer,
// card-head/card-body, btn-primary/btn-ghost-bordered, .stat-grid for
// summary metrics, .section-head transitions.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const MOM_TEST_PROMPTS = [
  '"Tell me about the last time you had to do <task>."',
  '"What\'s the hardest part about <problem area> for you?"',
  '"Walk me through how you solve this today, step by step."',
  '"What have you tried that didn\'t work? Why?"',
  '"How much time / money do you spend on this per month?"',
  '"Who else have you talked to about this?"',
];

function topicFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/interviews\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function rigourBadge(score) {
  const s = Math.max(0, Math.min(5, Number(score || 0)));
  const cls = s >= 4 ? 'high' : s >= 2 ? 'mid' : 'low';
  return `<span class="iv-rigour iv-rigour-${cls}" title="Mom Test rigour self-rating">${s}/5</span>`;
}

function followUpBadge(s) {
  const cls = s === 'pending' ? 'pending' : (s === 'done' ? 'done' : 'none');
  return `<span class="iv-fu iv-fu-${cls}">${esc(s || 'none')}</span>`;
}

function renderInterviewCard(iv) {
  return `
    <article class="iv-card" data-iv-id="${esc(iv.id)}">
      <header class="iv-card-head">
        <div>
          <h4>${esc(iv.interviewee_name || 'Anonymous')}</h4>
          <div class="iv-meta muted">
            <span>${esc(iv.persona || 'no persona')}</span>
            <span>·</span>
            <span>${esc(iv.channel || 'video')}</span>
            <span>·</span>
            <span>${esc((iv.conducted_at || '').slice(0, 10))}</span>
            <span>·</span>
            <span>${iv.duration_min || 0} min</span>
          </div>
        </div>
        <div class="iv-badges">
          ${rigourBadge(iv.mom_test_score)}
          ${followUpBadge(iv.follow_up)}
        </div>
      </header>
      ${iv.summary ? `<p class="iv-summary">${esc(iv.summary)}</p>` : ''}
      ${iv.jtbd_quote ? `<blockquote class="iv-quote">${esc(iv.jtbd_quote)}</blockquote>` : ''}
      <div class="iv-fields">
        ${iv.current_solution ? `<div><b>Current solution:</b> ${esc(iv.current_solution)}</div>` : ''}
        ${iv.willingness_to_pay ? `<div><b>WTP:</b> ${esc(iv.willingness_to_pay)}</div>` : ''}
      </div>
      <div class="iv-actions">
        <button class="btn btn-ghost btn-xs btn-bordered iv-edit" data-iv-id="${esc(iv.id)}">Edit</button>
        <button class="btn btn-ghost btn-xs btn-bordered iv-fu-cycle" data-iv-id="${esc(iv.id)}" data-fu="${esc(iv.follow_up || 'none')}">Cycle follow-up</button>
        <button class="btn btn-ghost btn-xs btn-bordered iv-delete" data-iv-id="${esc(iv.id)}">Delete</button>
      </div>
    </article>
  `;
}

function summaryStats(s) {
  if (!s || s.count === 0) {
    return `
      <section class="stat-grid">
        <div class="stat-card">
          <div class="stat-head">
            <div class="stat-icon mint"><i data-lucide="mic"></i></div>
          </div>
          <div class="stat-num">0</div>
          <div class="stat-label">Interviews on file</div>
        </div>
      </section>
    `;
  }
  const rigour = (s.rigour_avg || 0).toFixed(1);
  const rigourCls = s.rigour_avg >= 3.5 ? 'trend-up' : s.rigour_avg >= 2 ? 'trend-flat' : 'trend-down';
  const themes = (s.themes || []).slice(0, 1)[0]?.label || '—';
  const wtp    = (s.willingness_to_pay || []).slice(0, 1)[0]?.label || '—';
  return `
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon mint"><i data-lucide="users"></i></div>
        </div>
        <div class="stat-num">${s.count}</div>
        <div class="stat-label">Interviews on file</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon sky"><i data-lucide="target"></i></div>
          <div class="stat-trend ${rigourCls}">${rigour}/5</div>
        </div>
        <div class="stat-num">${rigour}</div>
        <div class="stat-label">Mom Test rigour avg</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon lavender"><i data-lucide="layers"></i></div>
        </div>
        <div class="stat-num" style="font-size:14px;font-weight:600">${esc(themes)}</div>
        <div class="stat-label">Top current solution</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon peach"><i data-lucide="dollar-sign"></i></div>
        </div>
        <div class="stat-num" style="font-size:14px;font-weight:600">${esc(wtp)}</div>
        <div class="stat-label">Top WTP signal</div>
      </div>
    </section>
  `;
}

function themesPanel(s) {
  if (!s || s.count === 0) return '';
  const themes = (s.themes || []).slice(0, 8).map(t =>
    `<div class="iv-theme-row"><span>${esc(t.label)}</span><span class="muted">${t.n}×</span></div>`,
  ).join('') || '<div class="muted" style="font-size:12px">No repeated solution themes yet.</div>';
  const wtp = (s.willingness_to_pay || []).slice(0, 8).map(w =>
    `<div class="iv-theme-row"><span>${esc(w.label)}</span><span class="muted">${w.n}×</span></div>`,
  ).join('') || '<div class="muted" style="font-size:12px">No WTP signals yet.</div>';
  return `
    <section class="two-col">
      <div class="card">
        <div class="card-head">
          <div><h3>Current solutions</h3><p>What they're using today</p></div>
        </div>
        <div class="card-body">${themes}</div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><h3>Willingness to pay</h3><p>Price points mentioned</p></div>
        </div>
        <div class="card-body">${wtp}</div>
      </div>
    </section>
  `;
}

function renderShell(topic, interviews, summary) {
  const cards = (interviews || []).map(renderInterviewCard).join('') ||
    `<div class="empty-state" style="padding:28px">No interviews yet — click <b>+ New interview</b> above.</div>`;
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/interviews">Interviews</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-primary btn-sm icon-btn" id="iv-new">
        <i data-lucide="plus"></i> New interview
      </button>
    </header>

    ${summaryStats(summary)}

    <section class="two-col">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>The Mom Test — never ask</h3>
            <p>Fitzpatrick 2013 — past behaviour over future intent</p>
          </div>
        </div>
        <div class="card-body">
          <p class="muted" style="font-size:12.5px;margin:0 0 10px">
            ❌ "Would you use this?" · ❌ "Would you pay for this?"
            — people lie about future behaviour.
          </p>
          <div class="muted" style="font-size:11px;letter-spacing:1px;font-weight:700;margin-bottom:6px">ALWAYS ASK</div>
          <ul class="iv-mom-list" style="margin:0;padding-left:18px">
            ${MOM_TEST_PROMPTS.map(p => `<li>${esc(p)}</li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><h3>Why interviews</h3><p>Real 1:1 signal vs. social-media corpus</p></div>
        </div>
        <div class="card-body">
          <p class="muted" style="font-size:12.5px;line-height:1.55;margin:0">
            Captures who, persona, JTBD quote, current solution, willingness
            to pay, and a Mom Test rigour self-rating per interview. The
            PRD generator pulls quotes from this table when shipping the
            "Customer voice" section.
          </p>
        </div>
      </div>
    </section>

    ${themesPanel(summary)}

    <div class="section-head">
      <div>
        <h2>Interviews</h2>
        <p>${(interviews || []).length} on file</p>
      </div>
    </div>
    <section class="iv-list">${cards}</section>
  `;
}

function showInterviewModal({ topic, existing, onSave }) {
  const wrap = document.createElement('div');
  wrap.className = 'iv-modal-bg';
  const v = existing || {};
  wrap.innerHTML = `
    <div class="iv-modal">
      <header><h3>${existing ? 'Edit' : 'New'} interview</h3><button class="btn btn-ghost btn-xs btn-bordered iv-modal-close">×</button></header>
      <label>Interviewee name
        <input id="iv-name" type="text" value="${esc(v.interviewee_name || '')}" placeholder="e.g. Sarah K."/>
      </label>
      <div class="iv-row-2">
        <label>Persona
          <input id="iv-persona" type="text" value="${esc(v.persona || '')}" placeholder="e.g. solo founder"/>
        </label>
        <label>Channel
          <select id="iv-channel">
            <option value="video"     ${v.channel === 'video' ? 'selected' : ''}>Video</option>
            <option value="phone"     ${v.channel === 'phone' ? 'selected' : ''}>Phone</option>
            <option value="inperson"  ${v.channel === 'inperson' ? 'selected' : ''}>In person</option>
            <option value="async"     ${v.channel === 'async' ? 'selected' : ''}>Async / written</option>
          </select>
        </label>
      </div>
      <div class="iv-row-2">
        <label>Date
          <input id="iv-date" type="date" value="${esc((v.conducted_at || '').slice(0, 10))}"/>
        </label>
        <label>Duration (min)
          <input id="iv-duration" type="number" value="${v.duration_min || 30}" min="0" />
        </label>
      </div>
      <label>Summary
        <textarea id="iv-summary" rows="3" placeholder="Two-line digest of the most important thing you learned.">${esc(v.summary || '')}</textarea>
      </label>
      <label>Best JTBD-style quote
        <textarea id="iv-jtbd" rows="2" placeholder='"When I have a new client onboarding, I just want to send them one link, so I can stop juggling 4 tools."'>${esc(v.jtbd_quote || '')}</textarea>
      </label>
      <div class="iv-row-2">
        <label>Current solution
          <input id="iv-current" type="text" value="${esc(v.current_solution || '')}" placeholder="e.g. spreadsheet + Notion"/>
        </label>
        <label>Willingness to pay
          <input id="iv-wtp" type="text" value="${esc(v.willingness_to_pay || '')}" placeholder="e.g. $30/mo, would not pay, depends"/>
        </label>
      </div>
      <label>Full notes / transcript
        <textarea id="iv-fulltext" rows="6" placeholder="Paste raw notes or transcript. Searchable later.">${esc(v.full_text || '')}</textarea>
      </label>
      <div class="iv-row-2">
        <label>Mom Test rigour (0=I asked about the future, 5=I only asked about past behaviour)
          <input id="iv-rigour" type="number" min="0" max="5" value="${v.mom_test_score ?? 3}"/>
        </label>
        <label>Follow-up
          <select id="iv-fu">
            <option value="none"    ${v.follow_up === 'none' ? 'selected' : ''}>None</option>
            <option value="pending" ${(v.follow_up === 'pending' || !v.follow_up) ? 'selected' : ''}>Pending</option>
            <option value="done"    ${v.follow_up === 'done' ? 'selected' : ''}>Done</option>
          </select>
        </label>
      </div>
      <footer>
        <button class="btn btn-ghost btn-sm btn-bordered iv-modal-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm iv-modal-save">${existing ? 'Save changes' : 'Create interview'}</button>
      </footer>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.iv-modal-close').onclick = close;
  wrap.querySelector('.iv-modal-cancel').onclick = close;
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('.iv-modal-save').onclick = async () => {
    const payload = {
      interviewee_name:    $('#iv-name', wrap).value.trim(),
      persona:             $('#iv-persona', wrap).value.trim(),
      channel:             $('#iv-channel', wrap).value,
      conducted_at:        $('#iv-date', wrap).value,
      duration_min:        parseInt($('#iv-duration', wrap).value || '0', 10),
      summary:             $('#iv-summary', wrap).value.trim(),
      jtbd_quote:          $('#iv-jtbd', wrap).value.trim(),
      current_solution:    $('#iv-current', wrap).value.trim(),
      willingness_to_pay:  $('#iv-wtp', wrap).value.trim(),
      full_text:           $('#iv-fulltext', wrap).value.trim(),
      mom_test_score:      parseInt($('#iv-rigour', wrap).value || '0', 10),
      follow_up:           $('#iv-fu', wrap).value,
    };
    if (!payload.interviewee_name) {
      alert('Interviewee name required.');
      return;
    }
    try {
      if (existing) {
        await api.interviewUpdate(existing.id, payload);
      } else {
        await api.interviewCreate(topic, payload.interviewee_name, payload);
      }
      close();
      await onSave?.();
    } catch (e) {
      alert(`Could not save: ${e?.message || e}`);
    }
  };
}

const FU_CYCLE = ['none', 'pending', 'done'];

async function renderTopicInterviews(root, topic) {
  root.innerHTML = `<div class="empty-state">Loading interviews…</div>`;

  const reload = () => renderTopicInterviews(root, topic);
  let listResp, sumResp;
  try {
    [listResp, sumResp] = await Promise.all([
      api.interviewList(topic),
      api.interviewSummary(topic),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load interviews</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  const interviews = listResp?.interviews || [];

  root.innerHTML = renderShell(topic, interviews, sumResp);
  window.refreshIcons?.();

  $('#iv-new', root)?.addEventListener('click', () =>
    showInterviewModal({ topic, onSave: reload }),
  );

  $$('.iv-edit', root).forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.ivId;
    try {
      const r = await api.interviewGet(id);
      if (!r?.ok) throw new Error(r?.error || 'not found');
      showInterviewModal({ topic, existing: r.interview, onSave: reload });
    } catch (e) {
      alert(`Couldn't open: ${e?.message || e}`);
    }
  }));

  $$('.iv-fu-cycle', root).forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.ivId;
    const cur = b.dataset.fu;
    const idx = FU_CYCLE.indexOf(cur);
    const next = FU_CYCLE[(idx + 1) % FU_CYCLE.length];
    try {
      await api.interviewUpdate(id, { follow_up: next });
      await reload();
    } catch (e) {
      alert(`Update failed: ${e?.message || e}`);
    }
  }));

  $$('.iv-delete', root).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this interview?')) return;
    try {
      await api.interviewDelete(b.dataset.ivId);
      await reload();
    } catch (e) {
      alert(`Delete failed: ${e?.message || e}`);
    }
  }));
}

async function renderPicker(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Customer Discovery Interviews</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Mom Test, Fitzpatrick 2013</span>
    </header>
    <div id="iv-pick-mount"><div class="empty-state">loading…</div></div>
  `;

  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    $('#iv-pick-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!topics?.length) {
    $('#iv-pick-mount', root).innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Create or pick a topic first — interviews are scoped to a topic so they sit alongside the corpus.</p>
        <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  $('#iv-pick-mount', root).innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Open interviews for a topic</h3>
          <p>Real 1:1 user interviews — distinct from your social-media corpus</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">
          Capture the raw notes here so the PRD can quote them later.
        </p>
        <div class="row">
          <select id="iv-topic-pick" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="iv-go">Open →</button>
        </div>
      </div>
    </div>
  `;
  $('#iv-go', root)?.addEventListener('click', () => {
    const t = $('#iv-topic-pick', root).value;
    if (t) location.hash = `#/interviews/${encodeURIComponent(t)}`;
  });
}

export async function renderInterviews(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicInterviews(root, topic);
  return renderPicker(root);
}
