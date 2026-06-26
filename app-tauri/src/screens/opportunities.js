// OpenReply — Opportunities. Scan the active agent's platforms for posts worth
// replying to, score them, and draft an on-brand reply (with subreddit compliance).
import { api, esc } from '../api.js';
import { refreshIcons } from '../icons.js';

function scorePct(s) { return Math.round((s || 0) * 100); }

function oppCard(o) {
  return `
  <div class="card or-opp" data-id="${esc(o.id)}">
    <div class="or-opp-head">
      <span class="badge">${esc(o.platform)}</span>
      ${o.sub ? `<span class="muted">r/${esc(o.sub)}</span>` : ''}
      <span class="or-score" title="relevance ${scorePct(o.relevance)} · intent ${scorePct(o.intent)} · fit ${scorePct(o.fit)}">${scorePct(o.score)}</span>
    </div>
    <div class="or-opp-title">${esc(o.title || '(no title)')}</div>
    ${o.reason ? `<div class="muted or-opp-reason">${esc(o.reason)}</div>` : ''}
    <div class="or-opp-actions">
      ${o.url ? `<a class="btn btn-sm btn-ghost" href="${esc(o.url)}" target="_blank">Open post</a>` : ''}
      <button class="btn btn-sm btn-primary" data-act="draft" data-id="${esc(o.id)}">Draft reply</button>
    </div>
    <div class="or-draft" data-draft="${esc(o.id)}"></div>
  </div>`;
}

export async function renderOpportunities(root) {
  let agent = null;
  try { agent = await api.agentGet(); } catch {}
  const agentName = agent?.name || '—';
  const platforms = (agent?.platforms || ['reddit_free']).join(',');

  root.innerHTML = `
    <div class="screen or-screen">
      <div class="screen-head">
        <h1>Opportunities</h1>
        <p class="muted">Conversations worth replying to for <b>${esc(agentName)}</b>${agent ? '' : ' — <a href="#/agents">create an agent first</a>'}.</p>
      </div>
      <div class="or-controls card">
        <label>Platforms <input id="or-pf" value="${esc(platforms)}" /></label>
        <label>Per platform <input id="or-lim" type="number" value="15" min="1" max="50" style="width:5rem"/></label>
        <button class="btn btn-primary" id="or-find">Find opportunities</button>
        <button class="btn btn-ghost" id="or-reload">Show saved</button>
        <span id="or-status" class="muted"></span>
      </div>
      <div id="or-opps" class="or-list"></div>
    </div>`;

  const status = document.getElementById('or-status');
  const list = document.getElementById('or-opps');

  async function showSaved() {
    list.innerHTML = `<div class="muted">Loading…</div>`;
    try {
      const res = await api.replyOpps(null, 0, 50);
      const opps = res?.opportunities || [];
      list.innerHTML = opps.length ? opps.map(oppCard).join('') : `<div class="empty-state">No saved opportunities. Click “Find opportunities”.</div>`;
      refreshIcons?.();
    } catch (e) { list.innerHTML = `<div class="error-card">${esc(String(e))}</div>`; }
  }

  document.getElementById('or-find').addEventListener('click', async () => {
    const pf = document.getElementById('or-pf').value.trim();
    const lim = parseInt(document.getElementById('or-lim').value, 10) || 15;
    status.textContent = 'Scanning + scoring… (this can take a minute)';
    list.innerHTML = `<div class="loading-skel">Scanning ${esc(pf)}…</div>`;
    try {
      const res = await api.replyFind(pf, lim, false);
      if (res?.error) { status.textContent = res.error; list.innerHTML = `<div class="empty-state">${esc(res.error)}</div>`; return; }
      const opps = res?.opportunities || [];
      status.textContent = `Found ${res?.found ?? opps.length}.`;
      list.innerHTML = opps.length ? opps.map(oppCard).join('') : `<div class="empty-state">No opportunities found. Try more keywords or platforms.</div>`;
      refreshIcons?.();
    } catch (e) { status.textContent = 'Failed: ' + String(e); list.innerHTML = ''; }
  });

  document.getElementById('or-reload').addEventListener('click', showSaved);

  list.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act="draft"]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const slot = list.querySelector(`[data-draft="${CSS.escape(id)}"]`);
    btn.disabled = true; btn.textContent = 'Drafting…';
    try {
      const d = await api.replyDraft(id);
      if (d?.error) { slot.innerHTML = `<div class="error-card">${esc(d.error)}</div>`; }
      else {
        const flag = d.compliant ? '' : `<div class="badge badge-red">⚠ check rules: ${esc(d.compliance_notes || '')}</div>`;
        slot.innerHTML = `${flag}<textarea class="or-draft-text" rows="5">${esc(d.text || '')}</textarea>
          <div class="muted">Review, edit, then post manually.</div>`;
      }
    } catch (e) { slot.innerHTML = `<div class="error-card">${esc(String(e))}</div>`; }
    btn.disabled = false; btn.textContent = 'Re-draft';
  });

  await showSaved();
}
