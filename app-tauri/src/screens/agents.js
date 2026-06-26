// OpenReply — Agents dashboard. Each Agent is a brand/niche persona with its own
// knowledge + voice. This is the app's landing screen.
import { api, esc } from '../api.js';
import { refreshIcons } from '../icons.js';

let _platforms = null;

async function loadPlatforms() {
  if (_platforms) return _platforms;
  try { _platforms = (await api.replyPlatforms())?.platforms || []; }
  catch { _platforms = []; }
  return _platforms;
}

function agentCard(a) {
  const kws = (a.keywords || []).slice(0, 6).map(k => `<span class="chip">${esc(k)}</span>`).join('');
  const pfs = (a.platforms || []).map(p => `<span class="chip chip-soft">${esc(p)}</span>`).join('');
  return `
  <div class="card or-agent ${a.active ? 'is-active' : ''}" data-id="${esc(a.id)}">
    <div class="or-agent-head">
      <div>
        <div class="or-agent-name">${esc(a.name)} ${a.active ? '<span class="badge badge-green">active</span>' : ''}</div>
        <div class="muted">${esc(a.niche || a.brand || '')}</div>
      </div>
    </div>
    <div class="or-chips">${kws}</div>
    <div class="or-chips">${pfs}</div>
    <div class="or-agent-actions">
      ${a.active ? '' : `<button class="btn btn-sm" data-act="use" data-id="${esc(a.id)}">Make active</button>`}
      <a class="btn btn-sm" href="#/opportunities">Find replies</a>
      <a class="btn btn-sm" href="#/compose">Create content</a>
      <button class="btn btn-sm btn-ghost" data-act="refresh" data-id="${esc(a.id)}">Refresh knowledge</button>
    </div>
  </div>`;
}

function createForm(platforms) {
  const pfBoxes = platforms.map(p =>
    `<label class="or-check"><input type="checkbox" value="${esc(p.key)}" ${p.key === 'reddit_free' ? 'checked' : ''}/> ${esc(p.label)}</label>`
  ).join('');
  return `
  <details class="card or-create">
    <summary><b>+ New agent</b> — a brand / niche persona</summary>
    <div class="or-form">
      <label>Name<input id="or-name" placeholder="e.g. Acme Notes — student productivity"/></label>
      <label>Niche<input id="or-niche" placeholder="AI note-taking for students"/></label>
      <label>Voice / persona<input id="or-persona" placeholder="ex-teacher, founder of Acme"/></label>
      <label>Keywords (comma-separated)<input id="or-keywords" placeholder="note taking app, obsidian alternative, study notes"/></label>
      <div class="or-platforms"><div class="muted">Platforms to watch</div><div class="or-check-grid">${pfBoxes}</div></div>
      <button class="btn btn-primary" id="or-create">Create agent</button>
      <div id="or-create-msg" class="muted"></div>
    </div>
  </details>`;
}

export async function renderAgents(root) {
  root.innerHTML = `
    <div class="screen or-screen">
      <div class="screen-head">
        <h1>Agents</h1>
        <p class="muted">Each agent is a brand/niche persona that learns its niche and writes replies & content in your voice.</p>
      </div>
      <div id="or-create-wrap"></div>
      <div id="or-agents" class="or-grid"><div class="muted">Loading agents…</div></div>
    </div>`;

  const platforms = await loadPlatforms();
  document.getElementById('or-create-wrap').innerHTML = createForm(platforms);

  async function reload() {
    const grid = document.getElementById('or-agents');
    try {
      const res = await api.agentList();
      const agents = res?.agents || [];
      grid.innerHTML = agents.length
        ? agents.map(agentCard).join('')
        : `<div class="empty-state">No agents yet. Create your first one above.</div>`;
      refreshIcons?.();
    } catch (e) {
      grid.innerHTML = `<div class="error-card">Could not load agents: ${esc(String(e))}</div>`;
    }
  }

  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    if (act === 'use') { await api.agentUse(id); await reload(); }
    if (act === 'refresh') {
      btn.textContent = 'Refreshing…'; btn.disabled = true;
      try { await api.agentRefresh(id, false); } catch {}
      btn.textContent = 'Refresh knowledge'; btn.disabled = false;
    }
  });

  document.getElementById('or-create').addEventListener('click', async () => {
    const name = document.getElementById('or-name').value.trim();
    const msg = document.getElementById('or-create-msg');
    if (!name) { msg.textContent = 'Name is required.'; return; }
    const platformsSel = Array.from(root.querySelectorAll('.or-check input:checked')).map(c => c.value);
    msg.textContent = 'Creating…';
    try {
      await api.agentCreate({
        name,
        niche: document.getElementById('or-niche').value.trim(),
        persona: document.getElementById('or-persona').value.trim(),
        keywords: document.getElementById('or-keywords').value.trim(),
        platforms: platformsSel.join(','),
      });
      msg.textContent = 'Created ✓';
      ['or-name', 'or-niche', 'or-persona', 'or-keywords'].forEach(i => { document.getElementById(i).value = ''; });
      await reload();
    } catch (e) { msg.textContent = 'Failed: ' + String(e); }
  });

  await reload();
}
