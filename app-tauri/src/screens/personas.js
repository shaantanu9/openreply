// Persona agents — Phase 1 (2026-05-12).
//
// Two routes:
//   #/personas        → list + create + per-persona dashboard launcher
//   #/persona/<id>    → single-persona dashboard: Memories | Chat | Ingest
//
// Self-contained module. Remove the route registrations in main.js + the
// nav link in index.html + this file to fully roll back.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ─── helpers ───────────────────────────────────────────────────────────────

function unwrap(rust) {
  // Sidecar one-shot commands return { _parse_error: true, _raw: "..." } if
  // the JSON output didn't parse; otherwise the parsed payload from the CLI.
  if (rust && rust._parse_error) {
    // The CLI emits a single JSON line per command — pull the last non-empty
    // line and try to parse it. This covers `_emit` from persona_cmds.py.
    try {
      const lines = (rust._raw || '').trim().split('\n').filter(Boolean);
      return JSON.parse(lines[lines.length - 1]);
    } catch {
      return { ok: false, error: rust._error || 'parse_error' };
    }
  }
  return rust;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso;
    return dt.toLocaleString();
  } catch { return iso; }
}

function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

// ─── list screen ───────────────────────────────────────────────────────────

export async function renderPersonas(root) {
  root.innerHTML = `
    <div class="screen-pad">
      <div class="page-head">
        <h1>Persona agents</h1>
        <p class="muted">
          Each persona is an always-on learning agent with a single lens.
          When you collect on any topic, every active persona reads the new
          posts, filters for relevance to its lens, and distills the lesson
          into its own memory. Ask the persona questions later; it answers
          from what it's learned.
        </p>
      </div>

      <div id="personas-list" class="personas-grid" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));margin:18px 0"></div>

      <div class="card" style="margin-top:24px">
        <div class="card-head"><h3>Create a new persona</h3></div>
        <div class="card-body" style="display:grid;gap:10px;max-width:560px">
          <label>Name <input id="np-name" placeholder="e.g. Market Hunter"></label>
          <label>Lens (single keyword) <input id="np-lens" placeholder="e.g. market-gap"></label>
          <label>Goal (one sentence) <textarea id="np-goal" rows="2" placeholder="e.g. Learn unmet market needs from every corpus."></textarea></label>
          <label>System prompt override (optional) <textarea id="np-sp" rows="3" placeholder="Leave blank to auto-generate from name + goal + lens"></textarea></label>
          <div style="display:flex;gap:8px;align-items:center">
            <label>Color <input id="np-color" type="color" value="#7c3aed"></label>
            <label>Icon (lucide name)  <input id="np-icon" placeholder="sparkles" value="sparkles"></label>
            <button id="np-create" class="btn-primary" style="margin-left:auto">Create</button>
          </div>
          <div id="np-msg" class="muted" style="font-size:12px"></div>
        </div>
      </div>
    </div>
  `;

  await reloadList(root);

  $('#np-create', root).addEventListener('click', async () => {
    const fields = {
      name:         $('#np-name', root).value.trim(),
      goal:         $('#np-goal', root).value.trim(),
      lens:         $('#np-lens', root).value.trim(),
      systemPrompt: $('#np-sp', root).value.trim() || null,
      color:        $('#np-color', root).value || null,
      icon:         $('#np-icon', root).value.trim() || null,
    };
    if (!fields.name || !fields.goal || !fields.lens) {
      $('#np-msg', root).textContent = 'name, lens, and goal are all required.';
      return;
    }
    $('#np-msg', root).textContent = 'creating…';
    try {
      const r = unwrap(await api.personaCreate(fields));
      if (!r.ok) {
        $('#np-msg', root).textContent = 'error: ' + (r.error || 'unknown');
        return;
      }
      $('#np-msg', root).textContent = `created persona #${r.id} '${r.name}'`;
      $$('#np-name, #np-goal, #np-lens, #np-sp', root).forEach(i => i.value = '');
      await reloadList(root);
    } catch (e) {
      $('#np-msg', root).textContent = 'error: ' + String(e?.message || e);
    }
  });
}

async function reloadList(root) {
  const grid = $('#personas-list', root);
  grid.innerHTML = '<div class="muted">loading…</div>';
  try {
    const r = unwrap(await api.personaList());
    const rows = r?.personas || [];
    if (!rows.length) {
      grid.innerHTML = '<div class="muted">no personas yet — create one below</div>';
      return;
    }
    grid.innerHTML = rows.map(p => personaCard(p)).join('');
    refreshIcons();
    // Wire card actions
    $$('[data-persona-id]', grid).forEach(el => {
      el.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        ev.stopPropagation();
        const id = parseInt(el.dataset.personaId, 10);
        if (act === 'open')   location.hash = `#/persona/${id}`;
        if (act === 'toggle') togglePersona(id, !el.dataset.active || el.dataset.active === '0', root);
        if (act === 'delete') deletePersona(id, root);
      });
    });
  } catch (e) {
    grid.innerHTML = `<div class="muted">error: ${esc(String(e?.message || e))}</div>`;
  }
}

function personaCard(p) {
  const s = p.stats || { memories: 0, edges: 0, topics_seen: 0, last_memory_at: null };
  const color = p.color || '#7c3aed';
  return `
    <div class="card persona-card" data-persona-id="${p.id}" data-active="${p.active}"
         style="border-left:4px solid ${esc(color)};cursor:pointer">
      <div class="card-head" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:8px;display:grid;place-items:center;background:${esc(color)}22;color:${esc(color)}">
          <i data-lucide="${esc(p.icon || 'sparkles')}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <h3 style="margin:0;font-size:16px">${esc(p.name)}</h3>
          <p class="muted" style="margin:2px 0 0;font-size:12px">lens: ${esc(p.lens)} · ${p.active ? 'active' : 'inactive'}</p>
        </div>
      </div>
      <div class="card-body" style="padding:8px 16px 14px">
        <p style="margin:0 0 10px;font-size:13px;line-height:1.4">${esc(p.goal)}</p>
        <div style="display:flex;gap:14px;font-size:12px" class="muted">
          <span><strong>${s.memories}</strong> memories</span>
          <span><strong>${s.topics_seen}</strong> topics</span>
          <span><strong>${s.edges}</strong> edges</span>
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:11px">last memory: ${fmtTime(s.last_memory_at)}</p>
        <div style="display:flex;gap:6px;margin-top:12px">
          <button class="btn-primary" data-act="open">Open</button>
          <button class="btn-ghost-bordered" data-act="toggle">${p.active ? 'Pause' : 'Resume'}</button>
          <button class="btn-ghost-bordered" data-act="delete" style="margin-left:auto;color:#b84747">Delete</button>
        </div>
      </div>
    </div>
  `;
}

async function togglePersona(id, makeActive, root) {
  await api.personaUpdate(id, { active: makeActive });
  await reloadList(root);
}

async function deletePersona(id, root) {
  if (!confirm('Delete this persona and ALL its memories? This cannot be undone.')) return;
  await api.personaDelete(id);
  await reloadList(root);
}


// ─── detail screen ─────────────────────────────────────────────────────────

export async function renderPersona(root, { params } = {}) {
  const id = parseInt((params || [])[0], 10);
  if (!id) {
    root.innerHTML = '<div class="screen-pad muted">invalid persona id</div>';
    return;
  }

  root.innerHTML = `
    <div class="screen-pad">
      <div id="persona-head"></div>
      <div class="tabs" style="margin:14px 0;display:flex;gap:8px;border-bottom:1px solid var(--border, #2a2a2a)">
        <button class="tab-btn active" data-tab="memories" style="padding:8px 14px;background:none;border:none;border-bottom:2px solid var(--accent, #7c3aed);cursor:pointer">Memories</button>
        <button class="tab-btn"        data-tab="chat"     style="padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer">Chat</button>
        <button class="tab-btn"        data-tab="ingest"   style="padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer">Ingest</button>
      </div>
      <div id="persona-body"></div>
    </div>
  `;

  let persona = null;
  try {
    const r = unwrap(await api.personaList());
    persona = (r?.personas || []).find(p => p.id === id);
  } catch {}
  if (!persona) {
    root.innerHTML = `<div class="screen-pad muted">persona #${id} not found</div>`;
    return;
  }

  $('#persona-head', root).innerHTML = renderHead(persona);
  refreshIcons();

  const tabBtns = $$('.tab-btn', root);
  tabBtns.forEach(b => b.addEventListener('click', () => {
    tabBtns.forEach(x => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.style.borderBottomColor = on ? 'var(--accent, #7c3aed)' : 'transparent';
    });
    mountTab(b.dataset.tab, $('#persona-body', root), persona);
  }));
  mountTab('memories', $('#persona-body', root), persona);
}

function renderHead(p) {
  const s = p.stats || {};
  const color = p.color || '#7c3aed';
  return `
    <div style="display:flex;align-items:flex-start;gap:14px">
      <div style="width:48px;height:48px;border-radius:10px;display:grid;place-items:center;background:${esc(color)}22;color:${esc(color)}">
        <i data-lucide="${esc(p.icon || 'sparkles')}" style="width:24px;height:24px"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px">
          <h1 style="margin:0;font-size:22px">${esc(p.name)}</h1>
          <span class="chip" style="background:${esc(color)}22;color:${esc(color)};padding:2px 8px;border-radius:6px;font-size:12px">${esc(p.lens)}</span>
          <span class="muted" style="font-size:12px">${p.active ? 'active' : 'paused'}</span>
        </div>
        <p class="muted" style="margin:6px 0 0">${esc(p.goal)}</p>
        <div style="display:flex;gap:14px;margin-top:8px;font-size:13px" class="muted">
          <span><strong>${s.memories || 0}</strong> memories</span>
          <span><strong>${s.topics_seen || 0}</strong> topics</span>
          <span><strong>${s.edges || 0}</strong> edges</span>
          <span><strong>${s.conclusions || 0}</strong> conclusions</span>
        </div>
      </div>
    </div>
  `;
}

function mountTab(tab, host, persona) {
  if (tab === 'memories') return mountMemoriesTab(host, persona);
  if (tab === 'chat')     return mountChatTab(host, persona);
  if (tab === 'ingest')   return mountIngestTab(host, persona);
}

async function mountMemoriesTab(host, persona) {
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
      <label>Filter by topic <input id="m-topic" placeholder="(all)" style="margin-left:6px"></label>
      <label>Limit <input id="m-limit" type="number" value="50" min="1" max="500" style="width:80px;margin-left:6px"></label>
      <button id="m-refresh" class="btn-ghost-bordered" style="margin-left:auto">Refresh</button>
    </div>
    <div id="m-list" class="muted">loading…</div>
  `;
  async function load() {
    $('#m-list', host).innerHTML = '<div class="muted">loading…</div>';
    const topic = $('#m-topic', host).value.trim() || null;
    const limit = parseInt($('#m-limit', host).value, 10) || 50;
    const r = unwrap(await api.personaMemories(persona.id, { topic, limit }));
    const rows = r?.memories || [];
    if (!rows.length) {
      $('#m-list', host).innerHTML = '<div class="muted">no memories yet — go to the Ingest tab.</div>';
      return;
    }
    $('#m-list', host).innerHTML = rows.map(m => `
      <div class="card" style="margin-bottom:10px">
        <div class="card-body" style="padding:12px 16px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
            <span class="chip" style="font-size:11px;padding:1px 7px;border-radius:5px;background:var(--accent-soft, #7c3aed22)">topic: ${esc(m.topic || '—')}</span>
            <span class="muted" style="font-size:11px">imp ${(m.importance ?? 0).toFixed(2)} · ${fmtTime(m.created_at)}</span>
            <span style="margin-left:auto;font-size:11px" class="muted">mem#${m.id}</span>
          </div>
          <p style="margin:0 0 6px;line-height:1.45">${esc(m.lesson || '')}</p>
          ${m.excerpt ? `<p class="muted" style="margin:0;font-size:12px;font-style:italic">"${esc(m.excerpt)}"</p>` : ''}
          ${m.post_title ? `<p class="muted" style="margin:6px 0 0;font-size:11px">source: ${esc(m.post_source || '?')} — ${esc(m.post_title.slice(0,80))}${m.post_url ? ` <a href="${esc(m.post_url)}" target="_blank">↗</a>` : ''}</p>` : ''}
        </div>
      </div>
    `).join('');
  }
  $('#m-refresh', host).addEventListener('click', load);
  $('#m-topic', host).addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  await load();
}

async function mountChatTab(host, persona) {
  host.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div id="chat-history" style="min-height:200px;max-height:60vh;overflow-y:auto;padding:8px;border:1px solid var(--border, #2a2a2a);border-radius:8px"></div>
      <div style="display:flex;gap:8px">
        <input id="chat-q" placeholder="Ask ${esc(persona.name)} something…" style="flex:1"/>
        <input id="chat-k" type="number" value="8" min="1" max="30" style="width:64px" title="memories to retrieve"/>
        <button id="chat-send" class="btn-primary">Ask</button>
      </div>
      <p class="muted" style="font-size:11px;margin:0">
        Answers come ONLY from ${esc(persona.name)}'s own memories. Citations
        like (M1, M3) point to the memories in the right-hand panel.
      </p>
    </div>
  `;
  const hist = $('#chat-history', host);
  function append(role, text, cits) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:8px 0;padding:8px 12px;border-radius:8px;line-height:1.5';
    wrap.style.background = role === 'user' ? 'var(--accent-soft, #7c3aed22)' : 'var(--bg-elev, #1a1a1a)';
    wrap.innerHTML = `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px" class="muted">${role}</div><div>${esc(text).replace(/\n/g,'<br/>')}</div>`;
    if (cits && cits.length) {
      wrap.innerHTML += `<details style="margin-top:6px"><summary class="muted" style="cursor:pointer;font-size:11px">${cits.length} citations</summary>` +
        cits.map(c => `<div class="muted" style="margin-top:6px;font-size:11px"><strong>${esc(c.tag)}</strong> mem#${c.memory_id} (topic=${esc(c.topic || '—')}): ${esc((c.lesson||'').slice(0,180))}</div>`).join('') +
        `</details>`;
    }
    hist.appendChild(wrap);
    hist.scrollTop = hist.scrollHeight;
  }
  async function ask() {
    const q = $('#chat-q', host).value.trim();
    if (!q) return;
    const k = parseInt($('#chat-k', host).value, 10) || 8;
    append('user', q, null);
    $('#chat-q', host).value = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'muted';
    placeholder.style.cssText = 'margin:8px 0;padding:8px 12px;font-style:italic';
    placeholder.textContent = `${persona.name} is thinking…`;
    hist.appendChild(placeholder);
    hist.scrollTop = hist.scrollHeight;
    try {
      const r = unwrap(await api.personaChat(persona.id, q, k));
      placeholder.remove();
      if (!r.ok) {
        append(persona.name, 'error: ' + (r.error || 'unknown'), null);
      } else {
        append(persona.name, r.answer || '(empty)', r.citations);
      }
    } catch (e) {
      placeholder.remove();
      append(persona.name, 'error: ' + String(e?.message || e), null);
    }
  }
  $('#chat-send', host).addEventListener('click', ask);
  $('#chat-q', host).addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
}

async function mountIngestTab(host, persona) {
  host.innerHTML = `
    <div style="max-width:680px">
      <p class="muted">
        Scans posts already in your corpus that ${esc(persona.name)} hasn't read yet,
        filters them through the lens, and stores any relevant lesson in
        ${esc(persona.name)}'s memory. Safe to re-run — already-ingested posts are skipped.
      </p>
      <div style="display:flex;gap:8px;align-items:center;margin:12px 0">
        <label>Limit posts to scan <input id="in-limit" type="number" value="50" min="1" max="500" style="width:80px;margin-left:6px"></label>
        <label>Topic (optional) <input id="in-topic" placeholder="(all topics)" style="margin-left:6px"></label>
        <button id="in-run" class="btn-primary" style="margin-left:auto">Run ingest</button>
      </div>
      <div id="in-log" style="font-family:var(--mono, ui-monospace, monospace);font-size:12px;padding:10px;border:1px solid var(--border, #2a2a2a);border-radius:8px;min-height:140px;max-height:50vh;overflow-y:auto"></div>
    </div>
  `;
  const log = $('#in-log', host);
  function line(text, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  let progressUnsub, doneUnsub;
  $('#in-run', host).addEventListener('click', async () => {
    log.innerHTML = '';
    const limit = parseInt($('#in-limit', host).value, 10) || 50;
    const topic = $('#in-topic', host).value.trim() || null;
    line(`▶ starting ingest (persona=${persona.name}, topic=${topic || '(all)'}, limit=${limit})`);
    if (progressUnsub) await progressUnsub();
    if (doneUnsub) await doneUnsub();
    progressUnsub = await api.onPersonaIngestProgress(payload => {
      const t = String(payload || '').trim();
      if (!t) return;
      // payload is an NDJSON line emitted by the python CLI
      try {
        const ev = JSON.parse(t);
        if (ev.event === 'start') line(`  start — ${ev.candidates} candidates`);
        else if (ev.event === 'memory') line(`  ✓ mem#${ev.memory_id}: ${(ev.lesson || '').slice(0,150)}`);
        else if (ev.event === 'skip')   line(`  · skip (${ev.reason})`, 'muted');
        else if (ev.event === 'error')  line(`  ✗ ${(ev.error || '').slice(0,150)}`, 'muted');
        else if (ev.event === 'done')   line(`  ▶ done — kept=${ev.kept} dropped=${ev.dropped} errors=${ev.errors}`);
      } catch {
        line(t);
      }
    });
    doneUnsub = await api.onPersonaIngestDone(_payload => {
      line('✔ ingest complete', '');
      if (progressUnsub) progressUnsub();
      if (doneUnsub) doneUnsub();
    });
    try {
      await api.personaIngest({ personaId: persona.id, topic, limit });
    } catch (e) {
      line('error: ' + String(e?.message || e));
    }
  });
}
