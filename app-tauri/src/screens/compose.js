// OpenReply — Compose. Generate a post / thread / script / article from the active
// agent's voice + live niche knowledge. Drafts persist for review/scheduling.
import { api, esc } from '../api.js';
import { refreshIcons } from '../icons.js';

const KINDS = [
  ['post', 'Post'], ['thread', 'Thread'], ['script', 'Video script'], ['article', 'Article'],
];

function contentCard(c) {
  return `
  <div class="card or-content">
    <div class="or-content-head">
      <span class="badge">${esc(c.kind)}</span>
      <span class="muted">${esc(c.platform || '')}</span>
      ${c.angle ? `<span class="chip">${esc(c.angle)}</span>` : ''}
      <span class="badge badge-soft">${esc(c.status || 'draft')}</span>
    </div>
    <textarea class="or-content-body" rows="6">${esc(c.body || '')}</textarea>
  </div>`;
}

export async function renderCompose(root) {
  let agent = null;
  try { agent = await api.agentGet(); } catch {}
  const agentName = agent?.name || '—';
  const platforms = agent?.platforms || ['reddit_free'];

  root.innerHTML = `
    <div class="screen or-screen">
      <div class="screen-head">
        <h1>Compose</h1>
        <p class="muted">Generate content for <b>${esc(agentName)}</b> from its live niche knowledge${agent ? '' : ' — <a href="#/agents">create an agent first</a>'}.</p>
      </div>
      <div class="or-controls card">
        <label>Type
          <select id="or-kind">${KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </label>
        <label>Platform
          <select id="or-platform">${platforms.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
        </label>
        <label class="or-grow">Angle (optional)
          <input id="or-angle" placeholder="leave blank to auto-pick the strongest angle"/></label>
        <button class="btn btn-primary" id="or-gen">Generate</button>
        <span id="or-status" class="muted"></span>
      </div>
      <div id="or-result"></div>
      <h3 class="or-sub">Recent drafts</h3>
      <div id="or-recent" class="or-list"></div>
    </div>`;

  const status = document.getElementById('or-status');
  const result = document.getElementById('or-result');

  async function loadRecent() {
    const wrap = document.getElementById('or-recent');
    try {
      const res = await api.contentList(null, null, 20);
      const items = res?.content || [];
      wrap.innerHTML = items.length ? items.map(contentCard).join('') : `<div class="empty-state">No drafts yet.</div>`;
      refreshIcons?.();
    } catch (e) { wrap.innerHTML = `<div class="error-card">${esc(String(e))}</div>`; }
  }

  document.getElementById('or-gen').addEventListener('click', async () => {
    const kind = document.getElementById('or-kind').value;
    const platform = document.getElementById('or-platform').value;
    const angle = document.getElementById('or-angle').value.trim();
    status.textContent = 'Generating…';
    result.innerHTML = `<div class="loading-skel">Writing a ${esc(kind)}…</div>`;
    try {
      const c = await api.contentGenerate(kind, platform, angle);
      if (c?.error) { status.textContent = c.error; result.innerHTML = `<div class="empty-state">${esc(c.error)}</div>`; return; }
      status.textContent = 'Done ✓';
      result.innerHTML = contentCard(c);
      await loadRecent();
    } catch (e) { status.textContent = 'Failed: ' + String(e); result.innerHTML = ''; }
  });

  await loadRecent();
}
